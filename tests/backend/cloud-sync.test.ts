import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import sqlite3 from 'sqlite3'
import type { RequestRecord } from '../../src/types/api'
import { cloudEventId, toCloudUsageEvent, toCloudUsageEvents } from '../../electron/cloud-contract'
import { CloudOutbox } from '../../electron/cloud-outbox'

const baseRecord: RequestRecord = {
  id: 'claude-code:C:\\Users\\alice\\.claude\\projects\\demo\\session.jsonl:42',
  timestamp: '2026-07-23T10:20:30.000Z',
  source: 'claude-code',
  sessionId: 'session-secret-ish-id',
  sessionTitle: 'private project title',
  model: 'claude-sonnet-4-6',
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 600,
  cacheCreationTokens: 400,
  cacheTokens: 1_000,
  rawTotalTokens: 1_150,
  weightedTotalTokens: 250,
  totalTokens: 250,
}

function runSql(database: sqlite3.Database, sql: string, params: unknown[] = []) {
  return new Promise<void>((resolve, reject) => {
    database.run(sql, params, (error) => (error ? reject(error) : resolve()))
  })
}

function openSql(pathname: string) {
  return new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(pathname, (error) => (error ? reject(error) : resolve(database)))
  })
}

function closeSql(database: sqlite3.Database) {
  return new Promise<void>((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()))
  })
}

async function removeDb(pathname: string) {
  await fs.rm(pathname, { force: true })
  await fs.rm(`${pathname}-shm`, { force: true })
  await fs.rm(`${pathname}-wal`, { force: true })
}

test('cloud event ID is stable when the same log is copied to another device', () => {
  const copied = {
    ...baseRecord,
    id: 'claude-code:/home/bob/.claude/projects/demo/session.jsonl:42',
  }
  assert.equal(cloudEventId(baseRecord), cloudEventId(copied))
  assert.notEqual(cloudEventId(baseRecord), cloudEventId({ ...baseRecord, id: baseRecord.id.replace(':42', ':43') }))
})

test('cloud payload is a strict statistics-only allowlist', () => {
  const event = toCloudUsageEvent(baseRecord)
  assert.deepEqual(Object.keys(event).sort(), [
    'cacheCreationTokens',
    'cacheReadTokens',
    'cacheTokens',
    'eventId',
    'inputTokens',
    'model',
    'occurredAt',
    'outputTokens',
    'rawTotalTokens',
    'requestCount',
    'schemaVersion',
    'source',
    'usageChannel',
    'weightedTotalTokens',
  ].sort())
  assert.equal(JSON.stringify(event).includes('private project title'), false)
  assert.equal(JSON.stringify(event).includes('session-secret-ish-id'), false)
  assert.equal(JSON.stringify(event).includes('.claude'), false)
})

test('local duplicate records collapse to one cloud event', () => {
  const events = toCloudUsageEvents([baseRecord, { ...baseRecord, id: `${baseRecord.id}` }])
  assert.equal(events.length, 1)
})

test('outbox keeps one row per event and requeues changed payloads', async () => {
  const dbPath = path.join(os.tmpdir(), `agent-token-tracker-cloud-${process.pid}-${Date.now()}.sqlite`)
  const outbox = new CloudOutbox(dbPath)
  const event = toCloudUsageEvent(baseRecord)
  const userId = 'user-a'

  try {
    await outbox.enqueue(userId, [event])
    await outbox.enqueue(userId, [event])
    assert.deepEqual(await outbox.stats(userId), { pendingCount: 1, uploadedCount: 0 })

    const batch = await outbox.claim(userId, 10)
    assert.equal(batch.length, 1)
    assert.equal(batch[0].payload.eventId, event.eventId)
    await outbox.markUploaded(userId, [event.eventId])
    assert.deepEqual(await outbox.stats(userId), { pendingCount: 0, uploadedCount: 1 })

    const changed = { ...event, outputTokens: event.outputTokens + 1 }
    await outbox.enqueue(userId, [changed])
    assert.deepEqual(await outbox.stats(userId), { pendingCount: 1, uploadedCount: 0 })
    const changedBatch = await outbox.claim(userId, 10)
    assert.equal(changedBatch[0].payload.outputTokens, event.outputTokens + 1)
    await outbox.markFailed(userId, [event.eventId], 'temporary network error')
    assert.deepEqual(await outbox.stats(userId), { pendingCount: 1, uploadedCount: 0 })
  } finally {
    await outbox.close()
    await removeDb(dbPath)
  }
})

test('an in-flight upload cannot overwrite a newer payload state', async () => {
  const dbPath = path.join(os.tmpdir(), `agent-token-tracker-cloud-race-${process.pid}-${Date.now()}.sqlite`)
  const outbox = new CloudOutbox(dbPath)
  const original = toCloudUsageEvent(baseRecord)
  const userId = 'user-a'

  try {
    await outbox.enqueue(userId, [original])
    const firstUpload = await outbox.claim(userId, 10)
    assert.equal(firstUpload.length, 1)

    const newer = { ...original, outputTokens: original.outputTokens + 1 }
    await outbox.enqueue(userId, [newer])
    await outbox.markUploaded(userId, [original.eventId])
    assert.deepEqual(await outbox.stats(userId), { pendingCount: 1, uploadedCount: 0 })

    const secondUpload = await outbox.claim(userId, 10)
    assert.equal(secondUpload[0].payload.outputTokens, newer.outputTokens)

    const newest = { ...newer, outputTokens: newer.outputTokens + 1 }
    await outbox.enqueue(userId, [newest])
    await outbox.markFailed(userId, [original.eventId], 'stale upload failed')
    const thirdUpload = await outbox.claim(userId, 10)
    assert.equal(thirdUpload[0].payload.outputTokens, newest.outputTokens)
    assert.equal(thirdUpload[0].attempts, 0)
    assert.equal(thirdUpload[0].lastError, undefined)
  } finally {
    await outbox.close()
    await removeDb(dbPath)
  }
})

test('outbox rows are isolated between cloud accounts', async () => {
  const dbPath = path.join(os.tmpdir(), `agent-token-tracker-cloud-isolation-${process.pid}-${Date.now()}.sqlite`)
  const outbox = new CloudOutbox(dbPath)
  const event = toCloudUsageEvent(baseRecord)
  const accountA = 'user-a'
  const accountB = 'user-b'

  try {
    await outbox.enqueue(accountA, [event])
    await outbox.enqueue(accountB, [event])
    assert.deepEqual(await outbox.stats(accountA), { pendingCount: 1, uploadedCount: 0 })
    assert.deepEqual(await outbox.stats(accountB), { pendingCount: 1, uploadedCount: 0 })

    assert.equal((await outbox.claim(accountA, 10)).length, 1)
    await outbox.markUploaded(accountA, [event.eventId])
    assert.deepEqual(await outbox.stats(accountA), { pendingCount: 0, uploadedCount: 1 })
    assert.deepEqual(await outbox.stats(accountB), { pendingCount: 1, uploadedCount: 0 })
    assert.equal((await outbox.claim(accountB, 10)).length, 1)
  } finally {
    await outbox.close()
    await removeDb(dbPath)
  }
})

test('legacy v1 outbox is adopted by only the first authenticated account', async () => {
  const dbPath = path.join(os.tmpdir(), `agent-token-tracker-cloud-legacy-${process.pid}-${Date.now()}.sqlite`)
  const event = toCloudUsageEvent(baseRecord)
  const legacy = await openSql(dbPath)
  try {
    await runSql(legacy, `
      CREATE TABLE cloud_outbox (
        event_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        claimed_at TEXT,
        updated_at TEXT NOT NULL
      )
    `)
    await runSql(
      legacy,
      `INSERT INTO cloud_outbox
        (event_id, payload_json, attempts, status, last_error, claimed_at, updated_at)
       VALUES (?, ?, 2, 'uploaded', NULL, NULL, ?)`,
      [event.eventId, JSON.stringify(event), new Date().toISOString()],
    )
  } finally {
    await closeSql(legacy)
  }

  const outbox = new CloudOutbox(dbPath)
  try {
    assert.deepEqual(await outbox.stats('first-user'), { pendingCount: 0, uploadedCount: 1 })
    assert.deepEqual(await outbox.stats('second-user'), { pendingCount: 0, uploadedCount: 0 })
    assert.equal((await outbox.claim('first-user', 10)).length, 0)
  } finally {
    await outbox.close()
    await removeDb(dbPath)
  }
})

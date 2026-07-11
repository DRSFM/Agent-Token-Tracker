import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sqlite3 from 'sqlite3'
import { querySqliteRows } from '../../electron/sqlite'

test('querySqliteRows reads SQLite without a system sqlite3 command', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-token-sqlite-'))
  const dbPath = path.join(root, 'usage.db')
  try {
    await new Promise<void>((resolve, reject) => {
      const database = new sqlite3.Database(dbPath)
      database.exec('create table usage (id text, tokens integer); insert into usage values (\'req-1\', 42)', (error) => {
        database.close()
        if (error) reject(error)
        else resolve()
      })
    })

    const rows = await querySqliteRows<{ id: string; tokens: number }>(dbPath, 'select id, tokens from usage')

    assert.deepEqual(rows, [{ id: 'req-1', tokens: 42 }])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

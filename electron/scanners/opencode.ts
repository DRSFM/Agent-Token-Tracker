import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { RequestRecord } from '../../src/types/api'
import {
  asNumber,
  asRecord,
  asString,
  cacheKey,
  pathExists,
  reusableCachedFile,
  sessionTitleFromCwd,
  shortId,
  type CachedSourceFile,
  type JsonlFileMetadata,
  type SourceScanResult,
} from './shared'
import { querySqliteRows } from '../sqlite'

const OPENCODE_USAGE_QUERY = `
select
  m.id as messageId,
  m.session_id as sessionId,
  m.time_created as timeCreated,
  m.data as data,
  s.title as sessionTitle,
  s.directory as sessionDirectory,
  s.path as sessionPath
from message m
left join session s on s.id = m.session_id
where m.data like '%"tokens"%'
order by m.time_created asc
`

interface OpenCodeUsageRow {
  messageId?: string
  sessionId?: string
  timeCreated?: number
  data?: string
  sessionTitle?: string
  sessionDirectory?: string
  sessionPath?: string
}

export function openCodeDataRoot() {
  const configured = process.env.OPENCODE_DATA_DIR?.trim()
  return configured || path.join(os.homedir(), '.local', 'share', 'opencode')
}

export function openCodeDbPath(root = openCodeDataRoot()) {
  const configured = process.env.OPENCODE_DB_PATH?.trim()
  return configured || path.join(root, 'opencode.db')
}

export async function scanOpenCode(
  cache = new Map<string, CachedSourceFile>(),
  root = openCodeDataRoot(),
): Promise<SourceScanResult> {
  const rootExists = await pathExists(root)
  const dbPath = openCodeDbPath(root)
  const metadata = await getOpenCodeDbMetadata(dbPath)
  const records: RequestRecord[] = []
  const cacheEntries: CachedSourceFile[] = []
  let parsedFiles = 0
  let reusedFiles = 0
  let lastError: string | undefined

  if (metadata) {
    const cached = reusableCachedFile('opencode', metadata, cache)
    if (cached) {
      records.push(...cached.records)
      cacheEntries.push(cached)
      reusedFiles = 1
    } else {
      try {
        const rows = await readOpenCodeUsageRows(dbPath)
        records.push(...openCodeRowsToRecords(rows, dbPath))
        parsedFiles = 1
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }

      cacheEntries.push({
        source: 'opencode',
        filePath: metadata.filePath,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        records,
      })
    }
  }

  cacheEntries.sort((a, b) => cacheKey(a.source, a.filePath).localeCompare(cacheKey(b.source, b.filePath)))

  return {
    source: 'opencode',
    label: 'opencode',
    rootPath: root,
    records,
    scannedFiles: metadata ? 1 : 0,
    parsedFiles,
    reusedFiles,
    rootExists,
    cacheEntries,
    lastError,
  }
}

async function getOpenCodeDbMetadata(dbPath: string): Promise<JsonlFileMetadata | null> {
  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
  let size = 0
  let mtimeMs = 0
  let foundDb = false

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate)
      if (!stats.isFile()) continue
      if (candidate === dbPath) foundDb = true
      size += stats.size
      mtimeMs = Math.max(mtimeMs, stats.mtimeMs)
    } catch {
      // WAL/SHM files are optional.
    }
  }

  if (!foundDb) return null
  return { filePath: dbPath, size, mtimeMs }
}

async function readOpenCodeUsageRows(dbPath: string) {
  return querySqliteRows<OpenCodeUsageRow>(dbPath, OPENCODE_USAGE_QUERY)
}

export function openCodeRowsToRecords(rows: OpenCodeUsageRow[], dbPath: string): RequestRecord[] {
  const records: RequestRecord[] = []

  for (const row of rows) {
    const data = parseOpenCodeMessageData(row.data)
    if (!data) continue
    if (asString(data.role) !== 'assistant') continue

    const tokens = asRecord(data.tokens)
    if (!tokens) continue

    const modelId = asString(data.modelID) ?? asString(asRecord(data.model)?.modelID) ?? 'opencode-unknown'
    const providerId = asString(data.providerID) ?? asString(asRecord(data.model)?.providerID)
    const model = normalizeOpenCodeModel(modelId, providerId)
    const inputTokens = asNumber(tokens.input)
    const outputTokens = asNumber(tokens.output) + asNumber(tokens.reasoning)
    const cache = asRecord(tokens.cache)
    const cacheReadTokens = asNumber(cache?.read)
    const cacheCreationTokens = asNumber(cache?.write)
    const cacheTokens = cacheReadTokens + cacheCreationTokens
    const rawTotalTokens = asNumber(tokens.total) || inputTokens + outputTokens + cacheTokens
    const weightedTotalTokens = Math.round(inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens * 0.1)
    const sessionId = row.sessionId || asString(data.sessionID) || 'opencode-unknown-session'
    const cwd = asString(asRecord(data.path)?.cwd) ?? row.sessionDirectory ?? row.sessionPath
    const sessionTitle = row.sessionTitle?.trim() || sessionTitleFromCwd(cwd, shortId(sessionId))
    const timestamp = timestampFromOpenCodeRow(row.timeCreated, data)
    const messageId = row.messageId || `${sessionId}-${records.length + 1}`

    records.push({
      id: `opencode:${dbPath}:${messageId}`,
      timestamp,
      source: 'opencode',
      sessionId,
      sessionTitle,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      cacheTokens,
      rawTotalTokens,
      weightedTotalTokens,
      totalTokens: weightedTotalTokens,
    })
  }

  return records
}

function parseOpenCodeMessageData(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

function normalizeOpenCodeModel(modelId: string, providerId?: string) {
  const model = modelId.trim()
  if (model) return model
  return providerId ? `${providerId}-unknown` : 'opencode-unknown'
}

function timestampFromOpenCodeRow(timeCreated: unknown, data: Record<string, unknown>) {
  const time = asRecord(data.time)
  const completed = asNumber(time?.completed)
  const created = asNumber(time?.created) || asNumber(timeCreated)
  const value = completed || created
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

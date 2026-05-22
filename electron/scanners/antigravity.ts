import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { RequestRecord } from '../../src/types/api'
import {
  asNumber,
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

const execFileAsync = promisify(execFile)

const ANTIGRAVITY_USAGE_QUERY = `
select idx, hex(data) as dataHex, size
from gen_metadata
order by idx asc
`

const ANTIGRAVITY_TRAJECTORY_QUERY = `
select trajectory_id as trajectoryId, cascade_id as cascadeId
from trajectory_meta
limit 1
`

interface AntigravityUsageRow {
  idx?: number
  dataHex?: string
  size?: number
}

interface AntigravityTrajectoryRow {
  trajectoryId?: string
  cascadeId?: string
}

interface AntigravityDbFile extends JsonlFileMetadata {
  sessionId: string
}

interface ProtoField {
  fieldNumber: number
  wireType: number
  value: bigint | number | Buffer | undefined
}

interface AntigravityUsage {
  requestId?: string
  model: string
  inputTokens: number
  outputTokens: number
  timestamp: string
}

export function antigravityDataRoot() {
  const configured = process.env.ANTIGRAVITY_DATA_DIR?.trim()
  return configured || path.join(os.homedir(), '.gemini', 'antigravity')
}

export function antigravityConversationsRoot(root = antigravityDataRoot()) {
  return path.join(root, 'conversations')
}

export async function scanAntigravity(
  cache = new Map<string, CachedSourceFile>(),
  root = antigravityDataRoot(),
): Promise<SourceScanResult> {
  const conversationsRoot = antigravityConversationsRoot(root)
  const rootExists = await pathExists(root)
  const dbFiles = await listAntigravityDbFiles(conversationsRoot)
  const records: RequestRecord[] = []
  const cacheEntries: CachedSourceFile[] = []
  let parsedFiles = 0
  let reusedFiles = 0

  for (const dbFile of dbFiles) {
    const cached = reusableCachedFile('antigravity', dbFile, cache)
    if (cached) {
      records.push(...cached.records)
      cacheEntries.push(cached)
      reusedFiles += 1
      continue
    }

    const fileRecords: RequestRecord[] = []
    try {
      const [rows, trajectory] = await Promise.all([
        readAntigravityUsageRows(dbFile.filePath),
        readAntigravityTrajectory(dbFile.filePath),
      ])
      fileRecords.push(...antigravityRowsToRecords(rows, dbFile.filePath, {
        sessionId: trajectory?.cascadeId || dbFile.sessionId,
        trajectoryId: trajectory?.trajectoryId,
        root,
      }))
      parsedFiles += 1
    } catch {
      // Antigravity stores usage as protobuf blobs inside SQLite. If sqlite3 is
      // unavailable or a database is locked, let the other sources keep working.
    }

    records.push(...fileRecords)
    cacheEntries.push({
      source: 'antigravity',
      filePath: dbFile.filePath,
      size: dbFile.size,
      mtimeMs: dbFile.mtimeMs,
      records: fileRecords,
    })
  }

  cacheEntries.sort((a, b) => cacheKey(a.source, a.filePath).localeCompare(cacheKey(b.source, b.filePath)))

  return {
    source: 'antigravity',
    label: 'Antigravity',
    rootPath: root,
    records,
    scannedFiles: dbFiles.length,
    parsedFiles,
    reusedFiles,
    rootExists,
    cacheEntries,
  }
}

async function listAntigravityDbFiles(conversationsRoot: string): Promise<AntigravityDbFile[]> {
  if (!(await pathExists(conversationsRoot))) return []

  let entries: string[] = []
  try {
    entries = await fs.readdir(conversationsRoot)
  } catch {
    return []
  }

  const dbPaths = entries
    .filter((name) => name.endsWith('.db'))
    .map((name) => path.join(conversationsRoot, name))
  const metadata = await Promise.all(dbPaths.map(getAntigravityDbMetadata))
  return metadata.filter((item): item is AntigravityDbFile => Boolean(item))
}

async function getAntigravityDbMetadata(dbPath: string): Promise<AntigravityDbFile | null> {
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
  return {
    filePath: dbPath,
    size,
    mtimeMs,
    sessionId: path.basename(dbPath, '.db'),
  }
}

async function readAntigravityUsageRows(dbPath: string) {
  const { stdout } = await execFileAsync(
    'sqlite3',
    ['-json', dbPath, ANTIGRAVITY_USAGE_QUERY],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  )
  const parsed = JSON.parse(stdout || '[]')
  return Array.isArray(parsed) ? parsed as AntigravityUsageRow[] : []
}

async function readAntigravityTrajectory(dbPath: string): Promise<AntigravityTrajectoryRow | null> {
  try {
    const { stdout } = await execFileAsync(
      'sqlite3',
      ['-json', dbPath, ANTIGRAVITY_TRAJECTORY_QUERY],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    const parsed = JSON.parse(stdout || '[]')
    return Array.isArray(parsed) ? parsed[0] as AntigravityTrajectoryRow | undefined ?? null : null
  } catch {
    return null
  }
}

export function antigravityRowsToRecords(
  rows: AntigravityUsageRow[],
  dbPath: string,
  options: { sessionId: string; trajectoryId?: string; root?: string },
): RequestRecord[] {
  const sessionId = options.sessionId || path.basename(dbPath, '.db')
  const title = antigravitySessionTitle(options.root, sessionId)
  const records: RequestRecord[] = []

  for (const row of rows) {
    const usage = parseAntigravityUsageHex(row.dataHex)
    if (!usage) continue
    if (usage.inputTokens <= 0 && usage.outputTokens <= 0) continue

    const messageId = usage.requestId || `${sessionId}-${row.idx ?? records.length + 1}`
    const rawTotalTokens = usage.inputTokens + usage.outputTokens

    records.push({
      id: `antigravity:${dbPath}:${messageId}`,
      timestamp: usage.timestamp,
      source: 'antigravity',
      sessionId,
      sessionTitle: title,
      model: normalizeAntigravityModel(usage.model),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheTokens: 0,
      rawTotalTokens,
      weightedTotalTokens: rawTotalTokens,
      totalTokens: rawTotalTokens,
    })
  }

  return records
}

function antigravitySessionTitle(root: string | undefined, sessionId: string) {
  if (!root) return shortId(sessionId)
  return sessionTitleFromCwd(path.join(root, 'brain', sessionId), shortId(sessionId))
}

export function parseAntigravityUsageHex(hex: unknown): AntigravityUsage | null {
  const value = asString(hex)
  if (!value || !/^[\da-f]+$/i.test(value) || value.length % 2 !== 0) return null
  return parseAntigravityUsageBlob(Buffer.from(value, 'hex'))
}

export function parseAntigravityUsageBlob(buffer: Buffer): AntigravityUsage | null {
  const top = parseProtoFields(buffer)
  const envelope = firstMessage(top, 1)
  const usage = envelope ? firstMessage(envelope, 4) : null
  if (!envelope || !usage) return null

  const inputTokens = numberField(usage, 2)
  const outputTokens = numberField(usage, 3) || numberField(usage, 10)
  const model = stringField(envelope, 19) || metadataValue(envelope, 'model') || 'antigravity-unknown'
  const timestamp = timestampFromEnvelope(envelope)

  return {
    requestId: stringField(usage, 11),
    model,
    inputTokens,
    outputTokens,
    timestamp,
  }
}

function parseProtoFields(buffer: Buffer) {
  const fields: ProtoField[] = []
  let offset = 0

  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset)
    if (!tag) break
    offset = tag.offset
    const fieldNumber = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 7n)
    if (fieldNumber <= 0) break

    if (wireType === 0) {
      const value = readVarint(buffer, offset)
      if (!value) break
      fields.push({ fieldNumber, wireType, value: value.value })
      offset = value.offset
      continue
    }

    if (wireType === 1) {
      if (offset + 8 > buffer.length) break
      fields.push({ fieldNumber, wireType, value: buffer.readDoubleLE(offset) })
      offset += 8
      continue
    }

    if (wireType === 2) {
      const length = readVarint(buffer, offset)
      if (!length) break
      offset = length.offset
      const byteLength = Number(length.value)
      if (!Number.isFinite(byteLength) || byteLength < 0 || offset + byteLength > buffer.length) break
      fields.push({ fieldNumber, wireType, value: buffer.subarray(offset, offset + byteLength) })
      offset += byteLength
      continue
    }

    if (wireType === 5) {
      if (offset + 4 > buffer.length) break
      fields.push({ fieldNumber, wireType, value: buffer.readFloatLE(offset) })
      offset += 4
      continue
    }

    break
  }

  return fields
}

function readVarint(buffer: Buffer, offset: number) {
  let value = 0n
  let shift = 0n
  let cursor = offset

  while (cursor < buffer.length && cursor - offset < 10) {
    const byte = buffer[cursor]
    value |= BigInt(byte & 0x7f) << shift
    cursor += 1
    if ((byte & 0x80) === 0) return { value, offset: cursor }
    shift += 7n
  }

  return null
}

function firstMessage(fields: ProtoField[], fieldNumber: number) {
  for (const field of fields) {
    if (field.fieldNumber !== fieldNumber || !Buffer.isBuffer(field.value)) continue
    const parsed = parseProtoFields(field.value)
    if (parsed.length) return parsed
  }
  return null
}

function allMessages(fields: ProtoField[], fieldNumber: number) {
  return fields
    .filter((field) => field.fieldNumber === fieldNumber && Buffer.isBuffer(field.value))
    .map((field) => parseProtoFields(field.value as Buffer))
    .filter((parsed) => parsed.length)
}

function numberField(fields: ProtoField[], fieldNumber: number) {
  const field = fields.find((item) => item.fieldNumber === fieldNumber)
  return asNumber(protoNumber(field?.value))
}

function stringField(fields: ProtoField[], fieldNumber: number) {
  const field = fields.find((item) => item.fieldNumber === fieldNumber)
  if (!Buffer.isBuffer(field?.value)) return undefined
  const text = field.value.toString('utf8').trim()
  return isPrintableText(text) ? text : undefined
}

function metadataValue(fields: ProtoField[], key: string) {
  for (const metadata of allMessages(fields, 20)) {
    const itemKey = stringField(metadata, 1)
    if (!itemKey || !itemKey.toLowerCase().includes(key.toLowerCase())) continue
    const value = stringField(metadata, 2)
    if (value) return value
  }
  return undefined
}

function timestampFromEnvelope(fields: ProtoField[]) {
  const timing = firstMessage(fields, 9)
  const secondsAndNanos = timing ? findSecondsAndNanos(timing) : null
  if (secondsAndNanos) {
    const [seconds, nanos] = secondsAndNanos
    return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString()
  }
  return new Date().toISOString()
}

function findSecondsAndNanos(fields: ProtoField[]): [number, number] | null {
  const directSeconds = numberField(fields, 1)
  const directNanos = numberField(fields, 2)
  if (isPlausibleEpochSecond(directSeconds) && directNanos >= 0 && directNanos < 1_000_000_000) {
    return [directSeconds, directNanos]
  }

  for (const field of fields) {
    if (!Buffer.isBuffer(field.value)) continue
    const nested = parseProtoFields(field.value)
    const found = findSecondsAndNanos(nested)
    if (found) return found
  }

  return null
}

function protoNumber(value: unknown) {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return 0
    return Number(value)
  }
  return value
}

function isPlausibleEpochSecond(value: number) {
  return value >= 1_577_836_800 && value <= 2_208_988_800
}

function isPrintableText(value: string) {
  return /^[\u0009\u000a\u000d\u0020-\u007e]+$/.test(value)
}

function normalizeAntigravityModel(model: string) {
  const normalized = model.trim().toLowerCase()
  if (!normalized || normalized.startsWith('model_placeholder')) return 'antigravity-unknown'
  return normalized
}

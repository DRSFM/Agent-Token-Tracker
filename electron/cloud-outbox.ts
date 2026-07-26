import sqlite3 from 'sqlite3'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CloudUsageEvent } from '../src/types/api'
import { getUserDataPath } from './app-paths'
import { isCloudUsageEvent } from './cloud-contract'

export type CloudOutboxStatus = 'pending' | 'uploading' | 'uploaded'

export interface CloudOutboxRow {
  eventId: string
  payload: CloudUsageEvent
  attempts: number
  status: CloudOutboxStatus
  lastError?: string
}

export interface CloudOutboxStats {
  pendingCount: number
  uploadedCount: number
}

export function cloudOutboxPath() {
  return path.join(getUserDataPath(), 'cloud-sync.sqlite')
}

/**
 * Development builds used to evaluate cloudOutboxPath before main.ts changed
 * Electron's userData directory. Keep that old database available when the
 * corrected development path is opened for the first time.
 */
export function legacyCloudOutboxPath(userDataPath: string) {
  return path.basename(userDataPath).toLowerCase() === 'development'
    ? path.join(path.dirname(userDataPath), 'cloud-sync.sqlite')
    : null
}

function run(database: sqlite3.Database, sql: string, params: unknown[] = []) {
  return new Promise<{ changes: number; lastID: number }>((resolve, reject) => {
    database.run(sql, params, function onRun(error) {
      if (error) reject(error)
      else resolve({ changes: this.changes, lastID: this.lastID })
    })
  })
}

function all<T>(database: sqlite3.Database, sql: string, params: unknown[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) reject(error)
      else resolve((rows ?? []) as T[])
    })
  })
}

function close(database: sqlite3.Database) {
  return new Promise<void>((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()))
  })
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function normalizeUserId(userId: string) {
  const normalized = userId.trim()
  if (!normalized) throw new Error('Cloud outbox requires an authenticated user id.')
  return normalized
}

interface StoredRow {
  event_id: string
  payload_json: string
  attempts: number
  status: CloudOutboxStatus
  last_error: string | null
}

interface TableColumn {
  name: string
}

interface TableName {
  name: string
}

const createOutboxTable = `
  CREATE TABLE IF NOT EXISTS cloud_outbox (
    user_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'uploading', 'uploaded')),
    last_error TEXT,
    claimed_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, event_id)
  )
`

export class CloudOutbox {
  private database: sqlite3.Database | null = null
  private opening: Promise<sqlite3.Database> | null = null
  private legacyTable: string | null = null
  private legacyAdoption: Promise<void> | null = null

  /**
   * Keep the default path unresolved until open(). Electron sets userData in
   * main.ts before the first database operation, while this module is
   * imported earlier during startup.
   */
  constructor(private readonly explicitDbPath?: string) {}

  private async ensureSchema(database: sqlite3.Database) {
    const columns = await all<TableColumn>(database, 'PRAGMA table_info("cloud_outbox")')
    if (columns.length && !columns.some((column) => column.name === 'user_id')) {
      const existingNames = new Set(
        (await all<TableName>(
          database,
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cloud_outbox_legacy%'`,
        )).map((table) => table.name),
      )
      let legacyName = 'cloud_outbox_legacy'
      let suffix = 1
      while (existingNames.has(legacyName)) legacyName = `cloud_outbox_legacy_${suffix++}`
      await run(database, `ALTER TABLE "cloud_outbox" RENAME TO ${quoteIdentifier(legacyName)}`)
      this.legacyTable = legacyName
    }

    await run(database, createOutboxTable)
    await run(database, `
      CREATE TABLE IF NOT EXISTS cloud_outbox_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    if (!this.legacyTable) {
      const legacyTables = await all<TableName>(
        database,
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cloud_outbox_legacy%' ORDER BY name`,
      )
      this.legacyTable = legacyTables[0]?.name ?? null
    }
  }

  async open() {
    if (this.database) return this.database
    if (this.opening) return this.opening

    this.opening = (async () => {
      const dbPath = this.explicitDbPath ?? cloudOutboxPath()
      await fs.mkdir(path.dirname(dbPath), { recursive: true })
      if (!this.explicitDbPath) await this.copyLegacyDatabaseIfNeeded(dbPath)
      const database = await new Promise<sqlite3.Database>((resolve, reject) => {
        const next = new sqlite3.Database(dbPath, (error) => {
          if (error) reject(error)
          else resolve(next)
        })
      })
      try {
        await run(database, 'PRAGMA busy_timeout = 3000')
        await this.ensureSchema(database)
        this.database = database
        return database
      } catch (error) {
        await close(database).catch(() => {})
        throw error
      }
    })()

    try {
      return await this.opening
    } finally {
      this.opening = null
    }
  }

  private async copyLegacyDatabaseIfNeeded(dbPath: string) {
    const legacyPath = legacyCloudOutboxPath(path.dirname(dbPath))
    if (!legacyPath || path.resolve(legacyPath) === path.resolve(dbPath)) return
    try {
      await fs.access(dbPath)
      return
    } catch {
      // The corrected path does not exist yet; continue below.
    }
    try {
      await fs.access(legacyPath)
    } catch {
      return
    }

    try {
      await fs.copyFile(legacyPath, dbPath, fsConstants.COPYFILE_EXCL)
      for (const suffix of ['-wal', '-shm']) {
        try {
          await fs.copyFile(`${legacyPath}${suffix}`, `${dbPath}${suffix}`, fsConstants.COPYFILE_EXCL)
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : ''
          if (code !== 'ENOENT' && code !== 'EEXIST') throw error
        }
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : ''
      if (code !== 'EEXIST') {
        throw new Error(`无法迁移开发版云同步数据库：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** Adopt v1 rows exactly once, for the first authenticated account that uses this DB. */
  private async adoptLegacyRows(database: sqlite3.Database, userId: string) {
    if (!this.legacyTable) return
    if (this.legacyAdoption) return this.legacyAdoption

    const normalizedUserId = normalizeUserId(userId)
    const legacyTable = this.legacyTable
    this.legacyAdoption = (async () => {
      await run(database, 'BEGIN IMMEDIATE')
      try {
        const adopted = await all<{ value: string }>(
          database,
          `SELECT value FROM cloud_outbox_meta WHERE key = 'legacy_adopted_user_id' LIMIT 1`,
        )
        if (!adopted.length) {
          const columns = new Set(
            (await all<TableColumn>(database, `PRAGMA table_info(${quoteIdentifier(legacyTable)})`))
              .map((column) => column.name),
          )
          const expression = (name: string, fallback: string) =>
            columns.has(name) ? quoteIdentifier(name) : fallback
          const now = new Date().toISOString()
          const updatedAtExpression = columns.has('updated_at')
            ? `COALESCE(${quoteIdentifier('updated_at')}, ?)`
            : '?'
          await run(
            database,
            `
              INSERT OR IGNORE INTO cloud_outbox
                (user_id, event_id, payload_json, attempts, status, last_error, claimed_at, updated_at)
              SELECT ?, event_id, payload_json,
                COALESCE(${expression('attempts', '0')}, 0),
                CASE WHEN ${expression('status', "'pending'")} IN ('pending', 'uploading', 'uploaded')
                  THEN ${expression('status', "'pending'")} ELSE 'pending' END,
                ${expression('last_error', 'NULL')},
                ${expression('claimed_at', 'NULL')},
                ${updatedAtExpression}
              FROM ${quoteIdentifier(legacyTable)}
              WHERE event_id IS NOT NULL AND payload_json IS NOT NULL
            `,
            [normalizedUserId, now],
          )
          // Keep the renamed table as an archive; the metadata marker prevents
          // another account from adopting the same v1 rows later.
          await run(
            database,
            `INSERT INTO cloud_outbox_meta (key, value) VALUES ('legacy_adopted_user_id', ?)`
              + ` ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [normalizedUserId],
          )
        }
        await run(database, 'COMMIT')
        this.legacyTable = null
      } catch (error) {
        await run(database, 'ROLLBACK').catch(() => {})
        throw error
      }
    })()

    try {
      await this.legacyAdoption
    } finally {
      this.legacyAdoption = null
    }
  }

  async enqueue(userId: string, events: CloudUsageEvent[]) {
    if (!events.length) return 0
    const normalizedUserId = normalizeUserId(userId)
    const database = await this.open()
    await this.adoptLegacyRows(database, normalizedUserId)
    await run(database, 'BEGIN IMMEDIATE')
    try {
      const now = new Date().toISOString()
      for (const event of events) {
        if (!isCloudUsageEvent(event)) {
          throw new Error(`Invalid cloud usage event: ${String((event as Partial<CloudUsageEvent>).eventId ?? 'unknown')}`)
        }
        await run(
          database,
          `
            INSERT INTO cloud_outbox
              (user_id, event_id, payload_json, attempts, status, last_error, claimed_at, updated_at)
            VALUES (?, ?, ?, 0, 'pending', NULL, NULL, ?)
            ON CONFLICT(user_id, event_id) DO UPDATE SET
              payload_json = excluded.payload_json,
              status = CASE
                WHEN cloud_outbox.payload_json = excluded.payload_json THEN cloud_outbox.status
                ELSE 'pending'
              END,
              attempts = CASE
                WHEN cloud_outbox.payload_json = excluded.payload_json THEN cloud_outbox.attempts
                ELSE 0
              END,
              last_error = CASE
                WHEN cloud_outbox.payload_json = excluded.payload_json THEN cloud_outbox.last_error
                ELSE NULL
              END,
              claimed_at = NULL,
              updated_at = excluded.updated_at
          `,
          [normalizedUserId, event.eventId, JSON.stringify(event), now],
        )
      }
      await run(database, 'COMMIT')
      return events.length
    } catch (error) {
      await run(database, 'ROLLBACK').catch(() => {})
      throw error
    }
  }

  async claim(userId: string, limit = 100): Promise<CloudOutboxRow[]> {
    const normalizedUserId = normalizeUserId(userId)
    const database = await this.open()
    await this.adoptLegacyRows(database, normalizedUserId)
    await run(
      database,
      `UPDATE cloud_outbox
       SET status = 'pending', claimed_at = NULL
       WHERE user_id = ? AND status = 'uploading' AND claimed_at < ?`,
      [normalizedUserId, new Date(Date.now() - 10 * 60 * 1000).toISOString()],
    )
    const rows = await all<StoredRow>(
      database,
      `SELECT event_id, payload_json, attempts, status, last_error
       FROM cloud_outbox
       WHERE user_id = ? AND status = 'pending'
       ORDER BY updated_at ASC
       LIMIT ?`,
      [normalizedUserId, Math.max(1, Math.min(500, Math.floor(limit)))],
    )
    if (!rows.length) return []

    const claimedAt = new Date().toISOString()
    await run(
      database,
      `UPDATE cloud_outbox SET status = 'uploading', claimed_at = ?, updated_at = ?
       WHERE user_id = ? AND event_id IN (${rows.map(() => '?').join(',')})`,
      [claimedAt, claimedAt, normalizedUserId, ...rows.map((row) => row.event_id)],
    )

    return rows.flatMap((row) => {
      try {
        const payload = JSON.parse(row.payload_json) as unknown
        return isCloudUsageEvent(payload)
          ? [{
              eventId: row.event_id,
              payload,
              attempts: row.attempts,
              status: 'uploading' as const,
              lastError: row.last_error ?? undefined,
            }]
          : []
      } catch {
        return []
      }
    })
  }

  async markUploaded(userId: string, eventIds: string[]) {
    if (!eventIds.length) return
    const normalizedUserId = normalizeUserId(userId)
    const database = await this.open()
    await this.adoptLegacyRows(database, normalizedUserId)
    const now = new Date().toISOString()
    await run(
      database,
      `UPDATE cloud_outbox SET status = 'uploaded', claimed_at = NULL, last_error = NULL, updated_at = ?
       WHERE user_id = ? AND status = 'uploading'
         AND event_id IN (${eventIds.map(() => '?').join(',')})`,
      [now, normalizedUserId, ...eventIds],
    )
  }

  async markFailed(userId: string, eventIds: string[], message: string) {
    if (!eventIds.length) return
    const normalizedUserId = normalizeUserId(userId)
    const database = await this.open()
    await this.adoptLegacyRows(database, normalizedUserId)
    const now = new Date().toISOString()
    await run(
      database,
      `UPDATE cloud_outbox
       SET status = 'pending', claimed_at = NULL, attempts = attempts + 1, last_error = ?, updated_at = ?
       WHERE user_id = ? AND status = 'uploading'
         AND event_id IN (${eventIds.map(() => '?').join(',')})`,
      [message.slice(0, 1000), now, normalizedUserId, ...eventIds],
    )
  }

  async stats(userId: string | null): Promise<CloudOutboxStats> {
    if (!userId?.trim()) return { pendingCount: 0, uploadedCount: 0 }
    const normalizedUserId = normalizeUserId(userId)
    const database = await this.open()
    await this.adoptLegacyRows(database, normalizedUserId)
    const rows = await all<{ status: CloudOutboxStatus; count: number }>(
      database,
      'SELECT status, COUNT(*) AS count FROM cloud_outbox WHERE user_id = ? GROUP BY status',
      [normalizedUserId],
    )
    return {
      pendingCount: rows
        .filter((row) => row.status === 'pending' || row.status === 'uploading')
        .reduce((sum, row) => sum + Number(row.count), 0),
      uploadedCount: rows
        .filter((row) => row.status === 'uploaded')
        .reduce((sum, row) => sum + Number(row.count), 0),
    }
  }

  async close() {
    if (!this.database) return
    const database = this.database
    this.database = null
    this.legacyTable = null
    await close(database)
  }
}

export const cloudOutbox = new CloudOutbox()

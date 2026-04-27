import { app } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  DailyTrendPoint,
  DataSourceStatus,
  DateRange,
  HeatmapCell,
  ModelShare,
  OverviewStats,
  RankBy,
  RequestRecord,
  SessionSummary,
} from '../src/types/api'
import { claudeCodeRoot, scanClaudeCode } from './scanners/claude'
import { codexSessionsRoot, scanCodex } from './scanners/codex'
import { cacheKey, type CachedSourceFile, type SourceScanResult } from './scanners/shared'
import {
  getRemoteSourceSettings,
  remoteClaudeCacheRoot,
  remoteCodexCacheRoot,
} from './remote-sync'

interface ScanState {
  records: RequestRecord[]
  scannedFiles: number
  parsedFiles: number
  reusedFiles: number
  sourceRootsFound: number
  sources: DataSourceStatus['sources']
  lastUpdatedAt: string
  healthy: boolean
}

interface ScanCacheFile {
  version: number
  files: CachedSourceFile[]
}

const CACHE_VERSION = 2
const CACHE_FILE_NAME = 'scan-cache.json'

const emptyState = (): ScanState => ({
  records: [],
  scannedFiles: 0,
  parsedFiles: 0,
  reusedFiles: 0,
  sourceRootsFound: 0,
  sources: [],
  lastUpdatedAt: new Date(0).toISOString(),
  healthy: false,
})

function cacheFilePath() {
  return path.join(app.getPath('userData'), CACHE_FILE_NAME)
}

export function scanCacheFilePath() {
  return cacheFilePath()
}

async function loadScanCache() {
  try {
    const raw = await fs.readFile(cacheFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ScanCacheFile>
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.files)) {
      return new Map<string, CachedSourceFile>()
    }

    return new Map(
      parsed.files
        .filter((entry): entry is CachedSourceFile => {
          return (
            !!entry &&
            typeof entry.filePath === 'string' &&
            typeof entry.size === 'number' &&
            typeof entry.mtimeMs === 'number' &&
            Array.isArray(entry.records)
          )
        })
        .map((entry) => [cacheKey(entry.source, entry.filePath), entry]),
    )
  } catch {
    return new Map<string, CachedSourceFile>()
  }
}

async function saveScanCache(entries: CachedSourceFile[]) {
  const payload: ScanCacheFile = {
    version: CACHE_VERSION,
    files: entries,
  }

  try {
    await fs.mkdir(path.dirname(cacheFilePath()), { recursive: true })
    await fs.writeFile(cacheFilePath(), JSON.stringify(payload), 'utf8')
  } catch {
    // Cache persistence is an optimization. Scanning should still succeed.
  }
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function parseLocalDate(value: string, end = false) {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  if (!year || !month || !day) return end ? endOfDay(new Date(value)) : startOfDay(new Date(value))
  return end
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day)
}

function rangeBounds(range: DateRange) {
  if (range.kind === 'absolute') {
    return {
      from: parseLocalDate(range.from),
      to: parseLocalDate(range.to, true),
    }
  }

  const days = Math.max(1, Math.floor(range.days))
  const today = startOfDay(new Date())
  return {
    from: addDays(today, -(days - 1)),
    to: endOfDay(today),
  }
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function filterByRange(records: RequestRecord[], range: DateRange) {
  const { from, to } = rangeBounds(range)
  return records.filter((record) => {
    const date = new Date(record.timestamp)
    return date >= from && date <= to
  })
}

function sumTokens(records: RequestRecord[]) {
  return records.reduce((sum, record) => sum + record.totalTokens, 0)
}

function sumRawTokens(records: RequestRecord[]) {
  return records.reduce((sum, record) => sum + (record.rawTotalTokens ?? record.totalTokens), 0)
}

function sumCacheTokens(records: RequestRecord[]) {
  return records.reduce((sum, record) => sum + (record.cacheTokens ?? 0), 0)
}

function deltaPct(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 1
  return (current - previous) / previous
}

function sameLocalDay(record: RequestRecord, target: Date) {
  return dateKey(new Date(record.timestamp)) === dateKey(target)
}

function weekdayMondayFirst(date: Date) {
  return (date.getDay() + 6) % 7
}

export class TokenDataStore {
  private state: ScanState = emptyState()
  private scanPromise: Promise<ScanState> | null = null
  private watcher: FSWatcher | null = null
  private watchTimer: NodeJS.Timeout | null = null

  async ensureScanned() {
    if (this.state.lastUpdatedAt !== new Date(0).toISOString()) return this.state
    return this.rescan()
  }

  async rescan() {
    if (this.scanPromise) return this.scanPromise

    this.scanPromise = this.runScan().finally(() => {
      this.scanPromise = null
    })

    return this.scanPromise
  }

  private async runScan() {
    const cache = await loadScanCache()
    const remoteSettings = await getRemoteSourceSettings()
    const scanTasks: Promise<SourceScanResult>[] = [scanClaudeCode(cache), scanCodex(cache)]

    if (remoteSettings.enabled && remoteSettings.host) {
      const remoteLabel = remoteSettings.host
      scanTasks.push(
        scanClaudeCode(cache, remoteClaudeCacheRoot()).then((result) => ({
          ...result,
          label: `Remote Claude Code (${remoteLabel})`,
        })),
        scanCodex(cache, remoteCodexCacheRoot()).then((result) => ({
          ...result,
          label: `Remote Codex (${remoteLabel})`,
        })),
      )
    }

    const settled = await Promise.allSettled(scanTasks)
    const fulfilled = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    )
    const records = fulfilled
      .flatMap((result) => result.records)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    const cacheEntries = fulfilled.flatMap((result) => result.cacheEntries)
    const sources = fulfilled.map((result) => sourceStatusFromScanResult(result))

    await saveScanCache(cacheEntries)

    this.state = {
      records,
      scannedFiles: fulfilled.reduce((sum, result) => sum + result.scannedFiles, 0),
      parsedFiles: fulfilled.reduce((sum, result) => sum + result.parsedFiles, 0),
      reusedFiles: fulfilled.reduce((sum, result) => sum + result.reusedFiles, 0),
      sourceRootsFound: fulfilled.filter((result) => result.rootExists).length,
      sources,
      lastUpdatedAt: new Date().toISOString(),
      healthy:
        fulfilled.some((result) => result.rootExists) &&
        settled.some((result) => result.status === 'fulfilled'),
    }

    return this.state
  }

  startWatching(onDataChanged: () => void) {
    if (this.watcher) return

    this.watcher = chokidar.watch([claudeCodeRoot(), codexSessionsRoot()], {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 750,
        pollInterval: 100,
      },
    })

    const schedule = (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return
      if (this.watchTimer) clearTimeout(this.watchTimer)
      this.watchTimer = setTimeout(() => {
        void this.rescan().then(onDataChanged).catch(() => {})
      }, 500)
    }

    this.watcher.on('add', schedule)
    this.watcher.on('change', schedule)
    this.watcher.on('unlink', schedule)
  }

  async stopWatching() {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  async clearCache() {
    try {
      await fs.rm(cacheFilePath(), { force: true })
      this.state = emptyState()
      return { cleared: true }
    } catch {
      return { cleared: false }
    }
  }

  async getOverviewStats(_range: DateRange): Promise<OverviewStats> {
    const { records } = await this.ensureScanned()
    const today = startOfDay(new Date())
    const yesterday = addDays(today, -1)
    const todayRecords = records.filter((record) => sameLocalDay(record, today))
    const yesterdayRecords = records.filter((record) => sameLocalDay(record, yesterday))

    const todayTotalTokens = sumTokens(todayRecords)
    const yesterdayTotalTokens = sumTokens(yesterdayRecords)
    const todayRequestCount = todayRecords.length
    const yesterdayRequestCount = yesterdayRecords.length
    const todayAvgPerRequest = todayRequestCount ? Math.round(todayTotalTokens / todayRequestCount) : 0
    const yesterdayAvgPerRequest = yesterdayRequestCount
      ? Math.round(yesterdayTotalTokens / yesterdayRequestCount)
      : 0
    const activeSessionCount = new Set(todayRecords.map((record) => record.sessionId)).size
    const yesterdayActiveSessionCount = new Set(yesterdayRecords.map((record) => record.sessionId)).size

    return {
      todayTotalTokens,
      todayRawTotalTokens: sumRawTokens(todayRecords),
      todayCacheTokens: sumCacheTokens(todayRecords),
      todayRequestCount,
      todayAvgPerRequest,
      activeSessionCount,
      todayTotalDeltaPct: deltaPct(todayTotalTokens, yesterdayTotalTokens),
      todayRequestDeltaPct: deltaPct(todayRequestCount, yesterdayRequestCount),
      todayAvgDeltaPct: deltaPct(todayAvgPerRequest, yesterdayAvgPerRequest),
      activeSessionDeltaPct: deltaPct(activeSessionCount, yesterdayActiveSessionCount),
    }
  }

  async getDailyTrend(range: DateRange): Promise<DailyTrendPoint[]> {
    const { records } = await this.ensureScanned()
    const { from, to } = rangeBounds(range)
    const buckets = new Map<string, number>()
    for (let cursor = startOfDay(from); cursor <= to; cursor = addDays(cursor, 1)) {
      buckets.set(dateKey(cursor), 0)
    }

    for (const record of filterByRange(records, range)) {
      const key = dateKey(new Date(record.timestamp))
      buckets.set(key, (buckets.get(key) ?? 0) + record.totalTokens)
    }

    return [...buckets.entries()].map(([date, totalTokens]) => ({ date, totalTokens }))
  }

  async getModelShares(range: DateRange, by: RankBy): Promise<ModelShare[]> {
    const { records } = await this.ensureScanned()
    const buckets = new Map<string, { totalTokens: number; requestCount: number }>()
    for (const record of filterByRange(records, range)) {
      const current = buckets.get(record.model) ?? { totalTokens: 0, requestCount: 0 }
      current.totalTokens += record.totalTokens
      current.requestCount += 1
      buckets.set(record.model, current)
    }

    const denominator = [...buckets.values()].reduce(
      (sum, item) => sum + (by === 'tokens' ? item.totalTokens : item.requestCount),
      0,
    )

    return [...buckets.entries()]
      .map(([model, item]) => ({
        model,
        totalTokens: item.totalTokens,
        requestCount: item.requestCount,
        share: denominator ? (by === 'tokens' ? item.totalTokens : item.requestCount) / denominator : 0,
      }))
      .sort((a, b) =>
        by === 'tokens' ? b.totalTokens - a.totalTokens : b.requestCount - a.requestCount,
      )
  }

  async getSessionRanking(range: DateRange, by: RankBy, limit: number): Promise<SessionSummary[]> {
    const { records } = await this.ensureScanned()
    const buckets = new Map<string, SessionSummary>()
    for (const record of filterByRange(records, range)) {
      const current = buckets.get(record.sessionId) ?? {
        sessionId: record.sessionId,
        title: record.sessionTitle ?? record.sessionId,
        source: record.source,
        totalTokens: 0,
        requestCount: 0,
        lastActiveAt: record.timestamp,
      }
      current.totalTokens += record.totalTokens
      current.requestCount += 1
      if (new Date(record.timestamp) > new Date(current.lastActiveAt)) {
        current.lastActiveAt = record.timestamp
      }
      buckets.set(record.sessionId, current)
    }

    return [...buckets.values()]
      .sort((a, b) =>
        by === 'tokens' ? b.totalTokens - a.totalTokens : b.requestCount - a.requestCount,
      )
      .slice(0, Math.max(0, limit))
  }

  async getHourlyHeatmap(range: DateRange): Promise<HeatmapCell[]> {
    const { records } = await this.ensureScanned()
    const buckets = new Map<string, number>()
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        buckets.set(`${weekday}:${hour}`, 0)
      }
    }

    for (const record of filterByRange(records, range)) {
      const date = new Date(record.timestamp)
      const key = `${weekdayMondayFirst(date)}:${date.getHours()}`
      buckets.set(key, (buckets.get(key) ?? 0) + record.totalTokens)
    }

    return [...buckets.entries()].map(([key, totalTokens]) => {
      const [weekday, hour] = key.split(':').map((value) => Number(value))
      return { weekday, hour, totalTokens }
    })
  }

  async getRecentRequests(limit: number): Promise<RequestRecord[]> {
    const { records } = await this.ensureScanned()
    return records.slice(0, Math.max(0, limit))
  }

  async getDataSourceStatus(): Promise<DataSourceStatus> {
    const state = await this.ensureScanned()
    return {
      kind: 'local-estimate',
      label: '本地估算',
      lastUpdatedAt: state.lastUpdatedAt,
      healthy: state.healthy,
      scannedFiles: state.scannedFiles,
      parsedFiles: state.parsedFiles,
      reusedFiles: state.reusedFiles,
      requestCount: state.records.length,
      sources: state.sources,
    }
  }
}

export const tokenDataStore = new TokenDataStore()

function sourceStatusFromScanResult(result: SourceScanResult): DataSourceStatus['sources'][number] {
  return {
    source: result.source,
    label: result.label,
    rootPath: result.rootPath,
    rootExists: result.rootExists,
    healthy: result.rootExists,
    scannedFiles: result.scannedFiles,
    parsedFiles: result.parsedFiles,
    reusedFiles: result.reusedFiles,
    requestCount: result.records.length,
  }
}

// 客户端聚合工具 —— 从 RequestRecord[] 派生各种视图所需数据
import type {
  AgentSource,
  DailyTrendPoint,
  HeatmapCell,
  ModelShare,
  OverviewStats,
  RankBy,
  RequestRecord,
  SessionSummary,
  UsageChannel,
  UsageUpstream,
} from '@/types/api'
import { estimateRequestValue } from './pricing'

export const SOURCE_LABEL: Record<AgentSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  antigravity: 'Antigravity',
  grok: 'Grok CLI',
  unknown: '未知',
}

export const SOURCE_COLOR: Record<AgentSource, string> = {
  'claude-code': '#8b5cf6',
  codex: '#10b981',
  opencode: '#0ea5e9',
  antigravity: '#f59e0b',
  grok: '#111827',
  unknown: '#94a3b8',
}

export interface RangeOpt {
  /** 包含起点 */
  fromMs: number
  /** 包含终点 */
  toMs: number
}

export const lastNDays = (days: number): RangeOpt => {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return { fromMs: start.getTime(), toMs: end.getTime() }
}

export const allTimeRange = (records: RequestRecord[]): RangeOpt => {
  const times = records
    .map((record) => new Date(record.timestamp).getTime())
    .filter(Number.isFinite)
  if (!times.length) return lastNDays(1)

  const start = new Date(Math.min(...times))
  start.setHours(0, 0, 0, 0)
  const end = new Date(Math.max(...times))
  end.setHours(23, 59, 59, 999)
  return { fromMs: start.getTime(), toMs: end.getTime() }
}

export const rangeDayCount = (range: RangeOpt) => {
  const start = new Date(range.fromMs)
  start.setHours(0, 0, 0, 0)
  const end = new Date(range.toMs)
  end.setHours(0, 0, 0, 0)
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
}

/** 在 RangeOpt 之前的同长度区间，用于做对比 */
export const previousRange = (range: RangeOpt): RangeOpt => {
  const span = range.toMs - range.fromMs + 1
  return { fromMs: range.fromMs - span, toMs: range.fromMs - 1 }
}

export const inRange = (record: RequestRecord, range: RangeOpt) => {
  const t = new Date(record.timestamp).getTime()
  return t >= range.fromMs && t <= range.toMs
}

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const sumTokens = (records: RequestRecord[]) =>
  records.reduce((s, r) => s + r.totalTokens, 0)

const deltaPct = (current: number, previous: number) => {
  if (previous === 0) return current === 0 ? 0 : 1
  return (current - previous) / previous
}

type SessionIdentityFields = Pick<RequestRecord, 'source' | 'sessionId' | 'usageChannel' | 'upstream'>

export const sessionIdentity = (record: SessionIdentityFields) =>
  [record.source, record.usageChannel ?? 'account', record.upstream?.id ?? '', record.sessionId].join('\u0000')

export function aggregateOverviewStats(records: RequestRecord[]): OverviewStats {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const todayRecords = records.filter((record) => dateKey(new Date(record.timestamp)) === dateKey(today))
  const yesterdayRecords = records.filter((record) => dateKey(new Date(record.timestamp)) === dateKey(yesterday))
  const todayTotalTokens = sumTokens(todayRecords)
  const yesterdayTotalTokens = sumTokens(yesterdayRecords)
  const todayRequestCount = todayRecords.length
  const yesterdayRequestCount = yesterdayRecords.length
  const todayAvgPerRequest = todayRequestCount ? Math.round(todayTotalTokens / todayRequestCount) : 0
  const yesterdayAvgPerRequest = yesterdayRequestCount
    ? Math.round(yesterdayTotalTokens / yesterdayRequestCount)
    : 0
  const activeSessionCount = new Set(todayRecords.map(sessionIdentity)).size
  const yesterdayActiveSessionCount = new Set(yesterdayRecords.map(sessionIdentity)).size

  return {
    todayTotalTokens,
    todayRawTotalTokens: todayRecords.reduce((sum, record) => sum + rawTokenTotal(record), 0),
    todayCacheTokens: todayRecords.reduce((sum, record) => sum + (record.cacheTokens ?? 0), 0),
    todayRequestCount,
    todayAvgPerRequest,
    activeSessionCount,
    todayTotalDeltaPct: deltaPct(todayTotalTokens, yesterdayTotalTokens),
    todayRequestDeltaPct: deltaPct(todayRequestCount, yesterdayRequestCount),
    todayAvgDeltaPct: deltaPct(todayAvgPerRequest, yesterdayAvgPerRequest),
    activeSessionDeltaPct: deltaPct(activeSessionCount, yesterdayActiveSessionCount),
  }
}

const rawTokenTotal = (record: RequestRecord) => record.rawTotalTokens ?? record.totalTokens
export const weightedTokenTotal = (record: RequestRecord) => {
  const outputTokens = Math.max(record.outputTokens, 0)
  const cacheTokens = Math.max(record.cacheTokens ?? record.cacheReadTokens ?? 0, 0)
  if (record.source === 'claude-code') {
    return Math.round(Math.max(record.inputTokens, 0) + outputTokens + cacheTokens * 0.1)
  }

  const rawTotal = rawTokenTotal(record)
  if (cacheTokens > 0) return Math.max(0, Math.round(rawTotal - cacheTokens * 0.9))
  return record.weightedTotalTokens ?? record.totalTokens
}

/** 按 sessionId 聚合 — 比 SessionSummary 多带 model 列表 */
export interface SessionAggregate {
  sessionId: string
  title: string
  source: AgentSource
  usageChannel?: UsageChannel
  upstream?: UsageUpstream
  totalTokens: number
  rawTotalTokens: number
  weightedTotalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  nonCachedBillableTokens: number
  estimatedValueUsd: number
  cachedValueUsd: number
  nonCachedValueUsd: number
  cacheReadTokens: number
  cacheWriteTokens: number
  pricedRequestCount: number
  unpricedRequestCount: number
  requestCount: number
  models: { model: string; tokens: number; count: number }[]
  firstActiveAt: string
  lastActiveAt: string
}

export function aggregateSessions(records: RequestRecord[]): SessionAggregate[] {
  const map = new Map<string, SessionAggregate>()
  for (const r of records) {
    const identity = sessionIdentity(r)
    let agg = map.get(identity)
    if (!agg) {
      agg = {
        sessionId: r.sessionId,
        title: r.sessionTitle ?? r.sessionId,
        source: r.source,
        usageChannel: r.usageChannel,
        upstream: r.upstream,
        totalTokens: 0,
        rawTotalTokens: 0,
        weightedTotalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        nonCachedBillableTokens: 0,
        estimatedValueUsd: 0,
        cachedValueUsd: 0,
        nonCachedValueUsd: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        pricedRequestCount: 0,
        unpricedRequestCount: 0,
        requestCount: 0,
        models: [],
        firstActiveAt: r.timestamp,
        lastActiveAt: r.timestamp,
      }
      map.set(identity, agg)
    }
    agg.totalTokens += r.totalTokens
    agg.rawTotalTokens += rawTokenTotal(r)
    agg.weightedTotalTokens += weightedTokenTotal(r)
    agg.inputTokens += r.inputTokens
    agg.outputTokens += r.outputTokens
    agg.cacheTokens += r.cacheTokens ?? 0
    const estimatedValue = estimateRequestValue(r)
    agg.nonCachedBillableTokens += estimatedValue.uncachedInputTokens + estimatedValue.outputTokens
    agg.estimatedValueUsd += estimatedValue.totalUsd
    agg.cachedValueUsd += estimatedValue.cachedUsd
    agg.nonCachedValueUsd += estimatedValue.nonCachedUsd
    agg.cacheReadTokens += estimatedValue.cacheReadTokens
    agg.cacheWriteTokens += estimatedValue.cacheWriteTokens
    if (estimatedValue.priced) agg.pricedRequestCount += 1
    else agg.unpricedRequestCount += 1
    agg.requestCount += 1
    if (new Date(r.timestamp) > new Date(agg.lastActiveAt)) agg.lastActiveAt = r.timestamp
    if (new Date(r.timestamp) < new Date(agg.firstActiveAt)) agg.firstActiveAt = r.timestamp

    const m = agg.models.find((x) => x.model === r.model)
    if (m) {
      m.tokens += rawTokenTotal(r)
      m.count += 1
    } else {
      agg.models.push({ model: r.model, tokens: rawTokenTotal(r), count: 1 })
    }
  }
  for (const a of map.values()) a.models.sort((x, y) => y.tokens - x.tokens)
  return [...map.values()]
}

/** 按 model 聚合 + share */
export function aggregateModels(records: RequestRecord[], by: RankBy = 'tokens'): ModelShare[] {
  const map = new Map<string, { rawTotalTokens: number; weightedTotalTokens: number; requestCount: number }>()
  for (const r of records) {
    const cur = map.get(r.model) ?? { rawTotalTokens: 0, weightedTotalTokens: 0, requestCount: 0 }
    cur.rawTotalTokens += rawTokenTotal(r)
    cur.weightedTotalTokens += weightedTokenTotal(r)
    cur.requestCount += 1
    map.set(r.model, cur)
  }
  const total = [...map.values()].reduce(
    (sum, value) => sum + (by === 'tokens' ? value.rawTotalTokens : value.requestCount),
    0,
  )
  return [...map.entries()]
    .map(([model, v]) => ({
      model,
      rawTotalTokens: v.rawTotalTokens,
      weightedTotalTokens: v.weightedTotalTokens,
      totalTokens: v.rawTotalTokens,
      requestCount: v.requestCount,
      share: total ? (by === 'tokens' ? v.rawTotalTokens : v.requestCount) / total : 0,
    }))
    .sort((a, b) => by === 'tokens' ? b.totalTokens - a.totalTokens : b.requestCount - a.requestCount)
}

export function aggregateSessionRanking(
  records: RequestRecord[],
  by: RankBy,
  limit: number,
): SessionSummary[] {
  return aggregateSessions(records)
    .map((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      source: session.source,
      usageChannel: session.usageChannel,
      upstream: session.upstream,
      totalTokens: session.totalTokens,
      requestCount: session.requestCount,
      lastActiveAt: session.lastActiveAt,
    }))
    .sort((a, b) => by === 'tokens' ? b.totalTokens - a.totalTokens : b.requestCount - a.requestCount)
    .slice(0, Math.max(0, limit))
}

/** 按日聚合（指定窗口内每日 token） */
export function aggregateDaily(records: RequestRecord[], range: RangeOpt): DailyTrendPoint[] {
  const buckets = new Map<string, number>()
  const cursor = new Date(range.fromMs)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= range.toMs) {
    buckets.set(dateKey(cursor), 0)
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const r of records) {
    if (!inRange(r, range)) continue
    const k = dateKey(new Date(r.timestamp))
    buckets.set(k, (buckets.get(k) ?? 0) + r.totalTokens)
  }
  return [...buckets.entries()].map(([date, totalTokens]) => ({ date, totalTokens }))
}

/** 按日 + 来源 聚合（堆叠面积图用） */
export interface DailyBySourcePoint {
  date: string
  bySource: Record<AgentSource, number>
  total: number
}

export function aggregateDailyBySource(
  records: RequestRecord[],
  range: RangeOpt,
): DailyBySourcePoint[] {
  const buckets = new Map<string, DailyBySourcePoint>()
  const cursor = new Date(range.fromMs)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= range.toMs) {
    const k = dateKey(cursor)
    buckets.set(k, {
      date: k,
      bySource: { 'claude-code': 0, codex: 0, opencode: 0, antigravity: 0, grok: 0, unknown: 0 },
      total: 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const r of records) {
    if (!inRange(r, range)) continue
    const k = dateKey(new Date(r.timestamp))
    const cell = buckets.get(k)
    if (!cell) continue
    cell.bySource[r.source] += r.totalTokens
    cell.total += r.totalTokens
  }
  return [...buckets.values()]
}

/** 时段热力（周一为 0） */
export function aggregateHeatmap(records: RequestRecord[]): HeatmapCell[] {
  const cells: HeatmapCell[] = []
  for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) cells.push({ weekday: w, hour: h, totalTokens: 0 })
  for (const r of records) {
    const d = new Date(r.timestamp)
    const w = (d.getDay() + 6) % 7
    const h = d.getHours()
    const cell = cells[w * 24 + h]
    cell.totalTokens += r.totalTokens
  }
  return cells
}

/** 单模型在窗口内的每日 token（sparkline 用） */
export function modelDailySeries(
  records: RequestRecord[],
  model: string,
  range: RangeOpt,
): number[] {
  const buckets = new Map<string, number>()
  const cursor = new Date(range.fromMs)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= range.toMs) {
    buckets.set(dateKey(cursor), 0)
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const r of records) {
    if (r.model !== model || !inRange(r, range)) continue
    const k = dateKey(new Date(r.timestamp))
    buckets.set(k, (buckets.get(k) ?? 0) + rawTokenTotal(r))
  }
  return [...buckets.values()]
}

// 客户端聚合工具 —— 从 RequestRecord[] 派生各种视图所需数据
import type {
  AgentSource,
  DailyTrendPoint,
  HeatmapCell,
  ModelShare,
  RequestRecord,
} from '@/types/api'

export const SOURCE_LABEL: Record<AgentSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  unknown: '未知',
}

export const SOURCE_COLOR: Record<AgentSource, string> = {
  'claude-code': '#8b5cf6',
  codex: '#10b981',
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

/** 按 sessionId 聚合 — 比 SessionSummary 多带 model 列表 */
export interface SessionAggregate {
  sessionId: string
  title: string
  source: AgentSource
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  requestCount: number
  models: { model: string; tokens: number; count: number }[]
  firstActiveAt: string
  lastActiveAt: string
}

export function aggregateSessions(records: RequestRecord[]): SessionAggregate[] {
  const map = new Map<string, SessionAggregate>()
  for (const r of records) {
    let agg = map.get(r.sessionId)
    if (!agg) {
      agg = {
        sessionId: r.sessionId,
        title: r.sessionTitle ?? r.sessionId,
        source: r.source,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        requestCount: 0,
        models: [],
        firstActiveAt: r.timestamp,
        lastActiveAt: r.timestamp,
      }
      map.set(r.sessionId, agg)
    }
    agg.totalTokens += r.totalTokens
    agg.inputTokens += r.inputTokens
    agg.outputTokens += r.outputTokens
    agg.cacheTokens += r.cacheTokens ?? 0
    agg.requestCount += 1
    if (new Date(r.timestamp) > new Date(agg.lastActiveAt)) agg.lastActiveAt = r.timestamp
    if (new Date(r.timestamp) < new Date(agg.firstActiveAt)) agg.firstActiveAt = r.timestamp

    const m = agg.models.find((x) => x.model === r.model)
    if (m) {
      m.tokens += r.totalTokens
      m.count += 1
    } else {
      agg.models.push({ model: r.model, tokens: r.totalTokens, count: 1 })
    }
  }
  for (const a of map.values()) a.models.sort((x, y) => y.tokens - x.tokens)
  return [...map.values()]
}

/** 按 model 聚合 + share */
export function aggregateModels(records: RequestRecord[]): ModelShare[] {
  const map = new Map<string, { totalTokens: number; requestCount: number }>()
  for (const r of records) {
    const cur = map.get(r.model) ?? { totalTokens: 0, requestCount: 0 }
    cur.totalTokens += r.totalTokens
    cur.requestCount += 1
    map.set(r.model, cur)
  }
  const total = [...map.values()].reduce((s, v) => s + v.totalTokens, 0)
  return [...map.entries()]
    .map(([model, v]) => ({
      model,
      totalTokens: v.totalTokens,
      requestCount: v.requestCount,
      share: total ? v.totalTokens / total : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
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
      bySource: { 'claude-code': 0, codex: 0, unknown: 0 },
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
    buckets.set(k, (buckets.get(k) ?? 0) + r.totalTokens)
  }
  return [...buckets.values()]
}

// ============================================================
// Shared IPC Contract — 前后端共享类型
// ============================================================
// 这是前端 (Claude Code 维护) 与 Electron 主进程 (Codex 维护)
// 之间的"合同"。所有跨进程的数据形状都在这里声明。
//
// Codex 在 electron/ipc-handlers.ts 中实现这些方法的真实逻辑；
// 前端通过 window.tokenAPI 调用（见 electron/preload.ts 和
// src/lib/api.ts）。
//
// 修改本文件时请同步更新：
//   - electron/preload.ts        (IPC bridge)
//   - electron/ipc-handlers.ts   (主进程实现 / Codex 部分)
//   - src/lib/mock.ts            (开发期 mock)
// ============================================================

/** 已知的 agent 工具来源 */
export type AgentSource = 'claude-code' | 'codex' | 'unknown'

/** 单条请求记录 (一次模型调用) */
export interface RequestRecord {
  id: string
  /** ISO timestamp */
  timestamp: string
  source: AgentSource
  /** 会话 ID，用于聚合到 SessionSummary */
  sessionId: string
  /** 会话标题（如有，否则用 ID 截断） */
  sessionTitle?: string
  model: string
  inputTokens: number
  outputTokens: number
  /** 缓存读 token (claude code 提供) */
  cacheReadTokens?: number
  /** 缓存写 token */
  cacheCreationTokens?: number
  /** 缓存 token 总量 */
  cacheTokens?: number
  /** 未加权原始总量 */
  rawTotalTokens?: number
  /** 加权估算总量，当前等同于 totalTokens */
  weightedTotalTokens?: number
  /** 加权估算总量，用于图表、排序和概览主数字 */
  totalTokens: number
}

/** 概览页顶部的 4 个统计卡片 */
export interface OverviewStats {
  /** 今日加权估算总量 */
  todayTotalTokens: number
  /** 今日未加权原始总量 */
  todayRawTotalTokens: number
  /** 今日缓存 token 总量 */
  todayCacheTokens: number
  todayRequestCount: number
  todayAvgPerRequest: number
  activeSessionCount: number
  /** 较昨日变化百分比 (e.g. 0.186 = +18.6%) */
  todayTotalDeltaPct: number
  todayRequestDeltaPct: number
  todayAvgDeltaPct: number
  activeSessionDeltaPct: number
}

/** 每日 token 趋势点 */
export interface DailyTrendPoint {
  /** YYYY-MM-DD */
  date: string
  totalTokens: number
}

/** 模型占比 */
export interface ModelShare {
  model: string
  totalTokens: number
  requestCount: number
  /** 0 ~ 1 */
  share: number
}

/** 会话排行榜条目 */
export interface SessionSummary {
  sessionId: string
  title: string
  source: AgentSource
  totalTokens: number
  requestCount: number
  lastActiveAt: string
}

/** 时段热力图: 7 行 x 24 列, value = token 总量 */
export interface HeatmapCell {
  /** 0=周一 ... 6=周日 */
  weekday: number
  /** 0..23 */
  hour: number
  totalTokens: number
}

/** 数据源状态 (左下角小卡片) */
export interface DataSourceStatusItem {
  source: AgentSource
  label: string
  rootPath: string
  rootExists: boolean
  healthy: boolean
  scannedFiles: number
  parsedFiles: number
  reusedFiles: number
  requestCount: number
  lastError?: string
}

export interface DataSourceStatus {
  /** 'local-estimate' | 其他后续来源 */
  kind: string
  label: string
  /** ISO timestamp, 上次扫描时间 */
  lastUpdatedAt: string
  healthy: boolean
  scannedFiles: number
  parsedFiles: number
  reusedFiles: number
  requestCount: number
  sources: DataSourceStatusItem[]
}

export type UpdateProviderSettings =
  | { provider: 'none' }
  | { provider: 'github'; owner: string; repo: string; host?: string }
  | { provider: 'generic'; url: string }

export type UpdateState =
  | 'idle'
  | 'not-configured'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  configured: boolean
  provider: UpdateProviderSettings['provider']
  currentVersion: string
  state: UpdateState
  latestVersion?: string
  message?: string
  percent?: number
  lastCheckedAt?: string
  updateSource?: string
}

/** 时间范围筛选 */
export type DateRange =
  | { kind: 'last-n-days'; days: number }
  | { kind: 'absolute'; from: string; to: string }

/** 排序维度 */
export type RankBy = 'tokens' | 'requests'

// ============================================================
// IPC 方法签名 — Codex 在主进程实现这些
// ============================================================

export interface TokenAPI {
  /** 概览统计卡片 */
  getOverviewStats(range: DateRange): Promise<OverviewStats>

  /** 每日趋势折线图 */
  getDailyTrend(range: DateRange): Promise<DailyTrendPoint[]>

  /** 模型占比甜甜圈 */
  getModelShares(range: DateRange, by: RankBy): Promise<ModelShare[]>

  /** 会话排行 */
  getSessionRanking(
    range: DateRange,
    by: RankBy,
    limit: number,
  ): Promise<SessionSummary[]>

  /** 时段热力图 */
  getHourlyHeatmap(range: DateRange): Promise<HeatmapCell[]>

  /** 最近请求列表 */
  getRecentRequests(limit: number): Promise<RequestRecord[]>

  /** 数据源状态 */
  getDataSourceStatus(): Promise<DataSourceStatus>

  /** 手动触发一次重新扫描 */
  rescan(): Promise<{ scannedFiles: number; newRequests: number }>

  /** 清理扫描缓存，下次扫描会重新解析文件 */
  clearCache(): Promise<{ cleared: boolean }>

  /** 打开本地目录 */
  openLocalPath(kind: AgentSource | 'cache'): Promise<{ ok: boolean; path: string; error?: string }>

  /** 获取更新源配置 */
  getUpdateSettings(): Promise<UpdateProviderSettings>

  /** 保存更新源配置 */
  setUpdateSettings(settings: UpdateProviderSettings): Promise<UpdateProviderSettings>

  /** 获取当前更新状态 */
  getUpdateStatus(): Promise<UpdateStatus>

  /** 手动检查更新 */
  checkForUpdates(): Promise<UpdateStatus>

  /** 下载已发现的更新 */
  downloadUpdate(): Promise<UpdateStatus>

  /** 重启并安装已下载更新 */
  installUpdate(): Promise<{ ok: boolean }>

  /** 监听后台扫描完成事件，返回取消订阅函数 */
  onDataChanged(cb: () => void): () => void

  /** 监听更新状态变化，返回取消订阅函数 */
  onUpdateStatusChanged(cb: (status: UpdateStatus) => void): () => void
}

declare global {
  interface Window {
    tokenAPI: TokenAPI
  }
}

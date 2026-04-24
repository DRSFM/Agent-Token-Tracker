// 开发期 mock 数据 —— Codex 接入真实数据源后此文件应保留作为 fallback / 测试用
import type {
  DailyTrendPoint,
  DataSourceStatus,
  HeatmapCell,
  ModelShare,
  OverviewStats,
  RequestRecord,
  SessionSummary,
  TokenAPI,
} from '@/types/api'

const today = new Date()

const ymd = (offsetDays: number) => {
  const d = new Date(today)
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const stats: OverviewStats = {
  todayTotalTokens: 128_430,
  todayRawTotalTokens: 246_812,
  todayCacheTokens: 131_536,
  todayRequestCount: 42,
  todayAvgPerRequest: 3_058,
  activeSessionCount: 7,
  todayTotalDeltaPct: 0.186,
  todayRequestDeltaPct: 0.167,
  todayAvgDeltaPct: -0.019,
  activeSessionDeltaPct: 0.4,
}

const dailyTrend: DailyTrendPoint[] = [
  76_000, 50_500, 86_200, 81_400, 78_600, 92_300, 87_900, 79_400, 124_500, 96_700,
  101_200, 98_300, 110_500, 128_430,
].map((v, i, arr) => ({ date: ymd(i - arr.length + 1), totalTokens: v }))

const modelShares: ModelShare[] = [
  { model: 'gpt-4.1', totalTokens: 642_512, requestCount: 312, share: 0.5 },
  { model: 'gpt-4o', totalTokens: 385_301, requestCount: 198, share: 0.3 },
  { model: 'gpt-4.1-mini', totalTokens: 256_489, requestCount: 154, share: 0.2 },
]

const sessionRanking: SessionSummary[] = [
  {
    sessionId: 's1',
    title: '产品需求分析讨论',
    source: 'claude-code',
    totalTokens: 245_678,
    requestCount: 56,
    lastActiveAt: new Date().toISOString(),
  },
  {
    sessionId: 's2',
    title: '智能客服优化项目',
    source: 'claude-code',
    totalTokens: 198_345,
    requestCount: 41,
    lastActiveAt: new Date().toISOString(),
  },
  {
    sessionId: 's3',
    title: '代码重构计划',
    source: 'codex',
    totalTokens: 156_789,
    requestCount: 38,
    lastActiveAt: new Date().toISOString(),
  },
  {
    sessionId: 's4',
    title: '市场调研与分析',
    source: 'claude-code',
    totalTokens: 112_458,
    requestCount: 29,
    lastActiveAt: new Date().toISOString(),
  },
  {
    sessionId: 's5',
    title: '文档撰写助手',
    source: 'codex',
    totalTokens: 89_301,
    requestCount: 22,
    lastActiveAt: new Date().toISOString(),
  },
]

const heatmap: HeatmapCell[] = (() => {
  const cells: HeatmapCell[] = []
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const peak = Math.exp(-Math.pow((h - 14) / 5, 2))
      const wkBoost = w < 5 ? 1 : 0.5
      const noise = 0.3 + Math.random() * 0.7
      cells.push({
        weekday: w,
        hour: h,
        totalTokens: Math.round(peak * wkBoost * noise * 10000),
      })
    }
  }
  return cells
})()

const recentRequests: RequestRecord[] = [
  {
    id: 'r1',
    timestamp: new Date(today.setHours(14, 32, 18)).toISOString(),
    source: 'codex',
    sessionId: 's1',
    sessionTitle: '产品需求分析讨论',
    model: 'gpt-4.1',
    inputTokens: 2_341,
    outputTokens: 1_812,
    cacheTokens: 2_120,
    rawTotalTokens: 6_273,
    weightedTotalTokens: 4_153,
    totalTokens: 4_153,
  },
  {
    id: 'r2',
    timestamp: new Date(today.setHours(14, 21, 7)).toISOString(),
    source: 'codex',
    sessionId: 's2',
    sessionTitle: '智能客服优化项目',
    model: 'gpt-4o',
    inputTokens: 1_243,
    outputTokens: 1_024,
    cacheTokens: 1_580,
    rawTotalTokens: 3_847,
    weightedTotalTokens: 2_267,
    totalTokens: 2_267,
  },
  {
    id: 'r3',
    timestamp: new Date(today.setHours(14, 5, 44)).toISOString(),
    source: 'codex',
    sessionId: 's3',
    sessionTitle: '代码重构计划',
    model: 'gpt-4.1-mini',
    inputTokens: 3_201,
    outputTokens: 2_104,
    cacheTokens: 2_990,
    rawTotalTokens: 8_295,
    weightedTotalTokens: 5_305,
    totalTokens: 5_305,
  },
  {
    id: 'r4',
    timestamp: new Date(today.setHours(13, 47, 33)).toISOString(),
    source: 'codex',
    sessionId: 's1',
    sessionTitle: '产品需求分析讨论',
    model: 'gpt-4.1',
    inputTokens: 4_512,
    outputTokens: 3_985,
    cacheTokens: 4_450,
    rawTotalTokens: 12_947,
    weightedTotalTokens: 8_497,
    totalTokens: 8_497,
  },
  {
    id: 'r5',
    timestamp: new Date(today.setHours(13, 32, 11)).toISOString(),
    source: 'codex',
    sessionId: 's2',
    sessionTitle: '智能客服优化项目',
    model: 'gpt-4o',
    inputTokens: 1_987,
    outputTokens: 1_498,
    cacheTokens: 1_930,
    rawTotalTokens: 5_415,
    weightedTotalTokens: 3_485,
    totalTokens: 3_485,
  },
]

const dataSourceStatus: DataSourceStatus = {
  kind: 'local-estimate',
  label: '本地估算',
  lastUpdatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  healthy: true,
  scannedFiles: 12,
  parsedFiles: 2,
  reusedFiles: 10,
  requestCount: recentRequests.length,
  sources: [
    {
      source: 'claude-code',
      label: 'Claude Code',
      rootPath: '~/.claude/projects',
      rootExists: true,
      healthy: true,
      scannedFiles: 8,
      parsedFiles: 1,
      reusedFiles: 7,
      requestCount: 2,
    },
    {
      source: 'codex',
      label: 'Codex',
      rootPath: '~/.codex/sessions',
      rootExists: true,
      healthy: true,
      scannedFiles: 4,
      parsedFiles: 1,
      reusedFiles: 3,
      requestCount: 3,
    },
  ],
}

export const mockAPI: TokenAPI = {
  async getOverviewStats() {
    return stats
  },
  async getDailyTrend() {
    return dailyTrend
  },
  async getModelShares() {
    return modelShares
  },
  async getSessionRanking(_range, _by, limit) {
    return sessionRanking.slice(0, limit)
  },
  async getHourlyHeatmap() {
    return heatmap
  },
  async getRecentRequests(limit) {
    return recentRequests.slice(0, limit)
  },
  async getDataSourceStatus() {
    return dataSourceStatus
  },
  async rescan() {
    return { scannedFiles: 0, newRequests: 0 }
  },
  async clearCache() {
    return { cleared: true }
  },
  async openLocalPath(kind) {
    return { ok: true, path: kind === 'cache' ? 'mock-cache' : `mock-${kind}` }
  },
  async getUpdateSettings() {
    return { provider: 'none' }
  },
  async setUpdateSettings(settings) {
    return settings
  },
  async getUpdateStatus() {
    return {
      configured: false,
      provider: 'none',
      currentVersion: '1.0.0',
      state: 'not-configured',
      message: '未配置更新源',
    }
  },
  async checkForUpdates() {
    return {
      configured: false,
      provider: 'none',
      currentVersion: '1.0.0',
      state: 'not-configured',
      message: '未配置更新源',
    }
  },
  async downloadUpdate() {
    return {
      configured: false,
      provider: 'none',
      currentVersion: '1.0.0',
      state: 'not-configured',
      message: '未配置更新源',
    }
  },
  async installUpdate() {
    return { ok: true }
  },
  onDataChanged() {
    return () => {}
  },
  onUpdateStatusChanged() {
    return () => {}
  },
}

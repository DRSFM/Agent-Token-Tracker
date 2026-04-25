// API 客户端 —— 渲染进程统一从这里取数据
//
// 行为：优先调用 window.tokenAPI（Codex 实现的 IPC）；
// 任何方法抛错（包括 Codex 尚未实现的 NOT_IMPL）会自动回落
// mock 数据并在控制台告警。这样前端开发期 / Codex 渐进实现期
// 都能正常渲染。
import type { TokenAPI } from '@/types/api'
import { mockAPI } from './mock'

const realAPI = typeof window !== 'undefined' ? window.tokenAPI : undefined

/** 当前环境是否能拿到真实 IPC（用于 UI 标识） */
export const hasRealAPI = !!realAPI

/** 单个方法是否曾抛错过（即 Codex 尚未实现）— 用于 UI 标识 */
const fallbackMethods = new Set<keyof TokenAPI>()

export const isUsingMock = (method?: keyof TokenAPI) =>
  !hasRealAPI || (method ? fallbackMethods.has(method) : fallbackMethods.size > 0)

function wrap<K extends keyof TokenAPI>(method: K): TokenAPI[K] {
  if (!realAPI) return mockAPI[method]
  // onDataChanged 是同步的事件订阅，不走 try/catch 包装
  if (method === 'onDataChanged' || method === 'onUpdateStatusChanged') return realAPI[method]
  return (async (...args: unknown[]) => {
    try {
      // @ts-expect-error 动态调用
      return await realAPI[method](...args)
    } catch (err) {
      if (!fallbackMethods.has(method)) {
        fallbackMethods.add(method)
        console.warn(
          `[api] IPC ${String(method)} 失败，回落 mock 数据。等 Codex 实现后会自动切换回真实数据。`,
          err,
        )
      }
      // @ts-expect-error 动态调用
      return mockAPI[method](...args)
    }
  }) as TokenAPI[K]
}

export const api: TokenAPI = {
  getOverviewStats: wrap('getOverviewStats'),
  getDailyTrend: wrap('getDailyTrend'),
  getModelShares: wrap('getModelShares'),
  getSessionRanking: wrap('getSessionRanking'),
  getHourlyHeatmap: wrap('getHourlyHeatmap'),
  getRecentRequests: wrap('getRecentRequests'),
  getDataSourceStatus: wrap('getDataSourceStatus'),
  rescan: wrap('rescan'),
  clearCache: wrap('clearCache'),
  openLocalPath: wrap('openLocalPath'),
  getRemoteSourceSettings: wrap('getRemoteSourceSettings'),
  setRemoteSourceSettings: wrap('setRemoteSourceSettings'),
  getRemoteSyncStatus: wrap('getRemoteSyncStatus'),
  testRemoteConnection: wrap('testRemoteConnection'),
  syncRemoteLogs: wrap('syncRemoteLogs'),
  getUpdateSettings: wrap('getUpdateSettings'),
  setUpdateSettings: wrap('setUpdateSettings'),
  getUpdateStatus: wrap('getUpdateStatus'),
  checkForUpdates: wrap('checkForUpdates'),
  downloadUpdate: wrap('downloadUpdate'),
  installUpdate: wrap('installUpdate'),
  onDataChanged: wrap('onDataChanged'),
  onUpdateStatusChanged: wrap('onUpdateStatusChanged'),
}

/** 兼容旧名 */
export const isMock = !hasRealAPI

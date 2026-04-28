// Preload — 暴露 IPC 给渲染进程
// ----------------------------------------------------------------
// 仅声明通道名，不写业务逻辑。具体 handler 在 ipc-handlers.ts。
// ----------------------------------------------------------------

import { contextBridge, ipcRenderer } from 'electron'
import type { TokenAPI } from '../src/types/api'

const api: TokenAPI = {
  getOverviewStats: (range) => ipcRenderer.invoke('token:getOverviewStats', range),
  getDailyTrend: (range) => ipcRenderer.invoke('token:getDailyTrend', range),
  getModelShares: (range, by) => ipcRenderer.invoke('token:getModelShares', range, by),
  getSessionRanking: (range, by, limit) =>
    ipcRenderer.invoke('token:getSessionRanking', range, by, limit),
  getHourlyHeatmap: (range) => ipcRenderer.invoke('token:getHourlyHeatmap', range),
  getRecentRequests: (limit) => ipcRenderer.invoke('token:getRecentRequests', limit),
  getDataSourceStatus: () => ipcRenderer.invoke('token:getDataSourceStatus'),
  rescan: () => ipcRenderer.invoke('token:rescan'),
  clearCache: () => ipcRenderer.invoke('token:clearCache'),
  openLocalPath: (kind) => ipcRenderer.invoke('token:openLocalPath', kind),
  getRemoteSourceSettings: () => ipcRenderer.invoke('token:getRemoteSourceSettings'),
  setRemoteSourceSettings: (settings) => ipcRenderer.invoke('token:setRemoteSourceSettings', settings),
  getRemoteSyncStatus: () => ipcRenderer.invoke('token:getRemoteSyncStatus'),
  testRemoteConnection: () => ipcRenderer.invoke('token:testRemoteConnection'),
  syncRemoteLogs: () => ipcRenderer.invoke('token:syncRemoteLogs'),
  getReplaySession: (sessionId, source, options) =>
    ipcRenderer.invoke('token:getReplaySession', sessionId, source, options),
  getUpdateSettings: () => ipcRenderer.invoke('token:getUpdateSettings'),
  setUpdateSettings: (settings) => ipcRenderer.invoke('token:setUpdateSettings', settings),
  getUpdateStatus: () => ipcRenderer.invoke('token:getUpdateStatus'),
  checkForUpdates: () => ipcRenderer.invoke('token:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('token:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('token:installUpdate'),
  onDataChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('token:dataChanged', listener)
    return () => ipcRenderer.removeListener('token:dataChanged', listener)
  },
  onUpdateStatusChanged: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof cb>[0]) =>
      cb(status)
    ipcRenderer.on('token:updateStatusChanged', listener)
    return () => ipcRenderer.removeListener('token:updateStatusChanged', listener)
  },
}

contextBridge.exposeInMainWorld('tokenAPI', api)

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import type {
  AgentSource,
  DateRange,
  RankBy,
  ReplaySessionOptions,
} from '../src/types/api'
import { tokenDataStore } from './aggregator'
import { claudeCodeRoot } from './scanners/claude'
import { codexSessionsRoot } from './scanners/codex'
import {
  getRemoteSourceSettings,
  getRemoteSyncStatus,
  remoteCacheRoot,
  setRemoteSourceSettings,
  syncRemoteLogs,
  testRemoteConnection,
} from './remote-sync'
import { getReplaySession } from './replay'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateSettings,
  getUpdateStatus,
  installUpdate,
  setUpdateSettings,
} from './updater'

function broadcastDataChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('token:dataChanged')
  }
}

export function registerIpcHandlers() {
  ipcMain.handle('token:getOverviewStats', async (_e, range: DateRange) =>
    tokenDataStore.getOverviewStats(range),
  )

  ipcMain.handle('token:getDailyTrend', async (_e, range: DateRange) =>
    tokenDataStore.getDailyTrend(range),
  )

  ipcMain.handle('token:getModelShares', async (_e, range: DateRange, by: RankBy) =>
    tokenDataStore.getModelShares(range, by),
  )

  ipcMain.handle(
    'token:getSessionRanking',
    async (_e, range: DateRange, by: RankBy, limit: number) =>
      tokenDataStore.getSessionRanking(range, by, limit),
  )

  ipcMain.handle('token:getHourlyHeatmap', async (_e, range: DateRange) =>
    tokenDataStore.getHourlyHeatmap(range),
  )

  ipcMain.handle('token:getRecentRequests', async (_e, limit: number) =>
    tokenDataStore.getRecentRequests(limit),
  )

  ipcMain.handle('token:getDataSourceStatus', async () => tokenDataStore.getDataSourceStatus())

  ipcMain.handle('token:rescan', async () => {
    const state = await tokenDataStore.rescan()
    broadcastDataChanged()
    return { scannedFiles: state.scannedFiles, newRequests: state.records.length }
  })

  ipcMain.handle('token:clearCache', async () => {
    const result = await tokenDataStore.clearCache()
    const state = await tokenDataStore.rescan()
    broadcastDataChanged()
    return { cleared: result.cleared && state.scannedFiles >= 0 }
  })

  ipcMain.handle('token:openLocalPath', async (_e, kind: AgentSource | 'cache' | 'ssh-readme' | 'remote-cache') => {
    const targetPath =
      kind === 'claude-code'
        ? claudeCodeRoot()
        : kind === 'codex'
          ? codexSessionsRoot()
          : kind === 'ssh-readme'
            ? app.isPackaged
              ? path.join(process.resourcesPath, 'ssh.readme')
              : path.join(app.getAppPath(), 'assets', 'ssh.readme')
            : kind === 'remote-cache'
              ? remoteCacheRoot()
              : app.getPath('userData')
    const error = await shell.openPath(targetPath)
    return { ok: !error, path: targetPath, error: error || undefined }
  })

  ipcMain.handle('token:getRemoteSourceSettings', async () => getRemoteSourceSettings())
  ipcMain.handle('token:setRemoteSourceSettings', async (_e, settings) => setRemoteSourceSettings(settings))
  ipcMain.handle('token:getRemoteSyncStatus', async () => getRemoteSyncStatus())
  ipcMain.handle('token:testRemoteConnection', async () => testRemoteConnection())
  ipcMain.handle('token:syncRemoteLogs', async () => {
    const result = await syncRemoteLogs()
    if (result.ok) {
      await tokenDataStore.rescan()
      broadcastDataChanged()
    }
    return result
  })

  ipcMain.handle('token:getReplaySession', async (
    _e,
    sessionId: string,
    source?: AgentSource,
    options?: ReplaySessionOptions,
  ) => {
    const files = await tokenDataStore.getReplayFilesForSession(sessionId, source)
    return getReplaySession(sessionId, source, files, options)
  })

  ipcMain.handle('token:getUpdateSettings', async () => getUpdateSettings())
  ipcMain.handle('token:setUpdateSettings', async (_e, settings) => setUpdateSettings(settings))
  ipcMain.handle('token:getUpdateStatus', async () => getUpdateStatus())
  ipcMain.handle('token:checkForUpdates', async () => checkForUpdates(true))
  ipcMain.handle('token:downloadUpdate', async () => downloadUpdate())
  ipcMain.handle('token:installUpdate', async () => {
    installUpdate()
    return { ok: true }
  })

  tokenDataStore.startWatching(broadcastDataChanged)
  app.on('before-quit', () => {
    void tokenDataStore.stopWatching()
  })
}

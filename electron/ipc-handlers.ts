import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import type {
  AgentSource,
  DateRange,
  OpenLocalPathTarget,
  RankBy,
  ReplaySessionOptions,
} from '../src/types/api'
import { tokenDataStore } from './aggregator'
import { claudeCodeRoot } from './scanners/claude'
import { codexSessionsRoot } from './scanners/codex'
import { codexApiRoot } from './scanners/codex-profiles'
import { openCodeDataRoot } from './scanners/opencode'
import { antigravityDataRoot } from './scanners/antigravity'
import { grokDataRoot } from './scanners/grok'
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
import { getCodexRateLimitResetCredits, getQuotaStatus } from './quota'
import { getGrokUsageStatus } from './grok-usage'
import { getQuotaVisibilitySettings, setQuotaVisibilitySettings } from './quota-visibility'
import { syncQuotaToCpa } from './cpa-sync'
import { getNetworkSettings, setNetworkSettings } from './network-settings'
import {
  completeCodexOAuthLogin,
  deleteCodexCredential,
  exportCodexCredential,
  getCodexCredentialMetas,
  importCodexApiKey,
  importCodexCredentialFiles,
  importCodexCredentialText,
  importCodexSubscriptionFromCockpit,
  importCurrentCodexAuth,
  launchCodexWithCredential,
  openCodexCredentialFolder,
  openCodexCliWithCredential,
  setCodexCredentialMeta,
  startCodexOAuthLogin,
  submitCodexOAuthCallbackUrl,
} from './codex-accounts'

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

  ipcMain.handle('token:openLocalPath', async (_e, kind: OpenLocalPathTarget) => {
    if (typeof kind === 'object') {
      const targetPath = path.resolve(kind.rootPath)
      const allowedRoots = [
        claudeCodeRoot(),
        codexSessionsRoot(),
        codexApiRoot(),
        openCodeDataRoot(),
        antigravityDataRoot(),
        grokDataRoot(),
        remoteCacheRoot(),
      ]
      if (!allowedRoots.some((root) => isPathAtOrInside(root, targetPath))) {
        return { ok: false, path: targetPath, error: 'Unsupported data source path.' }
      }
      const error = await shell.openPath(targetPath)
      return { ok: !error, path: targetPath, error: error || undefined }
    }

    const targetPath =
      kind === 'claude-code'
        ? claudeCodeRoot()
        : kind === 'codex'
          ? codexSessionsRoot()
          : kind === 'opencode'
            ? openCodeDataRoot()
            : kind === 'antigravity'
              ? antigravityDataRoot()
              : kind === 'grok'
                ? grokDataRoot()
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
  ipcMain.handle('token:getNetworkSettings', async () => getNetworkSettings())
  ipcMain.handle('token:setNetworkSettings', async (_e, settings) => setNetworkSettings(settings))
  ipcMain.handle('token:getQuotaStatus', async (_e, force?: boolean) =>
    getQuotaStatus(Boolean(force)),
  )
  ipcMain.handle('token:getQuotaVisibilitySettings', async () => getQuotaVisibilitySettings())
  ipcMain.handle('token:setQuotaVisibilitySettings', async (_e, settings) =>
    setQuotaVisibilitySettings(settings),
  )
  ipcMain.handle('token:syncQuotaToCpa', async () => syncQuotaToCpa())
  ipcMain.handle('token:getCodexRateLimitResetCredits', async (_e, credentialKey?: string) =>
    getCodexRateLimitResetCredits(credentialKey),
  )
  ipcMain.handle('token:getGrokUsageStatus', async (_e, force?: boolean) =>
    getGrokUsageStatus(Boolean(force)),
  )
  ipcMain.handle('token:getCodexCredentialMetas', async () => getCodexCredentialMetas())
  ipcMain.handle('token:importCodexSubscriptionFromCockpit', async () => importCodexSubscriptionFromCockpit())
  ipcMain.handle('token:setCodexCredentialMeta', async (_e, credentialKey, meta) =>
    setCodexCredentialMeta(credentialKey, meta),
  )
  ipcMain.handle('token:openCodexCliWithCredential', async (_e, credentialKey: string) =>
    openCodexCliWithCredential(credentialKey),
  )
  ipcMain.handle('token:openCodexCredentialFolder', async (_e, credentialKey: string) =>
    openCodexCredentialFolder(credentialKey),
  )
  ipcMain.handle('token:launchCodexWithCredential', async (_e, credentialKey: string) =>
    launchCodexWithCredential(credentialKey),
  )
  ipcMain.handle('token:exportCodexCredential', async (_e, credentialKey: string) =>
    exportCodexCredential(credentialKey),
  )
  ipcMain.handle('token:deleteCodexCredential', async (_e, credentialKey: string) =>
    deleteCodexCredential(credentialKey),
  )
  ipcMain.handle('token:startCodexOAuthLogin', async () => startCodexOAuthLogin())
  ipcMain.handle('token:submitCodexOAuthCallbackUrl', async (_e, loginId: string, callbackUrl: string) =>
    submitCodexOAuthCallbackUrl(loginId, callbackUrl),
  )
  ipcMain.handle('token:completeCodexOAuthLogin', async (_e, loginId: string) =>
    completeCodexOAuthLogin(loginId),
  )
  ipcMain.handle('token:importCodexCredentialText', async (_e, text: string) =>
    importCodexCredentialText(text),
  )
  ipcMain.handle('token:importCodexApiKey', async (_e, apiKey: string, baseUrl?: string) =>
    importCodexApiKey(apiKey, baseUrl),
  )
  ipcMain.handle('token:importCurrentCodexAuth', async () => importCurrentCodexAuth())
  ipcMain.handle('token:importCodexCredentialFiles', async () => importCodexCredentialFiles())

  ipcMain.handle('token:getReplaySession', async (
    _e,
    sessionId: string,
    source?: AgentSource,
    options?: ReplaySessionOptions,
  ) => {
    const files = await tokenDataStore.getReplayFilesForSession(sessionId, source, options)
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

function isPathAtOrInside(root: string, targetPath: string) {
  const relative = path.relative(path.resolve(root), targetPath)
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

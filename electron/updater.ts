import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  UpdateProviderSettings,
  UpdateStatus,
} from '../src/types/api'

const SETTINGS_FILE = 'update-settings.json'

const defaultSettings: UpdateProviderSettings = { provider: 'none' }

let settings: UpdateProviderSettings | null = null
let configuredKey = ''
let checking = false
let status: UpdateStatus = {
  configured: false,
  provider: 'none',
  currentVersion: app.getVersion(),
  state: 'not-configured',
  message: '未配置更新源',
}

function settingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function updateStatus(next: Partial<UpdateStatus>) {
  status = {
    ...status,
    currentVersion: app.getVersion(),
    ...next,
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('token:updateStatusChanged', status)
  }
}

function sourceKey(nextSettings: UpdateProviderSettings) {
  if (nextSettings.provider === 'github') {
    return `github:${nextSettings.owner}/${nextSettings.repo}:${nextSettings.host ?? ''}`
  }
  if (nextSettings.provider === 'generic') {
    return `generic:${nextSettings.url}`
  }
  return 'none'
}

function describeSource(nextSettings: UpdateProviderSettings) {
  if (nextSettings.provider === 'github') {
    return `${nextSettings.owner}/${nextSettings.repo}`
  }
  if (nextSettings.provider === 'generic') {
    return nextSettings.url
  }
  return undefined
}

function normalizeSettings(value: unknown): UpdateProviderSettings {
  const raw = value as Partial<UpdateProviderSettings> | null | undefined
  if (!raw || raw.provider === 'none') return defaultSettings
  if (raw.provider === 'github') {
    const owner = String(raw.owner ?? '').trim()
    const repo = String(raw.repo ?? '').trim()
    const host = String(raw.host ?? '').trim()
    if (!owner || !repo) return defaultSettings
    return { provider: 'github', owner, repo, host: host || undefined }
  }
  if (raw.provider === 'generic') {
    const url = String(raw.url ?? '').trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(url)) return defaultSettings
    return { provider: 'generic', url }
  }
  return defaultSettings
}

async function readSettings() {
  if (settings) return settings
  try {
    settings = normalizeSettings(JSON.parse(await readFile(settingsPath(), 'utf8')))
  } catch {
    settings = defaultSettings
  }
  configureUpdater(settings)
  return settings
}

async function saveSettings(nextSettings: UpdateProviderSettings) {
  settings = normalizeSettings(nextSettings)
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
  configureUpdater(settings)
  return settings
}

function configureUpdater(nextSettings: UpdateProviderSettings) {
  const key = sourceKey(nextSettings)
  const configured = nextSettings.provider !== 'none'

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  if (configured && key !== configuredKey) {
    if (nextSettings.provider === 'github') {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: nextSettings.owner,
        repo: nextSettings.repo,
        host: nextSettings.host,
      })
    } else if (nextSettings.provider === 'generic') {
      autoUpdater.setFeedURL({ provider: 'generic', url: nextSettings.url })
    }
  }

  configuredKey = key
  updateStatus({
    configured,
    provider: nextSettings.provider,
    state: configured ? 'idle' : 'not-configured',
    message: configured ? undefined : '未配置更新源',
    updateSource: describeSource(nextSettings),
    latestVersion: undefined,
    percent: undefined,
  })
}

export function initUpdateService() {
  autoUpdater.on('checking-for-update', () => {
    updateStatus({ state: 'checking', message: '正在检查更新...' })
  })
  autoUpdater.on('update-available', (info) => {
    updateStatus({
      state: 'available',
      latestVersion: info.version,
      message: `发现新版本 ${info.version}`,
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    updateStatus({
      state: 'not-available',
      latestVersion: info.version,
      lastCheckedAt: new Date().toISOString(),
      message: '当前已是最新版本',
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    updateStatus({
      state: 'downloading',
      percent: progress.percent,
      message: `正在下载 ${Math.round(progress.percent)}%`,
    })
  })
  autoUpdater.on('update-downloaded', (event) => {
    updateStatus({
      state: 'downloaded',
      latestVersion: event.version,
      percent: 100,
      message: '更新已下载，重启后安装',
    })
  })
  autoUpdater.on('error', (error) => {
    checking = false
    updateStatus({
      state: 'error',
      message: error.message || '检查更新失败',
      lastCheckedAt: new Date().toISOString(),
    })
  })

  void readSettings().then((current) => {
    if (current.provider === 'none' || !app.isPackaged) return
    setTimeout(() => {
      void checkForUpdates(false)
    }, 15_000)
  })
}

export async function getUpdateSettings() {
  return readSettings()
}

export async function setUpdateSettings(nextSettings: UpdateProviderSettings) {
  return saveSettings(nextSettings)
}

export function getUpdateStatus() {
  return status
}

export async function checkForUpdates(manual = true) {
  const current = await readSettings()
  if (current.provider === 'none') {
    updateStatus({ state: 'not-configured', message: '未配置更新源' })
    return status
  }
  if (!app.isPackaged) {
    updateStatus({
      state: 'error',
      message: '开发模式不检查更新，请用安装版验证。',
      lastCheckedAt: new Date().toISOString(),
    })
    return status
  }
  if (checking) return status

  checking = true
  try {
    await autoUpdater.checkForUpdates()
    return status
  } finally {
    checking = false
    if (manual && status.state === 'checking') {
      updateStatus({ state: 'idle', message: undefined })
    }
  }
}

export async function downloadUpdate() {
  await autoUpdater.downloadUpdate()
  return status
}

export function installUpdate() {
  autoUpdater.quitAndInstall(false, true)
}

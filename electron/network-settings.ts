import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NetworkSettings } from '../src/types/api'

const SETTINGS_FILE = 'network-settings.json'

const defaultSettings: NetworkSettings = {
  quotaProxyUrl: '',
}

let settings: NetworkSettings | null = null

function settingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function normalizeProxyUrl(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:') return ''
    if (!url.hostname || !url.port) return ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function normalizeSettings(value: unknown): NetworkSettings {
  const raw = value as Partial<NetworkSettings> | null | undefined
  return {
    quotaProxyUrl: normalizeProxyUrl(raw?.quotaProxyUrl),
  }
}

export async function getNetworkSettings() {
  if (settings) return settings
  try {
    settings = normalizeSettings(JSON.parse(await readFile(settingsPath(), 'utf8')))
  } catch {
    settings = defaultSettings
  }
  return settings
}

export async function setNetworkSettings(nextSettings: NetworkSettings) {
  settings = normalizeSettings(nextSettings)
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
  return settings
}

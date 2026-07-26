import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CloudSyncSettings } from '../src/types/api'
import { getUserDataPath } from './app-paths'

const SETTINGS_FILE = 'cloud-sync-settings.json'
const INSTALLATION_FILE = 'cloud-installation.json'

const defaultSettings: CloudSyncSettings = {
  enabled: false,
  historyMode: 'ask',
}

export interface CloudInstallation {
  id: string
  name: string
  platform: string
}

function settingsPath() {
  return path.join(getUserDataPath(), SETTINGS_FILE)
}

function installationPath() {
  return path.join(getUserDataPath(), INSTALLATION_FILE)
}

function normalizeSettings(value: unknown): CloudSyncSettings {
  const raw = value && typeof value === 'object' ? value as Partial<CloudSyncSettings> : {}
  const historyMode = raw.historyMode === 'include' || raw.historyMode === 'future-only'
    ? raw.historyMode
    : 'ask'
  const syncFrom = typeof raw.syncFrom === 'string' && Number.isFinite(new Date(raw.syncFrom).getTime())
    ? new Date(raw.syncFrom).toISOString()
    : undefined
  return {
    enabled: Boolean(raw.enabled) && historyMode !== 'ask',
    historyMode,
    ...(historyMode === 'future-only' && syncFrom ? { syncFrom } : {}),
  }
}

export async function getCloudSyncSettings() {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(settingsPath(), 'utf8')))
  } catch {
    return defaultSettings
  }
}

export async function setCloudSyncSettings(settings: CloudSyncSettings) {
  const normalized = normalizeSettings({
    ...settings,
    syncFrom: settings.historyMode === 'future-only'
      ? settings.syncFrom ?? new Date().toISOString()
      : undefined,
  })
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

export async function getCloudInstallation(): Promise<CloudInstallation> {
  try {
    const parsed = JSON.parse(await fs.readFile(installationPath(), 'utf8')) as Partial<CloudInstallation>
    if (typeof parsed.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.id)) {
      return {
        id: parsed.id,
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.slice(0, 120) : os.hostname(),
        platform: typeof parsed.platform === 'string' && parsed.platform.trim()
          ? parsed.platform.slice(0, 40)
          : process.platform,
      }
    }
  } catch {
    // Create a random installation identity below.
  }

  const installation: CloudInstallation = {
    id: randomUUID(),
    name: os.hostname().slice(0, 120) || 'Unnamed device',
    platform: process.platform,
  }
  await fs.mkdir(path.dirname(installationPath()), { recursive: true })
  await fs.writeFile(installationPath(), JSON.stringify(installation, null, 2), 'utf8')
  return installation
}

export interface CloudBackendConfig {
  url: string
  anonKey: string
}

export function getCloudBackendConfig(): CloudBackendConfig | null {
  const url = String(process.env.TOKEN_TRACKER_SUPABASE_URL ?? '').trim().replace(/\/$/, '')
  const anonKey = String(process.env.TOKEN_TRACKER_SUPABASE_ANON_KEY ?? '').trim()
  if (!url || !anonKey) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return null
    }
  } catch {
    return null
  }
  return { url, anonKey }
}

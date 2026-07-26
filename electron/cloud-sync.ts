import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type {
  CloudSyncSettings,
  CloudSyncStatus,
  CloudUsageBreakdown,
  CloudUsageSummary,
  RequestRecord,
} from '../src/types/api'
import { getUserDataPath } from './app-paths'
import { getCloudAccessToken, getCloudAuthStatus, getCloudUserId } from './cloud-auth'
import { toCloudUsageEvents } from './cloud-contract'
import { cloudOutbox } from './cloud-outbox'
import {
  getCloudBackendConfig,
  getCloudInstallation,
  getCloudSyncSettings,
  setCloudSyncSettings,
} from './cloud-settings'

const STATUS_FILE = 'cloud-sync-status.json'
const BATCH_SIZE = 500

const emptyUsageSummary = (): CloudUsageSummary => ({
  requestCount: 0,
  rawTotalTokens: 0,
  weightedTotalTokens: 0,
  bySource: [],
  byModel: [],
  byDevice: [],
})

interface StoredCloudStatus {
  lastSyncedAt?: string
  lastError?: string
}

function statusPath() {
  return path.join(getUserDataPath(), STATUS_FILE)
}

async function loadStoredStatus(): Promise<StoredCloudStatus> {
  try {
    const parsed = JSON.parse(await fs.readFile(statusPath(), 'utf8')) as StoredCloudStatus
    return {
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
    }
  } catch {
    return {}
  }
}

async function saveStoredStatus(status: StoredCloudStatus) {
  await fs.mkdir(path.dirname(statusPath()), { recursive: true })
  await fs.writeFile(statusPath(), JSON.stringify(status, null, 2), 'utf8')
}

async function rpcRequest(functionName: string, body: unknown) {
  const config = getCloudBackendConfig()
  if (!config) throw new Error('尚未配置 Supabase 项目。')
  const accessToken = await getCloudAccessToken()
  if (!accessToken) throw new Error('请先登录云端账号。')
  const response = await fetch(`${config.url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    let message = text
    try {
      const parsed = JSON.parse(text) as { message?: string; details?: string }
      message = parsed.message ?? parsed.details ?? text
    } catch {
      // Keep the response body when it is not JSON.
    }
    throw new Error(`Supabase RPC HTTP ${response.status}: ${message.slice(0, 500)}`)
  }
  return text ? JSON.parse(text) as unknown : null
}

export class CloudSyncService {
  private syncPromise: Promise<CloudSyncStatus> | null = null

  async getSettings() {
    return getCloudSyncSettings()
  }

  async setSettings(settings: CloudSyncSettings, records: RequestRecord[] = []) {
    const saved = await setCloudSyncSettings(settings)
    if (saved.enabled) await this.captureRecords(records, saved)
    return saved
  }

  async captureRecords(records: RequestRecord[], settings?: CloudSyncSettings) {
    const current = settings ?? await getCloudSyncSettings()
    if (!current.enabled || current.historyMode === 'ask') return 0
    const userId = await getCloudUserId()
    if (!userId) return 0
    const from = current.historyMode === 'future-only' && current.syncFrom
      ? new Date(current.syncFrom).getTime()
      : Number.NEGATIVE_INFINITY
    const eligible = records.filter((record) => new Date(record.timestamp).getTime() >= from)
    return cloudOutbox.enqueue(userId, toCloudUsageEvents(eligible))
  }

  async getStatus(): Promise<CloudSyncStatus> {
    const [settings, auth, userId, stored] = await Promise.all([
      getCloudSyncSettings(),
      getCloudAuthStatus(),
      getCloudUserId(),
      loadStoredStatus(),
    ])
    const outbox = await cloudOutbox.stats(userId)
    return {
      configured: Boolean(getCloudBackendConfig()),
      enabled: settings.enabled,
      authenticated: auth.authenticated,
      lastSyncedAt: stored.lastSyncedAt,
      pendingCount: outbox.pendingCount,
      lastError: stored.lastError,
    }
  }

  async syncNow() {
    if (this.syncPromise) return this.syncPromise
    this.syncPromise = this.runSync().finally(() => {
      this.syncPromise = null
    })
    return this.syncPromise
  }

  async getUsageSummary(): Promise<CloudUsageSummary> {
    const auth = await getCloudAuthStatus()
    if (!auth.authenticated) return emptyUsageSummary()
    const payload = await rpcRequest('get_my_cloud_usage_summary', {})
    if (!payload || typeof payload !== 'object') return emptyUsageSummary()
    const raw = payload as Record<string, unknown>
    const parseBreakdown = (value: unknown): CloudUsageBreakdown[] => {
      if (!Array.isArray(value)) return []
      return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const item = entry as Record<string, unknown>
        const key = typeof item.key === 'string' ? item.key : ''
        const label = typeof item.label === 'string' ? item.label : key
        if (!key) return []
        return [{
          key,
          label,
          requestCount: Number(item.requestCount ?? 0),
          rawTotalTokens: Number(item.rawTotalTokens ?? 0),
          weightedTotalTokens: Number(item.weightedTotalTokens ?? 0),
        }]
      })
    }
    return {
      requestCount: Number(raw.requestCount ?? 0),
      rawTotalTokens: Number(raw.rawTotalTokens ?? 0),
      weightedTotalTokens: Number(raw.weightedTotalTokens ?? 0),
      bySource: parseBreakdown(raw.bySource),
      byModel: parseBreakdown(raw.byModel),
      byDevice: parseBreakdown(raw.byDevice),
    }
  }

  private async runSync(): Promise<CloudSyncStatus> {
    const settings = await getCloudSyncSettings()
    if (!settings.enabled) {
      await saveStoredStatus({ ...(await loadStoredStatus()), lastError: undefined })
      return this.getStatus()
    }

    const userId = await getCloudUserId()
    if (!userId) {
      await saveStoredStatus({
        ...(await loadStoredStatus()),
        lastError: '请先登录云端账号。',
      })
      return this.getStatus()
    }

    const installation = await getCloudInstallation()
    try {
      for (;;) {
        const batch = await cloudOutbox.claim(userId, BATCH_SIZE)
        if (!batch.length) break
        const eventIds = batch.map((row) => row.eventId)
        try {
          await rpcRequest('sync_usage_events', {
            p_installation_id: installation.id,
            p_device_name: installation.name,
            p_platform: installation.platform,
            p_app_version: app.getVersion(),
            p_events: batch.map((row) => row.payload),
          })
          await cloudOutbox.markUploaded(userId, eventIds)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await cloudOutbox.markFailed(userId, eventIds, message)
          throw error
        }
      }

      await saveStoredStatus({
        lastSyncedAt: new Date().toISOString(),
        lastError: undefined,
      })
    } catch (error) {
      await saveStoredStatus({
        ...(await loadStoredStatus()),
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
    return this.getStatus()
  }

  async close() {
    await cloudOutbox.close()
  }
}

export const cloudSyncService = new CloudSyncService()

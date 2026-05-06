import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { SyncQuotaToCpaResult } from '../src/types/api'

const DEFAULT_DASHBOARD_HOST = '127.0.0.1'
const DEFAULT_DASHBOARD_PORT = 8320
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.cli-proxy-api', 'usage-dashboard')

interface DashboardConfig {
  dashboard_host?: string
  dashboard_port?: number | string
}

interface SyncQuotaResponse {
  ok?: boolean
  error?: string
  sync?: {
    updated?: number
    unchanged?: number
    missing?: unknown
  }
}

function expandHome(value: string) {
  if (value === '~') return os.homedir()
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

async function dashboardBaseUrl() {
  const envUrl = process.env.CLIPROXY_USAGE_DASHBOARD_URL
  if (envUrl) return envUrl.replace(/\/+$/, '')

  const configDir = expandHome(process.env.CLIPROXY_USAGE_DASHBOARD_DIR || DEFAULT_CONFIG_DIR)
  const configPath = path.join(configDir, 'config.json')
  let host = DEFAULT_DASHBOARD_HOST
  let port = DEFAULT_DASHBOARD_PORT

  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as DashboardConfig
    if (config.dashboard_host) host = config.dashboard_host
    const parsedPort = Number(config.dashboard_port)
    if (Number.isFinite(parsedPort) && parsedPort > 0) port = parsedPort
  } catch {
    // Missing dashboard config is fine; use the documented local default.
  }

  return `http://${host}:${port}`
}

function missingCount(value: unknown) {
  if (Array.isArray(value)) return value.length
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function postJson(url: string): Promise<SyncQuotaResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Length': '0',
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          const statusCode = response.statusCode || 0
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode}: ${response.statusMessage || body || 'Request failed'}`))
            return
          }
          try {
            resolve(JSON.parse(body) as SyncQuotaResponse)
          } catch {
            reject(new Error('Invalid JSON response'))
          }
        })
      },
    )
    request.setTimeout(20_000, () => {
      request.destroy(new Error('Request timeout'))
    })
    request.on('error', reject)
    request.end()
  })
}

export async function syncQuotaToCpa(): Promise<SyncQuotaToCpaResult> {
  try {
    const baseUrl = await dashboardBaseUrl()
    const response = await postJson(`${baseUrl}/api/sync-quota`)
    if (response.ok === false) {
      return {
        ok: false,
        updated: 0,
        unchanged: 0,
        missing: 0,
        syncedAt: new Date().toISOString(),
        message: response.error || 'CPA 路由同步失败',
      }
    }

    const sync = response.sync || {}
    return {
      ok: true,
      updated: Number(sync.updated || 0),
      unchanged: Number(sync.unchanged || 0),
      missing: missingCount(sync.missing),
      syncedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ok: false,
      updated: 0,
      unchanged: 0,
      missing: 0,
      syncedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

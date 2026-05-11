import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import type {
  QuotaAccountGroup,
  QuotaAccountStatus,
  QuotaGroupSummary,
  QuotaStatus,
} from '../src/types/api'
import { getNetworkSettings } from './network-settings'

const ACCOUNT_GROUPS: QuotaAccountGroup[] = ['自己的账号', '其余来源']
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.cli-proxy-api')
const DEFAULT_CONFIG_DIR = path.join(DEFAULT_AUTH_DIR, 'usage-dashboard')
const EXTRA_AUTH_DIRS = ['F:\\vscode代码\\cpa凭证学习']
const QUOTA_URL = 'https://chatgpt.com/backend-api/wham/usage'
const REFRESH_MS = 60_000
const PLAN_FOLDERS = ['free', 'plus', 'pro5x', 'pro20x'] as const
const PLAN_FOLDER_SET = new Set<string>(PLAN_FOLDERS)

type QuotaPlanFolder = (typeof PLAN_FOLDERS)[number]

interface AuthRecord {
  filePath: string
  accountGroup: QuotaAccountGroup
  groupRoot: string
}

interface AuthFile {
  access_token?: string
  email?: string
}

interface UsageWindow {
  used_percent?: number
  reset_at?: number
}

interface UsageResponse {
  plan_type?: string
  rate_limit?: {
    allowed?: boolean
    limit_reached?: boolean
    primary_window?: UsageWindow
    secondary_window?: UsageWindow
  }
  credits?: {
    balance?: unknown
  }
}

let cachedStatus: QuotaStatus | null = null
let cachedAt = 0
let inFlight: Promise<QuotaStatus> | null = null

function expandHome(value: string) {
  if (value === '~') return os.homedir()
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveAuthDirs() {
  const configDir = expandHome(process.env.CLIPROXY_USAGE_DASHBOARD_DIR || DEFAULT_CONFIG_DIR)
  const configPath = path.join(configDir, 'config.json')
  const dirs = [DEFAULT_AUTH_DIR, ...EXTRA_AUTH_DIRS]
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as { auth_dir?: string }
    if (config.auth_dir) dirs.unshift(expandHome(config.auth_dir))
  } catch {
    // No dashboard config is fine; use the CLIProxyAPI default.
  }
  return [...new Map(dirs.map((dir) => [path.normalize(expandHome(dir)).toLowerCase(), expandHome(dir)]))]
    .map(([, dir]) => dir)
}

async function walkAuthFiles(root: string, accountGroup: QuotaAccountGroup): Promise<AuthRecord[]> {
  if (!(await pathExists(root))) return []

  const records: AuthRecord[] = []
  const entries = await fs.readdir(root, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(root, entry.name)
      if (entry.isDirectory()) {
        records.push(...(await walkAuthFiles(child, accountGroup)))
        return
      }
      if (entry.isFile() && /^codex-.*\.json$/i.test(entry.name)) {
        records.push({ filePath: child, accountGroup, groupRoot: root })
      }
    }),
  )
  return records
}

async function ensurePlanFolders(groupRoot: string) {
  if (!(await pathExists(groupRoot))) return
  await Promise.all(PLAN_FOLDERS.map((planFolder) => fs.mkdir(path.join(groupRoot, planFolder), { recursive: true })))
}

async function scanGroupAuthFiles(authDir: string, accountGroup: QuotaAccountGroup) {
  const groupRoot = path.join(authDir, accountGroup)
  await ensurePlanFolders(groupRoot)
  return walkAuthFiles(groupRoot, accountGroup)
}

async function authFileRecords() {
  const authDirs = await resolveAuthDirs()
  const groups = await Promise.all(
    authDirs.flatMap((authDir) =>
      ACCOUNT_GROUPS.map((group) => scanGroupAuthFiles(authDir, group)),
    ),
  )
  return [
    ...new Map(
      groups
        .flat()
        .map((record) => [path.normalize(record.filePath).toLowerCase(), record] as const),
    ).values(),
  ].sort((a, b) => a.filePath.localeCompare(b.filePath))
}

function fallbackEmail(filePath: string) {
  return path
    .basename(filePath)
    .replace(/^codex-/i, '')
    .replace(/-(free|plus|pro5x|pro20x)\.json$/i, '')
    .replace(/-plus\.json$/i, '')
    .replace(/\.json$/i, '')
}

function normalizedPath(value: string) {
  return path.normalize(value).toLowerCase()
}

function normalizePlanFolder(plan: string): QuotaPlanFolder | null {
  const normalized = plan.trim().toLowerCase().replace(/[\s_-]+/g, '')
  return PLAN_FOLDER_SET.has(normalized) ? (normalized as QuotaPlanFolder) : null
}

async function nextAvailablePath(targetPath: string) {
  if (!(await pathExists(targetPath))) return targetPath

  const extension = path.extname(targetPath)
  const basename = path.basename(targetPath, extension)
  const directory = path.dirname(targetPath)
  for (let index = 1; index <= 999; index += 1) {
    const candidate = path.join(directory, `${basename}-${index}${extension}`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error(`No available file name under ${directory}`)
}

async function moveAuthFileToPlanFolder(record: AuthRecord, plan: string) {
  const planFolder = normalizePlanFolder(plan)
  if (!planFolder) return record.filePath

  const targetDir = path.join(record.groupRoot, planFolder)
  const targetPath = path.join(targetDir, path.basename(record.filePath))
  if (normalizedPath(record.filePath) === normalizedPath(targetPath)) return record.filePath

  await fs.mkdir(targetDir, { recursive: true })
  const availableTargetPath = await nextAvailablePath(targetPath)
  await fs.rename(record.filePath, availableTargetPath)
  return availableTargetPath
}

function percent(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null
}

function remaining(used: number | null) {
  return used === null ? null : Math.max(0, 100 - used)
}

function resetTime(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return new Date(n * 1000).toLocaleString('zh-CN', { hour12: false })
}

function requestOptions(token: string) {
  return {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'codex-cli',
    },
  }
}

function parseJsonResponse(
  statusCode: number,
  statusMessage: string | undefined,
  chunks: Buffer[],
  resolve: (value: UsageResponse) => void,
  reject: (reason?: unknown) => void,
) {
  if (statusCode < 200 || statusCode >= 300) {
    reject(new Error(`HTTP ${statusCode}: ${statusMessage || 'Request failed'}`))
    return
  }
  try {
    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as UsageResponse)
  } catch {
    reject(new Error('Invalid JSON response'))
  }
}

function getJsonDirect(url: string, token: string): Promise<UsageResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      requestOptions(token),
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          parseJsonResponse(response.statusCode || 0, response.statusMessage, chunks, resolve, reject)
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

function getJsonViaHttpProxy(url: string, token: string, proxyUrl: string): Promise<UsageResponse> {
  const target = new URL(url)
  const proxy = new URL(proxyUrl)
  const targetPort = Number(target.port || 443)
  const proxyPort = Number(proxy.port || 80)
  const auth =
    proxy.username || proxy.password
      ? Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
      : ''

  return new Promise((resolve, reject) => {
    const connectRequest = http.request({
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: auth ? { 'Proxy-Authorization': `Basic ${auth}` } : undefined,
    })

    connectRequest.setTimeout(20_000, () => {
      connectRequest.destroy(new Error('Proxy CONNECT timeout'))
    })

    connectRequest.on('connect', (response, socket) => {
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        socket.destroy()
        reject(new Error(`Proxy CONNECT ${response.statusCode || 0}: ${response.statusMessage || 'Request failed'}`))
        return
      }

      const tlsSocket = tls.connect({
        socket,
        servername: target.hostname,
      })

      tlsSocket.setTimeout(20_000, () => {
        tlsSocket.destroy(new Error('Request timeout'))
      })

      const request = https.request(
        {
          ...requestOptions(token),
          host: target.hostname,
          path: `${target.pathname}${target.search}`,
          servername: target.hostname,
          createConnection: () => tlsSocket,
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            parseJsonResponse(response.statusCode || 0, response.statusMessage, chunks, resolve, reject)
          })
        },
      )
      request.on('error', reject)
      request.end()
    })

    connectRequest.on('error', reject)
    connectRequest.end()
  })
}

async function getJson(url: string, token: string): Promise<UsageResponse> {
  const { quotaProxyUrl } = await getNetworkSettings()
  if (quotaProxyUrl) return getJsonViaHttpProxy(url, token, quotaProxyUrl)
  return getJsonDirect(url, token)
}

function errorRow(record: AuthRecord, email: string, error: unknown, timestamp: string): QuotaAccountStatus {
  const message = error instanceof Error ? error.message : String(error)
  return {
    timestamp,
    email,
    plan: '',
    allowed: false,
    limitReached: false,
    primaryUsedPercent: null,
    primaryRemainingPercent: null,
    primaryResetAt: '',
    secondaryUsedPercent: null,
    secondaryRemainingPercent: null,
    secondaryResetAt: '',
    creditsBalance: '',
    accountGroup: record.accountGroup,
    error: message,
  }
}

async function refreshRecord(record: AuthRecord, timestamp: string): Promise<QuotaAccountStatus> {
  let email = fallbackEmail(record.filePath)
  try {
    const auth = JSON.parse(await fs.readFile(record.filePath, 'utf8')) as AuthFile
    email = auth.email || email
    const token = auth.access_token
    if (!token) throw new Error('missing access_token')

    const data = await getJson(QUOTA_URL, token)
    const rateLimit = data.rate_limit || {}
    const primary = rateLimit.primary_window || {}
    const secondary = rateLimit.secondary_window || {}
    const primaryUsed = percent(primary.used_percent)
    const secondaryUsed = percent(secondary.used_percent)

    const status: QuotaAccountStatus = {
      timestamp,
      email,
      plan: data.plan_type || '',
      allowed: Boolean(rateLimit.allowed),
      limitReached: Boolean(rateLimit.limit_reached),
      primaryUsedPercent: primaryUsed,
      primaryRemainingPercent: remaining(primaryUsed),
      primaryResetAt: resetTime(primary.reset_at),
      secondaryUsedPercent: secondaryUsed,
      secondaryRemainingPercent: remaining(secondaryUsed),
      secondaryResetAt: resetTime(secondary.reset_at),
      creditsBalance: String(data.credits?.balance ?? ''),
      accountGroup: record.accountGroup,
      error: '',
    }

    try {
      await moveAuthFileToPlanFolder(record, status.plan)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      status.error = `分类移动失败：${message}`
    }

    return status
  } catch (error) {
    return errorRow(record, email, error, timestamp)
  }
}

function summarizeGroups(quotas: QuotaAccountStatus[]): QuotaGroupSummary[] {
  return ACCOUNT_GROUPS.map((accountGroup) => {
    const rows = quotas.filter((quota) => quota.accountGroup === accountGroup)
    return {
      accountGroup,
      total: rows.length,
      available: rows.filter((quota) => quota.allowed && !quota.error).length,
      limited: rows.filter((quota) => !quota.allowed && !quota.error).length,
      error: rows.filter((quota) => Boolean(quota.error)).length,
    }
  })
}

async function refreshQuotaStatus(): Promise<QuotaStatus> {
  const timestamp = new Date().toISOString()
  const records = await authFileRecords()
  const quotas = await Promise.all(records.map((record) => refreshRecord(record, timestamp)))
  return {
    quotas,
    groups: summarizeGroups(quotas),
    updatedAt: timestamp,
    refreshed: true,
    nextRefreshAt: new Date(Date.now() + REFRESH_MS).toISOString(),
  }
}

export async function getQuotaStatus(force = false): Promise<QuotaStatus> {
  const now = Date.now()
  if (!force && cachedStatus && now - cachedAt < REFRESH_MS) {
    return { ...cachedStatus, refreshed: false }
  }
  if (inFlight) return inFlight

  inFlight = refreshQuotaStatus()
    .then((status) => {
      cachedStatus = status
      cachedAt = Date.now()
      return status
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export const __quotaTestHooks = {
  ensurePlanFolders,
  moveAuthFileToPlanFolder,
  normalizePlanFolder,
}

import fs from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import type {
  QuotaAccountGroup,
  QuotaAccountStatus,
  QuotaGroupSummary,
  QuotaStatus,
} from '../src/types/api'

const ACCOUNT_GROUPS: QuotaAccountGroup[] = ['自己的账号', '其余来源']
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.cli-proxy-api')
const DEFAULT_CONFIG_DIR = path.join(DEFAULT_AUTH_DIR, 'usage-dashboard')
const EXTRA_AUTH_DIRS = ['F:\\vscode代码\\cpa凭证学习']
const QUOTA_URL = 'https://chatgpt.com/backend-api/wham/usage'
const REFRESH_MS = 60_000

interface AuthRecord {
  filePath: string
  accountGroup: QuotaAccountGroup
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
        records.push({ filePath: child, accountGroup })
      }
    }),
  )
  return records
}

async function authFileRecords() {
  const authDirs = await resolveAuthDirs()
  const groups = await Promise.all(
    authDirs.flatMap((authDir) =>
      ACCOUNT_GROUPS.map((group) => walkAuthFiles(path.join(authDir, group), group)),
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
    .replace(/-plus\.json$/i, '')
    .replace(/\.json$/i, '')
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

function getJson(url: string, token: string): Promise<UsageResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'codex-cli',
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const statusCode = response.statusCode || 0
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode}: ${response.statusMessage || 'Request failed'}`))
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as UsageResponse)
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

    return {
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

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
import { getQuotaVisibilitySettings } from './quota-visibility'

const ACCOUNT_GROUPS: QuotaAccountGroup[] = ['自己的账号', '其余来源']
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.cli-proxy-api')
const DEFAULT_CONFIG_DIR = path.join(DEFAULT_AUTH_DIR, 'usage-dashboard')
const EXTRA_AUTH_DIRS = ['F:\\vscode代码\\cpa凭证学习']
const QUOTA_URL = 'https://chatgpt.com/backend-api/wham/usage'
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_MS = 60_000
const TOKEN_REFRESH_SKEW_SECONDS = 300
const PLAN_FOLDERS = ['free', 'plus', 'pro5x', 'pro20x', 'business'] as const
const PLAN_FOLDER_SET = new Set<string>(PLAN_FOLDERS)
const PLAN_FOLDER_ALIASES: Record<string, QuotaPlanFolder> = {
  bussiness: 'business',
  chatgptbusiness: 'business',
}

type QuotaPlanFolder = (typeof PLAN_FOLDERS)[number]

interface AuthRecord {
  filePath: string
  accountGroup: QuotaAccountGroup
  groupRoot: string
}

interface AuthFile {
  auth_mode?: string
  access_token?: string
  id_token?: string
  refresh_token?: string
  account_id?: string
  email?: string
  tokens?: unknown
  OPENAI_API_KEY?: unknown
}

interface TokenResponse {
  id_token?: string
  access_token?: string
  refresh_token?: string
}

interface ResolvedAuthTokens {
  accessToken: string
  idToken?: string
  refreshToken?: string
  accountId?: string
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

class HttpStatusError extends Error {
  statusCode: number

  constructor(statusCode: number, statusMessage: string | undefined) {
    super(`HTTP ${statusCode}: ${statusMessage || 'Request failed'}`)
    this.statusCode = statusCode
  }
}

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

async function walkAuthFiles(
  root: string,
  accountGroup: QuotaAccountGroup,
  groupRoot = root,
): Promise<AuthRecord[]> {
  if (!(await pathExists(root))) return []

  const records: AuthRecord[] = []
  const entries = await fs.readdir(root, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(root, entry.name)
      if (entry.isDirectory()) {
        records.push(...(await walkAuthFiles(child, accountGroup, groupRoot)))
        return
      }
      if (entry.isFile() && /^codex-.*\.json$/i.test(entry.name)) {
        records.push({ filePath: child, accountGroup, groupRoot })
      }
    }),
  )
  return records
}

async function ensurePlanFolders(groupRoot: string) {
  if (!(await pathExists(groupRoot))) return
  await Promise.all(PLAN_FOLDERS.map((planFolder) => fs.mkdir(path.join(groupRoot, planFolder), { recursive: true })))
}

function inferPlanFolderFromFileName(filePath: string): QuotaPlanFolder | null {
  return /^codex-[a-z0-9]{6,64}-.+@.+\.json$/i.test(path.basename(filePath)) ? 'business' : null
}

async function scanGroupAuthFiles(authDir: string, accountGroup: QuotaAccountGroup) {
  const groupRoot = path.join(authDir, accountGroup)
  await ensurePlanFolders(groupRoot)
  return walkAuthFiles(groupRoot, accountGroup, groupRoot)
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
  const businessEmail = /^codex-[a-z0-9]{6,64}-(.+@.+)\.json$/i.exec(path.basename(filePath))?.[1]
  if (businessEmail) return businessEmail

  return path
    .basename(filePath)
    .replace(/^codex-/i, '')
    .replace(/-(free|plus|pro5x|pro20x|business|bussiness)\.json$/i, '')
    .replace(/-plus\.json$/i, '')
    .replace(/\.json$/i, '')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringField(record: Record<string, unknown> | null, key: string) {
  if (!record) return undefined
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null
  const part = token.split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function jwtAuthValue(token: string | undefined, keys: string[]) {
  const payload = decodeJwtPayload(token)
  const auth = asRecord(payload?.['https://api.openai.com/auth'])
  if (!auth) return undefined
  for (const key of keys) {
    const value = stringField(auth, key)
    if (value) return value
  }
  return undefined
}

function isJwtExpiredSoon(token: string) {
  const payload = decodeJwtPayload(token)
  const exp = typeof payload?.exp === 'number' ? payload.exp : 0
  if (!exp) return true
  return exp < Math.floor(Date.now() / 1000) + TOKEN_REFRESH_SKEW_SECONDS
}

function resolveAuthTokens(auth: AuthFile): ResolvedAuthTokens | null {
  const raw = auth as unknown as Record<string, unknown>
  const nestedTokens = asRecord(auth.tokens)
  const accessToken = stringField(raw, 'access_token') || stringField(nestedTokens, 'access_token')
  if (!accessToken) return null

  const idToken = stringField(raw, 'id_token') || stringField(nestedTokens, 'id_token')
  const refreshToken = stringField(raw, 'refresh_token') || stringField(nestedTokens, 'refresh_token')
  const accountId =
    stringField(raw, 'account_id') ||
    stringField(nestedTokens, 'account_id') ||
    jwtAuthValue(accessToken, ['chatgpt_account_id', 'account_id']) ||
    jwtAuthValue(idToken, ['account_id'])

  return { accessToken, idToken, refreshToken, accountId }
}

function normalizedPath(value: string) {
  return path.normalize(value).toLowerCase()
}

function quotaAccountKey(record: AuthRecord) {
  const relativePath = path.relative(record.groupRoot, record.filePath) || path.basename(record.filePath)
  const sourceKey = relativePath.split(path.sep).join('/').trim().toLowerCase()
  return `${record.accountGroup}:${sourceKey}`
}

function normalizePlanFolder(plan: string): QuotaPlanFolder | null {
  const normalized = plan.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (PLAN_FOLDER_ALIASES[normalized]) return PLAN_FOLDER_ALIASES[normalized]
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
  const planFolder = normalizePlanFolder(plan) || inferPlanFolderFromFileName(record.filePath)
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

function requestOptions(token: string, accountId?: string) {
  return {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'codex-cli',
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
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
    reject(new HttpStatusError(statusCode, statusMessage))
    return
  }
  try {
    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as UsageResponse)
  } catch {
    reject(new Error('Invalid JSON response'))
  }
}

function getJsonDirect(url: string, token: string, accountId?: string): Promise<UsageResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      requestOptions(token, accountId),
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

function getJsonViaHttpProxy(url: string, token: string, accountId: string | undefined, proxyUrl: string): Promise<UsageResponse> {
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
          ...requestOptions(token, accountId),
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

async function getJson(url: string, token: string, accountId?: string): Promise<UsageResponse> {
  const { quotaProxyUrl } = await getNetworkSettings()
  if (quotaProxyUrl) return getJsonViaHttpProxy(url, token, accountId, quotaProxyUrl)
  return getJsonDirect(url, token, accountId)
}

function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CODEX_CLIENT_ID,
  }).toString()

  return new Promise((resolve, reject) => {
    const request = https.request(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json',
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8')
          if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
            reject(new HttpStatusError(response.statusCode || 0, response.statusMessage))
            return
          }
          try {
            resolve(JSON.parse(responseBody) as TokenResponse)
          } catch {
            reject(new Error('Token 刷新失败：响应不是有效 JSON'))
          }
        })
      },
    )
    request.setTimeout(20_000, () => request.destroy(new Error('Token 刷新超时')))
    request.on('error', reject)
    request.end(body)
  })
}

async function writeRefreshedTokens(filePath: string, auth: AuthFile, refreshed: TokenResponse) {
  if (!refreshed.access_token) throw new Error('Token 刷新响应缺少 access_token')

  auth.access_token = refreshed.access_token
  if (refreshed.id_token) auth.id_token = refreshed.id_token
  if (refreshed.refresh_token) auth.refresh_token = refreshed.refresh_token

  const nestedTokens = asRecord(auth.tokens)
  if (nestedTokens) {
    nestedTokens.access_token = refreshed.access_token
    if (refreshed.id_token) nestedTokens.id_token = refreshed.id_token
    if (refreshed.refresh_token) nestedTokens.refresh_token = refreshed.refresh_token
    auth.tokens = nestedTokens
  }

  await fs.writeFile(filePath, `${JSON.stringify(auth, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function shouldRetryWithRefresh(error: unknown) {
  return error instanceof HttpStatusError && (error.statusCode === 401 || error.statusCode === 403)
}

async function getQuotaWithTokenRefresh(record: AuthRecord, auth: AuthFile) {
  let tokens = resolveAuthTokens(auth)
  if (!tokens) throw new Error('missing access_token')

  if (tokens.refreshToken && isJwtExpiredSoon(tokens.accessToken)) {
    const refreshed = await refreshTokens(tokens.refreshToken)
    await writeRefreshedTokens(record.filePath, auth, refreshed)
    tokens = resolveAuthTokens(auth)
    if (!tokens) throw new Error('missing access_token')
  }

  try {
    return await getJson(QUOTA_URL, tokens.accessToken, tokens.accountId)
  } catch (error) {
    if (!tokens.refreshToken || !shouldRetryWithRefresh(error)) throw error
    const refreshed = await refreshTokens(tokens.refreshToken)
    await writeRefreshedTokens(record.filePath, auth, refreshed)
    const refreshedTokens = resolveAuthTokens(auth)
    if (!refreshedTokens) throw new Error('missing access_token')
    return getJson(QUOTA_URL, refreshedTokens.accessToken, refreshedTokens.accountId)
  }
}

function errorRow(record: AuthRecord, email: string, error: unknown, timestamp: string): QuotaAccountStatus {
  const message = error instanceof Error ? error.message : String(error)
  return {
    timestamp,
    visibilityKey: quotaAccountKey(record),
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

function hiddenRow(record: AuthRecord, email: string, timestamp: string): QuotaAccountStatus {
  return {
    timestamp,
    visibilityKey: quotaAccountKey(record),
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
    error: '',
    hidden: true,
  }
}

async function refreshRecord(
  record: AuthRecord,
  timestamp: string,
  hiddenAccountKeys: Set<string>,
): Promise<QuotaAccountStatus> {
  let email = fallbackEmail(record.filePath)
  const visibilityKey = quotaAccountKey(record)
  if (hiddenAccountKeys.has(visibilityKey)) {
    try {
      const auth = JSON.parse(await fs.readFile(record.filePath, 'utf8')) as AuthFile
      email = auth.email || email
    } catch {
      // Hidden accounts should not surface local file parse errors as quota failures.
    }
    return hiddenRow(record, email, timestamp)
  }

  try {
    const auth = JSON.parse(await fs.readFile(record.filePath, 'utf8')) as AuthFile
    email = auth.email || email

    if (auth.auth_mode?.toLowerCase() === 'apikey' || typeof auth.OPENAI_API_KEY === 'string') {
      return {
        timestamp,
        visibilityKey,
        email,
        plan: 'API_KEY',
        allowed: true,
        limitReached: false,
        primaryUsedPercent: null,
        primaryRemainingPercent: null,
        primaryResetAt: '',
        secondaryUsedPercent: null,
        secondaryRemainingPercent: null,
        secondaryResetAt: '',
        creditsBalance: '',
        accountGroup: record.accountGroup,
        error: '',
      }
    }

    const data = await getQuotaWithTokenRefresh(record, auth)
    const rateLimit = data.rate_limit || {}
    const primary = rateLimit.primary_window || {}
    const secondary = rateLimit.secondary_window || {}
    const primaryUsed = percent(primary.used_percent)
    const secondaryUsed = percent(secondary.used_percent)

    const status: QuotaAccountStatus = {
      timestamp,
      visibilityKey,
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
  const visibility = await getQuotaVisibilitySettings()
  const hiddenAccountKeys = new Set(visibility.hiddenAccounts)
  const quotas = await Promise.all(records.map((record) => refreshRecord(record, timestamp, hiddenAccountKeys)))
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
  quotaAccountKey,
  normalizePlanFolder,
  inferPlanFolderFromFileName,
  fallbackEmail,
  refreshRecord,
  walkAuthFiles,
}

import { app, dialog, shell } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import type {
  CodexCredentialActionResult,
  CodexCredentialMeta,
  CodexCredentialMetaMap,
  CodexOAuthLoginStartResponse,
  QuotaAccountGroup,
} from '../src/types/api'

const ACCOUNT_GROUPS: QuotaAccountGroup[] = ['自己的账号', '其余来源']
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.cli-proxy-api')
const DEFAULT_CONFIG_DIR = path.join(DEFAULT_AUTH_DIR, 'usage-dashboard')
const EXTRA_AUTH_DIRS = ['F:\\vscode代码\\cpa凭证学习']
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OAUTH_SCOPES = 'openid profile email offline_access'
const OAUTH_ORIGINATOR = 'codex_vscode'
const TOKEN_REFRESH_SKEW_SECONDS = 300
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000

interface AuthRecord {
  filePath: string
  accountGroup: QuotaAccountGroup
  groupRoot: string
}

interface OAuthTokens {
  idToken: string
  accessToken: string
  refreshToken?: string
  accountId?: string
}

interface CredentialAuth {
  raw: Record<string, unknown>
  email: string
  tokens?: OAuthTokens
  apiKey?: string
  baseUrl?: string
}

interface TokenResponse {
  id_token?: string
  access_token?: string
  refresh_token?: string
}

interface OAuthFlowState {
  loginId: string
  state: string
  codeVerifier: string
  redirectUri: string
  authUrl: string
  code?: string
  server: http.Server
  expiresAt: number
}

const oauthFlows = new Map<string, OAuthFlowState>()

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
    // The dashboard config is optional.
  }
  return [...new Map(dirs.map((dir) => [path.normalize(expandHome(dir)).toLowerCase(), expandHome(dir)]))]
    .map(([, dir]) => dir)
}

async function walkAuthFiles(root: string, accountGroup: QuotaAccountGroup, groupRoot = root): Promise<AuthRecord[]> {
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

function codexCredentialKey(record: AuthRecord) {
  const relativePath = path.relative(record.groupRoot, record.filePath) || path.basename(record.filePath)
  const sourceKey = relativePath.split(path.sep).join('/').trim().toLowerCase()
  return `${record.accountGroup}:${sourceKey}`
}

async function findCredentialRecord(credentialKey: string) {
  const records = await authFileRecords()
  const record = records.find((item) => codexCredentialKey(item) === credentialKey)
  if (!record) throw new Error('未找到该 Codex 凭证，可能已被移动或删除')
  return record
}

function metadataPath() {
  return path.join(app.getPath('userData'), 'codex-account-meta.json')
}

async function readMetadata(): Promise<CodexCredentialMetaMap> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(metadataPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return {}
    const result: CodexCredentialMetaMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const meta = value as Partial<CodexCredentialMeta>
      result[key] = {
        tags: Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        note: typeof meta.note === 'string' ? meta.note : '',
      }
    }
    return result
  } catch {
    return {}
  }
}

async function writeMetadata(metadata: CodexCredentialMetaMap) {
  const target = metadataPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  await writeJsonAtomic(target, metadata)
}

export async function getCodexCredentialMetas(): Promise<CodexCredentialMetaMap> {
  return readMetadata()
}

export async function startCodexOAuthLogin(): Promise<CodexOAuthLoginStartResponse> {
  const loginId = base64Url(randomBytes(18))
  const state = base64Url(randomBytes(24))
  const codeVerifier = base64Url(randomBytes(32))
  const codeChallenge = sha256Base64Url(codeVerifier)

  const server = http.createServer((request, response) => {
    try {
      const flow = oauthFlows.get(loginId)
      if (!flow) throw new Error('OAuth 会话不存在或已过期')
      const url = new URL(request.url || '/', flow.redirectUri)
      const returnedState = url.searchParams.get('state') || ''
      const code = url.searchParams.get('code') || ''
      if (returnedState !== flow.state) throw new Error('OAuth state 校验失败')
      if (!code) throw new Error('OAuth 回调缺少 code')
      flow.code = code
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><meta charset="utf-8"><title>Codex OAuth</title><body>Codex 授权完成，可以回到 Agent Token Tracker。</body>')
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(error instanceof Error ? error.message : String(error))
    }
  })

  const redirectUri = await new Promise<string>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('无法启动 OAuth 本地回调服务'))
        return
      }
      resolve(`http://127.0.0.1:${address.port}/auth/callback`)
    })
  })

  const authUrl = `${AUTH_ENDPOINT}?${new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: OAUTH_ORIGINATOR,
  }).toString()}`

  const flow: OAuthFlowState = {
    loginId,
    state,
    codeVerifier,
    redirectUri,
    authUrl,
    server,
    expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
  }
  oauthFlows.set(loginId, flow)
  setTimeout(() => cleanupOAuthFlow(loginId), OAUTH_TIMEOUT_MS).unref()
  await shell.openExternal(authUrl)
  return { loginId, authUrl, redirectUri }
}

export function submitCodexOAuthCallbackUrl(loginId: string, callbackUrl: string) {
  const flow = oauthFlows.get(loginId)
  if (!flow || flow.expiresAt < Date.now()) {
    cleanupOAuthFlow(loginId)
    throw new Error('OAuth 会话不存在或已过期，请重新开始授权')
  }
  const url = new URL(callbackUrl)
  const state = url.searchParams.get('state') || ''
  const code = url.searchParams.get('code') || ''
  if (state !== flow.state) throw new Error('OAuth state 校验失败')
  if (!code) throw new Error('回调地址中没有 code')
  flow.code = code
  return { ok: true, message: '已读取回调地址，可以继续导入' }
}

export async function completeCodexOAuthLogin(loginId: string): Promise<CodexCredentialActionResult> {
  const flow = oauthFlows.get(loginId)
  if (!flow || flow.expiresAt < Date.now()) {
    cleanupOAuthFlow(loginId)
    throw new Error('OAuth 会话不存在或已过期，请重新开始授权')
  }
  if (!flow.code) throw new Error('还没有收到 OAuth 回调，请先在浏览器完成授权')
  try {
    const response = await exchangeOAuthCode(flow.code, flow.codeVerifier, flow.redirectUri)
    return await saveImportedCredential(tokenResponseToAuth(response))
  } finally {
    cleanupOAuthFlow(loginId)
  }
}

export async function importCodexCredentialText(text: string): Promise<CodexCredentialActionResult[]> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('导入内容不能为空')
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return importCredentialPayload(JSON.parse(trimmed))
  }

  const refreshTokenValues = extractRefreshTokensFromText(trimmed)
  if (refreshTokenValues.length === 0) throw new Error('未识别到 JSON 或 refresh_token')
  const results: CodexCredentialActionResult[] = []
  for (const refreshToken of refreshTokenValues) {
    const response = await refreshTokens(refreshToken)
    results.push(await saveImportedCredential(tokenResponseToAuth(response, refreshToken)))
  }
  return results
}

export async function importCodexApiKey(apiKey: string, baseUrl?: string): Promise<CodexCredentialActionResult> {
  const normalizedKey = apiKey.trim()
  if (!normalizedKey) throw new Error('API Key 不能为空')
  if (/^https?:\/\//i.test(normalizedKey)) throw new Error('API Key 不能是 URL')
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, '')
  if (normalizedBaseUrl && !/^https?:\/\//i.test(normalizedBaseUrl)) {
    throw new Error('Base URL 需要以 http:// 或 https:// 开头')
  }
  return saveImportedCredential(normalizeOAuthRaw({
    auth_mode: 'apikey',
    email: `api-key-${md5Short(normalizedKey)}`,
    OPENAI_API_KEY: normalizedKey,
    ...(normalizedBaseUrl ? { base_url: normalizedBaseUrl } : {}),
  }))
}

export async function importCurrentCodexAuth(): Promise<CodexCredentialActionResult[]> {
  const authPath = path.join(resolveCodexHome(), 'auth.json')
  if (!(await pathExists(authPath))) throw new Error(`未找到 Codex auth.json：${authPath}`)
  return importCredentialPayload(JSON.parse(await fs.readFile(authPath, 'utf8')))
}

export async function importCodexCredentialFiles(): Promise<CodexCredentialActionResult[]> {
  const result = await dialog.showOpenDialog({
    title: '选择 Codex 凭证 JSON 文件',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return []

  const imported: CodexCredentialActionResult[] = []
  for (const filePath of result.filePaths) {
    imported.push(...(await importCredentialPayload(JSON.parse(await fs.readFile(filePath, 'utf8')))))
  }
  return imported
}

export async function setCodexCredentialMeta(
  credentialKey: string,
  meta: CodexCredentialMeta,
): Promise<CodexCredentialMeta> {
  await findCredentialRecord(credentialKey)
  const nextMeta = {
    tags: [...new Set(meta.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12),
    note: meta.note.trim(),
  }
  const metadata = await readMetadata()
  metadata[credentialKey] = nextMeta
  await writeMetadata(metadata)
  return nextMeta
}

function fallbackEmail(filePath: string) {
  const businessEmail = /^codex-[a-z0-9]{6,64}-(.+@.+)\.json$/i.exec(path.basename(filePath))?.[1]
  if (businessEmail) return businessEmail

  return path
    .basename(filePath)
    .replace(/^codex-/i, '')
    .replace(/-(free|plus|pro5x|pro20x|business|bussiness)\.json$/i, '')
    .replace(/\.json$/i, '')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function jwtEmail(token?: string) {
  if (!token) return undefined
  const payload = decodeJwtPayload(token)
  const email = payload?.email
  return typeof email === 'string' && email.trim() ? email.trim() : undefined
}

function jwtAuthValue(token: string | undefined, keys: string[]) {
  if (!token) return undefined
  const payload = decodeJwtPayload(token)
  const auth = asRecord(payload?.['https://api.openai.com/auth'])
  if (!auth) return undefined
  for (const key of keys) {
    const value = auth[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function isJwtExpiredSoon(token: string) {
  const payload = decodeJwtPayload(token)
  const exp = typeof payload?.exp === 'number' ? payload.exp : 0
  if (!exp) return true
  return exp < Math.floor(Date.now() / 1000) + TOKEN_REFRESH_SKEW_SECONDS
}

function base64Url(buffer: Buffer) {
  return buffer.toString('base64url')
}

function sha256Base64Url(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

function md5Short(value: string) {
  return createHash('md5').update(value).digest('hex').slice(0, 12)
}

function sanitizeFilePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'account'
}

function normalizeOAuthRaw(raw: Record<string, unknown>, fallbackRefreshToken?: string): CredentialAuth {
  const nestedTokens = asRecord(raw.tokens)
  const idToken = stringField(nestedTokens || raw, 'id_token')
  const accessToken = stringField(nestedTokens || raw, 'access_token')
  const refreshToken = stringField(nestedTokens || raw, 'refresh_token') || fallbackRefreshToken
  const accountId =
    stringField(nestedTokens || raw, 'account_id') ||
    stringField(raw, 'account_id') ||
    jwtAuthValue(accessToken, ['chatgpt_account_id', 'account_id']) ||
    jwtAuthValue(idToken, ['account_id'])
  const email = stringField(raw, 'email') || jwtEmail(idToken) || 'unknown-codex-account'
  const apiKey = stringField(raw, 'OPENAI_API_KEY') || stringField(raw, 'openai_api_key')

  if (apiKey && !idToken && !accessToken) {
    return {
      raw: {
        auth_mode: 'apikey',
        email: stringField(raw, 'email') || `api-key-${md5Short(apiKey)}`,
        OPENAI_API_KEY: apiKey,
        ...(stringField(raw, 'base_url') || stringField(raw, 'api_base_url')
          ? { base_url: stringField(raw, 'base_url') || stringField(raw, 'api_base_url') }
          : {}),
      },
      email: stringField(raw, 'email') || `api-key-${md5Short(apiKey)}`,
      apiKey,
      baseUrl: stringField(raw, 'base_url') || stringField(raw, 'api_base_url'),
    }
  }

  if (!idToken || !accessToken) {
    throw new Error('OAuth JSON 缺少 id_token/access_token')
  }

  const tokens = { idToken, accessToken, refreshToken, accountId }
  const normalizedRaw: Record<string, unknown> = {
    auth_mode: 'oauth',
    email,
    id_token: idToken,
    access_token: accessToken,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(accountId ? { account_id: accountId } : {}),
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      ...(accountId ? { account_id: accountId } : {}),
    },
    last_refresh: new Date().toISOString(),
  }
  return { raw: normalizedRaw, email, tokens }
}

async function readCredentialAuth(record: AuthRecord): Promise<CredentialAuth> {
  const raw = asRecord(JSON.parse(await fs.readFile(record.filePath, 'utf8')))
  if (!raw) throw new Error('凭证 JSON 格式无效')

  const nestedTokens = asRecord(raw.tokens)
  const idToken = stringField(nestedTokens || raw, 'id_token')
  const accessToken = stringField(nestedTokens || raw, 'access_token')
  const refreshToken = stringField(nestedTokens || raw, 'refresh_token')
  const accountId =
    stringField(nestedTokens || raw, 'account_id') ||
    stringField(raw, 'account_id') ||
    jwtAuthValue(accessToken, ['chatgpt_account_id', 'account_id']) ||
    jwtAuthValue(idToken, ['account_id'])
  const apiKey = stringField(raw, 'OPENAI_API_KEY')
  const email = stringField(raw, 'email') || jwtEmail(idToken) || fallbackEmail(record.filePath)

  return {
    raw,
    email,
    tokens: idToken && accessToken
      ? { idToken, accessToken, refreshToken, accountId }
      : undefined,
    apiKey,
    baseUrl: stringField(raw, 'base_url') || stringField(raw, 'api_base_url'),
  }
}

function updateCredentialTokens(raw: Record<string, unknown>, tokens: OAuthTokens) {
  const nested = asRecord(raw.tokens)
  const target = nested || raw
  target.id_token = tokens.idToken
  target.access_token = tokens.accessToken
  if (tokens.refreshToken) target.refresh_token = tokens.refreshToken
  if (tokens.accountId) target.account_id = tokens.accountId
  if (nested) raw.tokens = target
  raw.last_refresh = new Date().toISOString()
}

async function writeJsonAtomic(targetPath: string, value: unknown) {
  const parent = path.dirname(targetPath)
  await fs.mkdir(parent, { recursive: true })
  const tempPath = path.join(parent, `.${path.basename(targetPath)}.tmp.${process.pid}.${Date.now()}`)
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tempPath, targetPath)
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
            reject(new Error(`Token 刷新失败：HTTP ${response.statusCode || 0}`))
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

function exchangeOAuthCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CODEX_CLIENT_ID,
    code_verifier: codeVerifier,
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
            reject(new Error(`OAuth Token 交换失败：HTTP ${response.statusCode || 0}`))
            return
          }
          try {
            resolve(JSON.parse(responseBody) as TokenResponse)
          } catch {
            reject(new Error('OAuth Token 交换失败：响应不是有效 JSON'))
          }
        })
      },
    )
    request.setTimeout(20_000, () => request.destroy(new Error('OAuth Token 交换超时')))
    request.on('error', reject)
    request.end(body)
  })
}

function tokenResponseToAuth(response: TokenResponse, fallbackRefreshToken?: string): CredentialAuth {
  if (!response.id_token || !response.access_token) {
    throw new Error('授权响应缺少 id_token/access_token')
  }
  return normalizeOAuthRaw({
    id_token: response.id_token,
    access_token: response.access_token,
    refresh_token: response.refresh_token || fallbackRefreshToken,
  }, fallbackRefreshToken)
}

async function resolveImportRoot() {
  const [firstDir] = await resolveAuthDirs()
  return firstDir || DEFAULT_AUTH_DIR
}

async function nextAvailableCredentialPath(targetPath: string) {
  if (!(await pathExists(targetPath))) return targetPath
  const extension = path.extname(targetPath)
  const basename = path.basename(targetPath, extension)
  const directory = path.dirname(targetPath)
  for (let index = 1; index <= 999; index += 1) {
    const candidate = path.join(directory, `${basename}-${index}${extension}`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error(`无法在 ${directory} 下生成可用文件名`)
}

async function saveImportedCredential(auth: CredentialAuth, group: QuotaAccountGroup = '自己的账号') {
  const importRoot = await resolveImportRoot()
  const targetDir = path.join(importRoot, group)
  const identity = auth.tokens?.accountId || auth.email || auth.apiKey || JSON.stringify(auth.raw)
  const fileName = `codex-${md5Short(identity)}-${sanitizeFilePart(auth.email)}.json`
  const targetPath = await nextAvailableCredentialPath(path.join(targetDir, fileName))
  await writeJsonAtomic(targetPath, auth.raw)
  return {
    ok: true,
    email: auth.email,
    path: targetPath,
    message: `已导入 ${auth.email}`,
  }
}

function extractRefreshTokensFromText(text: string) {
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^["']|["',;]$/g, '')
    if (!trimmed) continue
    const parsed = trimmed.match(/"refresh_token"\s*:\s*"([^"]+)"/)?.[1] || trimmed
    if (/^(rt_|[A-Za-z0-9_-]{20,})/.test(parsed) && !seen.has(parsed)) {
      seen.add(parsed)
      tokens.push(parsed)
    }
  }
  return tokens
}

async function importCredentialPayload(payload: unknown): Promise<CodexCredentialActionResult[]> {
  if (Array.isArray(payload)) {
    const results: CodexCredentialActionResult[] = []
    for (const item of payload) {
      results.push(...(await importCredentialPayload(item)))
    }
    return results
  }

  const raw = asRecord(payload)
  if (!raw) throw new Error('导入内容不是有效 JSON 对象')
  const refreshToken = stringField(raw, 'refresh_token') || stringField(asRecord(raw.tokens) || {}, 'refresh_token')
  if (refreshToken && !stringField(raw, 'access_token') && !asRecord(raw.tokens)) {
    const refreshed = await refreshTokens(refreshToken)
    return [await saveImportedCredential(tokenResponseToAuth(refreshed, refreshToken))]
  }
  return [await saveImportedCredential(normalizeOAuthRaw(raw, refreshToken))]
}

function cleanupOAuthFlow(loginId: string) {
  const flow = oauthFlows.get(loginId)
  if (!flow) return
  oauthFlows.delete(loginId)
  try {
    flow.server.close()
  } catch {
    // Already closed.
  }
}

async function prepareCredential(record: AuthRecord) {
  const auth = await readCredentialAuth(record)
  if (auth.apiKey) return auth
  if (!auth.tokens) throw new Error('该凭证缺少 id_token/access_token，不能用于 Codex 登录切换')

  if (!isJwtExpiredSoon(auth.tokens.accessToken)) return auth
  if (!auth.tokens.refreshToken) throw new Error('access_token 已过期且缺少 refresh_token，请重新登录后再导入')

  const refreshed = await refreshTokens(auth.tokens.refreshToken)
  const tokens: OAuthTokens = {
    idToken: refreshed.id_token || auth.tokens.idToken,
    accessToken: refreshed.access_token || auth.tokens.accessToken,
    refreshToken: refreshed.refresh_token || auth.tokens.refreshToken,
    accountId: auth.tokens.accountId,
  }
  updateCredentialTokens(auth.raw, tokens)
  await writeJsonAtomic(record.filePath, auth.raw)
  return { ...auth, tokens }
}

function buildCodexAuthJson(auth: CredentialAuth) {
  if (auth.apiKey) {
    return {
      auth_mode: 'apikey',
      OPENAI_API_KEY: auth.apiKey,
      ...(auth.baseUrl ? { base_url: auth.baseUrl } : {}),
    }
  }

  if (!auth.tokens) throw new Error('该凭证缺少 OAuth token，不能写入 Codex auth.json')
  return {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: auth.tokens.idToken,
      access_token: auth.tokens.accessToken,
      ...(auth.tokens.refreshToken ? { refresh_token: auth.tokens.refreshToken } : {}),
      ...(auth.tokens.accountId ? { account_id: auth.tokens.accountId } : {}),
    },
    last_refresh: new Date().toISOString(),
  }
}

function resolveCodexHome() {
  const raw = process.env.CODEX_HOME?.trim().replace(/^["']|["']$/g, '')
  return raw || path.join(os.homedir(), '.codex')
}

async function writeCredentialToCodexHome(record: AuthRecord, codexHome: string) {
  const auth = await prepareCredential(record)
  await writeJsonAtomic(path.join(codexHome, 'auth.json'), buildCodexAuthJson(auth))
  return auth
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function spawnCodexTerminal(codexHome?: string) {
  if (process.platform === 'win32') {
    const command = codexHome ? `set "CODEX_HOME=${codexHome}" && codex` : 'codex'
    const child = spawn('cmd.exe', ['/d', '/k', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()
    return
  }

  const shellPath = process.env.SHELL || '/bin/sh'
  const command = codexHome ? `CODEX_HOME=${shellQuote(codexHome)} codex` : 'codex'
  const child = spawn(shellPath, ['-lc', command], { detached: true, stdio: 'ignore' })
  child.unref()
}

function powershellDetached(command: string) {
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

function powershellSync(command: string) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  })
}

function windowsCodexDesktopPids() {
  if (process.platform !== 'win32') return []
  const output = powershellSync(`
    Get-Process |
      Where-Object {
        $_.ProcessName -ieq 'Codex' -or
        (($_.Path -like '*OpenAI.Codex*' -or $_.Path -like '*\\\\Codex\\\\*') -and $_.ProcessName -ieq 'codex')
      } |
      Select-Object -ExpandProperty Id
  `)
  return output.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isFinite(pid) && pid > 0)
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function stopCodexDesktopProcessIfPossible() {
  if (process.platform === 'win32') {
    powershellSync(`
      Get-Process |
        Where-Object {
          $_.ProcessName -ieq 'Codex' -or
          (($_.Path -like '*OpenAI.Codex*' -or $_.Path -like '*\\\\Codex\\\\*') -and $_.ProcessName -ieq 'codex')
        } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    `)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (windowsCodexDesktopPids().length === 0) return
      await sleep(250)
    }
    return
  }

  if (process.platform === 'darwin') {
    const child = spawn('osascript', ['-e', 'tell application "Codex" to quit'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    await sleep(1200)
  }
}

function detectWindowsCodexAppId() {
  const output = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "Get-StartApps | Where-Object { $_.AppID -match 'OpenAI\\.Codex|Codex' -or $_.Name -match '^Codex$|OpenAI Codex' } | Select-Object -First 1 -ExpandProperty AppID",
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const appId = output.stdout.trim().split(/\r?\n/)[0]?.trim()
  return appId || 'OpenAI.Codex_2p2nqsd0c76g0!App'
}

async function launchCodexDesktopApp() {
  if (process.platform === 'win32') {
    const beforePids = new Set(windowsCodexDesktopPids())
    const appId = detectWindowsCodexAppId()
    const shellTarget = `shell:AppsFolder\\${appId}`
    const child = spawn('explorer.exe', [shellTarget], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const pids = windowsCodexDesktopPids()
      if (pids.some((pid) => !beforePids.has(pid)) || (beforePids.size === 0 && pids.length > 0)) {
        return
      }
      await sleep(250)
    }
    throw new Error(`已调用 Codex 桌面端启动入口，但 15 秒内未检测到新进程：${shellTarget}`)
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', ['-a', 'Codex'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    await sleep(1200)
    return
  }

  throw new Error('Codex 桌面端启动目前仅支持 Windows 和 macOS')
}

function safeInstanceName(credentialKey: string) {
  return Buffer.from(credentialKey).toString('base64url').slice(0, 48)
}

export async function openCodexCliWithCredential(credentialKey: string): Promise<CodexCredentialActionResult> {
  const record = await findCredentialRecord(credentialKey)
  const instanceDir = path.join(app.getPath('userData'), 'codex-cli-instances', safeInstanceName(credentialKey))
  const auth = await writeCredentialToCodexHome(record, instanceDir)
  spawnCodexTerminal(instanceDir)
  return {
    ok: true,
    email: auth.email,
    path: instanceDir,
    message: `已用 ${auth.email} 启动隔离 Codex CLI`,
  }
}

export async function launchCodexWithCredential(credentialKey: string): Promise<CodexCredentialActionResult> {
  const record = await findCredentialRecord(credentialKey)
  const codexHome = resolveCodexHome()
  const auth = await writeCredentialToCodexHome(record, codexHome)
  await stopCodexDesktopProcessIfPossible()
  await launchCodexDesktopApp()
  return {
    ok: true,
    email: auth.email,
    path: codexHome,
    message: `已切换到 ${auth.email} 并启动 Codex 桌面端`,
  }
}

export async function exportCodexCredential(credentialKey: string): Promise<CodexCredentialActionResult> {
  const record = await findCredentialRecord(credentialKey)
  const result = await dialog.showOpenDialog({
    title: '选择凭证 JSON 导出目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, message: '已取消导出' }
  }

  const targetPath = path.join(result.filePaths[0], path.basename(record.filePath))
  await fs.copyFile(record.filePath, targetPath)
  return { ok: true, path: targetPath, message: '凭证 JSON 已导出' }
}

export async function deleteCodexCredential(credentialKey: string): Promise<CodexCredentialActionResult> {
  const record = await findCredentialRecord(credentialKey)
  const metadata = await readMetadata()
  delete metadata[credentialKey]
  await writeMetadata(metadata)
  try {
    await shell.trashItem(record.filePath)
  } catch {
    await fs.unlink(record.filePath)
  }
  return { ok: true, path: record.filePath, message: '凭证已删除' }
}

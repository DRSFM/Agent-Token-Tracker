import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage, shell } from 'electron'
import type {
  CloudActionResult,
  CloudAuthProvider,
  CloudAuthStatus,
  CloudOAuthStartResponse,
} from '../src/types/api'
import { getUserDataPath } from './app-paths'
import { getCloudBackendConfig } from './cloud-settings'

interface CloudSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  userId: string
  email?: string
  provider: CloudAuthProvider
}

interface SupabaseAuthResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  user?: {
    id?: string
    email?: string
    app_metadata?: { provider?: string }
  }
}

interface OAuthFlow {
  provider: 'github' | 'google'
  verifier: string
  server: Server
  callback: Promise<string>
  resolve: (code: string) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

const AUTH_FILE = 'cloud-auth.bin'
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000
/** Fixed local port so Supabase redirect allow-list configuration is stable. */
const OAUTH_CALLBACK_PORT = 48215
const oauthFlows = new Map<string, OAuthFlow>()
let loaded = false
let session: CloudSession | null = null
let refreshPromise: Promise<CloudSession | null> | null = null

function authPath() {
  return path.join(getUserDataPath(), AUTH_FILE)
}

function base64Url(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomUrlValue() {
  return base64Url(randomBytes(32))
}

function challengeFor(verifier: string) {
  return base64Url(createHash('sha256').update(verifier).digest())
}

export class CloudAuthHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(`Supabase Auth HTTP ${status}: ${message.slice(0, 300)}`)
    this.name = 'CloudAuthHttpError'
  }
}

function authError(status: number, body: string) {
  let message = body
  try {
    const parsed = JSON.parse(body) as { msg?: string; message?: string; error_description?: string }
    message = parsed.msg ?? parsed.message ?? parsed.error_description ?? body
  } catch {
    // Keep the text response when it is not JSON.
  }
  return new CloudAuthHttpError(status, message)
}

async function readJsonResponse(response: Response) {
  const text = await response.text()
  if (!response.ok) throw authError(response.status, text)
  try {
    return JSON.parse(text) as SupabaseAuthResponse
  } catch {
    throw new Error('Supabase Auth returned invalid JSON')
  }
}

async function authRequest(pathName: string, init: RequestInit = {}, accessToken?: string) {
  const config = getCloudBackendConfig()
  if (!config) throw new Error('尚未配置 Supabase 项目 URL 和 public anon key。')
  const headers = new Headers(init.headers)
  headers.set('apikey', config.anonKey)
  headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`${config.url}/auth/v1/${pathName}`, { ...init, headers })
}

function providerFromResponse(response: SupabaseAuthResponse, fallback: CloudAuthProvider): CloudAuthProvider {
  const provider = response.user?.app_metadata?.provider
  return provider === 'github' || provider === 'google' || provider === 'email' ? provider : fallback
}

function sessionFromResponse(response: SupabaseAuthResponse, fallback: CloudAuthProvider): CloudSession {
  if (!response.access_token || !response.refresh_token || !response.user?.id) {
    throw new Error('Supabase Auth 响应缺少必要的 session 字段。')
  }
  const expiresIn = Number(response.expires_in ?? 3600)
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Number.isFinite(response.expires_at)
      ? Number(response.expires_at) * 1000
      : Date.now() + Math.max(60, expiresIn) * 1000,
    userId: response.user.id,
    email: response.user.email,
    provider: providerFromResponse(response, fallback),
  }
}

async function persistSession(next: CloudSession | null) {
  session = next
  if (!next) {
    await fs.rm(authPath(), { force: true }).catch(() => {})
    return
  }

  try {
    if (!safeStorage.isEncryptionAvailable()) return
    const encrypted = safeStorage.encryptString(JSON.stringify(next))
    await fs.mkdir(path.dirname(authPath()), { recursive: true })
    await fs.writeFile(authPath(), encrypted)
  } catch {
    // Keep the session in memory, but never write plaintext tokens to disk.
  }
}

async function loadSession() {
  if (loaded) return session
  loaded = true
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const encrypted = await fs.readFile(authPath())
    const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as Partial<CloudSession>
    if (
      typeof parsed.accessToken === 'string' &&
      typeof parsed.refreshToken === 'string' &&
      typeof parsed.expiresAt === 'number' &&
      typeof parsed.userId === 'string' &&
      (parsed.provider === 'email' || parsed.provider === 'github' || parsed.provider === 'google')
    ) {
      session = parsed as CloudSession
    }
  } catch {
    session = null
  }
  return session
}

function isTerminalRefreshError(error: unknown) {
  return error instanceof CloudAuthHttpError && [400, 401, 403].includes(error.status)
}

async function refreshSession(current: CloudSession) {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const response = await authRequest('token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      })
      const refreshed = sessionFromResponse(await readJsonResponse(response), current.provider)
      await persistSession(refreshed)
      return refreshed
    } catch (error) {
      // A rejected/expired refresh token is terminal. Network errors and
      // temporary server failures must not erase an otherwise usable account
      // identity or its queued outbox data.
      if (isTerminalRefreshError(error)) await persistSession(null)
      return null
    }
  })()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

export async function getCloudAccessToken() {
  const current = await loadSession()
  if (!current) return null
  if (current.expiresAt - Date.now() > 60_000) return current.accessToken
  const refreshed = await refreshSession(current)
  return refreshed?.accessToken ?? null
}

/** Return the stored account identity without forcing a network refresh. */
export async function getCloudUserId() {
  return (await loadSession())?.userId ?? null
}

function authStatusFromSession(current: CloudSession): CloudAuthStatus {
  return {
    authenticated: true,
    email: current.email,
    userId: current.userId,
    provider: current.provider,
    expiresAt: new Date(current.expiresAt).toISOString(),
  }
}

export async function getCloudAuthStatus(): Promise<CloudAuthStatus> {
  const current = await loadSession()
  if (!current) return { authenticated: false }
  if (current.expiresAt - Date.now() <= 60_000) {
    const refreshed = await refreshSession(current)
    if (refreshed) return authStatusFromSession(refreshed)
    // Keep reporting the account as authenticated during transient network
    // failures. The caller can still use the identity to isolate its outbox;
    // an upload will retry once a fresh access token is available.
    if (session) return authStatusFromSession(session)
    return { authenticated: false }
  }
  return authStatusFromSession(current)
}

export async function requestCloudEmailOtp(email: string): Promise<CloudActionResult> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    return { ok: false, message: '请输入有效的邮箱地址。' }
  }
  try {
    const response = await authRequest('otp', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail, create_user: true }),
    })
    await readJsonResponse(response).catch(() => ({}))
    return { ok: true, message: '验证码已发送，请检查邮箱。' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function verifyCloudEmailOtp(email: string, token: string): Promise<CloudActionResult> {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedToken = token.trim()
  if (!/^\d{6}$/.test(normalizedToken)) return { ok: false, message: '验证码应为 6 位数字。' }
  try {
    const response = await authRequest('verify', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail, token: normalizedToken, type: 'email' }),
    })
    await persistSession(sessionFromResponse(await readJsonResponse(response), 'email'))
    return { ok: true, message: '登录成功。' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function writeCallback(response: ServerResponse, title: string, message: string) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><p>${message}</p>`)
}

function closeOAuthFlow(loginId: string) {
  const flow = oauthFlows.get(loginId)
  if (!flow) return
  clearTimeout(flow.timeout)
  flow.server.close()
  oauthFlows.delete(loginId)
}

async function startCallbackServer(loginId: string, provider: 'github' | 'google', verifier: string) {
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const callback = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  void callback.catch(() => {})
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    // Supabase normally preserves redirect_to, but on an OAuth error it can
    // fall back to the configured Site URL (the root path). Handle that case
    // so the user sees the actual auth error instead of a local 404.
    const isCallbackPath = requestUrl.pathname === '/auth/callback'
    const hasOAuthError = requestUrl.searchParams.has('error')
    if (!isCallbackPath && !(requestUrl.pathname === '/' && hasOAuthError)) {
      response.writeHead(404)
      response.end()
      return
    }
    const error = requestUrl.searchParams.get('error')
    if (error) {
      const description = requestUrl.searchParams.get('error_description') ?? error
      writeCallback(response, '登录取消', '登录未完成，可以返回 Tracker 重试。')
      rejectCode(new Error(description))
      return
    }
    const code = requestUrl.searchParams.get('code')
    if (!code) {
      writeCallback(response, '登录失败', '回调中没有授权 code，请重试。')
      rejectCode(new Error('OAuth callback did not contain a code'))
      return
    }
    writeCallback(response, '登录成功', '可以关闭此页面并返回 Agent Token Tracker。')
    resolveCode(code)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('无法启动本地 OAuth 回调服务。')
  }
  const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`
  const timeout = setTimeout(() => {
    rejectCode(new Error('OAuth 登录超时。'))
    closeOAuthFlow(loginId)
  }, OAUTH_TIMEOUT_MS)
  oauthFlows.set(loginId, {
    provider,
    verifier,
    server,
    callback,
    resolve: resolveCode,
    reject: rejectCode,
    timeout,
  })
  return redirectUri
}

export async function startCloudOAuth(provider: 'github' | 'google'): Promise<CloudOAuthStartResponse> {
  const config = getCloudBackendConfig()
  if (!config) return { ok: false, message: '尚未配置 Supabase 项目。' }

  const loginId = randomUUID()
  const verifier = randomUrlValue()
  try {
    const redirectUri = await startCallbackServer(loginId, provider, verifier)
    const authUrl = new URL(`${config.url}/auth/v1/authorize`)
    authUrl.searchParams.set('provider', provider)
    authUrl.searchParams.set('redirect_to', redirectUri)
    authUrl.searchParams.set('code_challenge', challengeFor(verifier))
    authUrl.searchParams.set('code_challenge_method', 's256')
    await shell.openExternal(authUrl.toString())
    return { ok: true, message: '已打开浏览器，请完成登录。', loginId, provider, authUrl: authUrl.toString(), redirectUri }
  } catch (error) {
    closeOAuthFlow(loginId)
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function completeCloudOAuth(loginId: string): Promise<CloudActionResult> {
  const flow = oauthFlows.get(loginId)
  if (!flow) return { ok: false, message: '登录流程已过期，请重新开始。' }
  try {
    const code = await flow.callback
    const response = await authRequest('token?grant_type=pkce', {
      method: 'POST',
      body: JSON.stringify({ auth_code: code, code_verifier: flow.verifier }),
    })
    await persistSession(sessionFromResponse(await readJsonResponse(response), flow.provider))
    return { ok: true, message: '登录成功。' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    closeOAuthFlow(loginId)
  }
}

export async function signOutCloud() {
  const current = await loadSession()
  try {
    if (current) {
      const response = await authRequest('logout', { method: 'POST' }, current.accessToken)
      if (!response.ok && response.status !== 401) throw authError(response.status, await response.text())
    }
  } catch {
    // Local logout must complete even when the network is unavailable.
  } finally {
    await persistSession(null)
    loaded = true
  }
  return { ok: true, message: '已退出云端账号。' }
}

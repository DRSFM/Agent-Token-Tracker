import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import tls from 'node:tls'
import type { GrokUsageStatus } from '../src/types/api'
import { getNetworkSettings } from './network-settings'
import { grokDataRoot, scanGrok } from './scanners/grok'

const GROK_BILLING_URL = 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig'
const GROK_BILLING_JSON_URL = 'https://cli-chat-proxy.grok.com/v1/billing'
const CACHE_MS = 60_000
const OIDC_SCOPE_PREFIX = 'https://auth.x.ai::'
const LEGACY_SCOPE = 'https://accounts.x.ai/sign-in'

export interface GrokAuthSelection {
  accessToken: string
  email?: string
  plan?: string
}

export interface GrokBillingUsage {
  weeklyUsedPercent?: number
  weeklyRemainingPercent?: number
  weeklyResetsAt?: string
  billingLimitUsd?: number
  billingUsedUsd?: number
  billingRemainingUsd?: number
  billingPeriodStart?: string
  billingPeriodEnd?: string
}

let cached: GrokUsageStatus | null = null
let cachedAt = 0
let inFlight: Promise<GrokUsageStatus> | null = null

export function selectGrokAuth(value: unknown): GrokAuthSelection {
  const root = asRecord(value)
  if (!root) throw new Error('Grok auth.json 根节点不是对象')
  const direct = authEntry(root)
  if (direct) return direct

  let oidc: GrokAuthSelection | undefined
  let legacy: GrokAuthSelection | undefined
  let fallback: GrokAuthSelection | undefined
  for (const [scope, raw] of Object.entries(root)) {
    const selected = authEntry(asRecord(raw))
    if (!selected) continue
    if (scope.startsWith(OIDC_SCOPE_PREFIX)) oidc = selected
    else if (scope === LEGACY_SCOPE || scope.includes('/sign-in')) legacy = selected
    else fallback ??= selected
  }
  const selected = oidc || legacy || fallback
  if (!selected) throw new Error('Grok auth.json 中没有可用 access token')
  return selected
}

export function parseGrokBillingResponse(data: Buffer, now = new Date()): GrokBillingUsage {
  const frames = grpcWebFrames(data)
  if (frames.length === 0) throw new Error('Grok 额度响应没有 protobuf 数据帧')
  const scan: ProtoScan = { varints: [], fixed32: [] }
  let order = 0
  for (const frame of frames) scanProto(frame, [], 0, scan, () => order++)

  const candidates = scan.fixed32
    .filter((field) => field.path.at(-1) === 1 && field.value >= 0 && field.value <= 100)
    .sort((a, b) => a.path.length - b.path.length || a.order - b.order)
  const preferred = candidates.filter((field) => samePath(field.path, [1, 1]))
  const used = (preferred[0] || candidates[0])?.value
  if (used === undefined) throw new Error('无法解析 Grok 每周额度')

  const futureResets = scan.varints
    .filter((field) => field.value >= 1_700_000_000 && field.value <= 2_100_000_000)
    .map((field) => ({ ...field, date: new Date(field.value * 1000) }))
    .filter((field) => field.date > now)
  const preferredResets = futureResets.filter((field) => samePath(field.path, [1, 5, 1]))
  const reset = (preferredResets.length ? preferredResets : futureResets)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0]?.date

  return {
    weeklyUsedPercent: used,
    weeklyRemainingPercent: Math.max(0, 100 - used),
    weeklyResetsAt: reset?.toISOString(),
  }
}

export function parseGrokBillingJson(value: unknown): GrokBillingUsage {
  const root = asRecord(value)
  const body = asRecord(root?.body) || root
  const config = asRecord(body?.config)
  if (!config) throw new Error('Grok billing 响应缺少 config')
  const monthlyLimitCents = moneyValue(config.monthlyLimit)
  const monthlyUsedCents = moneyValue(config.used)
  if (monthlyLimitCents === null || monthlyLimitCents <= 0 || monthlyUsedCents === null) {
    throw new Error('Grok billing 响应缺少月度金额')
  }
  const billingLimitUsd = monthlyLimitCents / 100
  const billingUsedUsd = monthlyUsedCents / 100
  const billingRemainingUsd = Math.max(0, billingLimitUsd - billingUsedUsd)
  const billingPeriodStart = validIsoString(config.billingPeriodStart)
  const billingPeriodEnd = validIsoString(config.billingPeriodEnd)
  return {
    billingLimitUsd,
    billingUsedUsd,
    billingRemainingUsd,
    billingPeriodStart,
    billingPeriodEnd,
  }
}

export function mergeGrokUsageResults(
  weekly: GrokBillingUsage,
  billing: GrokBillingUsage,
): GrokBillingUsage {
  return { ...billing, ...weekly }
}

export async function getGrokUsageStatus(force = false): Promise<GrokUsageStatus> {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached
  if (inFlight) return inFlight
  inFlight = refreshGrokUsageStatus().then((status) => {
    cached = status
    cachedAt = Date.now()
    return status
  }).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function refreshGrokUsageStatus(): Promise<GrokUsageStatus> {
  const rootPath = grokDataRoot()
  const scan = await scanGrok(new Map(), rootPath)
  const totalTokens = scan.records.reduce((sum, record) => sum + (record.rawTotalTokens ?? record.totalTokens), 0)
  const lastSessionAt = scan.records
    .map((record) => record.timestamp)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
  const base: GrokUsageStatus = {
    rootPath,
    authFound: false,
    sessionCount: new Set(scan.records.map((record) => record.sessionId)).size,
    totalTokens,
    lastSessionAt,
    updatedAt: new Date().toISOString(),
  }

  const authPath = path.join(rootPath, 'auth.json')
  let auth: GrokAuthSelection
  try {
    auth = selectGrokAuth(JSON.parse(await fs.readFile(authPath, 'utf8')))
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    const billing = await fetchGrokBilling(auth.accessToken)
    return {
      ...base,
      authFound: true,
      email: auth.email,
      plan: auth.plan,
      ...billing,
    }
  } catch (error) {
    return {
      ...base,
      authFound: true,
      email: auth.email,
      plan: auth.plan,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function fetchGrokBilling(accessToken: string): Promise<GrokBillingUsage> {
  const { quotaProxyUrl } = await getNetworkSettings()
  const weeklyBody = quotaProxyUrl
    ? await postGrokViaHttpProxy(accessToken, quotaProxyUrl)
    : await postGrokDirect(accessToken)
  const weekly = parseGrokBillingResponse(weeklyBody)

  try {
    const body = quotaProxyUrl
      ? await getGrokBillingJsonViaHttpProxy(accessToken, quotaProxyUrl)
      : await getGrokBillingJsonDirect(accessToken)
    return mergeGrokUsageResults(weekly, parseGrokBillingJson(JSON.parse(body.toString('utf8'))))
  } catch {
    // The dollar billing cycle is supplemental. Weekly SuperGrok quota remains usable.
    return weekly
  }
}

function billingJsonHeaders(accessToken: string) {
  return {
    Accept: 'application/json',
    'User-Agent': 'Agent Token Tracker',
    Authorization: `Bearer ${accessToken}`,
  }
}

function getGrokBillingJsonDirect(accessToken: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.request(GROK_BILLING_JSON_URL, {
      method: 'GET',
      headers: billingJsonHeaders(accessToken),
    }, (response) => collectHttpResponse(response, resolve, reject))
    request.setTimeout(20_000, () => request.destroy(new Error('Grok billing 查询超时')))
    request.on('error', reject)
    request.end()
  })
}

function getGrokBillingJsonViaHttpProxy(accessToken: string, proxyUrl: string): Promise<Buffer> {
  const target = new URL(GROK_BILLING_JSON_URL)
  const proxy = new URL(proxyUrl)
  const targetPort = Number(target.port || 443)
  const proxyPort = Number(proxy.port || 80)
  const proxyAuth = proxy.username || proxy.password
    ? Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
    : ''
  return new Promise((resolve, reject) => {
    const connectRequest = http.request({
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: proxyAuth ? { 'Proxy-Authorization': `Basic ${proxyAuth}` } : undefined,
    })
    connectRequest.setTimeout(20_000, () => connectRequest.destroy(new Error('Grok 代理连接超时')))
    connectRequest.on('connect', (response, socket) => {
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        socket.destroy()
        reject(new Error(`Grok 代理连接 HTTP ${response.statusCode || 0}`))
        return
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname })
      tlsSocket.setTimeout(20_000, () => tlsSocket.destroy(new Error('Grok billing 查询超时')))
      const request = https.request({
        method: 'GET',
        host: target.hostname,
        path: `${target.pathname}${target.search}`,
        servername: target.hostname,
        headers: billingJsonHeaders(accessToken),
        createConnection: () => tlsSocket,
      }, (billingResponse) => collectHttpResponse(billingResponse, resolve, reject))
      request.on('error', reject)
      request.end()
    })
    connectRequest.on('error', reject)
    connectRequest.end()
  })
}

function collectHttpResponse(
  response: http.IncomingMessage,
  resolve: (value: Buffer) => void,
  reject: (reason?: unknown) => void,
) {
  const chunks: Buffer[] = []
  response.on('data', (chunk: Buffer) => chunks.push(chunk))
  response.on('end', () => {
    const status = response.statusCode || 0
    if (status < 200 || status >= 300) {
      reject(new Error(status === 401 || status === 403 ? 'Grok 登录已失效，请运行 grok login' : `Grok billing 查询 HTTP ${status}`))
      return
    }
    resolve(Buffer.concat(chunks))
  })
}

function grokHeaders(accessToken: string) {
  return {
    Origin: 'https://grok.com',
    Referer: 'https://grok.com/?_s=usage',
    Accept: '*/*',
    'Content-Type': 'application/grpc-web+proto',
    'Content-Length': '5',
    'x-grpc-web': '1',
    'x-user-agent': 'connect-es/2.1.1',
    'User-Agent': 'Agent Token Tracker',
    Authorization: `Bearer ${accessToken}`,
  }
}

function postGrokDirect(accessToken: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.request(GROK_BILLING_URL, {
      method: 'POST',
      headers: grokHeaders(accessToken),
    }, (response) => collectGrokResponse(response, resolve, reject))
    request.setTimeout(20_000, () => request.destroy(new Error('Grok 额度查询超时')))
    request.on('error', reject)
    request.end(Buffer.alloc(5))
  })
}

function postGrokViaHttpProxy(accessToken: string, proxyUrl: string): Promise<Buffer> {
  const target = new URL(GROK_BILLING_URL)
  const proxy = new URL(proxyUrl)
  const targetPort = Number(target.port || 443)
  const proxyPort = Number(proxy.port || 80)
  const proxyAuth = proxy.username || proxy.password
    ? Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
    : ''

  return new Promise((resolve, reject) => {
    const connectRequest = http.request({
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: proxyAuth ? { 'Proxy-Authorization': `Basic ${proxyAuth}` } : undefined,
    })
    connectRequest.setTimeout(20_000, () => connectRequest.destroy(new Error('Grok 代理连接超时')))
    connectRequest.on('connect', (response, socket) => {
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        socket.destroy()
        reject(new Error(`Grok 代理连接 HTTP ${response.statusCode || 0}`))
        return
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname })
      tlsSocket.setTimeout(20_000, () => tlsSocket.destroy(new Error('Grok 额度查询超时')))
      const request = https.request({
        method: 'POST',
        host: target.hostname,
        path: target.pathname,
        servername: target.hostname,
        headers: grokHeaders(accessToken),
        createConnection: () => tlsSocket,
      }, (grokResponse) => collectGrokResponse(grokResponse, resolve, reject))
      request.on('error', reject)
      request.end(Buffer.alloc(5))
    })
    connectRequest.on('error', reject)
    connectRequest.end()
  })
}

function collectGrokResponse(
  response: http.IncomingMessage,
  resolve: (value: Buffer) => void,
  reject: (reason?: unknown) => void,
) {
  const chunks: Buffer[] = []
  response.on('data', (chunk: Buffer) => chunks.push(chunk))
  response.on('end', () => {
    const body = Buffer.concat(chunks)
    const status = response.statusCode || 0
    if (status < 200 || status >= 300) {
      reject(new Error(status === 401 || status === 403 ? 'Grok 登录已失效，请运行 grok login' : `Grok 额度查询 HTTP ${status}`))
      return
    }
    const grpcStatus = String(response.headers['grpc-status'] || grpcTrailerStatus(body) || '0')
    if (grpcStatus !== '0') {
      reject(new Error(`Grok 额度查询 gRPC ${grpcStatus}`))
      return
    }
    resolve(body)
  })
}

function authEntry(value: Record<string, unknown> | null): GrokAuthSelection | undefined {
  if (!value || typeof value.key !== 'string' || !value.key.trim()) return undefined
  const authMode = typeof value.auth_mode === 'string' ? value.auth_mode.trim() : ''
  return {
    accessToken: value.key.trim(),
    email: typeof value.email === 'string' && value.email.trim() ? value.email.trim() : undefined,
    plan: authMode.toLowerCase() === 'oidc' ? 'SuperGrok' : authMode || undefined,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function moneyValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const record = asRecord(value)
  return typeof record?.val === 'number' && Number.isFinite(record.val) ? record.val : null
}

function validIsoString(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) return undefined
  return new Date(value).toISOString()
}

interface ProtoScan {
  varints: Array<{ path: number[]; value: number }>
  fixed32: Array<{ path: number[]; value: number; order: number }>
}

function grpcWebFrames(data: Buffer) {
  const frames: Buffer[] = []
  for (let offset = 0; offset + 5 <= data.length;) {
    const flags = data[offset]
    const length = data.readUInt32BE(offset + 1)
    const start = offset + 5
    const end = start + length
    if (end > data.length) break
    if ((flags & 0x80) === 0) frames.push(data.subarray(start, end))
    offset = end
  }
  return frames
}

function grpcTrailerStatus(data: Buffer) {
  for (let offset = 0; offset + 5 <= data.length;) {
    const flags = data[offset]
    const length = data.readUInt32BE(offset + 1)
    const start = offset + 5
    const end = start + length
    if (end > data.length) break
    if ((flags & 0x80) !== 0) {
      const match = data.subarray(start, end).toString('utf8').match(/(?:^|\r?\n)grpc-status:\s*(\d+)/i)
      if (match) return match[1]
    }
    offset = end
  }
  return undefined
}

function scanProto(
  data: Buffer,
  path: number[],
  depth: number,
  scan: ProtoScan,
  nextOrder: () => number,
) {
  let offset = 0
  while (offset < data.length) {
    const key = readVarint(data, offset)
    if (!key || key.value === 0n) break
    offset = key.offset
    const fieldNumber = Number(key.value >> 3n)
    const wireType = Number(key.value & 7n)
    const fieldPath = [...path, fieldNumber]
    if (wireType === 0) {
      const value = readVarint(data, offset)
      if (!value) break
      offset = value.offset
      const numeric = Number(value.value)
      if (Number.isSafeInteger(numeric)) scan.varints.push({ path: fieldPath, value: numeric })
    } else if (wireType === 1) {
      if (offset + 8 > data.length) break
      offset += 8
    } else if (wireType === 2) {
      const length = readVarint(data, offset)
      if (!length) break
      offset = length.offset
      const size = Number(length.value)
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > data.length) break
      if (depth < 4) scanProto(data.subarray(offset, offset + size), fieldPath, depth + 1, scan, nextOrder)
      offset += size
    } else if (wireType === 5) {
      if (offset + 4 > data.length) break
      const value = data.readFloatLE(offset)
      offset += 4
      if (Number.isFinite(value)) scan.fixed32.push({ path: fieldPath, value, order: nextOrder() })
    } else {
      break
    }
  }
}

function readVarint(data: Buffer, start: number) {
  let value = 0n
  let shift = 0n
  let offset = start
  while (offset < data.length && offset - start < 10) {
    const byte = data[offset]
    value |= BigInt(byte & 0x7f) << shift
    offset += 1
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7n
  }
  return null
}

function samePath(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

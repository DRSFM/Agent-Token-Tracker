import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { RemoteSourceSettings, RemoteSyncStatus } from '../src/types/api'

const SETTINGS_FILE = 'remote-source-settings.json'
const STATUS_FILE = 'remote-sync-status.json'

const defaultSettings: RemoteSourceSettings = {
  enabled: false,
  host: '',
  user: '',
  port: 22,
  claudePath: '~/.claude/projects',
  codexPath: '~/.codex/sessions',
}

function remoteSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function remoteStatusPath() {
  return path.join(app.getPath('userData'), STATUS_FILE)
}

export function remoteCacheRoot() {
  return path.join(app.getPath('userData'), 'remote-cache', 'default')
}

export function remoteClaudeCacheRoot() {
  return path.join(remoteCacheRoot(), '.claude', 'projects')
}

export function remoteCodexCacheRoot() {
  return path.join(remoteCacheRoot(), '.codex', 'sessions')
}

function normalizeSettings(value: unknown): RemoteSourceSettings {
  const raw = value as Partial<RemoteSourceSettings> | null | undefined
  const port = Number(raw?.port ?? 22)
  return {
    enabled: Boolean(raw?.enabled),
    host: String(raw?.host ?? '').trim(),
    user: String(raw?.user ?? '').trim(),
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 22,
    claudePath: String(raw?.claudePath ?? defaultSettings.claudePath).trim() || defaultSettings.claudePath,
    codexPath: String(raw?.codexPath ?? defaultSettings.codexPath).trim() || defaultSettings.codexPath,
  }
}

function sshTarget(settings: RemoteSourceSettings) {
  return settings.user ? `${settings.user}@${settings.host}` : settings.host
}

function sshArgs(settings: RemoteSourceSettings, command: string) {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
  ]
  if (settings.port && settings.port !== 22) {
    args.push('-p', String(settings.port))
  }
  args.push(sshTarget(settings), command)
  return args
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function toHomeRelative(remotePath: string) {
  const trimmed = remotePath.trim()
  if (trimmed === '~') return '.'
  if (trimmed.startsWith('~/')) return trimmed.slice(2)
  return trimmed
}

async function runProcess(command: string, args: string[], options: { input?: NodeJS.ReadableStream } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    if (options.input) {
      options.input.pipe(child.stdin)
    }
  })
}

export async function getRemoteSourceSettings() {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(remoteSettingsPath(), 'utf8')))
  } catch {
    return defaultSettings
  }
}

export async function setRemoteSourceSettings(settings: RemoteSourceSettings) {
  const normalized = normalizeSettings(settings)
  await fs.mkdir(path.dirname(remoteSettingsPath()), { recursive: true })
  await fs.writeFile(remoteSettingsPath(), JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

export async function getRemoteSyncStatus(): Promise<RemoteSyncStatus> {
  let stored: Partial<RemoteSyncStatus> = {}
  try {
    stored = JSON.parse(await fs.readFile(remoteStatusPath(), 'utf8')) as Partial<RemoteSyncStatus>
  } catch {
    // ignore
  }

  const settings = await getRemoteSourceSettings()
  return {
    configured: Boolean(settings.enabled && settings.host),
    lastSyncedAt: stored.lastSyncedAt,
    lastError: stored.lastError,
    cachePath: remoteCacheRoot(),
    claudeCachePath: remoteClaudeCacheRoot(),
    codexCachePath: remoteCodexCacheRoot(),
  }
}

async function saveRemoteSyncStatus(status: Partial<RemoteSyncStatus>) {
  const next = { ...(await getRemoteSyncStatus()), ...status }
  await fs.mkdir(path.dirname(remoteStatusPath()), { recursive: true })
  await fs.writeFile(remoteStatusPath(), JSON.stringify(next, null, 2), 'utf8')
}

export async function testRemoteConnection() {
  const settings = await getRemoteSourceSettings()
  if (!settings.enabled || !settings.host) {
    return { ok: false, message: '请先启用并填写 Host。' }
  }

  const result = await runProcess('ssh', sshArgs(settings, `sh -lc ${shellQuote('printf ok')}`))
  if (result.code === 0 && result.stdout.trim() === 'ok') {
    return { ok: true, message: '连接成功。' }
  }
  return {
    ok: false,
    message: (result.stderr || result.stdout || `ssh exited ${result.code}`).trim(),
  }
}

export async function syncRemoteLogs() {
  const settings = await getRemoteSourceSettings()
  if (!settings.enabled || !settings.host) {
    return { ok: false, message: '请先启用并填写 Host。' }
  }

  const cacheRoot = remoteCacheRoot()
  const claudePath = toHomeRelative(settings.claudePath)
  const codexPath = toHomeRelative(settings.codexPath)
  const remoteCommand = [
    'cd "$HOME" || exit 1',
    'set --',
    `[ -d ${shellQuote(claudePath)} ] && set -- "$@" ${shellQuote(claudePath)}`,
    `[ -d ${shellQuote(codexPath)} ] && set -- "$@" ${shellQuote(codexPath)}`,
    'if [ "$#" -gt 0 ]; then tar -czf - "$@"; else tar -czf - --files-from /dev/null; fi',
  ].join('; ')

  await fs.rm(cacheRoot, { recursive: true, force: true })
  await fs.mkdir(cacheRoot, { recursive: true })

  const ssh = spawn('ssh', sshArgs(settings, `sh -lc ${shellQuote(remoteCommand)}`), {
    windowsHide: true,
  })
  const tar = spawn('tar', ['-xzf', '-', '-C', cacheRoot], { windowsHide: true })
  let sshError = ''
  let tarError = ''

  ssh.stderr.setEncoding('utf8')
  tar.stderr.setEncoding('utf8')
  ssh.stderr.on('data', (chunk) => {
    sshError += chunk
  })
  tar.stderr.on('data', (chunk) => {
    tarError += chunk
  })
  ssh.stdout.pipe(tar.stdin)

  const close = (child: ReturnType<typeof spawn>) =>
    new Promise<number>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => resolve(code ?? 1))
    })

  try {
    const [sshCode, tarCode] = await Promise.all([close(ssh), close(tar)])
    if (sshCode !== 0 || tarCode !== 0) {
      const message = (sshError || tarError || `ssh=${sshCode}, tar=${tarCode}`).trim()
      await saveRemoteSyncStatus({ lastError: message })
      return { ok: false, message }
    }

    const syncedAt = new Date().toISOString()
    await saveRemoteSyncStatus({ lastSyncedAt: syncedAt, lastError: undefined })
    return { ok: true, message: '远程日志已同步。', syncedAt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await saveRemoteSyncStatus({ lastError: message })
    return { ok: false, message }
  }
}

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { UsageUpstream } from '../../src/types/api'

export interface CodexApiScanTarget {
  rootPath: string
  label: string
  upstream: UsageUpstream
}

interface ProfileEntry {
  id?: unknown
  name?: unknown
  baseUrl?: unknown
  home?: unknown
}

interface ProfileIndex {
  profiles?: unknown
}

export function codexApiRoot() {
  return path.join(os.homedir(), '.codex-api')
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeRelativeHome(value: string) {
  return value.replace(/[\\/]+/g, path.sep)
}

function displayLabel(id: string, name: string) {
  const value = name || id
  if (value.toLowerCase() === 'anyrouter') return 'AnyRouter'
  return value
}

function baseUrlFromConfig(content: string) {
  const match = content.match(/^\s*base_url\s*=\s*["']([^"']+)["']\s*$/mi)
  return match?.[1]?.trim() || ''
}

function idFromBaseUrl(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.replace(/^www\./i, '')
    return normalizeId(hostname.split('.')[0] || 'apicodex') || 'apicodex'
  } catch {
    return 'apicodex'
  }
}

async function readText(filePath: string) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readProfileIndex(apiRoot: string) {
  try {
    return JSON.parse(await fs.readFile(path.join(apiRoot, 'profiles.json'), 'utf8')) as ProfileIndex
  } catch {
    return { profiles: [] }
  }
}

async function profileFromDirectory(apiRoot: string, profileDir: string): Promise<ProfileEntry> {
  const configPath = path.join(profileDir, 'config.toml')
  const baseUrl = baseUrlFromConfig(await readText(configPath))
  return {
    id: path.basename(profileDir),
    name: path.basename(profileDir),
    baseUrl,
    home: path.relative(apiRoot, profileDir),
  }
}

async function profileEntries(apiRoot: string) {
  const index = await readProfileIndex(apiRoot)
  const entries = Array.isArray(index.profiles)
    ? index.profiles.filter((value): value is ProfileEntry => !!value && typeof value === 'object')
    : []

  const profilesRoot = path.join(apiRoot, 'profiles')
  try {
    const directories = await fs.readdir(profilesRoot, { withFileTypes: true })
    const knownHomes = new Set(
      entries
        .map((entry) => stringValue(entry.home))
        .filter(Boolean)
        .map((home) => path.normalize(normalizeRelativeHome(home)).toLowerCase()),
    )
    for (const directory of directories) {
      if (!directory.isDirectory()) continue
      const relativeHome = path.join('profiles', directory.name)
      if (knownHomes.has(path.normalize(relativeHome).toLowerCase())) continue
      entries.push(await profileFromDirectory(apiRoot, path.join(profilesRoot, directory.name)))
    }
  } catch {
    // A missing profiles directory is fine; the root config is still a valid API target.
  }

  if (!entries.some((entry) => !stringValue(entry.home))) {
    const rootBaseUrl = baseUrlFromConfig(await readText(path.join(apiRoot, 'config.toml')))
    if (rootBaseUrl || await pathExists(path.join(apiRoot, 'sessions'))) {
      entries.unshift({
        id: idFromBaseUrl(rootBaseUrl),
        name: idFromBaseUrl(rootBaseUrl),
        baseUrl: rootBaseUrl,
      })
    }
  }

  return entries
}

export async function discoverCodexApiTargets(apiRoot = codexApiRoot()) {
  if (!(await pathExists(apiRoot))) return []
  const entries = await profileEntries(apiRoot)
  const targets = new Map<string, CodexApiScanTarget>()

  for (const entry of entries) {
    const home = normalizeRelativeHome(stringValue(entry.home))
    const profileRoot = home ? path.resolve(apiRoot, home) : apiRoot
    const id = normalizeId(stringValue(entry.id) || stringValue(entry.name) || idFromBaseUrl(stringValue(entry.baseUrl)))
    if (!id) continue
    const upstream: UsageUpstream = {
      id,
      label: displayLabel(id, stringValue(entry.name)),
      ...(stringValue(entry.baseUrl) ? { baseUrl: stringValue(entry.baseUrl) } : {}),
    }
    const key = path.normalize(path.join(profileRoot, 'sessions')).toLowerCase()
    targets.set(key, {
      rootPath: path.join(profileRoot, 'sessions'),
      label: `API · ${upstream.label}`,
      upstream,
    })
  }

  return [...targets.values()].sort((a, b) => a.upstream.label.localeCompare(b.upstream.label))
}

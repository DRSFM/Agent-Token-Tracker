import { createReadStream } from 'node:fs'
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import type { AgentSource, RequestRecord } from '../../src/types/api'

export interface SourceScanResult {
  source: AgentSource
  label: string
  rootPath: string
  records: RequestRecord[]
  scannedFiles: number
  parsedFiles: number
  reusedFiles: number
  rootExists: boolean
  cacheEntries: CachedSourceFile[]
}

export interface JsonlFileMetadata {
  filePath: string
  size: number
  mtimeMs: number
}

export interface CachedSourceFile extends JsonlFileMetadata {
  source: AgentSource
  records: RequestRecord[]
}

export async function pathExists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function listJsonlFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return []

  const files: string[] = []
  const visit = async (dir: string) => {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await visit(fullPath)
          return
        }
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(fullPath)
        }
      }),
    )
  }

  await visit(root)
  return files
}

export async function getJsonlFileMetadata(filePath: string): Promise<JsonlFileMetadata | null> {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) return null
    return {
      filePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    }
  } catch {
    return null
  }
}

export function cacheKey(source: AgentSource, filePath: string) {
  return `${source}\u0000${filePath}`
}

export function reusableCachedFile(
  source: AgentSource,
  metadata: JsonlFileMetadata,
  cache: Map<string, CachedSourceFile>,
) {
  const cached = cache.get(cacheKey(source, metadata.filePath))
  if (
    cached &&
    cached.source === source &&
    cached.size === metadata.size &&
    cached.mtimeMs === metadata.mtimeMs
  ) {
    return cached
  }
  return null
}

export async function readJsonlFile(
  filePath: string,
  onJson: (value: unknown, lineNumber: number) => void,
) {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  let lineNumber = 0
  for await (const line of lines) {
    lineNumber += 1
    if (!line.trim()) continue
    try {
      onJson(JSON.parse(line), lineNumber)
    } catch {
      // Historical JSONL files can contain interrupted writes. One bad line
      // should not poison the whole local estimate.
    }
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

export function normalizeIso(value: unknown) {
  if (typeof value !== 'string') return new Date().toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function sessionTitleFromCwd(cwd: unknown, fallback: string) {
  const cwdString = asString(cwd)
  if (!cwdString) return fallback
  const title = path.basename(cwdString)
  return title || fallback
}

export function shortId(value: string) {
  return value.length <= 12 ? value : value.slice(0, 12)
}

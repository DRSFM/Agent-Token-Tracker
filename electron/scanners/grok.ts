import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { RequestRecord } from '../../src/types/api'
import {
  asNumber,
  asRecord,
  asString,
  cacheKey,
  getJsonlFileMetadata,
  pathExists,
  reusableCachedFile,
  sessionTitleFromCwd,
  shortId,
  type CachedSourceFile,
  type SourceScanResult,
} from './shared'

export function grokDataRoot() {
  const configured = process.env.GROK_HOME?.trim()
  return configured || path.join(os.homedir(), '.grok')
}

export function grokSessionsRoot(root = grokDataRoot()) {
  return path.join(root, 'sessions')
}

export function grokUnifiedLogPath(root = grokDataRoot()) {
  return path.join(root, 'logs', 'unified.jsonl')
}

export function grokUnifiedLogToRecords(
  lines: string[],
  sessionTitles = new Map<string, string>(),
): RequestRecord[] {
  const records: RequestRecord[] = []
  const sessionModels = new Map<string, string>()
  let currentModel = ''

  lines.forEach((line, index) => {
    if (!line.trim()) return
    let event: Record<string, unknown> | null = null
    try {
      event = asRecord(JSON.parse(line))
    } catch {
      return
    }
    if (!event) return
    const context = asRecord(event.ctx)
    if (!context) return
    const sessionId = asString(event.sid)
    const model = asString(context.new_model)
      || asString(context.model)
      || asString(context.current_model_id)
    if (model) {
      currentModel = model
      if (sessionId) sessionModels.set(sessionId, model)
    }
    if (asString(event.msg) !== 'shell.turn.inference_done' || !sessionId) return

    const inputTokens = Math.max(0, asNumber(context.prompt_tokens))
    const cacheTokens = Math.min(inputTokens, Math.max(0, asNumber(context.cached_prompt_tokens)))
    // xAI completion_tokens already includes reasoning_tokens; adding it again would double count.
    const outputTokens = Math.max(0, asNumber(context.completion_tokens))
    if (inputTokens + outputTokens <= 0) return
    const timestampValue = asString(event.ts)
    const timestamp = timestampValue && Number.isFinite(new Date(timestampValue).getTime())
      ? new Date(timestampValue).toISOString()
      : new Date(0).toISOString()
    const resolvedModel = sessionModels.get(sessionId) || currentModel || 'grok-unknown'
    const weightedTotalTokens = (inputTokens - cacheTokens) + cacheTokens * 0.1 + outputTokens
    records.push({
      id: `grok:${sessionId}:${timestamp}:${index}`,
      timestamp,
      source: 'grok',
      sessionId,
      sessionTitle: sessionTitles.get(sessionId) || shortId(sessionId),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheTokens,
      cacheCreationTokens: 0,
      cacheTokens,
      rawTotalTokens: inputTokens + outputTokens,
      weightedTotalTokens,
      totalTokens: weightedTotalTokens,
    })
  })
  return records
}

export async function scanGrok(
  cache = new Map<string, CachedSourceFile>(),
  root = grokDataRoot(),
): Promise<SourceScanResult> {
  const rootExists = await pathExists(root)
  const files = await listSignalsFiles(grokSessionsRoot(root))
  const unifiedLog = grokUnifiedLogPath(root)
  const unifiedMetadata = await getJsonlFileMetadata(unifiedLog)
  const records: RequestRecord[] = []
  const cacheEntries: CachedSourceFile[] = []
  let parsedFiles = 0
  let reusedFiles = 0
  let lastError: string | undefined

  const sessionTitles = new Map(files.map((filePath) => {
    const sessionDir = path.dirname(filePath)
    const sessionId = path.basename(sessionDir)
    const projectPath = decodeProjectPath(path.basename(path.dirname(sessionDir)))
    return [sessionId, sessionTitleFromCwd(projectPath, shortId(sessionId))]
  }))

  if (unifiedMetadata) {
    const cached = reusableCachedFile('grok', unifiedMetadata, cache)
    if (cached) {
      records.push(...cached.records)
      cacheEntries.push(cached)
      reusedFiles += 1
    } else {
      const fileRecords: RequestRecord[] = []
      try {
        fileRecords.push(...grokUnifiedLogToRecords(
          (await fs.readFile(unifiedLog, 'utf8')).split(/\r?\n/),
          sessionTitles,
        ))
        parsedFiles += 1
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      records.push(...fileRecords)
      cacheEntries.push({
        source: 'grok',
        filePath: unifiedMetadata.filePath,
        size: unifiedMetadata.size,
        mtimeMs: unifiedMetadata.mtimeMs,
        records: fileRecords,
      })
    }
  }

  // Exact request usage lives in unified.jsonl. signals.json is retained only as
  // a compatibility fallback for older Grok CLI installations.
  if (records.length > 0) {
    return {
      source: 'grok',
      label: 'Grok CLI',
      rootPath: root,
      records,
      scannedFiles: files.length + 1,
      parsedFiles,
      reusedFiles,
      rootExists,
      cacheEntries,
      lastError,
    }
  }

  await Promise.all(files.map(async (filePath) => {
    const metadata = await getJsonlFileMetadata(filePath)
    if (!metadata) return
    const cached = reusableCachedFile('grok', metadata, cache)
    if (cached) {
      records.push(...cached.records)
      cacheEntries.push(cached)
      reusedFiles += 1
      return
    }

    const fileRecords: RequestRecord[] = []
    try {
      const payload = asRecord(JSON.parse(await fs.readFile(filePath, 'utf8')))
      if (!payload) throw new Error('signals.json 根节点不是对象')
      const totalTokens = Math.max(0,
        asNumber(payload.totalTokensBeforeCompaction) + asNumber(payload.contextTokensUsed),
      )
      const sessionDir = path.dirname(filePath)
      const sessionId = path.basename(sessionDir)
      const encodedProject = path.basename(path.dirname(sessionDir))
      const projectPath = decodeProjectPath(encodedProject)
      const model = asString(payload.primaryModelId)
        || (Array.isArray(payload.modelsUsed) ? payload.modelsUsed.map(asString).find(Boolean) : undefined)
        || 'grok-unknown'

      if (totalTokens > 0) {
        fileRecords.push({
          id: `grok:${filePath}:1`,
          timestamp: new Date(metadata.mtimeMs).toISOString(),
          source: 'grok',
          sessionId,
          sessionTitle: sessionTitleFromCwd(projectPath, shortId(sessionId)),
          model,
          inputTokens: totalTokens,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheTokens: 0,
          rawTotalTokens: totalTokens,
          weightedTotalTokens: totalTokens,
          totalTokens,
        })
      }
      parsedFiles += 1
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    records.push(...fileRecords)
    cacheEntries.push({
      source: 'grok',
      filePath: metadata.filePath,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      records: fileRecords,
    })
  }))

  cacheEntries.sort((a, b) => cacheKey(a.source, a.filePath).localeCompare(cacheKey(b.source, b.filePath)))
  return {
    source: 'grok',
    label: 'Grok CLI',
    rootPath: root,
    records,
    scannedFiles: files.length + (unifiedMetadata ? 1 : 0),
    parsedFiles,
    reusedFiles,
    rootExists,
    cacheEntries,
    lastError,
  }
}

async function listSignalsFiles(root: string) {
  if (!(await pathExists(root))) return []
  const result: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries.map(async (entry) => {
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile() && entry.name === 'signals.json') result.push(child)
    }))
  }
  await visit(root)
  return result.sort()
}

function decodeProjectPath(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

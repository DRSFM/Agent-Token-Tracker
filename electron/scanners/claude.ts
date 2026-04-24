import os from 'node:os'
import path from 'node:path'
import type { RequestRecord } from '../../src/types/api'
import {
  asNumber,
  asRecord,
  asString,
  cacheKey,
  getJsonlFileMetadata,
  listJsonlFiles,
  normalizeIso,
  pathExists,
  readJsonlFile,
  reusableCachedFile,
  sessionTitleFromCwd,
  shortId,
  type CachedSourceFile,
  type SourceScanResult,
} from './shared'

export function claudeCodeRoot() {
  return path.join(os.homedir(), '.claude', 'projects')
}

export async function scanClaudeCode(
  cache = new Map<string, CachedSourceFile>(),
  root = claudeCodeRoot(),
): Promise<SourceScanResult> {
  const rootExists = await pathExists(root)
  const files = await listJsonlFiles(root)
  const records: RequestRecord[] = []
  const cacheEntries: CachedSourceFile[] = []
  let parsedFiles = 0
  let reusedFiles = 0

  await Promise.all(
    files.map(async (filePath) => {
      const metadata = await getJsonlFileMetadata(filePath)
      if (!metadata) return

      const cached = reusableCachedFile('claude-code', metadata, cache)
      if (cached) {
        records.push(...cached.records)
        cacheEntries.push(cached)
        reusedFiles += 1
        return
      }

      const fallbackSessionId = path.basename(filePath, '.jsonl')
      const fileRecords: RequestRecord[] = []
      try {
        await readJsonlFile(filePath, (value, lineNumber) => {
          const row = asRecord(value)
          if (!row || row.type !== 'assistant') return

          const message = asRecord(row.message)
          const usage = asRecord(message?.usage)
          if (!message || !usage) return

          const inputTokens = asNumber(usage.input_tokens)
          const outputTokens = asNumber(usage.output_tokens)
          const cacheReadTokens = asNumber(usage.cache_read_input_tokens)
          const cacheCreationTokens = asNumber(usage.cache_creation_input_tokens)
          const cacheTokens = cacheReadTokens + cacheCreationTokens
          const rawTotalTokens = inputTokens + outputTokens + cacheTokens
          const totalTokens = Math.round(inputTokens + outputTokens + cacheTokens * 0.1)
          const sessionId = asString(row.sessionId) ?? fallbackSessionId
          const sessionTitle = sessionTitleFromCwd(row.cwd, shortId(sessionId))

          fileRecords.push({
            id: `claude-code:${filePath}:${lineNumber}`,
            timestamp: normalizeIso(row.timestamp),
            source: 'claude-code',
            sessionId,
            sessionTitle,
            model: asString(message.model) ?? 'claude-unknown',
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            cacheTokens,
            rawTotalTokens,
            weightedTotalTokens: totalTokens,
            totalTokens,
          })
        })
        parsedFiles += 1
      } catch {
        // A file can disappear while scanning or be temporarily locked.
      }
      records.push(...fileRecords)
      cacheEntries.push({
        source: 'claude-code',
        filePath: metadata.filePath,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        records: fileRecords,
      })
    }),
  )

  cacheEntries.sort((a, b) => cacheKey(a.source, a.filePath).localeCompare(cacheKey(b.source, b.filePath)))

  return {
    source: 'claude-code',
    label: 'Claude Code',
    rootPath: root,
    records,
    scannedFiles: files.length,
    parsedFiles,
    reusedFiles,
    rootExists,
    cacheEntries,
  }
}

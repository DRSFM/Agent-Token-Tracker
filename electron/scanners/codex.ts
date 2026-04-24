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

export function codexSessionsRoot() {
  return path.join(os.homedir(), '.codex', 'sessions')
}

export async function scanCodex(
  cache = new Map<string, CachedSourceFile>(),
  root = codexSessionsRoot(),
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

      const cached = reusableCachedFile('codex', metadata, cache)
      if (cached) {
        records.push(...cached.records)
        cacheEntries.push(cached)
        reusedFiles += 1
        return
      }

      const fallbackSessionId = path.basename(filePath, '.jsonl')
      let sessionId = fallbackSessionId
      let cwd: string | undefined
      let model = 'codex-unknown'
      const fileRecords: RequestRecord[] = []

      try {
        await readJsonlFile(filePath, (value, lineNumber) => {
          const row = asRecord(value)
          const payload = asRecord(row?.payload)
          if (!row || !payload) return

          if (row.type === 'session_meta') {
            sessionId = asString(payload.id) ?? sessionId
            cwd = asString(payload.cwd) ?? cwd
            return
          }

          if (row.type === 'turn_context') {
            model = asString(payload.model) ?? model
            cwd = asString(payload.cwd) ?? cwd
            return
          }

          if (row.type !== 'event_msg' || payload.type !== 'token_count') return

          const info = asRecord(payload.info)
          const usage = asRecord(info?.last_token_usage)
          if (!usage) return

          const inputTokens = asNumber(usage.input_tokens)
          const reasoningOutputTokens = asNumber(usage.reasoning_output_tokens)
          const outputTokens = asNumber(usage.output_tokens) + reasoningOutputTokens
          const cacheTokens = asNumber(usage.cached_input_tokens)
          const totalTokens = asNumber(usage.total_tokens)
          const effectiveTotal = totalTokens || inputTokens + outputTokens

          fileRecords.push({
            id: `codex:${filePath}:${lineNumber}`,
            timestamp: normalizeIso(row.timestamp),
            source: 'codex',
            sessionId,
            sessionTitle: sessionTitleFromCwd(cwd, shortId(sessionId)),
            model,
            inputTokens,
            outputTokens,
            cacheReadTokens: cacheTokens,
            cacheTokens,
            rawTotalTokens: effectiveTotal,
            weightedTotalTokens: effectiveTotal,
            totalTokens: effectiveTotal,
          })
        })
        parsedFiles += 1
      } catch {
        // A file can disappear while scanning or be temporarily locked.
      }
      records.push(...fileRecords)
      cacheEntries.push({
        source: 'codex',
        filePath: metadata.filePath,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        records: fileRecords,
      })
    }),
  )

  cacheEntries.sort((a, b) => cacheKey(a.source, a.filePath).localeCompare(cacheKey(b.source, b.filePath)))

  return {
    source: 'codex',
    label: 'Codex',
    rootPath: root,
    records,
    scannedFiles: files.length,
    parsedFiles,
    reusedFiles,
    rootExists,
    cacheEntries,
  }
}

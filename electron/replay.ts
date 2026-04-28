import path from 'node:path'
import type {
  AgentSource,
  ReplayAttachment,
  ReplayEvent,
  ReplayEventRole,
  ReplaySessionOptions,
  ReplayEventType,
} from '../src/types/api'
import { claudeCodeRoot } from './scanners/claude'
import { codexSessionsRoot } from './scanners/codex'
import {
  asNumber,
  asRecord,
  asString,
  firstNonEmptyStringAtPaths,
  listJsonlFiles,
  normalizeIso,
  readJsonlFile,
} from './scanners/shared'
import {
  getRemoteSourceSettings,
  remoteClaudeCacheRoot,
  remoteCodexCacheRoot,
} from './remote-sync'

const CLAUDE_MODEL_PATHS = [
  ['message', 'model'],
  ['model'],
  ['request', 'body', 'model'],
  ['response', 'body', 'model'],
  ['message', 'metadata', 'model'],
  ['message', 'usage', 'model'],
]

export async function getReplaySession(
  sessionId: string,
  source: AgentSource = 'unknown',
  candidateFiles: string[] = [],
  options: ReplaySessionOptions = {},
): Promise<ReplayEvent[]> {
  const events: ReplayEvent[] = []
  const remoteSettings = await getRemoteSourceSettings()

  if (source === 'claude-code' || source === 'unknown') {
    events.push(...await readClaudeReplay(sessionId, claudeCodeRoot(), candidateFiles, options))
    if (remoteSettings.enabled && remoteSettings.host) {
      events.push(...await readClaudeReplay(sessionId, remoteClaudeCacheRoot(), candidateFiles, options))
    }
  }

  if (source === 'codex' || source === 'unknown') {
    events.push(...await readCodexReplay(sessionId, codexSessionsRoot(), candidateFiles, options))
    if (remoteSettings.enabled && remoteSettings.host) {
      events.push(...await readCodexReplay(sessionId, remoteCodexCacheRoot(), candidateFiles, options))
    }
  }

  const sorted = events.sort((a, b) => {
    const timeDelta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    return timeDelta || a.rawRef.filePath.localeCompare(b.rawRef.filePath) || a.rawRef.lineNumber - b.rawRef.lineNumber
  })
  const replayEvents = options.conversationOnly ? filterConversationReplayEvents(sorted) : sorted
  const limit = Math.max(0, Math.floor(options.limit ?? 0))
  return limit ? replayEvents.slice(0, limit) : replayEvents
}

export async function readClaudeReplay(
  sessionId: string,
  root: string,
  candidateFiles: string[] = [],
  options: ReplaySessionOptions = {},
) {
  const files = await likelySessionFiles(root, sessionId, candidateFiles)
  const events: ReplayEvent[] = []

  await Promise.all(files.map(async (filePath) => {
    try {
      await readJsonlFile(filePath, (value, lineNumber) => {
        const row = asRecord(value)
        if (!row) return
        const rowSessionId = asString(row.sessionId) ?? path.basename(filePath, '.jsonl')
        if (rowSessionId !== sessionId) return
        const rowEvents = claudeRowToReplayEvents(row, filePath, lineNumber, rowSessionId, options)
        events.push(...rowEvents.filter((event) => isInsideReplayWindow(event, options)))
      })
    } catch {
      // The replay view is best-effort; a locked or moved file should not break the UI.
    }
  }))

  return options.conversationOnly ? filterConversationReplayEvents(events) : events
}

export async function readCodexReplay(
  sessionId: string,
  root: string,
  candidateFiles: string[] = [],
  options: ReplaySessionOptions = {},
) {
  const files = await likelySessionFiles(root, sessionId, candidateFiles)
  const events: ReplayEvent[] = []

  await Promise.all(files.map(async (filePath) => {
    const fileEvents: ReplayEvent[] = []
    let currentSessionId = path.basename(filePath, '.jsonl')
    let model = 'codex-unknown'
    try {
      await readJsonlFile(filePath, (value, lineNumber) => {
        const row = asRecord(value)
        const payload = asRecord(row?.payload)
        if (!row) return

        if (row.type === 'session_meta') {
          currentSessionId = asString(payload?.id) ?? currentSessionId
        }
        if (row.type === 'turn_context') {
          model = asString(payload?.model) ?? model
        }

        const rowEvents = codexRowToReplayEvents(row, filePath, lineNumber, currentSessionId, model, options)
        fileEvents.push(...rowEvents.filter((event) => isInsideReplayWindow(event, options)))
      })
    } catch {
      return
    }

    if (currentSessionId === sessionId) {
      events.push(...fileEvents.map((event) => ({ ...event, sessionId })))
    }
  }))

  return options.conversationOnly ? filterConversationReplayEvents(events) : events
}

async function likelySessionFiles(root: string, sessionId: string, candidateFiles: string[] = []) {
  const scopedCandidates = candidateFiles
    .filter((filePath) => filePath.endsWith('.jsonl') && isPathInside(root, filePath))
  if (candidateFiles.length) return [...new Set(scopedCandidates)]

  const files = await listJsonlFiles(root)
  const exact = files.filter((filePath) => path.basename(filePath, '.jsonl') === sessionId)
  return exact.length ? exact : files
}

function isPathInside(root: string, filePath: string) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function claudeRowToReplayEvents(
  row: Record<string, unknown>,
  filePath: string,
  lineNumber: number,
  sessionId: string,
  options: ReplaySessionOptions = {},
) {
  const events: ReplayEvent[] = []
  const timestamp = normalizeIso(row.timestamp)
  const message = asRecord(row.message)
  const model = firstNonEmptyStringAtPaths(row, CLAUDE_MODEL_PATHS)
  const rowType = asString(row.type)

  if (message) {
    const role = normalizeRole(asString(message.role) ?? rowType)
    const content = message.content
    const text = textFromContent(content, { omitTools: true })
    const attachments = imageAttachmentsFromContent(content)
    if (text) {
      events.push(baseEvent({
        source: 'claude-code',
        sessionId,
        filePath,
        lineNumber,
        timestamp,
        role,
        type: 'message',
        content: text,
        model,
        attachments,
        raw: options.includeRaw ? row : undefined,
      }))
    } else if (attachments.length) {
      events.push(baseEvent({
        source: 'claude-code',
        sessionId,
        filePath,
        lineNumber,
        timestamp,
        role,
        type: 'message',
        model,
        attachments,
        raw: options.includeRaw ? row : undefined,
      }))
    }

    events.push(...toolEventsFromContent({
      content,
      source: 'claude-code',
      sessionId,
      filePath,
      lineNumber,
      timestamp,
      model,
      includeRaw: options.includeRaw,
    }))

    const usage = asRecord(message.usage)
    if (usage) {
      const cacheTokens = asNumber(usage.cache_read_input_tokens) + asNumber(usage.cache_creation_input_tokens)
      const inputTokens = asNumber(usage.input_tokens)
      const outputTokens = asNumber(usage.output_tokens)
      events.push(baseEvent({
        source: 'claude-code',
        sessionId,
        filePath,
        lineNumber,
        timestamp,
        role: 'event',
        type: 'token_usage',
        content: model,
        model,
        inputTokens,
        outputTokens,
        cacheTokens,
        totalTokens: Math.round(inputTokens + outputTokens + cacheTokens * 0.1),
        raw: options.includeRaw ? usage : undefined,
      }))
    }
  } else if (rowType) {
    events.push(baseEvent({
      source: 'claude-code',
      sessionId,
      filePath,
      lineNumber,
      timestamp,
      role: 'event',
      type: rowType.includes('error') ? 'error' : 'metadata',
      content: rowType,
      raw: options.includeRaw ? row : undefined,
    }))
  }

  return events
}

function codexRowToReplayEvents(
  row: Record<string, unknown>,
  filePath: string,
  lineNumber: number,
  sessionId: string,
  model: string,
  options: ReplaySessionOptions = {},
) {
  const payload = asRecord(row.payload)
  const rowType = asString(row.type)
  const payloadType = asString(payload?.type)
  const timestamp = normalizeIso(row.timestamp)
  const events: ReplayEvent[] = []

  if (rowType === 'session_meta' || rowType === 'turn_context') {
    events.push(baseEvent({
      source: 'codex',
      sessionId,
      filePath,
      lineNumber,
      timestamp,
      role: 'event',
      type: 'metadata',
      content: payloadType ?? rowType,
      model,
      raw: options.includeRaw ? row : undefined,
    }))
    return events
  }

  if (rowType === 'event_msg' && payloadType === 'token_count') {
    const usage = asRecord(asRecord(payload?.info)?.last_token_usage)
    if (!usage) return events
    const inputTokens = asNumber(usage.input_tokens)
    const outputTokens = asNumber(usage.output_tokens) + asNumber(usage.reasoning_output_tokens)
    const cacheTokens = asNumber(usage.cached_input_tokens)
    const totalTokens = asNumber(usage.total_tokens) || inputTokens + outputTokens
    events.push(baseEvent({
      source: 'codex',
      sessionId,
      filePath,
      lineNumber,
      timestamp,
      role: 'event',
      type: 'token_usage',
      content: model,
      model,
      inputTokens,
      outputTokens,
      cacheTokens,
      totalTokens,
      raw: options.includeRaw ? usage : undefined,
    }))
    return events
  }

  const message = extractCodexMessage(payload)
  if (message) {
    events.push(baseEvent({
      source: 'codex',
      sessionId,
      filePath,
      lineNumber,
      timestamp,
      role: normalizeCodexMessageRole(message.role, payloadType),
      type: 'message',
      content: message.content,
      model,
      attachments: message.attachments,
      raw: options.includeRaw ? row : undefined,
    }))
    return events
  }

  if (rowType || payloadType) {
    events.push(baseEvent({
      source: 'codex',
      sessionId,
      filePath,
      lineNumber,
      timestamp,
      role: 'event',
      type: payloadType?.includes('error') || rowType?.includes('error') ? 'error' : 'metadata',
      content: payloadType ?? rowType,
      model,
      raw: options.includeRaw ? row : undefined,
    }))
  }

  return events
}

function toolEventsFromContent({
  content,
  source,
  sessionId,
  filePath,
  lineNumber,
  timestamp,
  model,
  includeRaw,
}: {
  content: unknown
  source: AgentSource
  sessionId: string
  filePath: string
  lineNumber: number
  timestamp: string
  model?: string
  includeRaw?: boolean
}) {
  if (!Array.isArray(content)) return []
  return content.flatMap((block, index) => {
    const record = asRecord(block)
    const type = asString(record?.type)
    if (!record || (type !== 'tool_use' && type !== 'tool_result')) return []
    const toolName = asString(record.name) ?? asString(record.tool_name)
    return [baseEvent({
      source,
      sessionId,
      filePath,
      lineNumber,
      suffix: `tool-${index}`,
      timestamp,
      role: 'tool',
      type: type === 'tool_use' ? 'tool_call' : 'tool_result',
      content: textFromContent(record.content),
      model,
      toolName,
      toolInput: record.input,
      toolOutput: record.content,
      raw: includeRaw ? record : undefined,
    })]
  })
}

function isInsideReplayWindow(event: ReplayEvent, options: ReplaySessionOptions) {
  const timestamp = new Date(event.timestamp).getTime()
  if (options.from && timestamp < new Date(options.from).getTime()) return false
  if (options.to && timestamp > new Date(options.to).getTime()) return false
  return true
}

function textFromContent(value: unknown, options: { omitTools?: boolean } = {}): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!Array.isArray(value)) return undefined

  const text = value
    .map((item) => {
      if (typeof item === 'string') return item
      const record = asRecord(item)
      if (!record) return ''
      const type = asString(record.type)
      if (options.omitTools && (type === 'tool_use' || type === 'tool_result')) return ''
      if (typeof record.text === 'string') return record.text
      if (typeof record.content === 'string') return record.content
      if (Array.isArray(record.content)) return textFromContent(record.content) ?? ''
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()

  return text || undefined
}

function extractCodexMessage(payload: Record<string, unknown> | null) {
  if (!payload) return null
  const directText = firstTextAtPaths(payload, [
    ['message'],
    ['text'],
    ['content'],
    ['delta'],
    ['item', 'content'],
    ['item', 'text'],
  ])
  const attachments = [
    ...imageAttachmentsFromContent(payload.images),
    ...imageAttachmentsFromContent(payload.content),
    ...imageAttachmentsFromContent(asRecord(payload.item)?.content),
  ]
  if (!directText && attachments.length === 0) return null
  return {
    role: asString(payload.role) ?? asString(asRecord(payload.item)?.role),
    content: directText,
    attachments,
  }
}

function firstTextAtPaths(root: unknown, paths: string[][]) {
  for (const candidatePath of paths) {
    let current: unknown = root
    for (const segment of candidatePath) {
      const record = asRecord(current)
      if (!record) {
        current = undefined
        break
      }
      current = record[segment]
    }
    const text = textFromContent(current) ?? asString(current)?.trim()
    if (text) return text
  }
  return undefined
}

function normalizeRole(value: string | undefined): ReplayEventRole {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') return value
  return 'event'
}

function normalizeCodexMessageRole(role: string | undefined, payloadType: string | undefined): ReplayEventRole {
  const normalized = normalizeRole(role)
  if (normalized !== 'event') return normalized
  if (payloadType === 'user_message') return 'user'
  if (payloadType === 'agent_message') return 'assistant'
  return normalized
}

function isConversationReplayEvent(event: ReplayEvent) {
  return event.type === 'message'
    && (event.role === 'user' || event.role === 'assistant')
    && (!!event.content?.trim() || !!event.attachments?.length)
    && !isTechnicalConversationContent(event.content)
}

function filterConversationReplayEvents(events: ReplayEvent[]) {
  const seen = new Set<string>()
  const deduped = events.filter((event) => {
    if (!isConversationReplayEvent(event)) return false
    const attachmentKey = event.attachments?.map((attachment) => attachment.url).join('|') ?? ''
    const dedupeKey = `${event.sessionId}:${event.role}:${event.content?.trim()}:${attachmentKey}`
    if (seen.has(dedupeKey)) return false
    seen.add(dedupeKey)
    return true
  })
  return collapseAssistantTurns(deduped)
}

function collapseAssistantTurns(events: ReplayEvent[]) {
  const collapsed: ReplayEvent[] = []
  let pendingAssistant: ReplayEvent | null = null

  const flushAssistant = () => {
    if (pendingAssistant) {
      collapsed.push(pendingAssistant)
      pendingAssistant = null
    }
  }

  for (const event of events) {
    if (event.role === 'assistant') {
      pendingAssistant = event
      continue
    }

    flushAssistant()
    collapsed.push(event)
  }

  flushAssistant()
  return collapsed
}

function isTechnicalConversationContent(content: string | undefined) {
  const text = content?.trim()
  if (!text) return true
  return [
    '<environment_context>',
    '<permissions instructions>',
    '<app-context>',
    '<collaboration_mode>',
    '<skills_instructions>',
    '<plugins_instructions>',
    '<user_info>',
    '<image',
    '<INSTRUCTIONS>',
    '# AGENTS.md instructions',
  ].some((prefix) => text.startsWith(prefix))
}

function baseEvent({
  source,
  sessionId,
  filePath,
  lineNumber,
  suffix,
  timestamp,
  role,
  type,
  content,
  model,
  inputTokens,
  outputTokens,
  cacheTokens,
  totalTokens,
  toolName,
  toolInput,
  toolOutput,
  attachments,
  raw,
}: {
  source: AgentSource
  sessionId: string
  filePath: string
  lineNumber: number
  suffix?: string
  timestamp: string
  role: ReplayEventRole
  type: ReplayEventType
  content?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheTokens?: number
  totalTokens?: number
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
  attachments?: ReplayAttachment[]
  raw?: unknown
}): ReplayEvent {
  const idSuffix = suffix ? `:${suffix}` : ''
  return {
    id: `${source}:${filePath}:${lineNumber}${idSuffix}`,
    sessionId,
    source,
    timestamp,
    role,
    type,
    content,
    model,
    inputTokens,
    outputTokens,
    cacheTokens,
    totalTokens,
    toolName,
    toolInput,
    toolOutput,
    attachments,
    raw,
    rawRef: { filePath, lineNumber },
  }
}

function imageAttachmentsFromContent(value: unknown): ReplayAttachment[] {
  if (!value) return []
  if (typeof value === 'string') {
    return value.startsWith('data:image/') || /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(value)
      ? [{ type: 'image', url: value }]
      : []
  }
  if (Array.isArray(value)) return value.flatMap(imageAttachmentsFromContent)

  const record = asRecord(value)
  if (!record) return []
  const type = asString(record.type)
  const source = asRecord(record.source)
  const mimeType = asString(record.mime_type) ?? asString(record.media_type) ?? asString(source?.media_type)

  if ((type === 'image' || type === 'input_image') && source) {
    const data = asString(source.data)
    const url = asString(source.url)
    if (data) return [{ type: 'image', url: data.startsWith('data:') ? data : `data:${mimeType ?? 'image/png'};base64,${data}`, mimeType }]
    if (url) return [{ type: 'image', url, mimeType }]
  }

  const directUrl = asString(record.image_url) ?? asString(record.url)
  if (directUrl) return imageAttachmentsFromContent(directUrl)
  return []
}

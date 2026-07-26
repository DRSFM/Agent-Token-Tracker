import { createHash } from 'node:crypto'
import type { CloudUsageEvent, RequestRecord } from '../src/types/api'

const MAX_MODEL_LENGTH = 200
const MAX_UPSTREAM_LENGTH = 200

function finiteNonNegative(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizedText(value: string | undefined, maxLength: number) {
  return (value ?? '').trim().slice(0, maxLength)
}

function normalizedTimestamp(value: string) {
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date(0).toISOString()
}

/**
 * Scanner IDs contain local file paths. The last component is a stable line,
 * message ID, or request index for the supported scanners and avoids uploading
 * the path itself while keeping copied logs deduplicable across devices.
 */
function stableRecordLocator(record: RequestRecord) {
  const separator = record.id.lastIndexOf(':')
  const suffix = separator >= 0 ? record.id.slice(separator + 1) : record.id
  return suffix || `${record.timestamp}|${record.model}`
}

export function cloudEventId(record: RequestRecord) {
  const identity = [
    'agent-token-tracker-cloud-event-v1',
    record.source,
    record.usageChannel ?? 'account',
    record.upstream?.id ?? '',
    record.sessionId,
    stableRecordLocator(record),
  ].join('\u0000')
  return `sha256:v1:${createHash('sha256').update(identity, 'utf8').digest('hex')}`
}

/** Convert a local request into the strict, content-free cloud payload. */
export function toCloudUsageEvent(record: RequestRecord): CloudUsageEvent {
  const inputTokens = finiteNonNegative(record.inputTokens)
  const outputTokens = finiteNonNegative(record.outputTokens)
  const cacheReadTokens = finiteNonNegative(record.cacheReadTokens)
  const cacheCreationTokens = finiteNonNegative(record.cacheCreationTokens)
  const cacheTokens = finiteNonNegative(record.cacheTokens ?? cacheReadTokens + cacheCreationTokens)
  const rawTotalTokens = finiteNonNegative(record.rawTotalTokens ?? inputTokens + outputTokens + cacheTokens)
  const weightedTotalTokens = finiteNonNegative(record.weightedTotalTokens ?? record.totalTokens)
  const upstreamId = normalizedText(record.upstream?.id, MAX_UPSTREAM_LENGTH)

  return {
    schemaVersion: 1,
    eventId: cloudEventId(record),
    occurredAt: normalizedTimestamp(record.timestamp),
    source: record.source,
    usageChannel: record.usageChannel ?? 'account',
    ...(upstreamId ? { upstreamId } : {}),
    model: normalizedText(record.model, MAX_MODEL_LENGTH) || 'unknown',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens,
    rawTotalTokens,
    weightedTotalTokens,
    requestCount: 1,
  }
}

export function toCloudUsageEvents(records: RequestRecord[]) {
  const unique = new Map<string, CloudUsageEvent>()
  for (const record of records) {
    const event = toCloudUsageEvent(record)
    unique.set(event.eventId, event)
  }
  return [...unique.values()]
}

export function isCloudUsageEvent(value: unknown): value is CloudUsageEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<CloudUsageEvent>
  return (
    event.schemaVersion === 1 &&
    typeof event.eventId === 'string' &&
    /^sha256:v1:[0-9a-f]{64}$/.test(event.eventId) &&
    typeof event.occurredAt === 'string' &&
    typeof event.source === 'string' &&
    typeof event.usageChannel === 'string' &&
    typeof event.model === 'string' &&
    typeof event.requestCount === 'number' &&
    event.requestCount === 1 &&
    [
      event.inputTokens,
      event.outputTokens,
      event.cacheReadTokens,
      event.cacheCreationTokens,
      event.cacheTokens,
      event.rawTotalTokens,
      event.weightedTotalTokens,
    ].every((token) => typeof token === 'number' && Number.isFinite(token) && token >= 0)
  )
}

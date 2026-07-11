import type { RequestRecord } from '../types/api'
import { estimateRecordsValue, type EstimatedValueSummary } from './pricing'

export interface CodexUsagePeriod {
  requestCount: number
  totalTokens: number
  estimated: EstimatedValueSummary
}

export interface CodexUsageSummary {
  fiveHours: CodexUsagePeriod
  sevenDays: CodexUsagePeriod
}

function summarizePeriod(records: RequestRecord[]): CodexUsagePeriod {
  return {
    requestCount: records.length,
    totalTokens: records.reduce((sum, record) => sum + record.totalTokens, 0),
    estimated: estimateRecordsValue(records),
  }
}

export function summarizeCodexUsage(records: RequestRecord[], now = new Date()): CodexUsageSummary {
  const current = now.getTime()
  const codexRecords = records.filter((record) => {
    if (record.source !== 'codex') return false
    const timestamp = new Date(record.timestamp).getTime()
    return Number.isFinite(timestamp) && timestamp <= current
  })
  const within = (hours: number) =>
    codexRecords.filter((record) => current - new Date(record.timestamp).getTime() <= hours * 3_600_000)

  return {
    fiveHours: summarizePeriod(within(5)),
    sevenDays: summarizePeriod(within(24 * 7)),
  }
}

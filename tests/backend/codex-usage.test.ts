import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeCodexUsage } from '../../src/lib/codex-usage'
import type { RequestRecord } from '../../src/types/api'

const now = new Date('2026-07-11T12:00:00.000Z')

function record(id: string, hoursAgo: number, source: RequestRecord['source'] = 'codex'): RequestRecord {
  return {
    id,
    timestamp: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
    source,
    sessionId: `session-${id}`,
    model: 'gpt-5.3-codex',
    inputTokens: 1_000,
    outputTokens: 100,
    cacheTokens: 400,
    totalTokens: 1_100,
  }
}

test('summarizeCodexUsage builds rolling 5 hour and 7 day totals from Codex records only', () => {
  const summary = summarizeCodexUsage([
    record('recent', 2),
    record('week', 48),
    record('old', 24 * 8),
    record('claude', 1, 'claude-code'),
  ], now)

  assert.equal(summary.fiveHours.requestCount, 1)
  assert.equal(summary.fiveHours.totalTokens, 1_100)
  assert.equal(summary.sevenDays.requestCount, 2)
  assert.equal(summary.sevenDays.totalTokens, 2_200)
  assert.equal(summary.sevenDays.estimated.pricedRequests, 2)
  assert.ok(summary.sevenDays.estimated.totalUsd > summary.fiveHours.estimated.totalUsd)
})

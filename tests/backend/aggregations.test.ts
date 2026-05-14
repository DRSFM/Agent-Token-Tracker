import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateModels, aggregateSessions, lastNDays, modelDailySeries, weightedTokenTotal } from '../../src/lib/aggregations'
import type { RequestRecord } from '../../src/types/api'

const now = new Date().toISOString()

const baseRecord: RequestRecord = {
  id: 'r1',
  timestamp: now,
  source: 'claude-code',
  sessionId: 's1',
  sessionTitle: 'session one',
  model: 'claude-sonnet-4-6',
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 600,
  cacheCreationTokens: 400,
  cacheTokens: 1_000,
  rawTotalTokens: 1_150,
  weightedTotalTokens: 250,
  totalTokens: 250,
}

test('model and session aggregates use raw tokens when comparing with cache tokens', () => {
  const models = aggregateModels([baseRecord])
  const sessions = aggregateSessions([baseRecord])

  assert.equal(models[0].totalTokens, 1_150)
  assert.equal(models[0].rawTotalTokens, 1_150)
  assert.equal(models[0].weightedTotalTokens, 250)
  assert.equal(sessions[0].rawTotalTokens, 1_150)
  assert.equal(sessions[0].weightedTotalTokens, 250)
  assert.equal(sessions[0].cacheTokens, 1_000)
  assert.equal(sessions[0].nonCachedBillableTokens, 150)
})

test('model daily series uses raw tokens for model page trends', () => {
  const series = modelDailySeries([baseRecord], 'claude-sonnet-4-6', lastNDays(1))

  assert.deepEqual(series, [1_150])
})

test('weightedTokenTotal recomputes stale Codex cached records from raw and cache tokens', () => {
  const staleCodexRecord: RequestRecord = {
    ...baseRecord,
    id: 'r2',
    source: 'codex',
    model: 'gpt-5.5',
    inputTokens: 100,
    outputTokens: 50,
    cacheTokens: 80,
    cacheReadTokens: 80,
    rawTotalTokens: 150,
    weightedTotalTokens: 150,
    totalTokens: 150,
  }

  assert.equal(weightedTokenTotal(staleCodexRecord), 78)
  const session = aggregateSessions([staleCodexRecord])[0]
  assert.equal(session.weightedTotalTokens, 78)
  assert.equal(session.nonCachedBillableTokens, 70)
  assert.equal(aggregateModels([staleCodexRecord])[0].weightedTotalTokens, 78)
})

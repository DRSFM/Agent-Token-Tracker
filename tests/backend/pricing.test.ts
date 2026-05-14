import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateRecordsValue, estimateRequestValue } from '../../src/lib/pricing'
import type { RequestRecord } from '../../src/types/api'

const baseRecord: RequestRecord = {
  id: 'r1',
  timestamp: new Date().toISOString(),
  source: 'codex',
  sessionId: 's1',
  model: 'gpt-5.5',
  inputTokens: 100,
  outputTokens: 20,
  cacheTokens: 40,
  totalTokens: 120,
}

test('estimateRequestValue discounts cached input tokens at the model cached-input rate', () => {
  const value = estimateRequestValue(baseRecord)

  assert.equal(value.priced, true)
  assertApprox(value.inputUsd, 0.0003)
  assertApprox(value.cachedInputUsd, 0.00002)
  assertApprox(value.outputUsd, 0.0006)
  assert.equal(value.cacheReadTokens, 40)
  assert.equal(value.cacheWriteTokens, 0)
  assert.equal(value.cachedTokenCount, 40)
  assertApprox(value.cachedUsd, 0.00002)
  assertApprox(value.nonCachedUsd, 0.0009)
  assertApprox(value.totalUsd, 0.00092)
})

test('estimateRecordsValue reports unpriced models separately', () => {
  const summary = estimateRecordsValue([
    baseRecord,
    { ...baseRecord, id: 'r2', model: 'claude-unknown' },
  ])

  assert.equal(summary.pricedRequests, 1)
  assert.equal(summary.unpricedRequests, 1)
  assert.equal(summary.cachedTokenCount, 40)
  assertApprox(summary.cachedUsd, 0.00002)
  assertApprox(summary.nonCachedUsd, 0.0009)
  assertApprox(summary.totalUsd, 0.00092)
})

test('estimateRequestValue prices Claude cache reads and cache writes separately', () => {
  const value = estimateRequestValue({
    ...baseRecord,
    model: 'claude-sonnet-4-6-20260201',
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 40,
    cacheCreationTokens: 30,
    cacheTokens: 70,
  })

  assert.equal(value.priced, true)
  assertApprox(value.inputUsd, 0.0003)
  assertApprox(value.cachedInputUsd, 0.000012)
  assertApprox(value.cacheWriteUsd, 0.0001125)
  assertApprox(value.outputUsd, 0.0003)
  assert.equal(value.cacheReadTokens, 40)
  assert.equal(value.cacheWriteTokens, 30)
  assert.equal(value.cachedTokenCount, 70)
  assertApprox(value.cachedUsd, 0.0001245)
  assertApprox(value.nonCachedUsd, 0.0006)
  assertApprox(value.totalUsd, 0.0007245)
})

function assertApprox(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`)
}

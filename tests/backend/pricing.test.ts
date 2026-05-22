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

test('estimateRequestValue subtracts Codex cached input from ordinary input even when cacheReadTokens is present', () => {
  const value = estimateRequestValue({
    ...baseRecord,
    cacheReadTokens: 40,
  })

  assert.equal(value.priced, true)
  assert.equal(value.cacheReadTokens, 40)
  assert.equal(value.uncachedInputTokens, 60)
  assertApprox(value.inputUsd, 0.0003)
  assertApprox(value.cachedInputUsd, 0.00002)
  assertApprox(value.outputUsd, 0.0006)
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
    source: 'claude-code',
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

test('estimateRequestValue prices opencode MiMo 2.5 Pro cache reads from official API tiers', () => {
  const value = estimateRequestValue({
    ...baseRecord,
    source: 'opencode',
    model: 'mimo-v2.5-pro',
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 500,
    cacheCreationTokens: 100,
    cacheTokens: 600,
    rawTotalTokens: 1_800,
    totalTokens: 1_350,
  })

  assert.equal(value.priced, true)
  assert.equal(value.uncachedInputTokens, 1_000)
  assert.equal(value.cacheReadTokens, 500)
  assert.equal(value.cacheWriteTokens, 100)
  assertApprox(value.inputUsd, 0.00105)
  assertApprox(value.cachedInputUsd, 0.000105)
  assertApprox(value.cacheWriteUsd, 0)
  assertApprox(value.outputUsd, 0.00063)
  assertApprox(value.totalUsd, 0.001785)
})

test('estimateRequestValue uses MiMo high-context tier above 256K tokens', () => {
  const value = estimateRequestValue({
    ...baseRecord,
    source: 'opencode',
    model: 'mimo2.5pro',
    inputTokens: 300_000,
    outputTokens: 10_000,
    cacheTokens: 0,
    rawTotalTokens: 310_000,
    totalTokens: 310_000,
  })

  assert.equal(value.priced, true)
  assertApprox(value.inputUsd, 0.63)
  assertApprox(value.outputUsd, 0.063)
  assertApprox(value.totalUsd, 0.693)
})

test('estimateRequestValue prices Antigravity Gemini 3.5 Flash at official standard tier', () => {
  const value = estimateRequestValue({
    ...baseRecord,
    source: 'antigravity',
    model: 'gemini-3.5-flash',
    inputTokens: 1_000,
    outputTokens: 200,
    cacheTokens: 0,
    rawTotalTokens: 1_200,
    totalTokens: 1_200,
  })

  assert.equal(value.priced, true)
  assertApprox(value.inputUsd, 0.0015)
  assertApprox(value.outputUsd, 0.0018)
  assertApprox(value.totalUsd, 0.0033)
})

test('estimateRequestValue prices Antigravity Gemini 3.1 Pro high-context tier above 200K tokens', () => {
  const value = estimateRequestValue({
    ...baseRecord,
    source: 'antigravity',
    model: 'gemini-3.1-pro-low',
    inputTokens: 210_000,
    outputTokens: 10_000,
    cacheTokens: 0,
    rawTotalTokens: 220_000,
    totalTokens: 220_000,
  })

  assert.equal(value.priced, true)
  assertApprox(value.inputUsd, 0.84)
  assertApprox(value.outputUsd, 0.18)
  assertApprox(value.totalUsd, 1.02)
})

function assertApprox(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`)
}

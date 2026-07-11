import type { RequestRecord } from '../types/api'

interface ApiTokenRate {
  inputUsdPerMillion: number
  cachedInputUsdPerMillion: number
  cacheWriteUsdPerMillion?: number
  outputUsdPerMillion: number
}

interface DynamicApiTokenRate extends ApiTokenRate {
  thresholdTokens?: number
  highContextRate?: ApiTokenRate
}

interface EstimatedRequestValue {
  totalUsd: number
  inputUsd: number
  cachedInputUsd: number
  cacheWriteUsd: number
  outputUsd: number
  cachedUsd: number
  nonCachedUsd: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cachedTokenCount: number
  uncachedInputTokens: number
  outputTokens: number
  priced: boolean
}

export interface EstimatedValueSummary {
  totalUsd: number
  inputUsd: number
  cachedInputUsd: number
  cacheWriteUsd: number
  outputUsd: number
  cachedUsd: number
  nonCachedUsd: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cachedTokenCount: number
  uncachedInputTokens: number
  outputTokens: number
  pricedRequests: number
  unpricedRequests: number
}

const OPENAI_API_RATES: { test: RegExp; rate: DynamicApiTokenRate }[] = [
  {
    test: /^gpt-5\.6-sol\b/i,
    rate: {
      inputUsdPerMillion: 5,
      cachedInputUsdPerMillion: 0.5,
      cacheWriteUsdPerMillion: 6.25,
      outputUsdPerMillion: 30,
      thresholdTokens: 272_000,
      highContextRate: {
        inputUsdPerMillion: 10,
        cachedInputUsdPerMillion: 1,
        cacheWriteUsdPerMillion: 12.5,
        outputUsdPerMillion: 45,
      },
    },
  },
  {
    test: /^gpt-5\.6-terra\b/i,
    rate: {
      inputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.25,
      cacheWriteUsdPerMillion: 3.125,
      outputUsdPerMillion: 15,
      thresholdTokens: 272_000,
      highContextRate: {
        inputUsdPerMillion: 5,
        cachedInputUsdPerMillion: 0.5,
        cacheWriteUsdPerMillion: 6.25,
        outputUsdPerMillion: 22.5,
      },
    },
  },
  {
    test: /^gpt-5\.6-luna\b/i,
    rate: {
      inputUsdPerMillion: 1,
      cachedInputUsdPerMillion: 0.1,
      cacheWriteUsdPerMillion: 1.25,
      outputUsdPerMillion: 6,
      thresholdTokens: 272_000,
      highContextRate: {
        inputUsdPerMillion: 2,
        cachedInputUsdPerMillion: 0.2,
        cacheWriteUsdPerMillion: 2.5,
        outputUsdPerMillion: 9,
      },
    },
  },
  {
    test: /^grok-4\.5\b/i,
    rate: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 6 },
  },
  {
    test: /^(?:grok-build(?:-0\.1)?|grok-code-fast(?:-1)?)\b/i,
    rate: { inputUsdPerMillion: 1, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 2 },
  },
  {
    test: /^gpt-5\.5\b/i,
    rate: { inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 30 },
  },
  {
    test: /^gpt-5\.4-mini\b/i,
    rate: { inputUsdPerMillion: 0.75, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 4.5 },
  },
  {
    test: /^gpt-5\.4\b/i,
    rate: { inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.25, outputUsdPerMillion: 15 },
  },
  {
    test: /^gpt-5\.3-codex\b/i,
    rate: { inputUsdPerMillion: 1.75, cachedInputUsdPerMillion: 0.175, outputUsdPerMillion: 14 },
  },
  {
    test: /^gemini[-_]?3\.?5[-_]?flash\b/i,
    rate: { inputUsdPerMillion: 1.5, cachedInputUsdPerMillion: 0.15, outputUsdPerMillion: 9 },
  },
  {
    test: /^gemini[-_]?3[-_]?flash\b/i,
    rate: { inputUsdPerMillion: 0.5, cachedInputUsdPerMillion: 0.05, outputUsdPerMillion: 3 },
  },
  {
    test: /^gemini[-_]?3\.?1[-_]?pro\b|^geminipro3\.?1\b|^gemini[-_]?3[-_]?pro\b/i,
    rate: {
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.2,
      outputUsdPerMillion: 12,
      thresholdTokens: 200_000,
      highContextRate: {
        inputUsdPerMillion: 4,
        cachedInputUsdPerMillion: 0.4,
        outputUsdPerMillion: 18,
      },
    },
  },
  {
    test: /^claude-(?:.+-)?opus-4-[765]\b/i,
    rate: { inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5, cacheWriteUsdPerMillion: 6.25, outputUsdPerMillion: 25 },
  },
  {
    test: /^claude-(?:.+-)?opus-4-1\b/i,
    rate: { inputUsdPerMillion: 15, cachedInputUsdPerMillion: 1.5, cacheWriteUsdPerMillion: 18.75, outputUsdPerMillion: 75 },
  },
  {
    test: /^claude-(?:.+-)?opus-4\b/i,
    rate: { inputUsdPerMillion: 15, cachedInputUsdPerMillion: 1.5, cacheWriteUsdPerMillion: 18.75, outputUsdPerMillion: 75 },
  },
  {
    test: /^claude-(?:.+-)?sonnet-4-[65]\b/i,
    rate: { inputUsdPerMillion: 3, cachedInputUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 3.75, outputUsdPerMillion: 15 },
  },
  {
    test: /^claude-(?:.+-)?sonnet-4\b/i,
    rate: { inputUsdPerMillion: 3, cachedInputUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 3.75, outputUsdPerMillion: 15 },
  },
  {
    test: /^claude-(?:.+-)?haiku-4-5\b/i,
    rate: { inputUsdPerMillion: 1, cachedInputUsdPerMillion: 0.1, cacheWriteUsdPerMillion: 1.25, outputUsdPerMillion: 5 },
  },
  {
    test: /^claude-(?:.+-)?haiku-3-5\b/i,
    rate: { inputUsdPerMillion: 0.8, cachedInputUsdPerMillion: 0.08, cacheWriteUsdPerMillion: 1, outputUsdPerMillion: 4 },
  },
  {
    test: /^mimo[-_]?v?2\.?5[-_]?pro\b|^mimo2\.?5pro\b/i,
    // Official MiMo docs publish CNY rates; keep this table in USD by
    // converting at 7 CNY/USD to match the app's existing value display.
    rate: {
      inputUsdPerMillion: 1.05,
      cachedInputUsdPerMillion: 0.21,
      cacheWriteUsdPerMillion: 0,
      outputUsdPerMillion: 3.15,
      thresholdTokens: 256_000,
      highContextRate: {
        inputUsdPerMillion: 2.1,
        cachedInputUsdPerMillion: 0.42,
        cacheWriteUsdPerMillion: 0,
        outputUsdPerMillion: 6.3,
      },
    },
  },
]

export function apiRateForModel(model: string): ApiTokenRate | null {
  return OPENAI_API_RATES.find((entry) => entry.test.test(model))?.rate ?? null
}

function apiRateForRecord(record: RequestRecord): ApiTokenRate | null {
  const rate = apiRateForModel(record.model)
  if (!rate) return null
  const dynamicRate = rate as DynamicApiTokenRate
  const hasSeparateCacheCounters =
    (record.source === 'claude-code' || record.source === 'opencode' || record.source === 'antigravity') &&
    (record.cacheReadTokens !== undefined || record.cacheCreationTokens !== undefined)
  const inputContextTokens = hasSeparateCacheCounters
    ? Math.max(record.inputTokens, 0) + Math.max(record.cacheReadTokens ?? 0, 0) + Math.max(record.cacheCreationTokens ?? 0, 0)
    : Math.max(record.inputTokens, 0)
  if (
    dynamicRate.thresholdTokens !== undefined &&
    dynamicRate.highContextRate &&
    inputContextTokens > dynamicRate.thresholdTokens
  ) {
    return dynamicRate.highContextRate
  }
  return rate
}

export function estimateRequestValue(record: RequestRecord): EstimatedRequestValue {
  const rate = apiRateForRecord(record)
  if (!rate) {
    return {
      totalUsd: 0,
      inputUsd: 0,
      cachedInputUsd: 0,
      cacheWriteUsd: 0,
      outputUsd: 0,
      cachedUsd: 0,
      nonCachedUsd: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedTokenCount: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      priced: false,
    }
  }

  const hasSeparateCacheCounters =
    (record.source === 'claude-code' || record.source === 'opencode' || record.source === 'antigravity') &&
    (record.cacheReadTokens !== undefined || record.cacheCreationTokens !== undefined)
  const cacheReadTokens = hasSeparateCacheCounters
    ? Math.max(record.cacheReadTokens ?? 0, 0)
    : Math.min(Math.max(record.cacheTokens ?? 0, 0), Math.max(record.inputTokens, 0))
  const cacheWriteTokens = Math.max(record.cacheCreationTokens ?? 0, 0)
  const uncachedInputTokens = hasSeparateCacheCounters
    ? Math.max(record.inputTokens, 0)
    : Math.max(record.inputTokens - cacheReadTokens, 0)
  const outputTokens = Math.max(record.outputTokens, 0)

  const inputUsd = (uncachedInputTokens / 1_000_000) * rate.inputUsdPerMillion
  const cachedInputUsd = (cacheReadTokens / 1_000_000) * rate.cachedInputUsdPerMillion
  const cacheWriteUsd = (cacheWriteTokens / 1_000_000) * (rate.cacheWriteUsdPerMillion ?? rate.inputUsdPerMillion)
  const outputUsd = (outputTokens / 1_000_000) * rate.outputUsdPerMillion
  const cachedUsd = cachedInputUsd + cacheWriteUsd
  const nonCachedUsd = inputUsd + outputUsd

  return {
    totalUsd: nonCachedUsd + cachedUsd,
    inputUsd,
    cachedInputUsd,
    cacheWriteUsd,
    outputUsd,
    cachedUsd,
    nonCachedUsd,
    cacheReadTokens,
    cacheWriteTokens,
    cachedTokenCount: cacheReadTokens + cacheWriteTokens,
    uncachedInputTokens,
    outputTokens,
    priced: true,
  }
}

export function estimateRecordsValue(records: RequestRecord[]): EstimatedValueSummary {
  return records.reduce<EstimatedValueSummary>(
    (summary, record) => {
      const value = estimateRequestValue(record)
      if (!value.priced) {
        summary.unpricedRequests += 1
        return summary
      }
      summary.totalUsd += value.totalUsd
      summary.inputUsd += value.inputUsd
      summary.cachedInputUsd += value.cachedInputUsd
      summary.cacheWriteUsd += value.cacheWriteUsd
      summary.outputUsd += value.outputUsd
      summary.cachedUsd += value.cachedUsd
      summary.nonCachedUsd += value.nonCachedUsd
      summary.cacheReadTokens += value.cacheReadTokens
      summary.cacheWriteTokens += value.cacheWriteTokens
      summary.cachedTokenCount += value.cachedTokenCount
      summary.uncachedInputTokens += value.uncachedInputTokens
      summary.outputTokens += value.outputTokens
      summary.pricedRequests += 1
      return summary
    },
    {
      totalUsd: 0,
      inputUsd: 0,
      cachedInputUsd: 0,
      cacheWriteUsd: 0,
      outputUsd: 0,
      cachedUsd: 0,
      nonCachedUsd: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedTokenCount: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      pricedRequests: 0,
      unpricedRequests: 0,
    },
  )
}

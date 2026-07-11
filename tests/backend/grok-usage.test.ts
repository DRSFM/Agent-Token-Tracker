import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeGrokUsageResults,
  parseGrokBillingJson,
  parseGrokBillingResponse,
  selectGrokAuth,
} from '../../electron/grok-usage'

test('selectGrokAuth prefers the xAI OIDC credential', () => {
  const auth = selectGrokAuth({
    'https://accounts.x.ai/sign-in': { key: 'legacy-token', email: 'legacy@example.com' },
    'https://auth.x.ai::account-id': {
      key: 'oidc-token',
      email: 'User@Example.com',
      auth_mode: 'oidc',
      expires_at: '2030-01-01T00:00:00.000Z',
    },
  })

  assert.equal(auth.accessToken, 'oidc-token')
  assert.equal(auth.email, 'User@Example.com')
  assert.equal(auth.plan, 'SuperGrok')
})

test('parseGrokBillingResponse reads weekly SuperGrok usage and reset from grpc-web protobuf', () => {
  const resetAt = 1_800_000_000
  const credits = protoMessage([
    protoFixed32(1, 12.5),
    protoBytes(5, protoMessage([protoVarint(1, resetAt)])),
  ])
  const payload = protoMessage([protoBytes(1, credits)])
  const frame = Buffer.concat([
    Buffer.from([0]),
    Buffer.from([(payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff]),
    payload,
  ])

  const result = parseGrokBillingResponse(frame, new Date('2026-01-01T00:00:00.000Z'))

  assert.equal(result.weeklyUsedPercent, 12.5)
  assert.equal(result.weeklyRemainingPercent, 87.5)
  assert.equal(result.weeklyResetsAt, new Date(resetAt * 1000).toISOString())
})

test('parseGrokBillingJson reads xAI monthly spend in cents', () => {
  const result = parseGrokBillingJson({
    body: {
      config: {
        monthlyLimit: { val: 20_000 },
        used: { val: 167 },
        onDemandCap: { val: 500 },
        billingPeriodStart: '2026-07-01T00:00:00.000Z',
        billingPeriodEnd: '2026-08-01T00:00:00.000Z',
      },
    },
  })

  assert.equal(result.billingLimitUsd, 200)
  assert.equal(result.billingUsedUsd, 1.67)
  assert.equal(result.billingRemainingUsd, 198.33)
  assert.equal(result.billingPeriodStart, '2026-07-01T00:00:00.000Z')
  assert.equal(result.billingPeriodEnd, '2026-08-01T00:00:00.000Z')
  assert.equal(result.weeklyUsedPercent, undefined)
})

test('mergeGrokUsageResults keeps weekly quota separate from billing dollars', () => {
  const result = mergeGrokUsageResults(
    { weeklyUsedPercent: 3, weeklyRemainingPercent: 97, weeklyResetsAt: '2026-07-14T01:39:00.000Z' },
    {
      billingLimitUsd: 200,
      billingUsedUsd: 7.23,
      billingRemainingUsd: 192.77,
      billingPeriodStart: '2026-07-01T00:00:00.000Z',
      billingPeriodEnd: '2026-08-01T00:00:00.000Z',
    },
  )

  assert.equal(result.weeklyUsedPercent, 3)
  assert.equal(result.weeklyResetsAt, '2026-07-14T01:39:00.000Z')
  assert.equal(result.billingUsedUsd, 7.23)
  assert.equal(result.billingPeriodEnd, '2026-08-01T00:00:00.000Z')
})

function protoMessage(parts: Buffer[]) {
  return Buffer.concat(parts)
}

function protoBytes(fieldNumber: number, value: Buffer) {
  return Buffer.concat([protoTag(fieldNumber, 2), protoVarintRaw(value.length), value])
}

function protoVarint(fieldNumber: number, value: number) {
  return Buffer.concat([protoTag(fieldNumber, 0), protoVarintRaw(value)])
}

function protoFixed32(fieldNumber: number, value: number) {
  const data = Buffer.allocUnsafe(4)
  data.writeFloatLE(value)
  return Buffer.concat([protoTag(fieldNumber, 5), data])
}

function protoTag(fieldNumber: number, wireType: number) {
  return protoVarintRaw((fieldNumber << 3) | wireType)
}

function protoVarintRaw(value: number) {
  const bytes: number[] = []
  let remaining = BigInt(value)
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n))
    remaining >>= 7n
  }
  bytes.push(Number(remaining))
  return Buffer.from(bytes)
}

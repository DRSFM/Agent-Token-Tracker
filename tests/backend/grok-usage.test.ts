import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGrokBillingResponse, selectGrokAuth } from '../../electron/grok-usage'

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

test('parseGrokBillingResponse reads monthly usage and reset from grpc-web protobuf', () => {
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

  assert.equal(result.monthlyUsedPercent, 12.5)
  assert.equal(result.monthlyRemainingPercent, 87.5)
  assert.equal(result.resetsAt, new Date(resetAt * 1000).toISOString())
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

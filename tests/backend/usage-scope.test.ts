import assert from 'node:assert/strict'
import test from 'node:test'
import { filterRecordsByUsageScope } from '../../src/lib/usage-scope'
import type { RequestRecord, UsageScope } from '../../src/types/api'

const baseRecord: RequestRecord = {
  id: 'account',
  timestamp: '2026-07-21T00:00:00.000Z',
  source: 'codex',
  sessionId: 'session',
  model: 'gpt-test',
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
}

const records: RequestRecord[] = [
  baseRecord,
  {
    ...baseRecord,
    id: 'anyrouter',
    usageChannel: 'api',
    upstream: { id: 'anyrouter', label: 'AnyRouter' },
    totalTokens: 20,
  },
  {
    ...baseRecord,
    id: 'muyuanpub',
    usageChannel: 'api',
    upstream: { id: 'muyuanpub', label: 'muyuanpub' },
    totalTokens: 30,
  },
]

for (const [scope, expectedIds] of [
  ['all', ['account', 'anyrouter', 'muyuanpub']],
  ['account', ['account']],
  ['api', ['anyrouter', 'muyuanpub']],
  ['api:anyrouter', ['anyrouter']],
  ['api:muyuanpub', ['muyuanpub']],
] as [UsageScope, string[]][]) {
  test(`usage scope ${scope} filters the expected records`, () => {
    assert.deepEqual(filterRecordsByUsageScope(records, scope).map((record) => record.id), expectedIds)
  })
}

test('total tokens equal account plus all API upstreams', () => {
  const total = filterRecordsByUsageScope(records, 'all').reduce((sum, record) => sum + record.totalTokens, 0)
  const account = filterRecordsByUsageScope(records, 'account').reduce((sum, record) => sum + record.totalTokens, 0)
  const api = filterRecordsByUsageScope(records, 'api').reduce((sum, record) => sum + record.totalTokens, 0)
  assert.equal(total, account + api)
})

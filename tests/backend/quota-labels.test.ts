import assert from 'node:assert/strict'
import test from 'node:test'
import {
  quotaPrimaryLimitLabel,
  quotaSecondaryLimitLabel,
  shouldShowSecondaryLimit,
} from '../../src/lib/quota-labels'

test('free quota primary window is labeled as weekly', () => {
  const quota = { plan: 'FREE', secondaryRemainingPercent: null, secondaryResetAt: '' }

  assert.equal(quotaPrimaryLimitLabel(quota), '周限额')
  assert.equal(shouldShowSecondaryLimit(quota), false)
})

test('paid quota windows keep five hour and seven day labels', () => {
  const quota = { plan: 'PLUS', secondaryRemainingPercent: 82, secondaryResetAt: '2026/5/29 09:38:25' }

  assert.equal(quotaPrimaryLimitLabel(quota), '5 小时限额')
  assert.equal(quotaSecondaryLimitLabel(quota), '7 天限额')
  assert.equal(shouldShowSecondaryLimit(quota), true)
})

import type { QuotaAccountStatus } from '@/types/api'

type QuotaWindowLabelInput = Pick<
  QuotaAccountStatus,
  'plan' | 'secondaryRemainingPercent' | 'secondaryResetAt'
>

function normalizedPlan(plan: string) {
  return plan.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

export function isFreeQuotaPlan(plan: string) {
  return normalizedPlan(plan) === 'free'
}

export function quotaPrimaryLimitLabel(quota: Pick<QuotaAccountStatus, 'plan'>) {
  return isFreeQuotaPlan(quota.plan) ? '周限额' : '5 小时限额'
}

export function quotaSecondaryLimitLabel(quota: Pick<QuotaAccountStatus, 'plan'>) {
  return isFreeQuotaPlan(quota.plan) ? '附加限额' : '7 天限额'
}

export function shouldShowSecondaryLimit(quota: QuotaWindowLabelInput) {
  return !isFreeQuotaPlan(quota.plan) || quota.secondaryRemainingPercent !== null || Boolean(quota.secondaryResetAt)
}

import type { RequestRecord, UsageScope } from '@/types/api'

export function apiUpstreamIdFromScope(scope: UsageScope) {
  return scope.startsWith('api:') ? scope.slice(4) : null
}

export function isApiUsageScope(scope: UsageScope) {
  return scope === 'api' || scope.startsWith('api:')
}

export function recordMatchesUsageScope(record: RequestRecord, scope: UsageScope) {
  if (scope === 'all') return true
  const channel = record.usageChannel ?? 'account'
  if (scope === 'account') return channel === 'account'
  if (scope === 'api') return channel === 'api'
  return channel === 'api' && record.upstream?.id === apiUpstreamIdFromScope(scope)
}

export function filterRecordsByUsageScope(records: RequestRecord[], scope: UsageScope) {
  return scope === 'all' ? records : records.filter((record) => recordMatchesUsageScope(record, scope))
}

import { create } from 'zustand'
import type { UsageScope } from '@/types/api'

const STORAGE_KEY = 'token-dashboard.usage-scope'

function normalizeScope(value: unknown): UsageScope {
  if (value === 'all' || value === 'account' || value === 'api') return value
  if (typeof value === 'string' && /^api:[a-z0-9._-]+$/i.test(value)) return value as UsageScope
  return 'all'
}

function loadScope() {
  if (typeof window === 'undefined') return 'all' as UsageScope
  try {
    return normalizeScope(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'all'
  }
}

interface UsageScopeState {
  scope: UsageScope
  setScope: (scope: UsageScope) => void
}

export const useUsageScope = create<UsageScopeState>((set) => ({
  scope: loadScope(),
  setScope: (scope) => {
    const normalized = normalizeScope(scope)
    set({ scope: normalized })
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized)
    } catch {
      // Scope persistence is optional; filtering still works for this session.
    }
  },
}))

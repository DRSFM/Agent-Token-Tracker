import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  KeyRound,
  Layers3,
  Route,
  UserRoundCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiUpstreamIdFromScope } from '@/lib/usage-scope'
import { useUsageScope } from '@/stores/usage-scope'
import type { DataSourceStatusItem, UsageScope, UsageUpstream } from '@/types/api'

interface ScopeOption {
  value: UsageScope
  label: string
  icon: typeof Layers3
  child?: boolean
}

const BASE_OPTIONS: ScopeOption[] = [
  { value: 'all', label: '总计', icon: Layers3 },
  { value: 'account', label: '官方账号登录', icon: UserRoundCheck },
  { value: 'api', label: 'API（全部）', icon: KeyRound },
]

function uniqueUpstreams(sources: DataSourceStatusItem[]) {
  const upstreams = new Map<string, UsageUpstream>()
  for (const source of sources) {
    if (source.usageChannel === 'api' && source.upstream) {
      upstreams.set(source.upstream.id, source.upstream)
    }
  }
  return [...upstreams.values()].sort((a, b) => a.label.localeCompare(b.label))
}

export function UsageScopePicker({ sources }: { sources: DataSourceStatusItem[] }) {
  const scope = useUsageScope((state) => state.scope)
  const setScope = useUsageScope((state) => state.setScope)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const upstreams = useMemo(() => uniqueUpstreams(sources), [sources])
  const options = useMemo<ScopeOption[]>(
    () => [
      ...BASE_OPTIONS,
      ...upstreams.map((upstream) => ({
        value: `api:${upstream.id}` as UsageScope,
        label: upstream.label,
        icon: Route,
        child: true,
      })),
    ],
    [upstreams],
  )
  const selected = options.find((option) => option.value === scope)
  const selectedUpstreamId = apiUpstreamIdFromScope(scope)
  const selectedLabel = selected?.label ?? (selectedUpstreamId ? selectedUpstreamId : '总计')
  const SelectedIcon = selected?.icon ?? Route

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const choose = (value: UsageScope) => {
    setScope(value)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative px-3 pb-1 titlebar-no-drag">
      <div className="mb-1.5 px-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
        统计口径
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-lg border px-2.5 text-left transition',
          'border-slate-200/80 bg-white/75 text-slate-700 hover:border-slate-300 hover:bg-white',
          'dark:border-slate-700 dark:bg-slate-800/65 dark:text-slate-200 dark:hover:border-slate-600',
          'focus:outline-none focus:ring-2 focus:ring-brand-500/35',
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <SelectedIcon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{selectedLabel}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+0.5rem)] left-3 right-3 z-50 overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {options.map(({ value, label, icon: Icon, child }) => {
            const active = value === scope
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(value)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition',
                  child && 'pl-6',
                  active
                    ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{child ? `API · ${label}` : label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

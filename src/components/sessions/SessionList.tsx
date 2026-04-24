import type { SessionAggregate } from '@/lib/aggregations'
import { formatNumber, formatRelativeMinutes } from '@/lib/format'
import { SourceBadge } from '@/components/filters/SourceBadge'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp } from 'lucide-react'

export type SessionSortKey = 'tokens' | 'requests' | 'lastActive'

interface Props {
  rows: SessionAggregate[]
  sortKey: SessionSortKey
  sortDesc: boolean
  onSort: (k: SessionSortKey) => void
  selectedId: string | null
  onSelect: (id: string) => void
}

const HEADERS: { key: SessionSortKey | 'title' | 'source'; label: string; align?: 'right'; width?: string }[] = [
  { key: 'title', label: '会话', width: 'flex-1 min-w-0' },
  { key: 'source', label: '来源', width: 'w-28 shrink-0' },
  { key: 'requests', label: '请求', align: 'right', width: 'w-20 shrink-0' },
  { key: 'tokens', label: 'Tokens', align: 'right', width: 'w-28 shrink-0' },
  { key: 'lastActive', label: '最后活跃', align: 'right', width: 'w-24 shrink-0' },
]

export function SessionList({ rows, sortKey, sortDesc, onSort, selectedId, onSelect }: Props) {
  const max = Math.max(...rows.map((r) => r.totalTokens), 1)

  return (
    <div className="text-sm">
      <div className="flex items-center gap-3 px-3 py-2 text-xs text-slate-400 border-b border-slate-100 dark:border-slate-800">
        {HEADERS.map((h) => {
          const sortable = h.key === 'tokens' || h.key === 'requests' || h.key === 'lastActive'
          const active = sortKey === h.key
          return (
            <div
              key={h.key}
              className={cn(h.width, h.align === 'right' && 'text-right', sortable && 'cursor-pointer select-none')}
              onClick={() => sortable && onSort(h.key as SessionSortKey)}
            >
              <span className={cn('inline-flex items-center gap-1', active && 'text-brand-600 dark:text-brand-400')}>
                {h.label}
                {active && (sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
              </span>
            </div>
          )
        })}
      </div>
      <ul className="space-y-0.5 mt-1 max-h-[560px] overflow-y-auto pr-1">
        {rows.map((s) => {
          const isActive = selectedId === s.sessionId
          return (
            <li
              key={s.sessionId}
              onClick={() => onSelect(s.sessionId)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition relative',
                isActive
                  ? 'bg-brand-500/10 dark:bg-brand-500/15'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate text-slate-800 dark:text-slate-100 font-medium">{s.title}</div>
                <div className="mt-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full"
                    style={{ width: `${(s.totalTokens / max) * 100}%` }}
                  />
                </div>
              </div>
              <div className="w-28 shrink-0">
                <SourceBadge source={s.source} />
              </div>
              <div className="w-20 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-300 text-xs">
                {formatNumber(s.requestCount)}
              </div>
              <div className="w-28 shrink-0 text-right tabular-nums text-slate-800 dark:text-slate-100 font-medium">
                {formatNumber(s.totalTokens)}
              </div>
              <div className="w-24 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">
                {formatRelativeMinutes(s.lastActiveAt)}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

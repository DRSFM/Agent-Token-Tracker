import { Sparkles, Code2, Boxes } from 'lucide-react'
import type { AgentSource } from '@/types/api'
import { cn } from '@/lib/utils'

export type SourceFilter = 'all' | AgentSource

const TABS: { value: SourceFilter; label: string; icon: typeof Sparkles }[] = [
  { value: 'all', label: '全部', icon: Boxes },
  { value: 'claude-code', label: 'Claude Code', icon: Sparkles },
  { value: 'codex', label: 'Codex', icon: Code2 },
]

export function SourceTabs({
  value,
  onChange,
}: {
  value: SourceFilter
  onChange: (v: SourceFilter) => void
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/80 dark:bg-slate-800/60">
      {TABS.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition',
            value === v
              ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

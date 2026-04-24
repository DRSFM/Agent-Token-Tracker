import { Sparkles, Code2, Bot, type LucideIcon } from 'lucide-react'
import type { AgentSource } from '@/types/api'
import { SOURCE_LABEL } from '@/lib/aggregations'
import { cn } from '@/lib/utils'

const ICON: Record<AgentSource, LucideIcon> = {
  'claude-code': Sparkles,
  codex: Code2,
  unknown: Bot,
}

const COLOR: Record<AgentSource, string> = {
  'claude-code': 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  codex: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  unknown: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
}

export function SourceBadge({
  source,
  size = 'sm',
}: {
  source: AgentSource
  size?: 'xs' | 'sm'
}) {
  const Icon = ICON[source]
  const sizeCls =
    size === 'xs'
      ? 'text-[10px] px-1.5 py-0.5 gap-1'
      : 'text-xs px-2 py-0.5 gap-1'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md font-medium whitespace-nowrap',
        COLOR[source],
        sizeCls,
      )}
    >
      <Icon className={size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {SOURCE_LABEL[source]}
    </span>
  )
}

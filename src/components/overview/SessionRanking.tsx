import type { SessionSummary } from '@/types/api'
import { formatNumber } from '@/lib/format'

interface Props {
  data: SessionSummary[]
}

const RANK_COLORS = [
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
  'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300',
  'bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400',
  'bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400',
]

export function SessionRanking({ data }: Props) {
  const max = Math.max(...data.map((d) => d.totalTokens), 1)
  return (
    <ul className="space-y-3">
      {data.map((s, i) => (
        <li key={s.sessionId} className="flex items-center gap-3 text-sm">
          <span
            className={`w-5 h-5 rounded-md text-xs font-semibold flex items-center justify-center shrink-0 ${
              RANK_COLORS[i] ?? RANK_COLORS[RANK_COLORS.length - 1]
            }`}
          >
            {i + 1}
          </span>
          <span className="text-slate-700 dark:text-slate-200 w-28 truncate">{s.title}</span>
          <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
              style={{ width: `${(s.totalTokens / max) * 100}%` }}
            />
          </div>
          <span className="text-slate-600 dark:text-slate-300 tabular-nums w-20 text-right text-xs">
            {formatNumber(s.totalTokens)}
          </span>
        </li>
      ))}
    </ul>
  )
}

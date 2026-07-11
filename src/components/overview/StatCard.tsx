import { cn } from '@/lib/utils'
import { formatNumber, formatPercent } from '@/lib/format'
import type { LucideIcon } from 'lucide-react'
import { ArrowDown, ArrowUp } from 'lucide-react'

interface Props {
  label: string
  value: number
  deltaPct?: number
  icon: LucideIcon
  iconClassName?: string
  details?: { label: string; value: number | string }[]
  valueFormatter?: (value: number) => string
}

export function StatCard({ label, value, deltaPct, icon: Icon, iconClassName, details, valueFormatter = formatNumber }: Props) {
  const isUp = (deltaPct ?? 0) >= 0
  return (
    <div className="rounded-2xl bg-white/90 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 backdrop-blur-md shadow-card dark:shadow-card-dark p-5 animate-fade-in">
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center shrink-0',
            iconClassName,
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
          <div className="mt-1 text-3xl font-bold text-slate-800 dark:text-slate-50 tabular-nums tracking-tight">
            {valueFormatter(value)}
          </div>
          {details && details.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400 dark:text-slate-500">
              {details.map((detail) => (
                <div key={detail.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span>{detail.label}</span>
                  <span className="tabular-nums text-slate-500 dark:text-slate-400">
                    {typeof detail.value === 'number' ? formatNumber(detail.value) : detail.value}
                  </span>
                </div>
              ))}
            </div>
          )}
          {deltaPct !== undefined && (
            <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              较昨日
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 font-medium',
                  isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {isUp ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                {formatPercent(Math.abs(deltaPct))}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

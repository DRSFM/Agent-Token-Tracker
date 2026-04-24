import type { ModelShare, RequestRecord } from '@/types/api'
import { formatNumber, formatPercent } from '@/lib/format'
import { modelDailySeries, type RangeOpt } from '@/lib/aggregations'
import { Sparkline } from '@/components/charts/Sparkline'
import { cn } from '@/lib/utils'

const PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6']

interface Props {
  shares: ModelShare[]
  records: RequestRecord[]
  range: RangeOpt
}

export function ModelTable({ shares, records, range }: Props) {
  return (
    <div className="text-sm">
      <div className="grid grid-cols-[2fr_60px_100px_80px_70px_120px] items-center gap-3 px-3 py-2 text-xs text-slate-400 border-b border-slate-100 dark:border-slate-800">
        <div>模型</div>
        <div className="text-right">请求</div>
        <div className="text-right">Tokens</div>
        <div className="text-right">平均</div>
        <div className="text-right">占比</div>
        <div className="text-right pr-1">趋势</div>
      </div>
      <ul className="space-y-0.5 mt-1">
        {shares.map((s, i) => {
          const color = PALETTE[i % PALETTE.length]
          const series = modelDailySeries(records, s.model, range)
          const avg = s.requestCount ? Math.round(s.totalTokens / s.requestCount) : 0
          return (
            <li
              key={s.model}
              className={cn(
                'grid grid-cols-[2fr_60px_100px_80px_70px_120px] items-center gap-3 px-3 py-2.5 rounded-lg',
                'hover:bg-slate-50 dark:hover:bg-slate-800/40 transition',
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-slate-800 dark:text-slate-100 truncate font-medium">{s.model}</span>
              </div>
              <div className="text-right tabular-nums text-slate-600 dark:text-slate-300 text-xs">
                {formatNumber(s.requestCount)}
              </div>
              <div className="text-right tabular-nums text-slate-800 dark:text-slate-100 font-medium">
                {formatNumber(s.totalTokens)}
              </div>
              <div className="text-right tabular-nums text-slate-500 dark:text-slate-400 text-xs">
                {formatNumber(avg)}
              </div>
              <div className="text-right">
                <span className="inline-flex items-center text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                  {formatPercent(s.share)}
                </span>
              </div>
              <div className="flex justify-end pr-1">
                <Sparkline data={series} color={color} width={110} height={24} />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

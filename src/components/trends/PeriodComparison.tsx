import type { RequestRecord } from '@/types/api'
import { previousRange, sumTokens, type RangeOpt, inRange } from '@/lib/aggregations'
import { formatNumber, formatPercent } from '@/lib/format'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'

interface Props {
  records: RequestRecord[]
  range: RangeOpt
  days: number
}

export function PeriodComparison({ records, range, days }: Props) {
  const stats = useMemo(() => {
    const prev = previousRange(range)
    const cur = records.filter((r) => inRange(r, range))
    const prv = records.filter((r) => inRange(r, prev))
    const curSessions = new Set(cur.map((r) => r.sessionId)).size
    const prvSessions = new Set(prv.map((r) => r.sessionId)).size
    return [
      tile('总 Tokens', sumTokens(cur), sumTokens(prv)),
      tile('请求数', cur.length, prv.length),
      tile('活跃会话', curSessions, prvSessions),
      tile(
        '日均 Tokens',
        Math.round(sumTokens(cur) / days),
        Math.round(sumTokens(prv) / days),
      ),
    ]
  }, [records, range, days])

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl bg-white/90 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 backdrop-blur-md shadow-card dark:shadow-card-dark px-4 py-3"
        >
          <div className="text-xs text-slate-500 dark:text-slate-400">{s.label}</div>
          <div className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
            {formatNumber(s.current)}
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            较上一周期
            <DeltaPill delta={s.delta} />
          </div>
        </div>
      ))}
    </div>
  )
}

function DeltaPill({ delta }: { delta: number }) {
  if (delta === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-slate-400">
        <Minus className="w-3 h-3" /> 0%
      </span>
    )
  const up = delta > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-medium',
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
      )}
    >
      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {formatPercent(Math.abs(delta))}
    </span>
  )
}

function tile(label: string, current: number, previous: number) {
  const delta = previous === 0 ? (current === 0 ? 0 : 1) : (current - previous) / previous
  return { label, current, previous, delta }
}

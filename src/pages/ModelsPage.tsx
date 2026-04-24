import { useMemo, useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { RangeSelect } from '@/components/filters/RangeSelect'
import { ModelDonut } from '@/components/overview/ModelDonut'
import { ModelTable } from '@/components/models/ModelTable'
import { useAllRequests } from '@/hooks/useAllRequests'
import { aggregateModels, inRange, lastNDays } from '@/lib/aggregations'
import { formatNumber, formatPercent } from '@/lib/format'
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states'

export default function ModelsPage() {
  const [days, setDays] = useState(30)
  const range = useMemo(() => lastNDays(days), [days])
  const { data, loading, error, refresh } = useAllRequests()

  const filteredRecords = useMemo(
    () => (data ? data.filter((r) => inRange(r, range)) : []),
    [data, range],
  )
  const shares = useMemo(() => aggregateModels(filteredRecords), [filteredRecords])

  const summary = useMemo(() => {
    const totalTokens = shares.reduce((s, x) => s + x.totalTokens, 0)
    const totalRequests = shares.reduce((s, x) => s + x.requestCount, 0)
    const top = shares[0]
    return {
      modelCount: shares.length,
      totalTokens,
      totalRequests,
      topModel: top?.model ?? '—',
      topShare: top?.share ?? 0,
    }
  }, [shares])

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-50">模型</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            按模型聚合的使用情况、占比与趋势
          </p>
        </div>
        <RangeSelect value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="活跃模型" value={formatNumber(summary.modelCount)} />
        <SummaryTile label="总 Tokens" value={formatNumber(summary.totalTokens)} />
        <SummaryTile label="总请求" value={formatNumber(summary.totalRequests)} />
        <SummaryTile
          label="主力模型"
          value={summary.topModel}
          hint={summary.topShare > 0 ? `占比 ${formatPercent(summary.topShare)}` : undefined}
        />
      </div>

      {error ? (
        <Card>
          <CardBody>
            <ErrorState error={error} onRetry={refresh} />
          </CardBody>
        </Card>
      ) : loading && !data ? (
        <Card>
          <CardBody>
            <LoadingState />
          </CardBody>
        </Card>
      ) : shares.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="当前时间窗内无模型记录"
              hint="试试拉长时间范围，或确认数据源已扫描"
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader title="占比分布" subtitle="按 Token 总量" />
            <CardBody>
              <ModelDonut data={shares} />
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader title="模型明细" subtitle={`最近 ${days} 天 · 含每日趋势`} />
            <CardBody className="pt-2">
              <ModelTable shares={shares} records={filteredRecords} range={range} />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl bg-white/90 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 backdrop-blur-md shadow-card dark:shadow-card-dark px-4 py-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums truncate">
        {value}
      </div>
      {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  )
}

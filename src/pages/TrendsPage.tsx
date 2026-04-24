import { useMemo, useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { RangeSelect } from '@/components/filters/RangeSelect'
import { DailyTrendChart } from '@/components/overview/DailyTrendChart'
import { Heatmap } from '@/components/overview/Heatmap'
import { StackedSourceChart } from '@/components/trends/StackedSourceChart'
import { PeriodComparison } from '@/components/trends/PeriodComparison'
import { useAllRequests } from '@/hooks/useAllRequests'
import {
  aggregateDaily,
  aggregateDailyBySource,
  aggregateHeatmap,
  inRange,
  lastNDays,
} from '@/lib/aggregations'
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states'

const RANGE_OPTIONS = [
  { value: '14', label: '最近 14 天' },
  { value: '30', label: '最近 30 天' },
  { value: '60', label: '最近 60 天' },
  { value: '90', label: '最近 90 天' },
]

export default function TrendsPage() {
  const [days, setDays] = useState(30)
  const range = useMemo(() => lastNDays(days), [days])
  const { data, loading, error, refresh } = useAllRequests()

  const filtered = useMemo(
    () => (data ? data.filter((r) => inRange(r, range)) : []),
    [data, range],
  )
  const dailyTrend = useMemo(() => aggregateDaily(filtered, range), [filtered, range])
  const dailyBySource = useMemo(() => aggregateDailyBySource(filtered, range), [filtered, range])
  const heatmap = useMemo(() => aggregateHeatmap(filtered), [filtered])

  const isEmpty = !loading && data && filtered.length === 0

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-50">趋势</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            长周期 Token 走势、来源对比与时段分布
          </p>
        </div>
        <RangeSelect value={days} onChange={setDays} options={RANGE_OPTIONS} />
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
      ) : isEmpty ? (
        <Card>
          <CardBody>
            <EmptyState
              title="当前时间窗内无记录"
              hint="试试拉长时间范围，或检查数据源是否健康"
            />
          </CardBody>
        </Card>
      ) : data ? (
        <>
          <PeriodComparison records={data} range={range} days={days} />

          <Card>
            <CardHeader title="每日 Token 趋势" subtitle={`最近 ${days} 天`} />
            <CardBody className="pt-2">
              <DailyTrendChart data={dailyTrend} />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="xl:col-span-2">
              <CardHeader title="来源对比" subtitle="按工具来源堆叠" />
              <CardBody className="pt-2">
                <StackedSourceChart data={dailyBySource} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="时段热力" subtitle="周一至周日 × 24 小时" />
              <CardBody>
                <Heatmap data={heatmap} />
              </CardBody>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}

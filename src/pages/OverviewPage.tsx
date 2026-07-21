import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, Activity, DollarSign, TrendingUp, Users } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { StatCard } from '@/components/overview/StatCard'
import { DailyTrendChart } from '@/components/overview/DailyTrendChart'
import { ModelDonut } from '@/components/overview/ModelDonut'
import { SessionRanking } from '@/components/overview/SessionRanking'
import { Heatmap } from '@/components/overview/Heatmap'
import { RecentRequests } from '@/components/overview/RecentRequests'
import { isMock } from '@/lib/api'
import type { RankBy } from '@/types/api'
import { ChevronDown } from 'lucide-react'
import { useScopedRequests } from '@/hooks/useAllRequests'
import { estimateRecordsValue } from '@/lib/pricing'
import { formatUsd, isToday } from '@/lib/format'
import {
  aggregateDaily,
  aggregateHeatmap,
  aggregateModels,
  aggregateOverviewStats,
  aggregateSessionRanking,
  inRange,
  lastNDays,
} from '@/lib/aggregations'

export default function OverviewPage() {
  const navigate = useNavigate()
  const [trendDays, setTrendDays] = useState(14)
  const [donutBy, setDonutBy] = useState<RankBy>('tokens')
  const [rankBy, setRankBy] = useState<RankBy>('tokens')

  const allRequests = useScopedRequests()
  const records = allRequests.data ?? []
  const range30 = useMemo(() => lastNDays(30), [])
  const trendRange = useMemo(() => lastNDays(trendDays), [trendDays])
  const range30Records = useMemo(
    () => records.filter((record) => inRange(record, range30)),
    [range30, records],
  )
  const stats = useMemo(() => aggregateOverviewStats(records), [records])
  const trend = useMemo(() => aggregateDaily(records, trendRange), [records, trendRange])
  const shares = useMemo(() => aggregateModels(range30Records, donutBy), [donutBy, range30Records])
  const ranking = useMemo(
    () => aggregateSessionRanking(range30Records, rankBy, 5),
    [range30Records, rankBy],
  )
  const heatmap = useMemo(() => aggregateHeatmap(range30Records), [range30Records])
  const recent = useMemo(() => records.slice(0, 5), [records])
  const todayValue = useMemo(() => {
    const estimated = estimateRecordsValue(records.filter((record) => isToday(record.timestamp)))
    return estimated
  }, [records])

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-50">今日概览</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            本地估算的 Token 使用趋势
          </p>
        </div>
        {isMock && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            未连接到本地数据源 — 显示示例数据
          </span>
        )}
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <>
            <StatCard
              label="今日总 Tokens"
              value={stats.todayTotalTokens}
              deltaPct={stats.todayTotalDeltaPct}
              icon={Database}
              iconClassName="bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300"
              details={[
                { label: '原始总量', value: stats.todayRawTotalTokens },
                { label: '缓存量', value: stats.todayCacheTokens },
              ]}
            />
            <StatCard
              label="请求次数"
              value={stats.todayRequestCount}
              deltaPct={stats.todayRequestDeltaPct}
              icon={Activity}
              iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300"
            />
            <StatCard
              label="平均每次"
              value={stats.todayAvgPerRequest}
              deltaPct={stats.todayAvgDeltaPct}
              icon={TrendingUp}
              iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300"
            />
            <StatCard
              label="活跃会话"
              value={stats.activeSessionCount}
              deltaPct={stats.activeSessionDeltaPct}
              icon={Users}
              iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300"
            />
            <StatCard
              label="今日估算计费"
              value={todayValue.totalUsd}
              valueFormatter={formatUsd}
              icon={DollarSign}
              iconClassName="bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300"
              details={[
                { label: '缓存', value: formatUsd(todayValue.cachedUsd) },
                { label: '非缓存', value: formatUsd(todayValue.nonCachedUsd) },
              ]}
            />
        </>
      </div>

      {/* 趋势 + 模型占比 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader
            title="每日 Token 趋势"
            action={
              <Select
                value={String(trendDays)}
                onChange={(v) => setTrendDays(Number(v))}
                options={[
                  { value: '7', label: '最近 7 天' },
                  { value: '14', label: '最近 14 天' },
                  { value: '30', label: '最近 30 天' },
                ]}
              />
            }
          />
          <CardBody className="pt-2">
            <DailyTrendChart data={trend} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="模型占比"
            action={
              <Select
                value={donutBy}
                onChange={(v) => setDonutBy(v as RankBy)}
                options={[
                  { value: 'tokens', label: '按 Tokens' },
                  { value: 'requests', label: '按请求数' },
                ]}
              />
            }
          />
          <CardBody><ModelDonut data={shares} /></CardBody>
        </Card>
      </div>

      {/* 会话排行 + 热力图 + 最近请求 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader
            title="会话排行"
            action={
              <Select
                value={rankBy}
                onChange={(v) => setRankBy(v as RankBy)}
                options={[
                  { value: 'tokens', label: '按 Tokens' },
                  { value: 'requests', label: '按请求数' },
                ]}
              />
            }
          />
          <CardBody><SessionRanking data={ranking} /></CardBody>
        </Card>

        <Card>
          <CardHeader title="时段热力" />
          <CardBody><Heatmap data={heatmap} /></CardBody>
        </Card>

        <Card>
          <CardHeader
            title="最近请求"
            action={
              <button
                type="button"
                onClick={() => navigate('/sessions')}
                className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
              >
                查看全部
              </button>
            }
          />
          <CardBody className="pt-1">
            <RecentRequests data={recent} />
            <div className="flex justify-center pt-1">
              <ChevronDown className="w-4 h-4 text-slate-300" />
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

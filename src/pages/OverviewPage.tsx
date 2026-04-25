import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, Activity, TrendingUp, Users } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { StatCard } from '@/components/overview/StatCard'
import { DailyTrendChart } from '@/components/overview/DailyTrendChart'
import { ModelDonut } from '@/components/overview/ModelDonut'
import { SessionRanking } from '@/components/overview/SessionRanking'
import { Heatmap } from '@/components/overview/Heatmap'
import { RecentRequests } from '@/components/overview/RecentRequests'
import { api, isMock } from '@/lib/api'
import { useAsync } from '@/hooks/useTokenData'
import type { DateRange, RankBy } from '@/types/api'
import { ChevronDown } from 'lucide-react'

export default function OverviewPage() {
  const navigate = useNavigate()
  const [trendDays, setTrendDays] = useState(14)
  const [donutBy, setDonutBy] = useState<RankBy>('tokens')
  const [rankBy, setRankBy] = useState<RankBy>('tokens')

  const range30: DateRange = useMemo(() => ({ kind: 'last-n-days', days: 30 }), [])
  const trendRange: DateRange = useMemo(
    () => ({ kind: 'last-n-days', days: trendDays }),
    [trendDays],
  )

  const stats = useAsync(() => api.getOverviewStats(range30), [])
  const trend = useAsync(() => api.getDailyTrend(trendRange), [trendDays])
  const shares = useAsync(() => api.getModelShares(range30, donutBy), [donutBy])
  const ranking = useAsync(() => api.getSessionRanking(range30, rankBy, 5), [rankBy])
  const heatmap = useAsync(() => api.getHourlyHeatmap(range30), [])
  const recent = useAsync(() => api.getRecentRequests(5), [])

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
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.data && (
          <>
            <StatCard
              label="今日总 Tokens"
              value={stats.data.todayTotalTokens}
              deltaPct={stats.data.todayTotalDeltaPct}
              icon={Database}
              iconClassName="bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300"
              details={[
                { label: '原始总量', value: stats.data.todayRawTotalTokens },
                { label: '缓存量', value: stats.data.todayCacheTokens },
              ]}
            />
            <StatCard
              label="请求次数"
              value={stats.data.todayRequestCount}
              deltaPct={stats.data.todayRequestDeltaPct}
              icon={Activity}
              iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300"
            />
            <StatCard
              label="平均每次"
              value={stats.data.todayAvgPerRequest}
              deltaPct={stats.data.todayAvgDeltaPct}
              icon={TrendingUp}
              iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300"
            />
            <StatCard
              label="活跃会话"
              value={stats.data.activeSessionCount}
              deltaPct={stats.data.activeSessionDeltaPct}
              icon={Users}
              iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300"
            />
          </>
        )}
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
            {trend.data && <DailyTrendChart data={trend.data} />}
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
          <CardBody>{shares.data && <ModelDonut data={shares.data} />}</CardBody>
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
          <CardBody>{ranking.data && <SessionRanking data={ranking.data} />}</CardBody>
        </Card>

        <Card>
          <CardHeader title="时段热力" />
          <CardBody>{heatmap.data && <Heatmap data={heatmap.data} />}</CardBody>
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
            {recent.data && <RecentRequests data={recent.data} />}
            <div className="flex justify-center pt-1">
              <ChevronDown className="w-4 h-4 text-slate-300" />
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

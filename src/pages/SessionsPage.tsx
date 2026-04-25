import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { RangeSelect } from '@/components/filters/RangeSelect'
import { SourceTabs, type SourceFilter } from '@/components/filters/SourceTabs'
import { SessionList, type SessionSortKey } from '@/components/sessions/SessionList'
import { SessionDetail } from '@/components/sessions/SessionDetail'
import { useAllRequests } from '@/hooks/useAllRequests'
import {
  aggregateSessions,
  inRange,
  lastNDays,
  type SessionAggregate,
} from '@/lib/aggregations'
import { formatNumber } from '@/lib/format'
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states'

export default function SessionsPage() {
  const [days, setDays] = useState(30)
  const [source, setSource] = useState<SourceFilter>('all')
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [sortKey, setSortKey] = useState<SessionSortKey>('tokens')
  const [sortDesc, setSortDesc] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, loading, error, refresh } = useAllRequests()

  // 从 TopBar 跳转过来时同步 URL ?q=
  useEffect(() => {
    const q = searchParams.get('q') ?? ''
    if (q !== search) setSearch(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // 用户改本页搜索框时同步回 URL（保留可分享 / 后退）
  useEffect(() => {
    const current = searchParams.get('q') ?? ''
    if (current === search) return
    const next = new URLSearchParams(searchParams)
    if (search) next.set('q', search)
    else next.delete('q')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const range = useMemo(() => lastNDays(days), [days])

  const sessions = useMemo<SessionAggregate[]>(() => {
    if (!data) return []
    const filteredRecords = data.filter((r) => inRange(r, range))
    let aggs = aggregateSessions(filteredRecords)
    if (source !== 'all') aggs = aggs.filter((s) => s.source === source)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      aggs = aggs.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.sessionId.toLowerCase().includes(q) ||
          s.models.some((m) => m.model.toLowerCase().includes(q)),
      )
    }
    aggs.sort((a, b) => {
      const dir = sortDesc ? -1 : 1
      if (sortKey === 'tokens') return dir * (a.totalTokens - b.totalTokens)
      if (sortKey === 'requests') return dir * (a.requestCount - b.requestCount)
      return dir * (new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime())
    })
    return aggs
  }, [data, range, source, search, sortKey, sortDesc])

  const summary = useMemo(() => {
    const totalTokens = sessions.reduce((s, x) => s + x.totalTokens, 0)
    const totalRequests = sessions.reduce((s, x) => s + x.requestCount, 0)
    return {
      sessionCount: sessions.length,
      totalTokens,
      totalRequests,
      avgPerSession: sessions.length ? Math.round(totalTokens / sessions.length) : 0,
    }
  }, [sessions])

  const selected = sessions.find((s) => s.sessionId === selectedId) ?? null

  const handleSort = (k: SessionSortKey) => {
    if (sortKey === k) setSortDesc(!sortDesc)
    else {
      setSortKey(k)
      setSortDesc(true)
    }
  }

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-50">会话</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            按会话查看 Token 消耗、模型分布与请求时间线
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SourceTabs value={source} onChange={setSource} />
          <RangeSelect value={days} onChange={setDays} />
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="会话数" value={summary.sessionCount} />
        <SummaryTile label="总 Tokens" value={summary.totalTokens} />
        <SummaryTile label="总请求" value={summary.totalRequests} />
        <SummaryTile label="平均/会话" value={summary.avgPerSession} />
      </div>

      {/* Two-column: list + detail */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader
            title="会话列表"
            action={
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索标题 / 模型 / ID"
                  className="h-8 pl-8 pr-7 w-56 rounded-lg text-xs bg-slate-100/80 dark:bg-slate-800/70 border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/40 placeholder:text-slate-400"
                />
                {search && (
                  <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setSearch('')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            }
          />
          <CardBody className="pt-2">
            {error ? (
              <ErrorState error={error} onRetry={refresh} />
            ) : loading && !data ? (
              <LoadingState />
            ) : sessions.length === 0 ? (
              <EmptyState
                title={search ? '没有匹配的会话' : '当前时间窗内暂无会话'}
                hint={search ? '换个关键词或清空搜索' : '尝试调整时间范围 / 来源筛选'}
              />
            ) : (
              <SessionList
                rows={sessions}
                sortKey={sortKey}
                sortDesc={sortDesc}
                onSort={handleSort}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="会话详情" />
          <CardBody>
            <SessionDetail session={selected} records={data ?? []} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/90 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 backdrop-blur-md shadow-card dark:shadow-card-dark px-4 py-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
        {formatNumber(value)}
      </div>
    </div>
  )
}

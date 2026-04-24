import { useMemo } from 'react'
import type { RequestRecord } from '@/types/api'
import type { SessionAggregate } from '@/lib/aggregations'
import { aggregateDaily, lastNDays } from '@/lib/aggregations'
import { formatNumber, formatTime, formatRelativeMinutes } from '@/lib/format'
import { Sparkline } from '@/components/charts/Sparkline'
import { SourceBadge } from '@/components/filters/SourceBadge'
import { EmptyState } from '@/components/ui/states'
import { MessageSquare, Hash, Database, Clock, Sparkles } from 'lucide-react'

interface Props {
  session: SessionAggregate | null
  records: RequestRecord[]
}

export function SessionDetail({ session, records }: Props) {
  const sessionRequests = useMemo(
    () => (session ? records.filter((r) => r.sessionId === session.sessionId) : []),
    [session, records],
  )
  const trendSeries = useMemo(() => {
    if (!sessionRequests.length) return []
    return aggregateDaily(sessionRequests, lastNDays(14)).map((p) => p.totalTokens)
  }, [sessionRequests])

  if (!session) {
    return (
      <EmptyState
        title="选择会话查看详情"
        hint="左侧列表中点选任意一行，这里显示该会话的 token 使用、模型分布和最近请求"
        className="py-16"
      />
    )
  }

  const recentInSession = [...sessionRequests]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8)

  const stats = [
    { icon: Database, label: '总 Tokens', value: formatNumber(session.totalTokens) },
    { icon: Hash, label: '请求数', value: formatNumber(session.requestCount) },
    {
      icon: Clock,
      label: '持续',
      value: spanLabel(session.firstActiveAt, session.lastActiveAt),
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 break-all">
            {session.title}
          </h3>
          <SourceBadge source={session.source} />
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 break-all">
          会话 ID：<code className="font-mono">{session.sessionId}</code>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {stats.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 border border-slate-100 dark:border-slate-700/60"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Icon className="w-3 h-3" />
              {label}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
              {value}
            </div>
          </div>
        ))}
      </div>

      {trendSeries.some((v) => v > 0) && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">最近 14 天 Token</div>
            <div className="text-xs text-slate-400">
              更新于 {formatRelativeMinutes(session.lastActiveAt)}
            </div>
          </div>
          <Sparkline data={trendSeries} width={300} height={50} />
        </div>
      )}

      <div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-2">
          <Sparkles className="w-3 h-3" />
          模型分布
        </div>
        <ul className="space-y-1.5">
          {session.models.map((m) => (
            <li key={m.model} className="flex items-center text-sm">
              <span className="text-slate-700 dark:text-slate-200 flex-1 truncate">{m.model}</span>
              <span className="text-xs text-slate-400 mr-3">{m.count} 次</span>
              <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                {formatNumber(m.tokens)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-2">
          <MessageSquare className="w-3 h-3" />
          最近请求
        </div>
        <ul className="space-y-1">
          {recentInSession.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <span className="text-slate-400 tabular-nums w-16 shrink-0">
                {formatTime(r.timestamp)}
              </span>
              <span className="text-slate-700 dark:text-slate-200 flex-1 truncate">{r.model}</span>
              <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                {formatNumber(r.totalTokens)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function spanLabel(from: string, to: string) {
  const ms = Math.max(0, new Date(to).getTime() - new Date(from).getTime())
  const m = Math.floor(ms / 60000)
  if (m < 1) return '< 1 分'
  if (m < 60) return `${m} 分`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时`
  return `${Math.floor(h / 24)} 天`
}

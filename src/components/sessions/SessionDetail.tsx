import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReplayEvent, ReplaySessionOptions, RequestRecord } from '@/types/api'
import type { SessionAggregate } from '@/lib/aggregations'
import { aggregateDaily, lastNDays } from '@/lib/aggregations'
import { formatNumber, formatTime, formatRelativeMinutes } from '@/lib/format'
import { Sparkline } from '@/components/charts/Sparkline'
import { SourceBadge } from '@/components/filters/SourceBadge'
import { ConversationEventList } from '@/components/replay/ConversationView'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Braces,
  Clock,
  Copy,
  Database,
  Hash,
  Maximize2,
  MessageSquare,
  Search,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'

const REPLAY_EVENT_LIMIT = 600
const RAW_EVENT_LIMIT = 200
const REPLAY_WINDOW_BEFORE_MS = 30 * 60 * 1000
const REPLAY_WINDOW_AFTER_MS = 5 * 60 * 1000

interface Props {
  session: SessionAggregate | null
  records: RequestRecord[]
}

export function SessionDetail({ session, records }: Props) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'overview' | 'replay' | 'raw'>('overview')
  const [replay, setReplay] = useState<ReplayEvent[] | null>(null)
  const [replayLoadedKey, setReplayLoadedKey] = useState<string | null>(null)
  const [replayLoading, setReplayLoading] = useState(false)
  const [replayError, setReplayError] = useState<unknown>(null)
  const [query, setQuery] = useState('')

  const sessionRequests = useMemo(
    () => (session ? records.filter((r) => r.sessionId === session.sessionId) : []),
    [session, records],
  )
  const trendSeries = useMemo(() => {
    if (!sessionRequests.length) return []
    return aggregateDaily(sessionRequests, lastNDays(14)).map((p) => p.totalTokens)
  }, [sessionRequests])
  const replayOptions = useMemo<ReplaySessionOptions>(() => ({
    ...replayWindowFromRequests(sessionRequests),
    includeRaw: tab === 'raw',
    conversationOnly: tab === 'replay',
    limit: tab === 'raw' ? RAW_EVENT_LIMIT : REPLAY_EVENT_LIMIT,
  }), [sessionRequests, tab])
  const replayRequestKey = session
    ? [
      session.sessionId,
      tab,
      replayOptions.from ?? '',
      replayOptions.to ?? '',
      replayOptions.includeRaw ? 'raw' : 'lean',
      replayOptions.conversationOnly ? 'conversation' : 'all',
      replayOptions.limit ?? 0,
    ].join('|')
    : ''

  useEffect(() => {
    setTab('overview')
    setReplay(null)
    setReplayLoadedKey(null)
    setReplayError(null)
    setQuery('')
  }, [session?.sessionId])

  useEffect(() => {
    if (!session || tab === 'overview' || replayLoadedKey === replayRequestKey) return
    let cancelled = false
    setReplay(null)
    setReplayLoading(true)
    setReplayError(null)
    void api.getReplaySession(session.sessionId, session.source, replayOptions)
      .then((events) => {
        if (!cancelled) {
          setReplay(events)
          setReplayLoadedKey(replayRequestKey)
        }
      })
      .catch((error) => {
        if (!cancelled) setReplayError(error)
      })
      .finally(() => {
        if (!cancelled) setReplayLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [replayLoadedKey, replayOptions, replayRequestKey, session, tab])

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

  const filteredReplay = (replay ?? []).filter((event) => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return [
      event.content,
      event.model,
      event.type,
      event.role,
      event.rawRef.filePath,
    ].some((value) => value?.toLowerCase().includes(q))
  })

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

      <div className="flex items-center gap-1 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 p-1">
        {[
          { key: 'overview', label: '概览', icon: Database },
          { key: 'replay', label: '回放', icon: MessageSquare },
          { key: 'raw', label: '原始事件', icon: Braces },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key as typeof tab)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition',
              tab === key
                ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-900 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <OverviewPanel
          session={session}
          stats={stats}
          trendSeries={trendSeries}
          recentInSession={recentInSession}
        />
      ) : (
        <ReplayPanel
          mode={tab}
          events={filteredReplay}
          totalEvents={replay?.length ?? 0}
          query={query}
          setQuery={setQuery}
          loading={replayLoading}
          error={replayError}
          onRetry={() => {
            setReplay(null)
            setReplayLoadedKey(null)
            setReplayError(null)
          }}
          limit={replayOptions.limit ?? 0}
          sessionTitle={session.title}
          onOpenReplayPage={() => {
            const params = new URLSearchParams({
              sid: session.sessionId,
              source: session.source,
            })
            navigate(`/replay?${params.toString()}`)
          }}
        />
      )}
    </div>
  )
}

function OverviewPanel({
  session,
  stats,
  trendSeries,
  recentInSession,
}: {
  session: SessionAggregate
  stats: { icon: typeof Database; label: string; value: string }[]
  trendSeries: number[]
  recentInSession: RequestRecord[]
}) {
  return (
    <div className="space-y-5">
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

function ReplayPanel({
  mode,
  events,
  totalEvents,
  query,
  setQuery,
  loading,
  error,
  onRetry,
  limit,
  sessionTitle,
  onOpenReplayPage,
}: {
  mode: 'replay' | 'raw'
  events: ReplayEvent[]
  totalEvents: number
  query: string
  setQuery: (value: string) => void
  loading: boolean
  error: unknown
  onRetry: () => void
  limit: number
  sessionTitle: string
  onOpenReplayPage: () => void
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (loading) return <LoadingState label={mode === 'raw' ? '正在读取原始 JSONL…' : '正在整理对话回放…'} />

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === 'raw' ? '搜索原始事件 / 模型 / 文件路径' : '搜索我的输入 / 助手回复'}
            className="h-8 w-full rounded-lg border border-transparent bg-slate-100/80 pl-8 pr-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500/30 dark:bg-slate-800/70 dark:text-slate-200"
          />
        </div>
        {mode === 'replay' && events.length > 0 && (
          <button
            type="button"
            onClick={onOpenReplayPage}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-brand-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-brand-50 dark:bg-slate-900 dark:text-brand-300 dark:ring-slate-700"
            title={`打开 ${sessionTitle} 的回放页`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            大屏
          </button>
        )}
      </div>

      {totalEvents === 0 ? (
        <EmptyState
          title={mode === 'raw' ? '没有原始事件' : '没有可回放的对话'}
          hint={mode === 'raw' ? '可能是日志文件已移动，或该来源暂未暴露原始 JSONL' : '可能是这段日志只包含工具调用、统计记录，或该来源暂未暴露对话正文'}
          className="py-10"
        />
      ) : events.length === 0 ? (
        <EmptyState title={mode === 'raw' ? '没有匹配事件' : '没有匹配消息'} hint="换个关键词或清空搜索" className="py-10" />
      ) : mode === 'raw' ? (
        <>
          <LimitNotice count={totalEvents} limit={limit} mode={mode} />
          <RawEventList events={events} />
        </>
      ) : (
        <>
          <LimitNotice count={totalEvents} limit={limit} mode={mode} />
          <ConversationEventList events={events} className="max-h-[520px]" compact />
        </>
      )}
    </div>
  )
}

function LimitNotice({ count, limit, mode }: { count: number; limit: number; mode: 'replay' | 'raw' }) {
  if (!limit || count < limit) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
      已限制显示前 {formatNumber(limit)} 条{mode === 'raw' ? '原始事件' : '回放事件'}，避免长会话拖慢界面。
    </div>
  )
}

function RawEventList({ events }: { events: ReplayEvent[] }) {
  return (
    <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
      {events.map((event) => (
        <li key={event.id} className="rounded-xl border border-slate-200 bg-slate-950 p-3 dark:border-slate-700">
          <EventHeader event={event} dark />
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-200">
            {stringify(event.raw ?? { rawRef: event.rawRef, note: '原始 JSON 未随本次回放加载' })}
          </pre>
        </li>
      ))}
    </ul>
  )
}

function EventHeader({ event, dark = false }: { event: ReplayEvent; dark?: boolean }) {
  const Icon =
    event.type === 'tool_call' || event.type === 'tool_result'
      ? TerminalSquare
      : event.type === 'token_usage'
        ? Hash
        : event.role === 'event'
          ? TerminalSquare
          : MessageSquare
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className={cn('h-3.5 w-3.5', dark ? 'text-slate-400' : 'text-slate-400')} />
      <span className={cn('font-medium', dark ? 'text-slate-200' : 'text-slate-700 dark:text-slate-200')}>
        {eventLabel(event)}
      </span>
      {event.model && (
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          {event.model}
        </span>
      )}
      <span className={cn('ml-auto tabular-nums', dark ? 'text-slate-500' : 'text-slate-400')}>
        {formatTime(event.timestamp)}
      </span>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(stringify(event.raw ?? event.rawRef))}
        className={cn('rounded p-1 transition', dark ? 'text-slate-500 hover:text-slate-200' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200')}
        title="复制原始 JSON"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  )
}

function eventLabel(event: ReplayEvent) {
  if (event.type === 'tool_call') return event.toolName ? `调用 ${event.toolName}` : '工具调用'
  if (event.type === 'tool_result') return event.toolName ? `${event.toolName} 结果` : '工具结果'
  if (event.type === 'token_usage') return 'Token 用量'
  if (event.type === 'metadata') return event.content ?? '元数据'
  if (event.type === 'error') return event.content ?? '错误'
  if (event.role === 'user') return '用户'
  if (event.role === 'assistant') return '助手'
  if (event.role === 'system') return '系统'
  return '事件'
}

function stringify(value: unknown) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
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

function replayWindowFromRequests(records: RequestRecord[]): Pick<ReplaySessionOptions, 'from' | 'to'> {
  if (!records.length) return {}
  const times = records
    .map((record) => new Date(record.timestamp).getTime())
    .filter(Number.isFinite)
  if (!times.length) return {}
  return {
    from: new Date(Math.min(...times) - REPLAY_WINDOW_BEFORE_MS).toISOString(),
    to: new Date(Math.max(...times) + REPLAY_WINDOW_AFTER_MS).toISOString(),
  }
}

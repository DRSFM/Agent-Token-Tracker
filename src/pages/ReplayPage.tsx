import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Braces, Clock3, GripVertical, Hash, Maximize2, MessageSquare, Minimize2, Search, X } from 'lucide-react'
import { RangeSelect } from '@/components/filters/RangeSelect'
import { SourceTabs, type SourceFilter } from '@/components/filters/SourceTabs'
import { SourceBadge } from '@/components/filters/SourceBadge'
import { ConversationEventList } from '@/components/replay/ConversationView'
import { OpenAIMessageList, flattenEventForSearch } from '@/components/replay/OpenAIMessageView'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAllRequests } from '@/hooks/useAllRequests'
import { aggregateSessions, inRange, lastNDays, type SessionAggregate } from '@/lib/aggregations'
import { api } from '@/lib/api'
import { formatNumber, formatRelativeMinutes } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ReplayEvent, ReplaySessionOptions, RequestRecord } from '@/types/api'

const REPLAY_LIMIT = 1200
const REPLAY_WINDOW_BEFORE_MS = 30 * 60 * 1000
const REPLAY_WINDOW_AFTER_MS = 5 * 60 * 1000

const FOCUS_WIDTH_KEY = 'replay.focus.width'
const FOCUS_WIDTH_DEFAULT = 1024
const FOCUS_WIDTH_MIN = 480

const FOCUS_FONT_KEY = 'replay.focus.fontSize'
const FOCUS_FONT_DEFAULT = 15
const FOCUS_FONT_OPTIONS: { label: string; px: number }[] = [
  { label: '小', px: 13 },
  { label: '中', px: 15 },
  { label: '大', px: 17 },
  { label: '特大', px: 19 },
]

const FOCUS_FAMILY_CN_KEY = 'replay.focus.fontFamilyZh'
const FOCUS_FAMILY_EN_KEY = 'replay.focus.fontFamilyEn'
const FOCUS_FAMILY_CN_OPTIONS: { label: string; stack: string }[] = [
  { label: '宋体', stack: '"SimSun", "宋体"' },
  { label: '微软雅黑', stack: '"Microsoft YaHei", "微软雅黑"' },
  { label: '黑体', stack: '"SimHei", "黑体"' },
  { label: '楷体', stack: '"KaiTi", "楷体"' },
  { label: '仿宋', stack: '"FangSong", "仿宋"' },
]
const FOCUS_FAMILY_EN_OPTIONS: { label: string; stack: string }[] = [
  { label: 'Times New Roman', stack: '"Times New Roman", Times' },
  { label: 'Arial', stack: 'Arial, Helvetica' },
  { label: 'Helvetica', stack: 'Helvetica, Arial' },
  { label: 'Georgia', stack: 'Georgia, serif' },
  { label: 'Courier New', stack: '"Courier New", monospace' },
]
const FOCUS_FAMILY_CN_DEFAULT = FOCUS_FAMILY_CN_OPTIONS[0].label
const FOCUS_FAMILY_EN_DEFAULT = FOCUS_FAMILY_EN_OPTIONS[0].label

const VIEW_MODE_KEY = 'replay.viewMode'
type ViewMode = 'standard' | 'openai'

export default function ReplayPage() {
  const [days, setDays] = useState(30)
  const [source, setSource] = useState<SourceFilter>('all')
  const [sessionQuery, setSessionQuery] = useState('')
  const [messageQuery, setMessageQuery] = useState('')
  const [events, setEvents] = useState<ReplayEvent[] | null>(null)
  const [loadingReplay, setLoadingReplay] = useState(false)
  const [replayError, setReplayError] = useState<unknown>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'standard'
    const saved = window.localStorage.getItem(VIEW_MODE_KEY)
    return saved === 'openai' ? 'openai' : 'standard'
  })
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  const selectedId = searchParams.get('sid')
  const { data, loading, error, refresh } = useAllRequests()

  const range = useMemo(() => lastNDays(days), [days])
  const visibleRecords = useMemo(() => {
    if (!data) return []
    const ranged = data.filter((record) => inRange(record, range))
    return source === 'all' ? ranged : ranged.filter((record) => record.source === source)
  }, [data, range, source])

  const sessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase()
    return aggregateSessions(visibleRecords)
      .filter((session) =>
        !q ||
        session.title.toLowerCase().includes(q) ||
        session.sessionId.toLowerCase().includes(q) ||
        session.models.some((model) => model.model.toLowerCase().includes(q)))
      .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
  }, [visibleRecords, sessionQuery])

  const selected = useMemo(() => {
    if (!sessions.length) return null
    return sessions.find((session) => session.sessionId === selectedId) ?? sessions[0]
  }, [sessions, selectedId])

  const selectedRecords = useMemo(
    () => (selected ? visibleRecords.filter((record) => record.sessionId === selected.sessionId) : []),
    [selected, visibleRecords],
  )

  const conversationOnly = viewMode === 'standard'
  const replayOptions = useMemo<ReplaySessionOptions>(() => ({
    ...replayWindowFromRequests(selectedRecords),
    includeRaw: false,
    conversationOnly,
    limit: REPLAY_LIMIT,
  }), [selectedRecords, conversationOnly])
  const selectedSessionId = selected?.sessionId
  const selectedSource = selected?.source
  const replayFrom = replayOptions.from
  const replayTo = replayOptions.to

  const replayKey = selected
    ? [
      selected.sessionId,
      selected.source,
      replayFrom ?? '',
      replayTo ?? '',
      REPLAY_LIMIT,
      conversationOnly ? 'conv' : 'all',
    ].join('|')
    : ''

  useEffect(() => {
    if (!sessions.length || selectedId) return
    selectSession(sessions[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, selectedId])

  useEffect(() => {
    if (!selectedSessionId || !selectedSource || loadedKey === replayKey) return
    let cancelled = false
    setEvents(null)
    setLoadingReplay(true)
    setReplayError(null)
    void api.getReplaySession(selectedSessionId, selectedSource, {
      from: replayFrom,
      to: replayTo,
      includeRaw: false,
      conversationOnly,
      limit: REPLAY_LIMIT,
    })
      .then((nextEvents) => {
        if (!cancelled) {
          setEvents(nextEvents)
          setLoadedKey(replayKey)
        }
      })
      .catch((nextError) => {
        if (!cancelled) setReplayError(nextError)
      })
      .finally(() => {
        if (!cancelled) setLoadingReplay(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadedKey, replayFrom, replayKey, replayTo, selectedSessionId, selectedSource, conversationOnly])

  const filteredEvents = useMemo(() => {
    if (!events) return []
    const q = messageQuery.trim().toLowerCase()
    if (!q) return events
    if (viewMode === 'openai') {
      return events.filter((event) => flattenEventForSearch(event).includes(q))
    }
    return events.filter((event) =>
      [event.content, event.model, event.role].some((value) => value?.toLowerCase().includes(q)),
    )
  }, [events, messageQuery, viewMode])

  const selectSession = (session: SessionAggregate) => {
    const next = new URLSearchParams(searchParams)
    next.set('sid', session.sessionId)
    next.set('source', session.source)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex h-[calc(100vh-5.5rem)] min-h-[640px] flex-col gap-4 pt-2">
      {focusMode && selected && (
        <ReplayFocusOverlay
          session={selected}
          events={filteredEvents}
          loading={loadingReplay}
          error={replayError}
          messageQuery={messageQuery}
          setMessageQuery={setMessageQuery}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onClose={() => setFocusMode(false)}
          onRetry={() => {
            setLoadedKey(null)
            setEvents(null)
          }}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-50">回放</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            像聊天记录一样阅读历史会话，只展示输入与回复
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SourceTabs value={source} onChange={setSource} />
          <RangeSelect value={days} onChange={setDays} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col rounded-2xl border border-slate-200/70 bg-white/90 shadow-card backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-card-dark">
          <div className="border-b border-slate-100 px-4 py-4 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder="搜索会话 / 模型 / ID"
                className="h-9 w-full rounded-xl border border-transparent bg-slate-100/80 pl-8 pr-8 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500/30 dark:bg-slate-800/70 dark:text-slate-200"
              />
              {sessionQuery && (
                <button
                  type="button"
                  onClick={() => setSessionQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {error ? (
              <ErrorState error={error} onRetry={refresh} className="py-10" />
            ) : loading && !data ? (
              <LoadingState />
            ) : sessions.length === 0 ? (
              <EmptyState
                title={sessionQuery ? '没有匹配的会话' : '当前时间窗内暂无会话'}
                hint={sessionQuery ? '换个关键词或清空搜索' : '尝试调整时间范围 / 来源筛选'}
                className="py-10"
              />
            ) : (
              <ul className="space-y-1">
                {sessions.map((session) => (
                  <SessionReplayRow
                    key={session.sessionId}
                    session={session}
                    active={session.sessionId === selected?.sessionId}
                    onClick={() => selectSession(session)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200/70 bg-white/90 shadow-card backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-card-dark">
          {selected ? (
            <>
              <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-brand-500" />
                      <h3 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {selected.title}
                      </h3>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-slate-400">
                      {selected.sessionId}
                    </div>
                  </div>
                  <SourceBadge source={selected.source} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <ReplayMetric icon={MessageSquare} label="消息" value={formatNumber(events?.length ?? 0)} />
                  <ReplayMetric icon={Hash} label="请求" value={formatNumber(selected.requestCount)} />
                  <ReplayMetric icon={Hash} label="Tokens" value={formatNumber(selected.totalTokens)} />
                  <ReplayMetric icon={Clock3} label="最近" value={formatRelativeMinutes(selected.lastActiveAt)} />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={messageQuery}
                      onChange={(event) => setMessageQuery(event.target.value)}
                      placeholder={viewMode === 'openai' ? '搜索消息 / 工具调用 / 参数' : '搜索我的输入 / 助手回复'}
                      className="h-10 w-full rounded-xl border border-transparent bg-slate-100/80 pl-10 pr-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500/30 dark:bg-slate-800/70 dark:text-slate-200"
                    />
                  </div>
                  <ViewModeToggle value={viewMode} onChange={setViewMode} />
                  <button
                    type="button"
                    onClick={() => setFocusMode(true)}
                    disabled={!selected || loadingReplay || !!replayError || (events?.length ?? 0) === 0}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-medium text-brand-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-900 dark:text-brand-300 dark:ring-slate-700"
                    title="进入沉浸回放"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    全屏
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 px-4 py-5 md:px-8">
                {replayError ? (
                  <ErrorState
                    error={replayError}
                    onRetry={() => {
                      setLoadedKey(null)
                      setEvents(null)
                    }}
                    className="py-16"
                  />
                ) : loadingReplay ? (
                  <LoadingState label="正在整理对话回放…" />
                ) : (events?.length ?? 0) === 0 ? (
                  <EmptyState
                    title="没有可回放的对话"
                    hint="这段日志可能只包含统计记录、工具调用，或该来源未暴露正文"
                    className="py-16"
                  />
                ) : filteredEvents.length === 0 ? (
                  <EmptyState title="没有匹配消息" hint="换个关键词或清空搜索" className="py-16" />
                ) : viewMode === 'openai' ? (
                  <OpenAIMessageList
                    events={filteredEvents}
                    className="h-full"
                  />
                ) : (
                  <ConversationEventList
                    events={filteredEvents}
                    className="h-full space-y-6"
                    compact={false}
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              title="选择会话开始回放"
              hint="左侧选择任意历史会话，这里会以聊天记录形式展示输入和回复"
              className="py-24"
            />
          )}
        </section>
      </div>
    </div>
  )
}

function ReplayFocusOverlay({
  session,
  events,
  loading,
  error,
  messageQuery,
  setMessageQuery,
  viewMode,
  setViewMode,
  onClose,
  onRetry,
}: {
  session: SessionAggregate
  events: ReplayEvent[]
  loading: boolean
  error: unknown
  messageQuery: string
  setMessageQuery: (value: string) => void
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  onClose: () => void
  onRetry: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const [widthPx, setWidthPx] = useState<number>(() => {
    if (typeof window === 'undefined') return FOCUS_WIDTH_DEFAULT
    const saved = Number(window.localStorage.getItem(FOCUS_WIDTH_KEY))
    return Number.isFinite(saved) && saved >= FOCUS_WIDTH_MIN ? saved : FOCUS_WIDTH_DEFAULT
  })
  const [fontPx, setFontPx] = useState<number>(() => {
    if (typeof window === 'undefined') return FOCUS_FONT_DEFAULT
    const saved = Number(window.localStorage.getItem(FOCUS_FONT_KEY))
    return FOCUS_FONT_OPTIONS.some((option) => option.px === saved) ? saved : FOCUS_FONT_DEFAULT
  })
  const [familyCn, setFamilyCn] = useState<string>(() => {
    if (typeof window === 'undefined') return FOCUS_FAMILY_CN_DEFAULT
    const saved = window.localStorage.getItem(FOCUS_FAMILY_CN_KEY) ?? ''
    return FOCUS_FAMILY_CN_OPTIONS.some((option) => option.label === saved) ? saved : FOCUS_FAMILY_CN_DEFAULT
  })
  const [familyEn, setFamilyEn] = useState<string>(() => {
    if (typeof window === 'undefined') return FOCUS_FAMILY_EN_DEFAULT
    const saved = window.localStorage.getItem(FOCUS_FAMILY_EN_KEY) ?? ''
    return FOCUS_FAMILY_EN_OPTIONS.some((option) => option.label === saved) ? saved : FOCUS_FAMILY_EN_DEFAULT
  })
  const [maxWidthPx, setMaxWidthPx] = useState<number>(typeof window === 'undefined' ? 1920 : window.innerWidth)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(FOCUS_WIDTH_KEY, String(Math.round(widthPx)))
  }, [widthPx])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(FOCUS_FONT_KEY, String(fontPx))
  }, [fontPx])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(FOCUS_FAMILY_CN_KEY, familyCn)
  }, [familyCn])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(FOCUS_FAMILY_EN_KEY, familyEn)
  }, [familyEn])

  const fontFamilyStack = (() => {
    const enOption = FOCUS_FAMILY_EN_OPTIONS.find((option) => option.label === familyEn) ?? FOCUS_FAMILY_EN_OPTIONS[0]
    const cnOption = FOCUS_FAMILY_CN_OPTIONS.find((option) => option.label === familyCn) ?? FOCUS_FAMILY_CN_OPTIONS[0]
    return `${enOption.stack}, ${cnOption.stack}, sans-serif`
  })()

  useEffect(() => {
    const measure = () => {
      if (stageRef.current) setMaxWidthPx(stageRef.current.clientWidth)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const startDrag = (event: React.MouseEvent, side: 'left' | 'right') => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = widthPx
    const sign = side === 'right' ? 1 : -1
    const max = stageRef.current?.clientWidth ?? window.innerWidth
    const onMove = (e: MouseEvent) => {
      const delta = (e.clientX - startX) * 2 * sign
      const next = Math.min(max, Math.max(FOCUS_WIDTH_MIN, startWidth + delta))
      setWidthPx(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50/95 p-5 backdrop-blur-xl dark:bg-slate-950/95">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-brand-500" />
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
              {session.title}
            </h2>
            <SourceBadge source={session.source} />
          </div>
          <div className="mt-1 truncate font-mono text-xs text-slate-400">
            {session.sessionId}
          </div>
        </div>

        <div className="flex min-w-[320px] max-w-6xl flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={messageQuery}
              onChange={(event) => setMessageQuery(event.target.value)}
              placeholder={viewMode === 'openai' ? '搜索消息 / 工具调用 / 参数' : '搜索我的输入 / 助手回复'}
              className="h-10 w-full rounded-xl border border-slate-200/70 bg-white/85 pl-10 pr-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200"
            />
          </div>
          <ViewModeToggle value={viewMode} onChange={setViewMode} compact />

          <div
            className="hidden h-10 shrink-0 items-center gap-1 rounded-xl bg-white px-2 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700 lg:flex"
            title="切换对话字号"
          >
            <span className="px-1 text-xs text-slate-500 dark:text-slate-400">字号</span>
            {FOCUS_FONT_OPTIONS.map((option) => (
              <button
                key={option.px}
                type="button"
                onClick={() => setFontPx(option.px)}
                className={cn(
                  'inline-flex h-7 min-w-[28px] items-center justify-center rounded-md px-2 text-xs font-medium transition',
                  fontPx === option.px
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
                title={`${option.label}（${option.px}px）`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div
            className="hidden h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-2.5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700 xl:flex"
            title="选择中英文字体"
          >
            <span className="text-xs text-slate-500 dark:text-slate-400">中</span>
            <select
              value={familyCn}
              onChange={(event) => setFamilyCn(event.target.value)}
              className="h-7 rounded-md bg-transparent px-1 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-brand-500/30 dark:text-slate-200"
              style={{ fontFamily: (FOCUS_FAMILY_CN_OPTIONS.find((option) => option.label === familyCn) ?? FOCUS_FAMILY_CN_OPTIONS[0]).stack }}
            >
              {FOCUS_FAMILY_CN_OPTIONS.map((option) => (
                <option key={option.label} value={option.label} style={{ fontFamily: option.stack }}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-300 dark:text-slate-600">|</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">英</span>
            <select
              value={familyEn}
              onChange={(event) => setFamilyEn(event.target.value)}
              className="h-7 rounded-md bg-transparent px-1 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-brand-500/30 dark:text-slate-200"
              style={{ fontFamily: (FOCUS_FAMILY_EN_OPTIONS.find((option) => option.label === familyEn) ?? FOCUS_FAMILY_EN_OPTIONS[0]).stack }}
            >
              {FOCUS_FAMILY_EN_OPTIONS.map((option) => (
                <option key={option.label} value={option.label} style={{ fontFamily: option.stack }}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div
            className="hidden h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700 md:flex"
            title="拖动调整对话宽度"
          >
            <span className="text-xs text-slate-500 dark:text-slate-400">宽度</span>
            <input
              type="range"
              min={FOCUS_WIDTH_MIN}
              max={Math.max(FOCUS_WIDTH_MIN + 1, Math.round(maxWidthPx))}
              step={20}
              value={Math.min(Math.round(widthPx), Math.round(maxWidthPx))}
              onChange={(event) => setWidthPx(Number(event.target.value))}
              className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-500 dark:bg-slate-700"
            />
            <span className="w-10 text-right font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {Math.round(widthPx)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:text-brand-600 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"
            title="退出沉浸回放（Esc）"
          >
            <Minimize2 className="h-4 w-4" />
            退出
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-5 shadow-card dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-card-dark md:px-6"
      >
        {error ? (
          <ErrorState error={error} onRetry={onRetry} className="py-24" />
        ) : loading ? (
          <LoadingState label="正在整理对话回放…" />
        ) : events.length === 0 ? (
          <EmptyState title="没有可回放的对话" hint="这段日志可能只包含统计记录、工具调用，或该来源未暴露正文" className="py-24" />
        ) : (
          <div
            className="relative mx-auto h-full"
            style={{ width: `min(${Math.round(widthPx)}px, 100%)` }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖拽调整对话宽度"
              onMouseDown={(event) => startDrag(event, 'left')}
              className="group absolute left-0 top-1/2 z-20 flex h-20 w-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white shadow-md ring-1 ring-slate-300 transition hover:bg-brand-500 hover:ring-brand-500 dark:bg-slate-800 dark:ring-slate-600 dark:hover:bg-brand-500 dark:hover:ring-brand-500"
              title="拖拽调整对话宽度"
            >
              <GripVertical className="h-4 w-4 text-slate-500 transition group-hover:text-white dark:text-slate-300" />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖拽调整对话宽度"
              onMouseDown={(event) => startDrag(event, 'right')}
              className="group absolute right-0 top-1/2 z-20 flex h-20 w-5 translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white shadow-md ring-1 ring-slate-300 transition hover:bg-brand-500 hover:ring-brand-500 dark:bg-slate-800 dark:ring-slate-600 dark:hover:bg-brand-500 dark:hover:ring-brand-500"
              title="拖拽调整对话宽度"
            >
              <GripVertical className="h-4 w-4 text-slate-500 transition group-hover:text-white dark:text-slate-300" />
            </div>
            {viewMode === 'openai' ? (
              <OpenAIMessageList
                events={events}
                className="h-full"
                fontSize={fontPx}
                fontFamily={fontFamilyStack}
              />
            ) : (
              <ConversationEventList
                events={events}
                className="h-full space-y-6"
                compact={false}
                fontSize={fontPx}
                fontFamily={fontFamilyStack}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ViewModeToggle({
  value,
  onChange,
  compact = false,
}: {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  compact?: boolean
}) {
  const items: { key: ViewMode; label: string; icon: typeof MessageSquare; title: string }[] = [
    { key: 'standard', label: '标准', icon: MessageSquare, title: '标准对话视图：仅展示用户和助手的最终输出' },
    { key: 'openai', label: 'OpenAI', icon: Braces, title: 'OpenAI Message 格式：展示工具调用 / 参数 / 结果' },
  ]
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center rounded-xl bg-white p-0.5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700',
        compact ? 'h-10' : 'h-10',
      )}
      title="切换对话展示模式"
    >
      {items.map((item) => {
        const Icon = item.icon
        const active = value === item.key
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            title={item.title}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition',
              active
                ? 'bg-brand-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function SessionReplayRow({
  session,
  active,
  onClick,
}: {
  session: SessionAggregate
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full rounded-xl px-3 py-3 text-left transition',
          active
            ? 'bg-brand-500/10 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
            : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/50',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{session.title}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
              <span>{formatNumber(session.requestCount)} 请求</span>
              <span>{formatRelativeMinutes(session.lastActiveAt)}</span>
            </div>
          </div>
          <SourceBadge source={session.source} />
        </div>
      </button>
    </li>
  )
}

function ReplayMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MessageSquare
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
        {value}
      </div>
    </div>
  )
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

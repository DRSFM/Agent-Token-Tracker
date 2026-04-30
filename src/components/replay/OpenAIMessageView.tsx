import { useMemo } from 'react'
import { Hammer, MessageCircle, Settings2, Wrench } from 'lucide-react'
import type { ReplayEvent } from '@/types/api'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type OpenAIRole = 'user' | 'assistant' | 'system' | 'tool'

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAIMessage {
  /** 来源事件 id，便于 React key */
  id: string
  role: OpenAIRole
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
  /** 渲染辅助字段（不参与 OpenAI 协议），用于角标 */
  _model?: string
  _timestamp: string
  _kind: 'message' | 'tool_call' | 'tool_result' | 'metadata' | 'error'
}

export function OpenAIMessageList({
  events,
  className,
  fontSize,
  fontFamily,
}: {
  events: ReplayEvent[]
  className?: string
  fontSize?: number
  fontFamily?: string
}) {
  const messages = useMemo(() => convertEventsToOpenAIMessages(events), [events])

  const inlineStyle: { fontSize?: string; fontFamily?: string } = {}
  if (fontSize) inlineStyle.fontSize = `${fontSize}px`
  if (fontFamily) inlineStyle.fontFamily = fontFamily

  return (
    <ul
      className={cn('space-y-3 overflow-y-auto pr-1', className)}
      style={Object.keys(inlineStyle).length ? inlineStyle : undefined}
    >
      {messages.map((message) => (
        <li key={message.id}>
          <OpenAIMessageCard message={message} />
        </li>
      ))}
    </ul>
  )
}

function OpenAIMessageCard({ message }: { message: OpenAIMessage }) {
  const palette = rolePalette(message.role, message._kind)
  const Icon = palette.icon
  return (
    <article
      className={cn(
        'rounded-2xl border bg-white/90 shadow-sm transition dark:bg-slate-900/80',
        palette.cardBorder,
      )}
    >
      <header
        className={cn(
          'flex items-center gap-2 rounded-t-2xl border-b px-3 py-2 text-xs',
          palette.headerBg,
          palette.headerBorder,
        )}
      >
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold',
            palette.badge,
          )}
        >
          <Icon className="h-3 w-3" />
          {message.role}
        </span>
        {message.name && (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            name: {message.name}
          </span>
        )}
        {message.tool_call_id && (
          <span className="truncate rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            id: {message.tool_call_id}
          </span>
        )}
        {message._model && (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            {message._model}
          </span>
        )}
        <span className="ml-auto tabular-nums text-slate-400 dark:text-slate-500">
          {formatTime(message._timestamp)}
        </span>
      </header>

      <div className="space-y-3 px-3 py-3">
        {message.content !== null && message.content !== undefined && message.content !== '' && (
          <Field label="content">
            <ContentBlock value={message.content} />
          </Field>
        )}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <Field label="tool_calls">
            <ul className="space-y-2">
              {message.tool_calls.map((call) => (
                <li
                  key={call.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/80 p-2 dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-mono text-slate-500 dark:text-slate-400">
                      function
                    </span>
                    <span className="rounded-md bg-brand-500/10 px-1.5 py-0.5 font-mono text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                      {call.function.name}
                    </span>
                    <span className="ml-auto truncate font-mono text-slate-400">
                      id: {call.id}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Field label="arguments" tight>
                      <ContentBlock value={call.function.arguments} prettyJson />
                    </Field>
                  </div>
                </li>
              ))}
            </ul>
          </Field>
        )}
      </div>
    </article>
  )
}

function Field({ label, children, tight = false }: { label: string; children: React.ReactNode; tight?: boolean }) {
  return (
    <div className={tight ? 'space-y-1' : 'space-y-1.5'}>
      <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      {children}
    </div>
  )
}

function ContentBlock({ value, prettyJson = false }: { value: string; prettyJson?: boolean }) {
  const looksJson = prettyJson || isJsonish(value)
  if (looksJson) {
    const formatted = tryPrettyJson(value)
    return (
      <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[12px] leading-5 text-slate-100">
        <code>{formatted}</code>
      </pre>
    )
  }
  return (
    <div className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 leading-7 text-slate-800 dark:bg-slate-800/60 dark:text-slate-100">
      {value}
    </div>
  )
}

function rolePalette(role: OpenAIRole, kind: OpenAIMessage['_kind']) {
  if (role === 'user') {
    return {
      icon: MessageCircle,
      badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      headerBg: 'bg-emerald-50/60 dark:bg-emerald-500/5',
      headerBorder: 'border-emerald-100 dark:border-emerald-500/20',
      cardBorder: 'border-emerald-200/70 dark:border-emerald-500/20',
    }
  }
  if (role === 'assistant') {
    return {
      icon: kind === 'tool_call' ? Wrench : MessageCircle,
      badge: 'bg-brand-500/15 text-brand-700 dark:text-brand-300',
      headerBg: 'bg-brand-50/70 dark:bg-brand-500/5',
      headerBorder: 'border-brand-100 dark:border-brand-500/20',
      cardBorder: 'border-brand-200/70 dark:border-brand-500/25',
    }
  }
  if (role === 'tool') {
    return {
      icon: Hammer,
      badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      headerBg: 'bg-amber-50/70 dark:bg-amber-500/5',
      headerBorder: 'border-amber-100 dark:border-amber-500/20',
      cardBorder: 'border-amber-200/70 dark:border-amber-500/25',
    }
  }
  return {
    icon: Settings2,
    badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-200',
    headerBg: 'bg-slate-50 dark:bg-slate-800/40',
    headerBorder: 'border-slate-100 dark:border-slate-700',
    cardBorder: 'border-slate-200 dark:border-slate-700',
  }
}

function convertEventsToOpenAIMessages(events: ReplayEvent[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = []

  for (const event of events) {
    if (event.type === 'message') {
      const role: OpenAIRole = event.role === 'assistant'
        ? 'assistant'
        : event.role === 'system'
          ? 'system'
          : 'user'
      out.push({
        id: event.id,
        role,
        content: event.content ?? '',
        _model: event.model,
        _timestamp: event.timestamp,
        _kind: 'message',
      })
      continue
    }

    if (event.type === 'tool_call') {
      out.push({
        id: event.id,
        role: 'assistant',
        content: event.content && event.content.trim() !== '' ? event.content : null,
        tool_calls: [
          {
            id: event.id,
            type: 'function',
            function: {
              name: event.toolName ?? 'tool',
              arguments: stringifyArg(event.toolInput),
            },
          },
        ],
        _model: event.model,
        _timestamp: event.timestamp,
        _kind: 'tool_call',
      })
      continue
    }

    if (event.type === 'tool_result') {
      out.push({
        id: event.id,
        role: 'tool',
        name: event.toolName,
        tool_call_id: event.id,
        content: stringifyArg(event.toolOutput ?? event.content ?? ''),
        _timestamp: event.timestamp,
        _kind: 'tool_result',
      })
      continue
    }

    if (event.type === 'error') {
      out.push({
        id: event.id,
        role: 'system',
        content: event.content ?? '(error)',
        _timestamp: event.timestamp,
        _kind: 'error',
      })
      continue
    }

    if (event.type === 'metadata') {
      if (!event.content) continue
      out.push({
        id: event.id,
        role: 'system',
        content: event.content,
        _timestamp: event.timestamp,
        _kind: 'metadata',
      })
      continue
    }
    // token_usage 等其他类型暂不展示
  }

  return out
}

function stringifyArg(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function tryPrettyJson(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return value
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return value
  }
}

function isJsonish(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

/** 将 ReplayEvent[] 转换为可被搜索过滤的扁平字符串（供搜索逻辑复用） */
export function flattenEventForSearch(event: ReplayEvent): string {
  const parts: string[] = [
    event.content ?? '',
    event.model ?? '',
    event.role ?? '',
    event.toolName ?? '',
    typeof event.toolInput === 'string' ? event.toolInput : event.toolInput ? safeJson(event.toolInput) : '',
    typeof event.toolOutput === 'string' ? event.toolOutput : event.toolOutput ? safeJson(event.toolOutput) : '',
  ]
  return parts.join('\n').toLowerCase()
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

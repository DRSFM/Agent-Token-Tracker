import { useMemo } from 'react'
import katex from 'katex'
import type { ReplayEvent } from '@/types/api'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'image'; alt: string; url: string }
  | { type: 'math'; tex: string }

export function ConversationEventList({
  events,
  className,
  compact = true,
  fontSize,
  fontFamily,
}: {
  events: ReplayEvent[]
  className?: string
  compact?: boolean
  fontSize?: number
  fontFamily?: string
}) {
  return (
    <ul className={cn('space-y-4 overflow-y-auto pr-1', className)}>
      {events.map((event) => (
        <li
          key={event.id}
          className={cn('flex', event.role === 'user' ? 'justify-end' : 'justify-start')}
        >
          <MessageBubble event={event} compact={compact} fontSize={fontSize} fontFamily={fontFamily} />
        </li>
      ))}
    </ul>
  )
}

export function MessageBubble({
  event,
  compact = false,
  fontSize,
  fontFamily,
}: {
  event: ReplayEvent
  compact?: boolean
  fontSize?: number
  fontFamily?: string
}) {
  const isUser = event.role === 'user'
  const inlineStyle: { fontSize?: string; fontFamily?: string } = {}
  if (fontSize) inlineStyle.fontSize = `${fontSize}px`
  if (fontFamily) inlineStyle.fontFamily = fontFamily
  const hasInline = Object.keys(inlineStyle).length > 0
  return (
    <article
      style={hasInline ? inlineStyle : undefined}
      className={cn(
        'max-w-[92%] rounded-2xl px-4 py-3 shadow-sm ring-1',
        !fontSize && (compact ? 'text-sm' : 'text-[15px]'),
        isUser
          ? 'rounded-tr-md bg-slate-100 text-slate-800 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700'
          : 'rounded-tl-md bg-white/85 text-slate-800 ring-slate-200 dark:bg-slate-900/85 dark:text-slate-100 dark:ring-slate-700',
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
        <span className="font-medium text-slate-500 dark:text-slate-300">
          {isUser ? '我' : '助手'}
        </span>
        {event.model && !isUser && (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            {event.model}
          </span>
        )}
        <span className="ml-auto tabular-nums">{formatTime(event.timestamp)}</span>
      </div>
      <MessageContent text={event.content ?? ''} />
      {event.attachments && event.attachments.length > 0 && (
        <div className="mt-3 grid gap-2">
          {event.attachments.map((attachment, index) => (
            <a
              key={`${attachment.url.slice(0, 48)}-${index}`}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
            >
              <img
                src={attachment.url}
                alt={attachment.title ?? `image-${index + 1}`}
                className="max-h-96 w-full object-contain"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
    </article>
  )
}

function MessageContent({ text }: { text: string }) {
  const cleaned = stripImageTags(text)
  const blocks = splitCodeFences(cleaned)
  return (
    <div className="space-y-3 leading-7">
      {blocks.map((block, index) => (
        block.type === 'code' ? (
          <pre
            key={index}
            className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-100"
          >
            <code>{block.text}</code>
          </pre>
        ) : <MarkdownText key={index} text={block.text} />
      ))}
    </div>
  )
}

function stripImageTags(text: string) {
  return text
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, '')
    .replace(/<image\b[^>]*\/>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function MarkdownText({ text }: { text: string }) {
  const nodes = splitTables(text)
  return (
    <div className="space-y-2">
      {nodes.map((node, index) => (
        node.type === 'table' ? (
          <div key={index} className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100/80 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  {node.headers.map((header, headerIndex) => (
                    <th key={headerIndex} className="border-b border-slate-200 px-3 py-2 font-medium dark:border-slate-700">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="odd:bg-white/50 dark:odd:bg-slate-900/30">
                    {node.headers.map((_, cellIndex) => (
                      <td key={cellIndex} className="border-t border-slate-100 px-3 py-2 align-top dark:border-slate-800">
                        {row[cellIndex] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <BlockMathAwareText key={index} text={node.text} />
        )
      ))}
    </div>
  )
}

function BlockMathAwareText({ text }: { text: string }) {
  const segments = splitBlockMath(text)
  return (
    <div className="space-y-2">
      {segments.map((segment, index) =>
        segment.type === 'math' ? (
          <BlockMath key={index} tex={segment.tex} />
        ) : (
          <div key={index} className="space-y-2">
            {segment.text.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
              <InlineParagraph key={paragraphIndex} text={paragraph} />
            ))}
          </div>
        ),
      )}
    </div>
  )
}

function InlineParagraph({ text }: { text: string }) {
  if (!text.trim()) return null
  const tokens = tokenizeInline(text)
  const hasBlockImage = tokens.some((t) => t.type === 'image')

  if (hasBlockImage) {
    return (
      <div className="space-y-2">
        {tokens.map((token, index) =>
          token.type === 'image' ? (
            <a
              key={`${token.url}-${index}`}
              href={token.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
            >
              <img
                src={token.url}
                alt={token.alt}
                className="max-h-96 w-full object-contain"
                loading="lazy"
              />
            </a>
          ) : token.type === 'math' ? (
            <p key={index} className="whitespace-pre-wrap break-words">
              <InlineMath tex={token.tex} />
            </p>
          ) : (
            <p key={index} className="whitespace-pre-wrap break-words">
              {token.text}
            </p>
          ),
        )}
      </div>
    )
  }

  return (
    <p className="whitespace-pre-wrap break-words">
      {tokens.map((token, index) =>
        token.type === 'math' ? (
          <InlineMath key={index} tex={token.tex} />
        ) : (
          <span key={index}>{token.type === 'text' ? token.text : ''}</span>
        ),
      )}
    </p>
  )
}

function BlockMath({ tex }: { tex: string }) {
  const html = useKatex(tex, true)
  if (!html) {
    return (
      <pre className="overflow-x-auto rounded-md bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        $${tex}$$
      </pre>
    )
  }
  return (
    <div
      className="my-1 overflow-x-auto text-slate-800 dark:text-slate-100"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function InlineMath({ tex }: { tex: string }) {
  const html = useKatex(tex, false)
  if (!html) return <code className="text-rose-500">${tex}$</code>
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function useKatex(tex: string, displayMode: boolean) {
  return useMemo(() => {
    const trimmed = tex.trim()
    if (!trimmed) return null
    try {
      return katex.renderToString(trimmed, {
        displayMode,
        throwOnError: false,
        output: 'html',
        strict: 'ignore',
        trust: false,
      })
    } catch {
      return null
    }
  }, [tex, displayMode])
}

function splitCodeFences(text: string) {
  const blocks: Array<{ type: 'text' | 'code'; text: string }> = []
  const regex = /```[^\n]*\n?([\s\S]*?)```/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    const before = text.slice(cursor, match.index).trim()
    if (before) blocks.push({ type: 'text', text: before })
    blocks.push({ type: 'code', text: match[1].trim() })
    cursor = match.index + match[0].length
  }
  const rest = text.slice(cursor).trim()
  if (rest) blocks.push({ type: 'text', text: rest })
  return blocks.length ? blocks : [{ type: 'text', text }]
}

function splitTables(text: string) {
  const lines = text.split('\n')
  const nodes: Array<{ type: 'text'; text: string } | { type: 'table'; headers: string[]; rows: string[][] }> = []
  let textBuffer: string[] = []
  let i = 0

  const flushText = () => {
    const value = textBuffer.join('\n').trim()
    if (value) nodes.push({ type: 'text', text: value })
    textBuffer = []
  }

  while (i < lines.length) {
    if (i + 1 < lines.length && isTableRow(lines[i]) && isTableSeparator(lines[i + 1])) {
      flushText()
      const headers = parseTableRow(lines[i])
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableRow(lines[i]))
        i += 1
      }
      nodes.push({ type: 'table', headers, rows })
      continue
    }
    textBuffer.push(lines[i])
    i += 1
  }

  flushText()
  return nodes.length ? nodes : [{ type: 'text' as const, text }]
}

function isTableRow(line: string) {
  return line.includes('|') && parseTableRow(line).length >= 2
}

function isTableSeparator(line: string) {
  const cells = parseTableRow(line)
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function splitBlockMath(text: string): Array<{ type: 'text'; text: string } | { type: 'math'; tex: string }> {
  const parts: Array<{ type: 'text'; text: string } | { type: 'math'; tex: string }> = []
  const regex = /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    if (match.index > cursor) parts.push({ type: 'text', text: text.slice(cursor, match.index) })
    const tex = (match[1] ?? match[2] ?? '').trim()
    if (tex) parts.push({ type: 'math', tex })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) })
  return parts.length ? parts : [{ type: 'text', text }]
}

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const regex = /!\[([^\]]*)\]\((\S+?)\)|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\w)/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    if (match.index > cursor) tokens.push({ type: 'text', text: text.slice(cursor, match.index) })
    if (match[2] !== undefined) {
      tokens.push({ type: 'image', alt: match[1] || 'image', url: match[2] })
    } else {
      const tex = (match[3] ?? match[4] ?? '').trim()
      if (tex) tokens.push({ type: 'math', tex })
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) tokens.push({ type: 'text', text: text.slice(cursor) })
  return tokens.length ? tokens : [{ type: 'text', text }]
}

import type { RequestRecord } from '@/types/api'
import { formatNumber, formatTime, isToday } from '@/lib/format'
import { Sparkles, Code2, Bot } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Props {
  data: RequestRecord[]
}

const sourceIcon: Record<string, LucideIcon> = {
  'claude-code': Sparkles,
  codex: Code2,
  unknown: Bot,
}

const sourceColor: Record<string, string> = {
  'claude-code': 'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300',
  codex: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300',
  unknown: 'bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300',
}

export function RecentRequests({ data }: Props) {
  return (
    <div className="overflow-hidden">
      <div className="grid grid-cols-[120px_1fr_80px_80px_80px] text-xs text-slate-400 px-2 py-2">
        <div>时间</div>
        <div>模型</div>
        <div className="text-right">输入</div>
        <div className="text-right">输出</div>
        <div className="text-right">总计</div>
      </div>
      <ul className="space-y-1">
        {data.map((r) => {
          const Icon = sourceIcon[r.source] ?? Bot
          return (
            <li
              key={r.id}
              className="grid grid-cols-[120px_1fr_80px_80px_80px] items-center text-sm px-2 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
            >
              <div className="text-slate-500 dark:text-slate-400 text-xs tabular-nums">
                {isToday(r.timestamp) ? '今天 ' : ''}
                {formatTime(r.timestamp)}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                    sourceColor[r.source] ?? sourceColor.unknown
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <span className="text-slate-700 dark:text-slate-200 truncate">{r.model}</span>
              </div>
              <div className="text-right tabular-nums text-slate-600 dark:text-slate-300">
                {formatNumber(r.inputTokens)}
              </div>
              <div className="text-right tabular-nums text-slate-600 dark:text-slate-300">
                {formatNumber(r.outputTokens)}
              </div>
              <div className="text-right tabular-nums font-medium text-slate-800 dark:text-slate-100">
                {formatNumber(r.totalTokens)}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

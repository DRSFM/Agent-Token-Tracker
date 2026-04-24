// 加载 / 空 / 错误 三态组件 — 供 Sessions/Models/Trends 等页面统一使用
import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg bg-slate-100 dark:bg-slate-800/60 animate-pulse',
        className,
      )}
    />
  )
}

export function LoadingState({ label = '加载中…', className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-sm text-slate-500 dark:text-slate-400 gap-2',
        className,
      )}
    >
      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      {label}
    </div>
  )
}

export function EmptyState({
  title = '暂无数据',
  hint,
  action,
  className,
}: {
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center gap-2',
        className,
      )}
    >
      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center mb-1">
        <Inbox className="w-5 h-5 text-slate-400" />
      </div>
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</div>
      {hint && (
        <div className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">{hint}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center gap-2',
        className,
      )}
    >
      <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-500/15 flex items-center justify-center mb-1">
        <AlertTriangle className="w-5 h-5 text-rose-500 dark:text-rose-400" />
      </div>
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">加载失败</div>
      <div className="text-xs text-slate-500 dark:text-slate-400 max-w-md break-all">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          重试
        </button>
      )}
    </div>
  )
}

/** 把 useAsync 结果封装成 loading/empty/error/success 渲染分支 */
export function AsyncBoundary<T>({
  state,
  isEmpty,
  emptyTitle,
  emptyHint,
  children,
  onRetry,
}: {
  state: { data: T | null; loading: boolean; error: unknown }
  isEmpty?: (data: T) => boolean
  emptyTitle?: ReactNode
  emptyHint?: ReactNode
  children: (data: T) => ReactNode
  onRetry?: () => void
}) {
  if (state.error) return <ErrorState error={state.error} onRetry={onRetry} />
  if (state.loading && !state.data) return <LoadingState />
  if (!state.data) return <LoadingState />
  if (isEmpty?.(state.data)) return <EmptyState title={emptyTitle} hint={emptyHint} />
  return <>{children(state.data)}</>
}

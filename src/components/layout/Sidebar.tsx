import { NavLink } from 'react-router-dom'
import { LayoutGrid, MessageSquare, Box, TrendingUp, Settings, Database, RefreshCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { formatRelativeMinutes } from '@/lib/format'
import type { DataSourceStatus } from '@/types/api'

const navItems = [
  { to: '/overview', label: '概览', icon: LayoutGrid },
  { to: '/sessions', label: '会话', icon: MessageSquare },
  { to: '/models', label: '模型', icon: Box },
  { to: '/trends', label: '趋势', icon: TrendingUp },
  { to: '/settings', label: '设置', icon: Settings },
]

export default function Sidebar() {
  const [status, setStatus] = useState<DataSourceStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const reload = async () => {
    try {
      setStatus(await api.getDataSourceStatus())
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => {
    reload()
    const off = api.onDataChanged(reload)
    const i = setInterval(reload, 60_000)
    return () => {
      off()
      clearInterval(i)
    }
  }, [])

  const handleRescan = async () => {
    setRefreshing(true)
    try {
      await api.rescan()
      await reload()
    } catch {
      // swallow — surfaced elsewhere
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <aside className="w-[200px] shrink-0 h-full flex flex-col bg-white/70 dark:bg-slate-900/60 border-r border-slate-200/70 dark:border-slate-800 backdrop-blur-md">
      <div className="h-14 titlebar-drag" />

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto titlebar-no-drag">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition',
                isActive
                  ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300 dark:bg-brand-500/15 shadow-sm font-medium'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center',
                    isActive
                      ? 'bg-brand-500 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
                  )}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="m-3 p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                status?.healthy ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
            数据源
          </div>
          <button
            type="button"
            onClick={handleRescan}
            disabled={refreshing}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition disabled:opacity-40"
            title="重新扫描"
          >
            <RefreshCcw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-400" />
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {status?.label ?? '本地估算'}
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          {status ? `更新于 ${formatRelativeMinutes(status.lastUpdatedAt)}` : '未连接'}
        </div>
        {status && (
          <div className="mt-1 text-[11px] text-slate-400">
            文件 {status.scannedFiles} · 记录 {status.requestCount}
          </div>
        )}
      </div>
    </aside>
  )
}

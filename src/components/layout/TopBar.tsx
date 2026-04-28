import { Search, RefreshCcw, Sun, Moon, Monitor } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { formatRelativeMinutes } from '@/lib/format'
import { useSettings, type ThemeMode } from '@/stores/settings'
import type { DataSourceStatus } from '@/types/api'
import { cn } from '@/lib/utils'

const titleMap: Record<string, string> = {
  '/overview': 'Token Dashboard',
  '/sessions': '会话',
  '/replay': '回放',
  '/models': '模型',
  '/trends': '趋势',
  '/settings': '设置',
}

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system']
const THEME_ICON: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}
const THEME_LABEL: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}

export default function TopBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const title = titleMap[pathname] ?? 'Token Dashboard'

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<DataSourceStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { theme, setTheme } = useSettings()
  const ThemeIcon = THEME_ICON[theme]

  // 拉一次数据源状态 + 监听后台扫描
  useEffect(() => {
    let cancelled = false
    const reload = async () => {
      try {
        const next = await api.getDataSourceStatus()
        if (!cancelled) setStatus(next)
      } catch {
        if (!cancelled) setStatus(null)
      }
    }
    reload()
    const off = api.onDataChanged(reload)
    const i = window.setInterval(reload, 60_000)
    return () => {
      cancelled = true
      off()
      window.clearInterval(i)
    }
  }, [])

  // ⌘K / Ctrl+K 聚焦搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submitSearch = () => {
    const q = query.trim()
    if (!q) {
      navigate('/sessions')
      return
    }
    navigate(`/sessions?q=${encodeURIComponent(q)}`)
  }

  const handleRescan = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await api.rescan()
      setStatus(await api.getDataSourceStatus())
    } catch {
      // ignore — 状态条会显示
    } finally {
      setRefreshing(false)
    }
  }

  const cycleTheme = () => {
    const idx = THEME_ORDER.indexOf(theme)
    setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length])
  }

  const freshness = status?.lastUpdatedAt
    ? `更新于 ${formatRelativeMinutes(status.lastUpdatedAt)}`
    : '未连接'

  return (
    <header className="h-16 px-8 flex items-center gap-6 titlebar-drag">
      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100 shrink-0">
        {title}
      </h1>

      <div className="flex-1 max-w-2xl titlebar-no-drag">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSearch()
              if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
            }}
            placeholder="搜索会话、模型或关键词，回车跳转..."
            className="w-full h-9 pl-9 pr-12 rounded-xl bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/80 text-slate-500 dark:text-slate-300 font-mono">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-3 titlebar-no-drag">
        <button
          type="button"
          onClick={handleRescan}
          disabled={refreshing}
          title="点击重新扫描"
          className="h-9 px-3 inline-flex items-center gap-2 rounded-xl bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-sm text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-60"
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              status?.healthy ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {freshness}
          </span>
          <RefreshCcw className={cn('w-3.5 h-3.5 text-slate-400', refreshing && 'animate-spin')} />
        </button>
        <button
          type="button"
          onClick={cycleTheme}
          title={`主题：${THEME_LABEL[theme]}（点击切换）`}
          className="w-9 h-9 rounded-full bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800"
        >
          <ThemeIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}

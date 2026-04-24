import { Search, Calendar, ChevronDown, User } from 'lucide-react'
import { useLocation } from 'react-router-dom'

const titleMap: Record<string, string> = {
  '/overview': 'Token Dashboard',
  '/sessions': '会话',
  '/models': '模型',
  '/trends': '趋势',
  '/settings': '设置',
}

export default function TopBar() {
  const { pathname } = useLocation()
  const title = titleMap[pathname] ?? 'Token Dashboard'

  return (
    <header className="h-16 px-8 flex items-center gap-6 titlebar-drag">
      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100 shrink-0">
        {title}
      </h1>

      <div className="flex-1 max-w-2xl titlebar-no-drag">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜索会话、模型或关键词..."
            className="w-full h-9 pl-9 pr-12 rounded-xl bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/80 text-slate-500 dark:text-slate-300 font-mono">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-3 titlebar-no-drag">
        <button className="h-9 px-3 inline-flex items-center gap-2 rounded-xl bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-sm text-slate-700 dark:text-slate-200 hover:bg-white">
          <Calendar className="w-4 h-4 text-slate-400" />
          最近 30 天
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
        <button className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center hover:opacity-90">
          <User className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}

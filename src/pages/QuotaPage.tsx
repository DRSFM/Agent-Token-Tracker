import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock3,
  EyeOff,
  LayoutGrid,
  List,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { api, isMock } from '@/lib/api'
import { formatRelativeMinutes } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  QuotaAccountGroup,
  QuotaAccountStatus,
  QuotaStatus,
  SyncQuotaToCpaResult,
} from '@/types/api'

const GROUPS: QuotaAccountGroup[] = ['自己的账号', '其余来源']
const HIDDEN_QUOTA_ACCOUNTS_STORAGE_KEY = 'agent-token-tracker:hidden-quota-accounts'
type QuotaScope = 'all' | QuotaAccountGroup
type QuotaViewMode = 'table' | 'cards'

const scopeOptions: Array<{ value: QuotaScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: '自己的账号', label: '仅自己账号' },
  { value: '其余来源', label: '仅其他来源' },
]

const viewOptions: Array<{ value: QuotaViewMode; label: string; icon: typeof List }> = [
  { value: 'table', label: '表格', icon: List },
  { value: 'cards', label: '卡片', icon: LayoutGrid },
]

const groupTone: Record<QuotaAccountGroup, string> = {
  自己的账号: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300',
  其余来源: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
}

function percentTone(value: number | null) {
  if (value === null) return 'bg-slate-300 dark:bg-slate-700'
  if (value <= 10) return 'bg-rose-500'
  if (value <= 30) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function quotaLabel(value: number | null) {
  return value === null ? '不可用' : `${value}%`
}

function formatQuotaError(error: string) {
  if (/401|Unauthorized|invalidated|signing in again/i.test(error)) {
    return '额度获取失败：401，认证已失效，请重新登录'
  }
  if (/missing access_token/i.test(error)) return '额度获取失败：认证文件缺少 access_token'
  if (/timeout/i.test(error)) return '额度获取失败：请求超时，请稍后重试'
  return `额度获取失败：${error}`
}

function quotaAccountKey(quota: QuotaAccountStatus) {
  if (quota.visibilityKey) return quota.visibilityKey
  return `${quota.accountGroup}:${quota.email.trim().toLowerCase()}`
}

function readHiddenQuotaKeys() {
  try {
    const raw = window.localStorage.getItem(HIDDEN_QUOTA_ACCOUNTS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function saveHiddenQuotaKeys(keys: string[]) {
  try {
    window.localStorage.setItem(HIDDEN_QUOTA_ACCOUNTS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // Keeping the page usable is more important than surfacing storage errors here.
  }
}

function QuotaBar({ value, className }: { value: number | null; className?: string }) {
  const width = value === null ? 100 : Math.max(0, Math.min(100, value))
  return (
    <div className={cn('min-w-[108px]', className)}>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={cn('h-full rounded-full', percentTone(value))} style={{ width: `${width}%` }} />
      </div>
      <div
        className={cn(
          'mt-1 text-xs tabular-nums',
          value === null ? 'text-slate-400' : 'text-slate-600 dark:text-slate-300',
        )}
      >
        {quotaLabel(value)}
      </div>
    </div>
  )
}

function QuotaLimitRow({
  label,
  value,
  resetAt,
}: {
  label: string
  value: number | null
  resetAt: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-800 dark:text-slate-100">{quotaLabel(value)}</span>
          {resetAt && <span className="ml-2">{resetAt}</span>}
        </span>
      </div>
      <QuotaBar value={value} className="min-w-0" />
    </div>
  )
}

function StatusPill({ quota }: { quota: QuotaAccountStatus }) {
  const hasError = Boolean(quota.error)
  const label = hasError ? '异常' : quota.allowed ? '可用' : quota.limitReached ? '已限额' : '受限'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium',
        hasError || !quota.allowed
          ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          hasError || !quota.allowed ? 'bg-rose-500' : 'bg-emerald-500',
        )}
      />
      {label}
    </span>
  )
}

function GroupTable({
  group,
  rows,
  onHide,
}: {
  group: QuotaAccountGroup
  rows: QuotaAccountStatus[]
  onHide: (quota: QuotaAccountStatus) => void
}) {
  return (
    <Card>
      <CardHeader
        title={group}
        subtitle={`${rows.length} 个账号`}
        action={
          <span className={cn('rounded-lg p-2', groupTone[group])}>
            <Users className="h-4 w-4" />
          </span>
        }
      />
      <CardBody className="pt-3">
        {rows.length === 0 ? (
          <EmptyState title="暂无账号" hint="未发现该分组下的 codex 认证文件" className="py-10" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-slate-200/70 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="w-[30%] py-2 pr-3 font-medium">账号</th>
                  <th className="w-[12%] py-2 pr-3 font-medium">状态</th>
                  <th className="w-[14%] py-2 pr-3 font-medium">5h 剩余</th>
                  <th className="w-[14%] py-2 pr-3 font-medium">7d 剩余</th>
                  <th className="w-[23%] py-2 pr-3 font-medium">重置时间</th>
                  <th className="w-[7%] py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((quota, index) => (
                  <tr key={`${quotaAccountKey(quota)}:${index}`} className="align-top">
                    <td className="py-3 pr-3">
                      <div className="truncate font-medium text-slate-700 dark:text-slate-200" title={quota.email}>
                        {quota.email}
                      </div>
                      {quota.plan && (
                        <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">{quota.plan}</div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <StatusPill quota={quota} />
                    </td>
                    <td className="py-3 pr-3">
                      <QuotaBar value={quota.primaryRemainingPercent} />
                    </td>
                    <td className="py-3 pr-3">
                      <QuotaBar value={quota.secondaryRemainingPercent} />
                    </td>
                    <td className="py-3 pr-3">
                      {quota.error ? (
                        <div className="break-words text-xs text-rose-500 dark:text-rose-300">
                          {formatQuotaError(quota.error)}
                        </div>
                      ) : (
                        <div className="space-y-1 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                          <div>{quota.primaryResetAt || '未返回'}</div>
                          <div className="text-slate-400">{quota.secondaryResetAt || '未返回'}</div>
                        </div>
                      )}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => onHide(quota)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white/80 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-700"
                        title="隐藏账号"
                        aria-label={`隐藏账号 ${quota.email}`}
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function AccountCard({
  quota,
  onHide,
}: {
  quota: QuotaAccountStatus
  onHide: (quota: QuotaAccountStatus) => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 shadow-sm transition hover:bg-white/90 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:bg-slate-900/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={quota.email}>
            {quota.email}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {quota.plan && (
              <span className="rounded-lg bg-brand-500/10 px-2 py-1 text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                {quota.plan}
              </span>
            )}
            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {quota.accountGroup}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill quota={quota} />
          <button
            type="button"
            onClick={() => onHide(quota)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white/80 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-700"
            title="隐藏账号"
            aria-label={`隐藏账号 ${quota.email}`}
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-4 h-8 rounded-xl bg-slate-50/80 px-3 py-2 dark:bg-slate-800/50">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: 18 }).map((_, index) => (
            <span
              key={index}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                quota.error
                  ? 'bg-slate-200 dark:bg-slate-700'
                  : index < Math.round(((quota.primaryRemainingPercent ?? 0) / 100) * 18)
                    ? percentTone(quota.primaryRemainingPercent)
                    : 'bg-slate-200 dark:bg-slate-700',
              )}
            />
          ))}
        </div>
      </div>

      {quota.error ? (
        <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50/70 px-3 py-2 text-sm leading-6 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {formatQuotaError(quota.error)}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <QuotaLimitRow label="5 小时限额" value={quota.primaryRemainingPercent} resetAt={quota.primaryResetAt} />
          <QuotaLimitRow label="7 天限额" value={quota.secondaryRemainingPercent} resetAt={quota.secondaryResetAt} />
        </div>
      )}
    </div>
  )
}

function GroupCards({
  group,
  rows,
  onHide,
}: {
  group: QuotaAccountGroup
  rows: QuotaAccountStatus[]
  onHide: (quota: QuotaAccountStatus) => void
}) {
  return (
    <Card>
      <CardHeader
        title={group}
        subtitle={`${rows.length} 个账号`}
        action={
          <span className={cn('rounded-lg p-2', groupTone[group])}>
            <Users className="h-4 w-4" />
          </span>
        }
      />
      <CardBody className="pt-3">
        {rows.length === 0 ? (
          <EmptyState title="暂无账号" hint="未发现该分组下的 codex 认证文件" className="py-10" />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {rows.map((quota, index) => (
              <AccountCard key={`${quotaAccountKey(quota)}:${index}`} quota={quota} onHide={onHide} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function HiddenAccountsPanel({
  rows,
  onRestore,
}: {
  rows: QuotaAccountStatus[]
  onRestore: (quota: QuotaAccountStatus) => void
}) {
  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="隐藏账号"
        subtitle={`${rows.length} 个账号`}
        action={
          <span className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <EyeOff className="h-4 w-4" />
          </span>
        }
      />
      <CardBody className="pt-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((quota, index) => (
            <div
              key={`${quotaAccountKey(quota)}:${index}:hidden`}
              className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={quota.email}>
                  {quota.email}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {quota.plan && (
                    <span className="rounded-md bg-brand-500/10 px-1.5 py-0.5 text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                      {quota.plan}
                    </span>
                  )}
                  <span className="rounded-md bg-white px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {quota.accountGroup}
                  </span>
                  {quota.error && (
                    <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
                      异常
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRestore(quota)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200/70 bg-white/80 px-2.5 text-xs font-medium text-slate-600 transition hover:bg-white hover:text-slate-800 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
                title="恢复显示"
                aria-label={`恢复显示账号 ${quota.email}`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                恢复
              </button>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

export default function QuotaPage() {
  const [status, setStatus] = useState<QuotaStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncQuotaToCpaResult | null>(null)
  const [scope, setScope] = useState<QuotaScope>('all')
  const [viewMode, setViewMode] = useState<QuotaViewMode>('cards')
  const [hiddenQuotaKeys, setHiddenQuotaKeys] = useState<string[]>(readHiddenQuotaKeys)
  const [visibilityLoaded, setVisibilityLoaded] = useState(false)

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true)
    setError(null)
    try {
      const next = await api.getQuotaStatus(force)
      setStatus(next)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load(true)
    const interval = window.setInterval(() => load(false), 60_000)
    return () => window.clearInterval(interval)
  }, [load])

  useEffect(() => {
    let cancelled = false

    async function loadVisibilitySettings() {
      const localKeys = readHiddenQuotaKeys()
      try {
        const settings = await api.getQuotaVisibilitySettings()
        const merged = [...new Set([...settings.hiddenAccounts, ...localKeys])]
        if (cancelled) return
        setHiddenQuotaKeys(merged)
        saveHiddenQuotaKeys(merged)
        setVisibilityLoaded(true)
        if (merged.length !== settings.hiddenAccounts.length) {
          await api.setQuotaVisibilitySettings({ hiddenAccounts: merged })
          await load(true)
        }
      } catch {
        if (cancelled) return
        setHiddenQuotaKeys(localKeys)
        setVisibilityLoaded(true)
      }
    }

    loadVisibilitySettings()
    return () => {
      cancelled = true
    }
  }, [load])

  const syncToCpa = useCallback(async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await api.syncQuotaToCpa()
      setSyncResult(result)
      if (result.ok) await load(true)
    } finally {
      setSyncing(false)
    }
  }, [load])

  const updateHiddenQuotaKeys = useCallback(
    async (updater: (current: string[]) => string[]) => {
      const next = updater(hiddenQuotaKeys)
      setHiddenQuotaKeys(next)
      saveHiddenQuotaKeys(next)
      try {
        await api.setQuotaVisibilitySettings({ hiddenAccounts: next })
      } finally {
        await load(true)
      }
    },
    [hiddenQuotaKeys, load],
  )

  const hideQuota = useCallback((quota: QuotaAccountStatus) => {
    const key = quotaAccountKey(quota)
    void updateHiddenQuotaKeys((current) => (current.includes(key) ? current : [...current, key]))
  }, [updateHiddenQuotaKeys])

  const restoreQuota = useCallback((quota: QuotaAccountStatus) => {
    const key = quotaAccountKey(quota)
    void updateHiddenQuotaKeys((current) => current.filter((item) => item !== key))
  }, [updateHiddenQuotaKeys])

  const hiddenQuotaKeySet = useMemo(() => new Set(hiddenQuotaKeys), [hiddenQuotaKeys])

  const scopedQuotas = useMemo(
    () =>
      (status?.quotas ?? []).filter((quota) =>
        scope === 'all' ? true : quota.accountGroup === scope,
      ),
    [scope, status],
  )

  const visibleQuotas = useMemo(
    () => scopedQuotas.filter((quota) => !hiddenQuotaKeySet.has(quotaAccountKey(quota))),
    [hiddenQuotaKeySet, scopedQuotas],
  )

  const hiddenQuotas = useMemo(
    () => scopedQuotas.filter((quota) => hiddenQuotaKeySet.has(quotaAccountKey(quota))),
    [hiddenQuotaKeySet, scopedQuotas],
  )

  const visibleGroups = useMemo(
    () => (scope === 'all' ? GROUPS : GROUPS.filter((group) => group === scope)),
    [scope],
  )

  const byGroup = useMemo(() => {
    const grouped: Record<QuotaAccountGroup, QuotaAccountStatus[]> = {
      自己的账号: [],
      其余来源: [],
    }
    for (const quota of visibleQuotas) {
      grouped[quota.accountGroup].push(quota)
    }
    return grouped
  }, [visibleQuotas])

  const scopedTotal = scopedQuotas.length
  const total = visibleQuotas.length
  const hiddenCount = hiddenQuotas.length
  const available = visibleQuotas.filter((quota) => quota.allowed && !quota.error).length
  const errorCount = visibleQuotas.filter((quota) => Boolean(quota.error)).length
  const min5h = visibleQuotas
    .map((quota) => quota.primaryRemainingPercent)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0]
  const min7d = visibleQuotas
    .map((quota) => quota.secondaryRemainingPercent)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0]

  return (
    <div className="space-y-5 pt-2">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-50">余量额度</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {scope === 'all' ? '自己的账号 / 其余来源' : scope} · 5h 与 7d 剩余额度
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl border border-slate-200/70 bg-white/70 p-1 dark:border-slate-700/70 dark:bg-slate-800/50">
            {scopeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setScope(option.value)}
                className={cn(
                  'h-7 rounded-lg px-3 text-xs font-medium transition',
                  scope === option.value
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/70 dark:hover:text-slate-200',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-xl border border-slate-200/70 bg-white/70 p-1 dark:border-slate-700/70 dark:bg-slate-800/50">
            {viewOptions.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setViewMode(option.value)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition',
                    viewMode === option.value
                      ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/70 dark:hover:text-slate-200',
                  )}
                  title={`${option.label}视图`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              )
            })}
          </div>
          {isMock && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              示例数据
            </span>
          )}
          {status?.updatedAt && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              更新于 {formatRelativeMinutes(status.updatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200/70 bg-white/80 px-3 text-sm text-slate-700 transition hover:bg-white disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCcw className={cn('h-3.5 w-3.5 text-slate-400', refreshing && 'animate-spin')} />
            刷新余量
          </button>
          <button
            type="button"
            onClick={syncToCpa}
            disabled={syncing || refreshing}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            <RefreshCcw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            同步到 CPA 路由
          </button>
        </div>
      </div>

      {syncResult && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm shadow-sm',
            syncResult.ok
              ? 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
          )}
        >
          <span className="font-medium">
            {syncResult.ok ? 'CPA 路由同步完成' : 'CPA 路由同步失败'}
          </span>
          {syncResult.ok ? (
            <span className="tabular-nums">
              updated {syncResult.updated} · unchanged {syncResult.unchanged} · missing {syncResult.missing}
            </span>
          ) : (
            <span>{syncResult.message || '请确认 CPA dashboard 后端已启动'}</span>
          )}
        </div>
      )}

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => load(true)} />
        </Card>
      ) : loading && !status ? (
        <Card>
          <LoadingState label="正在查询余量..." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">显示账号</div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-50">
                      {total}
                    </div>
                  </div>
                  <span className="rounded-xl bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <Users className="h-5 w-5" />
                  </span>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">可用账号</div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-50">
                      {available}
                    </div>
                  </div>
                  <span className="rounded-xl bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">最低余量</div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-50">
                      {quotaLabel(min5h ?? null)} / {quotaLabel(min7d ?? null)}
                    </div>
                  </div>
                  <span className="rounded-xl bg-blue-100 p-2 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
                    <Clock3 className="h-5 w-5" />
                  </span>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">异常账号</div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-50">
                      {errorCount}
                    </div>
                  </div>
                  <span className="rounded-xl bg-rose-100 p-2 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                </div>
              </CardBody>
            </Card>
          </div>

          {scopedTotal === 0 ? (
            <Card>
              <EmptyState
                title="暂无账号"
                hint={
                  scope === 'all'
                    ? '未发现自己的账号或其余来源分组下的 codex 认证文件'
                    : `未发现${scope}分组下的 codex 认证文件`
                }
              />
            </Card>
          ) : total === 0 ? (
            <Card>
              <EmptyState title="当前没有显示账号" hint="当前筛选下的账号都在隐藏栏" />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {visibleGroups.map((group) => (
                viewMode === 'cards' ? (
                  <GroupCards key={group} group={group} rows={byGroup[group]} onHide={hideQuota} />
                ) : (
                  <GroupTable key={group} group={group} rows={byGroup[group]} onHide={hideQuota} />
                )
              ))}
            </div>
          )}

          {hiddenCount > 0 && <HiddenAccountsPanel rows={hiddenQuotas} onRestore={restoreQuota} />}
        </>
      )}
    </div>
  )
}

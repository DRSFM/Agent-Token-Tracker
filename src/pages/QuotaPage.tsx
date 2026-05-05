import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clock3, RefreshCcw, ShieldCheck, Users } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { api, isMock } from '@/lib/api'
import { formatRelativeMinutes } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { QuotaAccountGroup, QuotaAccountStatus, QuotaStatus } from '@/types/api'

const GROUPS: QuotaAccountGroup[] = ['自己的账号', '其余来源']

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

function QuotaBar({ value }: { value: number | null }) {
  const width = value === null ? 100 : Math.max(0, Math.min(100, value))
  return (
    <div className="min-w-[108px]">
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

function GroupTable({ group, rows }: { group: QuotaAccountGroup; rows: QuotaAccountStatus[] }) {
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
                  <th className="w-[32%] py-2 pr-3 font-medium">账号</th>
                  <th className="w-[13%] py-2 pr-3 font-medium">状态</th>
                  <th className="w-[15%] py-2 pr-3 font-medium">5h 剩余</th>
                  <th className="w-[15%] py-2 pr-3 font-medium">7d 剩余</th>
                  <th className="w-[25%] py-2 font-medium">重置时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((quota, index) => (
                  <tr key={`${quota.accountGroup}:${quota.email}:${index}`} className="align-top">
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
                    <td className="py-3">
                      {quota.error ? (
                        <div className="break-words text-xs text-rose-500 dark:text-rose-300">{quota.error}</div>
                      ) : (
                        <div className="space-y-1 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                          <div>{quota.primaryResetAt || '未返回'}</div>
                          <div className="text-slate-400">{quota.secondaryResetAt || '未返回'}</div>
                        </div>
                      )}
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

export default function QuotaPage() {
  const [status, setStatus] = useState<QuotaStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<unknown>(null)

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

  const byGroup = useMemo(() => {
    const grouped: Record<QuotaAccountGroup, QuotaAccountStatus[]> = {
      自己的账号: [],
      其余来源: [],
    }
    for (const quota of status?.quotas ?? []) {
      grouped[quota.accountGroup].push(quota)
    }
    return grouped
  }, [status])

  const total = status?.quotas.length ?? 0
  const available = status?.groups.reduce((sum, group) => sum + group.available, 0) ?? 0
  const errorCount = status?.groups.reduce((sum, group) => sum + group.error, 0) ?? 0
  const min5h = status?.quotas
    .map((quota) => quota.primaryRemainingPercent)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0]
  const min7d = status?.quotas
    .map((quota) => quota.secondaryRemainingPercent)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0]

  return (
    <div className="space-y-5 pt-2">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-50">余量额度</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            自己的账号 / 其余来源 · 5h 与 7d 剩余额度
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
      </div>

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
                    <div className="text-xs text-slate-500 dark:text-slate-400">账号总数</div>
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

          {total === 0 ? (
            <Card>
              <EmptyState title="暂无账号" hint="未发现自己的账号或其余来源分组下的 codex 认证文件" />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {GROUPS.map((group) => (
                <GroupTable key={group} group={group} rows={byGroup[group]} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

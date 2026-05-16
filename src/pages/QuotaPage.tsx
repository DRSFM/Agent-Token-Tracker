import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  Database,
  Download,
  EyeOff,
  FileJson,
  KeyRound,
  LayoutGrid,
  List,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Tag,
  Terminal,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { api, isMock } from '@/lib/api'
import { formatRelativeMinutes } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  CodexCredentialActionResult,
  CodexCredentialMeta,
  CodexCredentialMetaMap,
  CodexOAuthLoginStartResponse,
  QuotaAccountGroup,
  QuotaAccountStatus,
  QuotaStatus,
  SyncQuotaToCpaResult,
} from '@/types/api'

const GROUPS: QuotaAccountGroup[] = ['自己的账号', '其余来源']
const HIDDEN_QUOTA_ACCOUNTS_STORAGE_KEY = 'agent-token-tracker:hidden-quota-accounts'
type QuotaScope = 'all' | QuotaAccountGroup
type QuotaViewMode = 'table' | 'cards'
type CredentialAction = 'cli' | 'launch' | 'refresh' | 'export' | 'delete'

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

function emptyMeta(): CodexCredentialMeta {
  return { tags: [], note: '' }
}

function actionKey(action: CredentialAction, quota: QuotaAccountStatus) {
  return `${action}:${quotaAccountKey(quota)}`
}

function ActionButton({
  icon: Icon,
  title,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Terminal
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20'
          : 'border-slate-200/70 bg-white/80 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-700',
      )}
      title={title}
      aria-label={title}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

function CredentialActions({
  quota,
  busyActionKey,
  onOpenCli,
  onEditMeta,
  onLaunch,
  onRefresh,
  onExport,
  onDelete,
}: {
  quota: QuotaAccountStatus
  busyActionKey: string
  onOpenCli: (quota: QuotaAccountStatus) => void
  onEditMeta: (quota: QuotaAccountStatus) => void
  onLaunch: (quota: QuotaAccountStatus) => void
  onRefresh: (quota: QuotaAccountStatus) => void
  onExport: (quota: QuotaAccountStatus) => void
  onDelete: (quota: QuotaAccountStatus) => void
}) {
  const key = quotaAccountKey(quota)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        icon={Terminal}
        title={`CLI 启动 ${quota.email}`}
        onClick={() => onOpenCli(quota)}
        disabled={busyActionKey === actionKey('cli', quota)}
      />
      <ActionButton icon={Tag} title={`标签与备注 ${quota.email}`} onClick={() => onEditMeta(quota)} />
      <ActionButton
        icon={Play}
        title={`启动 ${quota.email}`}
        onClick={() => onLaunch(quota)}
        disabled={busyActionKey === actionKey('launch', quota)}
      />
      <ActionButton
        icon={RefreshCcw}
        title={`刷新配额 ${quota.email}`}
        onClick={() => onRefresh(quota)}
        disabled={busyActionKey === actionKey('refresh', quota)}
      />
      <ActionButton
        icon={Upload}
        title={`导出 JSON ${quota.email}`}
        onClick={() => onExport(quota)}
        disabled={busyActionKey === actionKey('export', quota)}
      />
      <ActionButton
        icon={Trash2}
        title={`删除凭证 ${quota.email}`}
        onClick={() => onDelete(quota)}
        disabled={busyActionKey === actionKey('delete', quota) || !key}
        danger
      />
    </div>
  )
}

function MetaBadges({ meta }: { meta: CodexCredentialMeta }) {
  if (meta.tags.length === 0 && !meta.note) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {meta.tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        >
          <Tag className="h-3 w-3" />
          {tag}
        </span>
      ))}
      {meta.note && (
        <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <FileJson className="h-3 w-3 shrink-0" />
          <span className="truncate">{meta.note}</span>
        </span>
      )}
    </div>
  )
}

function CredentialMetaModal({
  quota,
  meta,
  saving,
  onClose,
  onSave,
}: {
  quota: QuotaAccountStatus
  meta: CodexCredentialMeta
  saving: boolean
  onClose: () => void
  onSave: (meta: CodexCredentialMeta) => void
}) {
  const [tagsText, setTagsText] = useState(meta.tags.join(', '))
  const [note, setNote] = useState(meta.note)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">标签与备注</h3>
            <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{quota.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">标签</span>
            <input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="例如 主力, 备用, 客户A"
              className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">备注</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="写一点方便自己识别的信息"
              rows={4}
              className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-9 rounded-xl border border-slate-200/70 bg-white px-4 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                tags: tagsText.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean),
                note,
              })
            }
            disabled={saving}
            className="h-9 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

type AddAccountTab = 'oauth' | 'token' | 'apikey' | 'import'

const addAccountTabs: Array<{ value: AddAccountTab; label: string; icon: typeof Terminal }> = [
  { value: 'oauth', label: 'OAuth 授权', icon: Terminal },
  { value: 'token', label: 'Token / JSON', icon: FileJson },
  { value: 'apikey', label: 'API Key', icon: KeyRound },
  { value: 'import', label: '导入', icon: Database },
]

function AddCodexAccountModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (results: CodexCredentialActionResult[]) => void
}) {
  const [tab, setTab] = useState<AddAccountTab>('oauth')
  const [oauthFlow, setOauthFlow] = useState<CodexOAuthLoginStartResponse | null>(null)
  const [callbackUrl, setCallbackUrl] = useState('')
  const [tokenText, setTokenText] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const runImport = useCallback(
    async (operation: () => Promise<CodexCredentialActionResult | CodexCredentialActionResult[]>) => {
      setBusy(true)
      setError('')
      setMessage('')
      try {
        const result = await operation()
        const results = Array.isArray(result) ? result : [result]
        const imported = results.filter((item) => item.ok !== false)
        setMessage(imported.length ? `已导入 ${imported.length} 个账号` : '没有导入新账号')
        onImported(results)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [onImported],
  )

  const startOAuth = useCallback(() => {
    setBusy(true)
    setError('')
    setMessage('')
    api
      .startCodexOAuthLogin()
      .then((flow) => {
        setOauthFlow(flow)
        setMessage('已打开浏览器授权页')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }, [])

  const submitCallback = useCallback(() => {
    if (!oauthFlow) {
      setError('请先开始 OAuth 授权')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    api
      .submitCodexOAuthCallbackUrl(oauthFlow.loginId, callbackUrl)
      .then((result) => setMessage(result.message))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }, [callbackUrl, oauthFlow])

  const completeOAuth = useCallback(() => {
    if (!oauthFlow) {
      setError('请先开始 OAuth 授权')
      return
    }
    void runImport(() => api.completeCodexOAuthLogin(oauthFlow.loginId))
  }, [oauthFlow, runImport])

  const copyAuthUrl = useCallback(() => {
    if (!oauthFlow?.authUrl) return
    void navigator.clipboard?.writeText(oauthFlow.authUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [oauthFlow])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-5 dark:border-slate-800">
          <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">添加 Codex 账号</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="grid grid-cols-4 gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800/70">
            {addAccountTabs.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setTab(item.value)
                    setError('')
                    setMessage('')
                  }}
                  className={cn(
                    'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold transition',
                    tab === item.value
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-700',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}
          </div>

          {tab === 'oauth' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">通过 OpenAI 官方授权页导入 Codex OAuth 账号。</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={oauthFlow?.authUrl || ''}
                  placeholder="点击下方按钮生成授权链接"
                  className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={copyAuthUrl}
                  disabled={!oauthFlow?.authUrl}
                  className="inline-flex h-12 w-14 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="复制授权链接"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={startOAuth}
                disabled={busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-105 disabled:opacity-60"
              >
                <Terminal className="h-4 w-4" />
                在浏览器中打开
              </button>
              <div className="flex gap-2">
                <input
                  value={callbackUrl}
                  onChange={(event) => setCallbackUrl(event.target.value)}
                  placeholder="可粘贴完整回调地址"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={submitCallback}
                  disabled={busy || !callbackUrl.trim()}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Check className="h-4 w-4" />
                  读取
                </button>
              </div>
              <button
                type="button"
                onClick={completeOAuth}
                disabled={busy || !oauthFlow}
                className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                我已授权，完成导入
              </button>
            </div>
          )}

          {tab === 'token' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">粘贴 auth.json、账号 JSON、refresh_token，或每行一个 refresh_token。</p>
              <textarea
                value={tokenText}
                onChange={(event) => setTokenText(event.target.value)}
                placeholder={'示例：{"refresh_token":"rt_..."}'}
                rows={7}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => void runImport(() => api.importCodexCredentialText(tokenText))}
                disabled={busy || !tokenText.trim()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-105 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                导入
              </button>
            </div>
          )}

          {tab === 'apikey' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">导入 API Key 账号。API Key 不参与 ChatGPT 5h/7d 额度查询。</p>
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
                type="password"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="Base URL，可留空"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => void runImport(() => api.importCodexApiKey(apiKey, baseUrl || undefined))}
                disabled={busy || !apiKey.trim()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-105 disabled:opacity-60"
              >
                <KeyRound className="h-4 w-4" />
                导入 API Key
              </button>
            </div>
          )}

          {tab === 'import' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">从本机已登录 Codex 或本地 JSON 文件导入账号。</p>
              <button
                type="button"
                onClick={() => void runImport(api.importCurrentCodexAuth)}
                disabled={busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-105 disabled:opacity-60"
              >
                <Database className="h-4 w-4" />
                获取本地账号
              </button>
              <button
                type="button"
                onClick={() => void runImport(api.importCodexCredentialFiles)}
                disabled={busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Upload className="h-4 w-4" />
                从本地文件导入
              </button>
            </div>
          )}

          {(message || error) && (
            <div
              className={cn(
                'rounded-xl border px-4 py-3 text-sm',
                error
                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
              )}
            >
              {error || message}
            </div>
          )}
        </div>
      </div>
    </div>
  )
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
  metas,
  busyActionKey,
  onHide,
  onOpenCli,
  onEditMeta,
  onLaunch,
  onRefresh,
  onExport,
  onDelete,
}: {
  group: QuotaAccountGroup
  rows: QuotaAccountStatus[]
  metas: CodexCredentialMetaMap
  busyActionKey: string
  onHide: (quota: QuotaAccountStatus) => void
  onOpenCli: (quota: QuotaAccountStatus) => void
  onEditMeta: (quota: QuotaAccountStatus) => void
  onLaunch: (quota: QuotaAccountStatus) => void
  onRefresh: (quota: QuotaAccountStatus) => void
  onExport: (quota: QuotaAccountStatus) => void
  onDelete: (quota: QuotaAccountStatus) => void
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
            <table className="min-w-[940px] w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-slate-200/70 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="w-[26%] py-2 pr-3 font-medium">账号</th>
                  <th className="w-[10%] py-2 pr-3 font-medium">状态</th>
                  <th className="w-[12%] py-2 pr-3 font-medium">5h 剩余</th>
                  <th className="w-[12%] py-2 pr-3 font-medium">7d 剩余</th>
                  <th className="w-[18%] py-2 pr-3 font-medium">重置时间</th>
                  <th className="w-[22%] py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((quota, index) => {
                  const meta = metas[quotaAccountKey(quota)] || emptyMeta()
                  return (
                    <tr key={`${quotaAccountKey(quota)}:${index}`} className="align-top">
                      <td className="py-3 pr-3">
                        <div className="truncate font-medium text-slate-700 dark:text-slate-200" title={quota.email}>
                          {quota.email}
                        </div>
                        {quota.plan && (
                          <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">{quota.plan}</div>
                        )}
                        <MetaBadges meta={meta} />
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
                        <div className="flex flex-wrap gap-2">
                          <CredentialActions
                            quota={quota}
                            busyActionKey={busyActionKey}
                            onOpenCli={onOpenCli}
                            onEditMeta={onEditMeta}
                            onLaunch={onLaunch}
                            onRefresh={onRefresh}
                            onExport={onExport}
                            onDelete={onDelete}
                          />
                          <ActionButton icon={EyeOff} title={`隐藏账号 ${quota.email}`} onClick={() => onHide(quota)} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
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
  meta,
  busyActionKey,
  onHide,
  onOpenCli,
  onEditMeta,
  onLaunch,
  onRefresh,
  onExport,
  onDelete,
}: {
  quota: QuotaAccountStatus
  meta: CodexCredentialMeta
  busyActionKey: string
  onHide: (quota: QuotaAccountStatus) => void
  onOpenCli: (quota: QuotaAccountStatus) => void
  onEditMeta: (quota: QuotaAccountStatus) => void
  onLaunch: (quota: QuotaAccountStatus) => void
  onRefresh: (quota: QuotaAccountStatus) => void
  onExport: (quota: QuotaAccountStatus) => void
  onDelete: (quota: QuotaAccountStatus) => void
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
          <MetaBadges meta={meta} />
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

      <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <CredentialActions
          quota={quota}
          busyActionKey={busyActionKey}
          onOpenCli={onOpenCli}
          onEditMeta={onEditMeta}
          onLaunch={onLaunch}
          onRefresh={onRefresh}
          onExport={onExport}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}

function GroupCards({
  group,
  rows,
  metas,
  busyActionKey,
  onHide,
  onOpenCli,
  onEditMeta,
  onLaunch,
  onRefresh,
  onExport,
  onDelete,
}: {
  group: QuotaAccountGroup
  rows: QuotaAccountStatus[]
  metas: CodexCredentialMetaMap
  busyActionKey: string
  onHide: (quota: QuotaAccountStatus) => void
  onOpenCli: (quota: QuotaAccountStatus) => void
  onEditMeta: (quota: QuotaAccountStatus) => void
  onLaunch: (quota: QuotaAccountStatus) => void
  onRefresh: (quota: QuotaAccountStatus) => void
  onExport: (quota: QuotaAccountStatus) => void
  onDelete: (quota: QuotaAccountStatus) => void
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
              <AccountCard
                key={`${quotaAccountKey(quota)}:${index}`}
                quota={quota}
                meta={metas[quotaAccountKey(quota)] || emptyMeta()}
                busyActionKey={busyActionKey}
                onHide={onHide}
                onOpenCli={onOpenCli}
                onEditMeta={onEditMeta}
                onLaunch={onLaunch}
                onRefresh={onRefresh}
                onExport={onExport}
                onDelete={onDelete}
              />
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
  const [credentialMetas, setCredentialMetas] = useState<CodexCredentialMetaMap>({})
  const [editingMetaQuota, setEditingMetaQuota] = useState<QuotaAccountStatus | null>(null)
  const [savingMeta, setSavingMeta] = useState(false)
  const [busyActionKey, setBusyActionKey] = useState('')
  const [actionResult, setActionResult] = useState<CodexCredentialActionResult | null>(null)
  const [actionError, setActionError] = useState('')
  const [showAddAccountModal, setShowAddAccountModal] = useState(false)

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

    async function loadCredentialMetas() {
      try {
        const metas = await api.getCodexCredentialMetas()
        if (!cancelled) setCredentialMetas(metas)
      } catch {
        if (!cancelled) setCredentialMetas({})
      }
    }

    loadCredentialMetas()
    return () => {
      cancelled = true
    }
  }, [])

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

  const runCredentialAction = useCallback(
    async (
      action: CredentialAction,
      quota: QuotaAccountStatus,
      operation: (credentialKey: string) => Promise<CodexCredentialActionResult>,
      after?: () => Promise<void>,
    ) => {
      const key = quotaAccountKey(quota)
      setBusyActionKey(actionKey(action, quota))
      setActionResult(null)
      setActionError('')
      try {
        const result = await operation(key)
        setActionResult(result)
        if (after) await after()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyActionKey('')
      }
    },
    [],
  )

  const openCli = useCallback(
    (quota: QuotaAccountStatus) => {
      void runCredentialAction('cli', quota, api.openCodexCliWithCredential)
    },
    [runCredentialAction],
  )

  const launchCodex = useCallback(
    (quota: QuotaAccountStatus) => {
      void runCredentialAction('launch', quota, api.launchCodexWithCredential)
    },
    [runCredentialAction],
  )

  const refreshQuota = useCallback(
    (quota: QuotaAccountStatus) => {
      void runCredentialAction(
        'refresh',
        quota,
        async () => ({ ok: true, message: `已刷新 ${quota.email} 所在列表` }),
        () => load(true),
      )
    },
    [load, runCredentialAction],
  )

  const exportCredential = useCallback(
    (quota: QuotaAccountStatus) => {
      const confirmed = window.confirm('导出的 JSON 包含登录凭证，请只保存到可信目录。是否继续？')
      if (!confirmed) return
      void runCredentialAction('export', quota, api.exportCodexCredential)
    },
    [runCredentialAction],
  )

  const deleteCredential = useCallback(
    (quota: QuotaAccountStatus) => {
      const confirmed = window.confirm(`确定删除 ${quota.email} 的本地凭证 JSON 吗？此操作会移入回收站。`)
      if (!confirmed) return
      void runCredentialAction('delete', quota, api.deleteCodexCredential, () => load(true))
    },
    [load, runCredentialAction],
  )

  const saveCredentialMeta = useCallback(
    async (meta: CodexCredentialMeta) => {
      if (!editingMetaQuota) return
      const key = quotaAccountKey(editingMetaQuota)
      setSavingMeta(true)
      setActionError('')
      try {
        const saved = await api.setCodexCredentialMeta(key, meta)
        setCredentialMetas((current) => ({ ...current, [key]: saved }))
        setEditingMetaQuota(null)
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setSavingMeta(false)
      }
    },
    [editingMetaQuota],
  )

  const handleImportedAccounts = useCallback(
    (results: CodexCredentialActionResult[]) => {
      const imported = results.filter((item) => item.ok !== false)
      setActionError('')
      setActionResult({
        ok: imported.length > 0,
        message: imported.length ? `已导入 ${imported.length} 个账号` : '没有导入新账号',
        email: imported[0]?.email,
        path: imported[0]?.path,
      })
      void load(true)
      void api
        .getCodexCredentialMetas()
        .then(setCredentialMetas)
        .catch(() => setCredentialMetas({}))
    },
    [load],
  )

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
            onClick={() => setShowAddAccountModal(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 px-3 text-sm font-medium text-white shadow-sm transition hover:brightness-105"
          >
            <Plus className="h-3.5 w-3.5" />
            添加账号
          </button>
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

      {(actionResult || actionError) && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm shadow-sm',
            actionError || actionResult?.ok === false
              ? 'border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
              : 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
          )}
        >
          <span className="font-medium">{actionError ? '操作失败' : '操作完成'}</span>
          <span>{actionError || actionResult?.message}</span>
          {actionResult?.path && <span className="break-all text-xs opacity-80">{actionResult.path}</span>}
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
                  <GroupCards
                    key={group}
                    group={group}
                    rows={byGroup[group]}
                    metas={credentialMetas}
                    busyActionKey={busyActionKey}
                    onHide={hideQuota}
                    onOpenCli={openCli}
                    onEditMeta={setEditingMetaQuota}
                    onLaunch={launchCodex}
                    onRefresh={refreshQuota}
                    onExport={exportCredential}
                    onDelete={deleteCredential}
                  />
                ) : (
                  <GroupTable
                    key={group}
                    group={group}
                    rows={byGroup[group]}
                    metas={credentialMetas}
                    busyActionKey={busyActionKey}
                    onHide={hideQuota}
                    onOpenCli={openCli}
                    onEditMeta={setEditingMetaQuota}
                    onLaunch={launchCodex}
                    onRefresh={refreshQuota}
                    onExport={exportCredential}
                    onDelete={deleteCredential}
                  />
                )
              ))}
            </div>
          )}

          {hiddenCount > 0 && <HiddenAccountsPanel rows={hiddenQuotas} onRestore={restoreQuota} />}

          {editingMetaQuota && (
            <CredentialMetaModal
              quota={editingMetaQuota}
              meta={credentialMetas[quotaAccountKey(editingMetaQuota)] || emptyMeta()}
              saving={savingMeta}
              onClose={() => setEditingMetaQuota(null)}
              onSave={saveCredentialMeta}
            />
          )}

          {showAddAccountModal && (
            <AddCodexAccountModal
              onClose={() => setShowAddAccountModal(false)}
              onImported={handleImportedAccounts}
            />
          )}
        </>
      )}
    </div>
  )
}

import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { useSettings, type IdleTimeoutPreset, type ThemeMode } from '@/stores/settings'
import {
  Sun,
  Moon,
  Monitor,
  Image as ImageIcon,
  Trash2,
  Check,
  FolderOpen,
  RefreshCcw,
  DownloadCloud,
  Globe2,
  Save,
  Server,
  Cloud,
  Github,
  Mail,
  LogIn,
  LogOut,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type {
  CloudAuthStatus,
  CloudSyncHistoryMode,
  CloudSyncSettings,
  CloudSyncStatus,
  CloudUsageSummary,
  DataSourceStatus,
  NetworkSettings,
  OpenLocalPathTarget,
  RemoteSourceSettings,
  RemoteSyncStatus,
  UpdateProviderSettings,
  UpdateStatus,
} from '@/types/api'
import { formatNumber, formatRelativeMinutes } from '@/lib/format'

const THEMES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const IDLE_TIMEOUTS: { value: IdleTimeoutPreset; label: string }[] = [
  { value: '30', label: '30 秒' },
  { value: '60', label: '1 分钟' },
  { value: '300', label: '5 分钟' },
  { value: '900', label: '15 分钟' },
  { value: '3600', label: '1 小时' },
  { value: 'never', label: '永不' },
  { value: 'custom', label: '自定义' },
]

export default function SettingsPage() {
  const {
    theme,
    setTheme,
    backgroundImage,
    setBackgroundImage,
    backgroundImages,
    activeBackgroundId,
    addBackgroundImage,
    selectBackgroundImage,
    removeBackgroundImage,
    backgroundOpacity,
    setBackgroundOpacity,
    idleBackgroundModeEnabled,
    idleTimeoutPreset,
    idleCustomSeconds,
    setIdleBackgroundModeEnabled,
    setIdleTimeoutPreset,
    setIdleCustomSeconds,
  } = useSettings()
  const [status, setStatus] = useState<DataSourceStatus | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [remoteSettings, setRemoteSettings] = useState<RemoteSourceSettings>({
    enabled: false,
    host: '',
    user: '',
    port: 22,
    claudePath: '~/.claude/projects',
    codexPath: '~/.codex/sessions',
  })
  const [remoteStatus, setRemoteStatus] = useState<RemoteSyncStatus | null>(null)
  const [remoteMessage, setRemoteMessage] = useState('')
  const [networkSettings, setNetworkSettings] = useState<NetworkSettings>({
    quotaProxyUrl: '',
  })
  const [networkMessage, setNetworkMessage] = useState('')
  const [cloudSettings, setCloudSettings] = useState<CloudSyncSettings>({
    enabled: false,
    historyMode: 'ask',
  })
  const [cloudAuth, setCloudAuth] = useState<CloudAuthStatus | null>(null)
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus | null>(null)
  const [cloudSummary, setCloudSummary] = useState<CloudUsageSummary | null>(null)
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudOtp, setCloudOtp] = useState('')
  const [cloudOtpSent, setCloudOtpSent] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [updateProvider, setUpdateProvider] = useState<UpdateProviderSettings['provider']>('none')
  const [githubOwner, setGithubOwner] = useState('')
  const [githubRepo, setGithubRepo] = useState('')
  const [genericUrl, setGenericUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [networkBusy, setNetworkBusy] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const reloadStatus = async () => {
    try {
      setStatus(await api.getDataSourceStatus())
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => {
    void reloadStatus()
    const off = api.onDataChanged(reloadStatus)
    return off
  }, [])

  useEffect(() => {
    void reloadRemote()
  }, [])

  useEffect(() => {
    void reloadNetwork()
  }, [])

  useEffect(() => {
    void reloadCloud()
  }, [])

  useEffect(() => {
    void reloadUpdate()
    const off = api.onUpdateStatusChanged(setUpdateStatus)
    return off
  }, [])

  const reloadUpdate = async () => {
    try {
      const [settings, nextStatus] = await Promise.all([
        api.getUpdateSettings(),
        api.getUpdateStatus(),
      ])
      setUpdateStatus(nextStatus)
      setUpdateProvider(settings.provider)
      if (settings.provider === 'github') {
        setGithubOwner(settings.owner)
        setGithubRepo(settings.repo)
      }
      if (settings.provider === 'generic') {
        setGenericUrl(settings.url)
      }
    } catch {
      setUpdateStatus(null)
    }
  }

  const reloadRemote = async () => {
    try {
      const [settings, nextStatus] = await Promise.all([
        api.getRemoteSourceSettings(),
        api.getRemoteSyncStatus(),
      ])
      setRemoteSettings(settings)
      setRemoteStatus(nextStatus)
      setRemoteMessage(nextStatus.lastError ?? '')
    } catch {
      setRemoteMessage('读取远程配置失败。')
    }
  }

  const reloadNetwork = async () => {
    try {
      const settings = await api.getNetworkSettings()
      setNetworkSettings(settings)
      setNetworkMessage(settings.quotaProxyUrl ? '余量查询将通过代理访问 ChatGPT。' : '未配置代理，余量查询将直连。')
    } catch {
      setNetworkMessage('读取网络配置失败。')
    }
  }

  const reloadCloud = async () => {
    try {
      const [settings, auth, nextStatus, summary] = await Promise.all([
        api.getCloudSyncSettings(),
        api.getCloudAuthStatus(),
        api.getCloudSyncStatus(),
        api.getCloudUsageSummary(),
      ])
      setCloudSettings(settings)
      setCloudAuth(auth)
      setCloudStatus(nextStatus)
      setCloudSummary(summary)
      if (nextStatus.lastError) setCloudMessage(nextStatus.lastError)
    } catch {
      setCloudAuth({ authenticated: false })
      setCloudSummary(null)
      setCloudMessage('读取云同步状态失败。')
    }
  }

  const onPickImage = () => fileInput.current?.click()

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    void readBackgroundFile(file)
      .then((dataUrl) => addBackgroundImage(file.name, dataUrl))
      .catch(() => {})
    e.target.value = ''
  }

  const onRescan = async () => {
    setBusy(true)
    try {
      await api.rescan()
      await reloadStatus()
    } finally {
      setBusy(false)
    }
  }

  const onClearCache = async () => {
    setBusy(true)
    try {
      await api.clearCache()
      await reloadStatus()
    } finally {
      setBusy(false)
    }
  }

  const onOpenPath = (kind: OpenLocalPathTarget) => {
    void api.openLocalPath(kind)
  }

  const onOpenSpecialPath = (kind: 'ssh-readme' | 'remote-cache') => {
    void api.openLocalPath(kind)
  }

  const updateRemoteField = <K extends keyof RemoteSourceSettings>(
    key: K,
    value: RemoteSourceSettings[K],
  ) => {
    setRemoteSettings((current) => ({ ...current, [key]: value }))
  }

  const onSaveRemote = async () => {
    setRemoteBusy(true)
    try {
      const saved = await api.setRemoteSourceSettings(remoteSettings)
      setRemoteSettings(saved)
      setRemoteMessage('远程数据源已保存。')
      await reloadRemote()
    } finally {
      setRemoteBusy(false)
    }
  }

  const onTestRemote = async () => {
    setRemoteBusy(true)
    try {
      const result = await api.testRemoteConnection()
      setRemoteMessage(result.message)
    } finally {
      setRemoteBusy(false)
    }
  }

  const onSyncRemote = async () => {
    setRemoteBusy(true)
    try {
      const result = await api.syncRemoteLogs()
      setRemoteMessage(result.message)
      await Promise.all([reloadRemote(), reloadStatus()])
    } finally {
      setRemoteBusy(false)
    }
  }

  const onSaveNetwork = async () => {
    setNetworkBusy(true)
    try {
      const saved = await api.setNetworkSettings(networkSettings)
      setNetworkSettings(saved)
      setNetworkMessage(
        saved.quotaProxyUrl
          ? `余量查询代理已保存：${saved.quotaProxyUrl}`
          : '已关闭余量查询代理。',
      )
    } finally {
      setNetworkBusy(false)
    }
  }

  const onRequestCloudOtp = async () => {
    setCloudBusy(true)
    try {
      const result = await api.requestCloudEmailOtp(cloudEmail)
      setCloudMessage(result.message)
      setCloudOtpSent(result.ok)
    } finally {
      setCloudBusy(false)
    }
  }

  const onVerifyCloudOtp = async () => {
    setCloudBusy(true)
    try {
      const result = await api.verifyCloudEmailOtp(cloudEmail, cloudOtp)
      setCloudMessage(result.message)
      if (result.ok) {
        setCloudOtp('')
        setCloudOtpSent(false)
        await reloadCloud()
      }
    } finally {
      setCloudBusy(false)
    }
  }

  const onCloudOAuth = async (provider: 'github' | 'google') => {
    setCloudBusy(true)
    try {
      const started = await api.startCloudOAuth(provider)
      setCloudMessage(started.message)
      if (started.ok && started.loginId) {
        const result = await api.completeCloudOAuth(started.loginId)
        setCloudMessage(result.message)
        if (result.ok) await reloadCloud()
      }
    } finally {
      setCloudBusy(false)
    }
  }

  const onCloudSignOut = async () => {
    setCloudBusy(true)
    try {
      const result = await api.signOutCloud()
      setCloudMessage(result.message)
      await reloadCloud()
    } finally {
      setCloudBusy(false)
    }
  }

  const onSaveCloudSettings = async () => {
    if (!cloudAuth?.authenticated) {
      setCloudMessage('请先登录云端账号。')
      return
    }
    if (cloudSettings.enabled && cloudSettings.historyMode === 'ask') {
      setCloudMessage('请先选择是否上传已有历史统计。')
      return
    }
    setCloudBusy(true)
    try {
      const saved = await api.setCloudSyncSettings(cloudSettings)
      setCloudSettings(saved)
      setCloudMessage(saved.enabled ? '云同步已开启。' : '云同步已关闭，本地统计仍会继续工作。')
      await reloadCloud()
    } finally {
      setCloudBusy(false)
    }
  }

  const onSyncCloud = async () => {
    setCloudBusy(true)
    try {
      const result = await api.syncCloudNow()
      setCloudStatus(result)
      setCloudSummary(await api.getCloudUsageSummary())
      const message = result.lastError
        ?? (!result.enabled
          ? '请先开启云同步。'
          : !result.authenticated
            ? '请先登录云端账号。'
            : result.pendingCount > 0
              ? `已同步一部分，仍有 ${formatNumber(result.pendingCount)} 条待上传。`
              : '同步完成。')
      setCloudMessage(message)
    } finally {
      setCloudBusy(false)
    }
  }

  const setCloudHistoryMode = (historyMode: CloudSyncHistoryMode) => {
    setCloudSettings((current) => ({
      ...current,
      historyMode,
      syncFrom: historyMode === 'future-only' ? current.syncFrom ?? new Date().toISOString() : undefined,
    }))
  }

  const onSaveUpdateSettings = async () => {
    setUpdateBusy(true)
    try {
      const settings: UpdateProviderSettings =
        updateProvider === 'github'
          ? { provider: 'github', owner: githubOwner.trim(), repo: githubRepo.trim() }
          : updateProvider === 'generic'
            ? { provider: 'generic', url: genericUrl.trim() }
            : { provider: 'none' }
      await api.setUpdateSettings(settings)
      await reloadUpdate()
    } finally {
      setUpdateBusy(false)
    }
  }

  const onCheckUpdate = async () => {
    setUpdateBusy(true)
    try {
      setUpdateStatus(await api.checkForUpdates())
    } finally {
      setUpdateBusy(false)
    }
  }

  const onDownloadUpdate = async () => {
    setUpdateBusy(true)
    try {
      setUpdateStatus(await api.downloadUpdate())
    } finally {
      setUpdateBusy(false)
    }
  }

  const onInstallUpdate = () => {
    void api.installUpdate()
  }

  return (
    <div className="space-y-5 pt-2 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-50">设置</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">外观与数据源偏好</p>
      </div>

      <Card>
        <CardHeader
          title="云账号与同步"
          subtitle={
            cloudAuth?.authenticated
              ? `${cloudAuth.email ?? '已登录'} · ${cloudSettings.enabled ? '同步已开启' : '同步默认关闭'}`
              : '跨设备汇总 token、模型、来源、时间和请求数'
          }
          action={
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-300">
              <Cloud className="w-4 h-4" />
            </span>
          }
        />
        <CardBody className="space-y-4">
          {!cloudStatus?.configured && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              尚未配置独立 Supabase 项目。当前仍可使用全部本地统计功能；配置后再启用云同步。
            </div>
          )}

          {!cloudAuth?.authenticated ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <label className="text-xs text-slate-500 dark:text-slate-400">
                  邮箱验证码登录
                  <input
                    type="email"
                    value={cloudEmail}
                    onChange={(e) => setCloudEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </label>
                <button
                  type="button"
                  onClick={onRequestCloudOtp}
                  disabled={cloudBusy || !cloudEmail.trim() || !cloudStatus?.configured}
                  className="self-end inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs text-white hover:bg-brand-600 disabled:opacity-50 transition"
                >
                  <Mail className="w-3.5 h-3.5" />
                  发送验证码
                </button>
              </div>
              {cloudOtpSent && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    6 位验证码
                    <input
                      value={cloudOtp}
                      onChange={(e) => setCloudOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      placeholder="123456"
                      className="mt-1 w-32 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm tracking-[0.2em] text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onVerifyCloudOtp}
                    disabled={cloudBusy || cloudOtp.length !== 6}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs text-white hover:bg-emerald-600 disabled:opacity-50 transition"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    登录
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => void onCloudOAuth('github')}
                  disabled={cloudBusy || !cloudStatus?.configured}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800 disabled:opacity-50 transition"
                >
                  <Github className="w-3.5 h-3.5" />
                  GitHub 登录
                </button>
                <button
                  type="button"
                  onClick={() => void onCloudOAuth('google')}
                  disabled={cloudBusy || !cloudStatus?.configured}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
                >
                  <span className="text-sm font-semibold">G</span>
                  Google 登录
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
                    <ShieldCheck className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-700 dark:text-slate-200">{cloudAuth.email ?? '云端账号'}</div>
                    <div className="text-xs text-slate-400">{cloudAuth.provider === 'email' ? '邮箱' : cloudAuth.provider === 'github' ? 'GitHub' : 'Google'}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onCloudSignOut}
                  disabled={cloudBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  退出登录
                </button>
              </div>

              <div>
                <div className="mb-2 text-sm text-slate-600 dark:text-slate-300">首次登录的数据范围</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    ['include', '包含已有历史', '上传本机已扫描的统计记录，跨设备统一汇总。'],
                    ['future-only', '仅同步今后数据', '不上传历史，从现在开始记录新的统计。'],
                  ] as const).map(([value, label, description]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCloudHistoryMode(value)}
                      className={cn(
                        'text-left rounded-lg border px-3 py-2 transition',
                        cloudSettings.historyMode === value
                          ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                          : 'border-slate-200 bg-white/60 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
                      )}
                    >
                      <div className="text-xs font-medium">{label}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">启用云同步</div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">仅上传 token、模型、来源、时间和请求数，不上传 prompt、回复或本地日志。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCloudSettings((current) => ({ ...current, enabled: !current.enabled }))}
                  disabled={cloudSettings.historyMode === 'ask'}
                  aria-pressed={cloudSettings.enabled}
                  className={cn(
                    'relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50',
                    cloudSettings.enabled ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-700',
                  )}
                >
                  <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition', cloudSettings.enabled ? 'left-5' : 'left-0.5')} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onSaveCloudSettings}
                  disabled={cloudBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs text-white hover:bg-brand-600 disabled:opacity-50 transition"
                >
                  <Save className="w-3.5 h-3.5" />
                  保存同步设置
                </button>
                <button
                  type="button"
                  onClick={onSyncCloud}
                  disabled={cloudBusy || !cloudSettings.enabled}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <RefreshCcw className={cn('w-3.5 h-3.5', cloudBusy && 'animate-spin')} />
                  立即同步
                </button>
              </div>

              <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm text-slate-600 dark:text-slate-300">所有设备合计</div>
                  <span className="text-xs text-slate-400">{formatNumber(cloudSummary?.byDevice.length ?? 0)} 台设备</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <DataTile label="加权 Token" value={cloudSummary?.weightedTotalTokens ?? 0} />
                  <DataTile label="原始 Token" value={cloudSummary?.rawTotalTokens ?? 0} />
                  <DataTile label="请求数" value={cloudSummary?.requestCount ?? 0} />
                </div>
                {(cloudSummary?.bySource.length ?? 0) > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {cloudSummary!.bySource.slice(0, 6).map((item) => (
                      <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate text-slate-500 dark:text-slate-400">{item.label}</span>
                        <span className="shrink-0 tabular-nums text-slate-700 dark:text-slate-200">{formatNumber(item.weightedTotalTokens)} token · {formatNumber(item.requestCount)} 次</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {(cloudMessage || cloudStatus) && (
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{cloudMessage || (cloudStatus?.enabled ? '云同步已开启。' : '云同步默认关闭。')}</span>
                {cloudStatus?.enabled && <span className="text-xs text-slate-400">待上传 {formatNumber(cloudStatus.pendingCount)}</span>}
              </div>
              {cloudStatus?.lastSyncedAt && <div className="mt-1 text-xs text-slate-400">上次同步 {formatRelativeMinutes(cloudStatus.lastSyncedAt)}</div>}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="外观" subtitle="主题模式与背景图" />
        <CardBody className="space-y-6">
          <div>
            <div className="text-sm text-slate-600 dark:text-slate-300 mb-2">主题模式</div>
            <div className="grid grid-cols-3 gap-2 max-w-md">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm border transition',
                    theme === value
                      ? 'bg-brand-500/10 border-brand-500/40 text-brand-700 dark:text-brand-300'
                      : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm text-slate-600 dark:text-slate-300 mb-2">背景图库</div>
            <div className="flex items-center gap-3">
              <button
                onClick={onPickImage}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-500 text-white text-sm hover:bg-brand-600 transition"
              >
                <ImageIcon className="w-4 h-4" />
                上传图片
              </button>
              {backgroundImage && (
                <button
                  onClick={() => setBackgroundImage(null)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                  关闭背景
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={onFileChosen}
              />
            </div>
            {backgroundImages.length > 0 && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div
                  className={cn(
                    'group relative aspect-video rounded-xl overflow-hidden border transition bg-slate-50 dark:bg-slate-800',
                    !activeBackgroundId
                      ? 'border-brand-500 ring-2 ring-brand-500/25'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectBackgroundImage(null)}
                    className="flex h-full w-full items-center justify-center text-sm text-slate-500 dark:text-slate-400"
                    title="无背景"
                  >
                    无背景
                    {!activeBackgroundId && (
                      <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-brand-500 text-white flex items-center justify-center shadow-sm">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </button>
                </div>
                {backgroundImages.map((image) => {
                  const active = image.id === activeBackgroundId
                  return (
                    <div
                      key={image.id}
                      className={cn(
                        'group relative aspect-video rounded-xl overflow-hidden border transition bg-slate-100 dark:bg-slate-800',
                        active
                          ? 'border-brand-500 ring-2 ring-brand-500/25'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => selectBackgroundImage(image.id)}
                        className="block w-full h-full"
                        title={image.name}
                      >
                        <img src={image.dataUrl} alt="" className="w-full h-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 px-2 py-1 text-[11px] text-white bg-slate-950/45 truncate">
                          {image.name}
                        </span>
                        {active && (
                          <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-brand-500 text-white flex items-center justify-center shadow-sm">
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </button>
                      {!image.builtin && (
                        <button
                          type="button"
                          onClick={() => removeBackgroundImage(image.id)}
                          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-slate-950/45 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {backgroundImage && (
              <div className="mt-4">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  背景清晰度 — {Math.round(backgroundOpacity * 100)}%
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={backgroundOpacity}
                  onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                  className="w-full max-w-md accent-brand-500"
                />
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm text-slate-600 dark:text-slate-300">静默背景欣赏</div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  一段时间不操作后，界面会淡成轻玻璃感，点击任意位置恢复。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIdleBackgroundModeEnabled(!idleBackgroundModeEnabled)}
                className={cn(
                  'relative h-6 w-11 rounded-full transition shrink-0',
                  idleBackgroundModeEnabled ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-700',
                )}
                aria-pressed={idleBackgroundModeEnabled}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition',
                    idleBackgroundModeEnabled ? 'left-5' : 'left-0.5',
                  )}
                />
              </button>
            </div>
            {idleBackgroundModeEnabled && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {IDLE_TIMEOUTS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setIdleTimeoutPreset(option.value)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs border transition',
                        idleTimeoutPreset === option.value
                          ? 'bg-brand-500/10 border-brand-500/40 text-brand-700 dark:text-brand-300'
                          : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {idleTimeoutPreset === 'custom' && (
                  <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    自定义秒数
                    <input
                      type="number"
                      min={5}
                      max={86400}
                      value={idleCustomSeconds}
                      onChange={(e) => setIdleCustomSeconds(Number(e.target.value))}
                      className="w-28 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-2 py-1 text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="网络代理"
          subtitle="仅用于余量查询，不影响本地 CPA 同步"
          action={
            <span className="rounded-lg bg-blue-100 p-2 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
              <Globe2 className="w-4 h-4" />
            </span>
          }
        />
        <CardBody className="space-y-4">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            余量查询代理
            <input
              value={networkSettings.quotaProxyUrl}
              onChange={(e) =>
                setNetworkSettings((current) => ({ ...current, quotaProxyUrl: e.target.value }))
              }
              placeholder="http://127.0.0.1:7897"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </label>
          <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-slate-400" />
              <span>{networkMessage || 'Clash 端口可填写 http://127.0.0.1:7897。'}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              当前支持 HTTP / Mixed 代理端口；本地 127.0.0.1:8320 的 CPA 同步仍然直连。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSaveNetwork}
              disabled={networkBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-xs text-white hover:bg-brand-600 disabled:opacity-50 transition"
            >
              <Save className="w-3.5 h-3.5" />
              保存代理
            </button>
            <button
              type="button"
              onClick={() => setNetworkSettings({ quotaProxyUrl: 'http://127.0.0.1:7897' })}
              disabled={networkBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition"
            >
              使用 Clash 7897
            </button>
            <button
              type="button"
              onClick={() => setNetworkSettings({ quotaProxyUrl: '' })}
              disabled={networkBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition"
            >
              清空
            </button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="远程数据源"
          subtitle={
            remoteStatus?.lastSyncedAt
              ? `上次同步 ${formatRelativeMinutes(remoteStatus.lastSyncedAt)}`
              : '通过本机 SSH 只读同步远端日志'
          }
          action={
            <button
              type="button"
              onClick={() => onOpenSpecialPath('ssh-readme')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              SSH 填写指南
            </button>
          }
        />
        <CardBody className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-slate-600 dark:text-slate-300">启用远程同步</div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                使用系统 ssh 拉取远端 JSONL 到本地缓存，不保存密码，不在远端常驻。
              </p>
            </div>
            <button
              type="button"
              onClick={() => updateRemoteField('enabled', !remoteSettings.enabled)}
              className={cn(
                'relative h-6 w-11 rounded-full transition shrink-0',
                remoteSettings.enabled ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-700',
              )}
              aria-pressed={remoteSettings.enabled}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition',
                  remoteSettings.enabled ? 'left-5' : 'left-0.5',
                )}
              />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="sm:col-span-2 text-xs text-slate-500 dark:text-slate-400">
              Host / SSH config alias
              <input
                value={remoteSettings.host}
                onChange={(e) => updateRemoteField('host', e.target.value)}
                placeholder="company-dev 或 xxx.company.com"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              User 可选
              <input
                value={remoteSettings.user ?? ''}
                onChange={(e) => updateRemoteField('user', e.target.value)}
                placeholder="留空用 ssh config"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Port
              <input
                type="number"
                min={1}
                max={65535}
                value={remoteSettings.port ?? 22}
                onChange={(e) => updateRemoteField('port', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Claude Code 远端路径
              <input
                value={remoteSettings.claudePath}
                onChange={(e) => updateRemoteField('claudePath', e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Codex 远端路径
              <input
                value={remoteSettings.codexPath}
                onChange={(e) => updateRemoteField('codexPath', e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </label>
          </div>

          <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-slate-400" />
              <span>{remoteMessage || '保存后可测试连接并同步远端日志。'}</span>
            </div>
            {remoteStatus?.cachePath && (
              <code className="block mt-1 text-xs text-slate-400 truncate">
                {remoteStatus.cachePath}
              </code>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSaveRemote}
              disabled={remoteBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-xs text-white hover:bg-brand-600 disabled:opacity-50 transition"
            >
              <Save className="w-3.5 h-3.5" />
              保存远程源
            </button>
            <button
              type="button"
              onClick={onTestRemote}
              disabled={remoteBusy || !remoteSettings.enabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition"
            >
              <RefreshCcw className={cn('w-3.5 h-3.5', remoteBusy && 'animate-spin')} />
              测试连接
            </button>
            <button
              type="button"
              onClick={onSyncRemote}
              disabled={remoteBusy || !remoteSettings.enabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-xs text-white hover:bg-slate-800 disabled:opacity-50 transition"
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              同步远端日志
            </button>
            <button
              type="button"
              onClick={() => onOpenSpecialPath('remote-cache')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              打开缓存
            </button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="数据源"
          subtitle={status ? `更新于 ${formatRelativeMinutes(status.lastUpdatedAt)}` : '本地估算'}
          action={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRescan}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition"
              >
                <RefreshCcw className={cn('w-3.5 h-3.5', busy && 'animate-spin')} />
                重新扫描
              </button>
              <button
                type="button"
                onClick={onClearCache}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-xs text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-50 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清理缓存
              </button>
            </div>
          }
        />
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <DataTile label="扫描文件" value={status?.scannedFiles ?? 0} />
            <DataTile label="请求记录" value={status?.requestCount ?? 0} />
            <DataTile label="本次解析" value={status?.parsedFiles ?? 0} />
            <DataTile label="缓存复用" value={status?.reusedFiles ?? 0} />
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
            {(status?.sources ?? []).map((source) => (
              <div
                key={`${source.source}:${source.rootPath}`}
                className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-800"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        source.healthy ? 'bg-emerald-500' : 'bg-amber-500',
                      )}
                    />
                    <span className="text-slate-700 dark:text-slate-200">{source.label}</span>
                    <span className="text-xs text-slate-400">
                      {formatNumber(source.requestCount)} records
                    </span>
                  </div>
                  <code className="block mt-1 text-xs text-slate-400 truncate">
                    {source.rootPath}
                  </code>
                  {source.lastError && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-300 break-words">
                      {source.lastError}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenPath({ source: source.source, rootPath: source.rootPath })}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  打开
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <span className="text-slate-700 dark:text-slate-200">应用缓存目录</span>
                <div className="mt-1 text-xs text-slate-400">扫描缓存与本地应用数据</div>
              </div>
              <button
                type="button"
                onClick={() => onOpenPath('cache')}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                打开
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="软件更新"
          subtitle={
            updateStatus
              ? `${updateStatus.currentVersion} · ${formatUpdateState(updateStatus)}`
              : 'GitHub Releases 接口预留'
          }
          action={
            <button
              type="button"
              onClick={onCheckUpdate}
              disabled={updateBusy || updateProvider === 'none'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition"
            >
              <RefreshCcw className={cn('w-3.5 h-3.5', updateBusy && 'animate-spin')} />
              检查更新
            </button>
          }
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['none', 'github', 'generic'] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => setUpdateProvider(provider)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs border transition',
                  updateProvider === provider
                    ? 'bg-brand-500/10 border-brand-500/40 text-brand-700 dark:text-brand-300'
                    : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
                )}
              >
                {provider === 'github' ? 'GitHub Releases' : provider === 'generic' ? '通用 URL' : '暂不配置'}
              </button>
            ))}
          </div>

          {updateProvider === 'github' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-slate-500 dark:text-slate-400">
                GitHub Owner
                <input
                  value={githubOwner}
                  onChange={(e) => setGithubOwner(e.target.value)}
                  placeholder="例如 your-name"
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </label>
              <label className="text-xs text-slate-500 dark:text-slate-400">
                Repository
                <input
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="例如 agent-token-tracker"
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </label>
            </div>
          )}

          {updateProvider === 'generic' && (
            <label className="text-xs text-slate-500 dark:text-slate-400">
              更新源 URL
              <input
                value={genericUrl}
                onChange={(e) => setGenericUrl(e.target.value)}
                placeholder="https://example.com/agent-token-tracker"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </label>
          )}

          <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between gap-3">
              <span>{updateStatus?.message ?? '未配置更新源'}</span>
              {typeof updateStatus?.percent === 'number' && (
                <span className="tabular-nums">{Math.round(updateStatus.percent)}%</span>
              )}
            </div>
            {updateStatus?.updateSource && (
              <code className="block mt-1 text-xs text-slate-400 truncate">
                {updateStatus.updateSource}
              </code>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSaveUpdateSettings}
              disabled={updateBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-xs text-white hover:bg-brand-600 disabled:opacity-50 transition"
            >
              <Save className="w-3.5 h-3.5" />
              保存更新源
            </button>
            {updateStatus?.state === 'available' && (
              <button
                type="button"
                onClick={onDownloadUpdate}
                disabled={updateBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-xs text-white hover:bg-slate-800 disabled:opacity-50 transition"
              >
                <DownloadCloud className="w-3.5 h-3.5" />
                下载更新
              </button>
            )}
            {updateStatus?.state === 'downloaded' && (
              <button
                type="button"
                onClick={onInstallUpdate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-xs text-white hover:bg-emerald-600 transition"
              >
                <DownloadCloud className="w-3.5 h-3.5" />
                重启安装
              </button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function formatUpdateState(status: UpdateStatus) {
  const map: Record<UpdateStatus['state'], string> = {
    idle: '待检查',
    'not-configured': '未配置',
    checking: '检查中',
    available: '有新版本',
    'not-available': '已是最新',
    downloading: '下载中',
    downloaded: '待安装',
    error: '检查失败',
  }
  return map[status.state]
}

function DataTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 px-3 py-2">
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
        {formatNumber(value)}
      </div>
    </div>
  )
}

function readBackgroundFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const raw = String(reader.result)
      const image = new Image()
      image.onerror = () => resolve(raw)
      image.onload = () => {
        const maxSide = 2560
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(raw)
          return
        }
        ctx.drawImage(image, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.86))
      }
      image.src = raw
    }
    reader.readAsDataURL(file)
  })
}

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
  Save,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AgentSource, DataSourceStatus, UpdateProviderSettings, UpdateStatus } from '@/types/api'
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
  const [updateProvider, setUpdateProvider] = useState<UpdateProviderSettings['provider']>('none')
  const [githubOwner, setGithubOwner] = useState('')
  const [githubRepo, setGithubRepo] = useState('')
  const [genericUrl, setGenericUrl] = useState('')
  const [busy, setBusy] = useState(false)
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

  const onOpenPath = (kind: AgentSource | 'cache') => {
    void api.openLocalPath(kind)
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
                key={source.source}
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
                </div>
                <button
                  type="button"
                  onClick={() => onOpenPath(source.source)}
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

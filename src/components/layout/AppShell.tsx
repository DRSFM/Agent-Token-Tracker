import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'

export default function AppShell({ children }: { children: ReactNode }) {
  const {
    backgroundImage,
    backgroundOpacity,
    idleBackgroundModeEnabled,
    idleTimeoutPreset,
    idleCustomSeconds,
  } = useSettings()
  const [idle, setIdle] = useState(false)
  const timerRef = useRef<number | null>(null)

  const idleSeconds = useMemo(() => {
    if (!idleBackgroundModeEnabled || !backgroundImage || idleTimeoutPreset === 'never') return null
    return idleTimeoutPreset === 'custom' ? idleCustomSeconds : Number(idleTimeoutPreset)
  }, [backgroundImage, idleBackgroundModeEnabled, idleTimeoutPreset, idleCustomSeconds])

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    const armTimer = () => {
      clearTimer()
      if (!idleSeconds) {
        setIdle(false)
        return
      }
      timerRef.current = window.setTimeout(() => setIdle(true), idleSeconds * 1000)
    }
    const activate = () => {
      setIdle(false)
      armTimer()
    }

    armTimer()
    window.addEventListener('pointerdown', activate)
    window.addEventListener('keydown', activate)
    window.addEventListener('wheel', activate, { passive: true })
    return () => {
      clearTimer()
      window.removeEventListener('pointerdown', activate)
      window.removeEventListener('keydown', activate)
      window.removeEventListener('wheel', activate)
    }
  }, [idleSeconds])

  return (
    <div className={cn('app-shell h-screen w-screen overflow-hidden relative', idle && 'is-idle')}>
      {backgroundImage && (
        <div
          className="app-bg"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            opacity: backgroundOpacity,
          }}
        />
      )}

      {idle && (
        <div className="idle-hint pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-20 rounded-full border border-white/20 bg-slate-950/20 px-4 py-2 text-xs text-white/70 backdrop-blur-sm">
          点击任意位置恢复
        </div>
      )}

      {/* 静默模式下整体（除原生窗口控制按钮外）渐隐为透明玻璃 */}
      <div className="app-glass-layer h-full w-full flex">
        <Sidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main className="flex-1 overflow-y-auto px-8 pb-8">{children}</main>
        </div>
      </div>
    </div>
  )
}

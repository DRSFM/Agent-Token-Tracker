import { create } from 'zustand'
import tifa2bWeddingBackground from '@/assets/backgrounds/tifa-2b-wedding-4k.png'
import tifaWeddingBackground from '@/assets/backgrounds/tifa-wedding-4k.png'

export type ThemeMode = 'light' | 'dark' | 'system'
export type IdleTimeoutPreset = '30' | '60' | '300' | '900' | '3600' | 'never' | 'custom'

export interface BackgroundImageItem {
  id: string
  name: string
  dataUrl: string
  createdAt: string
  builtin?: boolean
}

interface SettingsState {
  theme: ThemeMode
  /** 用户上传的背景图 dataURL，null 表示无 */
  backgroundImage: string | null
  /** 背景图库：内置图 + 用户上传图 */
  backgroundImages: BackgroundImageItem[]
  activeBackgroundId: string | null
  /** 背景图不透明度 0~1 */
  backgroundOpacity: number
  idleBackgroundModeEnabled: boolean
  idleTimeoutPreset: IdleTimeoutPreset
  idleCustomSeconds: number
  setTheme: (t: ThemeMode) => void
  setBackgroundImage: (img: string | null) => void
  addBackgroundImage: (name: string, dataUrl: string) => void
  selectBackgroundImage: (id: string | null) => void
  removeBackgroundImage: (id: string) => void
  setBackgroundOpacity: (o: number) => void
  setIdleBackgroundModeEnabled: (enabled: boolean) => void
  setIdleTimeoutPreset: (preset: IdleTimeoutPreset) => void
  setIdleCustomSeconds: (seconds: number) => void
}

const STORAGE_KEY = 'token-dashboard.settings'
const BUILTIN_BACKGROUND_IDS = new Set(['builtin-tifa-2b-wedding', 'builtin-tifa-wedding'])
const BUILTIN_BACKGROUND_IMAGES: BackgroundImageItem[] = [
  {
    id: 'builtin-tifa-2b-wedding',
    name: '蒂法 2B 花嫁 4K',
    dataUrl: tifa2bWeddingBackground,
    createdAt: '2026-04-24T00:00:00.000Z',
    builtin: true,
  },
  {
    id: 'builtin-tifa-wedding',
    name: '蒂法花嫁 4K',
    dataUrl: tifaWeddingBackground,
    createdAt: '2026-04-24T00:00:00.000Z',
    builtin: true,
  },
]

interface PersistedSettings {
  theme: ThemeMode
  backgroundImage: string | null
  backgroundImages?: BackgroundImageItem[]
  activeBackgroundId?: string | null
  backgroundOpacity: number
  idleBackgroundModeEnabled?: boolean
  idleTimeoutPreset?: IdleTimeoutPreset
  idleCustomSeconds?: number
}

const baseDefaultSettings: PersistedSettings = {
  theme: 'system',
  backgroundImage: null,
  backgroundImages: [],
  activeBackgroundId: null,
  backgroundOpacity: 0.85,
  idleBackgroundModeEnabled: false,
  idleTimeoutPreset: '300',
  idleCustomSeconds: 120,
}

const loadPersisted = (): PersistedSettings => {
  if (typeof window === 'undefined') {
    return createDefaultSettings()
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedSettings
      return normalizePersisted(parsed)
    }
  } catch {
    // ignore
  }
  const defaults = createDefaultSettings()
  persist(defaults)
  return defaults
}

const persist = (s: PersistedSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore (e.g. image too large)
  }
}

const createBackgroundId = () => `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const pickRandomBuiltinBackgroundId = () =>
  BUILTIN_BACKGROUND_IMAGES[Math.floor(Math.random() * BUILTIN_BACKGROUND_IMAGES.length)]?.id ?? null

const mergeBuiltinBackgroundImages = (images: BackgroundImageItem[]) => {
  const customImages = images.filter((image) => !BUILTIN_BACKGROUND_IDS.has(image.id))
  return [...customImages, ...BUILTIN_BACKGROUND_IMAGES]
}

const createDefaultSettings = (): PersistedSettings =>
  normalizePersisted(baseDefaultSettings, { selectDefaultBackground: true })

const normalizePersisted = (
  settings: PersistedSettings,
  options: { selectDefaultBackground?: boolean } = {},
): PersistedSettings => {
  if (settings.backgroundImage && (settings.backgroundImages ?? []).length === 0) {
    const migrated = {
      id: createBackgroundId(),
      name: '已保存背景',
      dataUrl: settings.backgroundImage,
      createdAt: new Date().toISOString(),
    }
    return normalizePersisted({
      ...settings,
      backgroundImages: [migrated],
      activeBackgroundId: migrated.id,
      backgroundOpacity: settings.backgroundOpacity ?? 0.85,
    })
  }

  const backgroundImages = mergeBuiltinBackgroundImages(settings.backgroundImages ?? [])
  const activeBackgroundId =
    settings.activeBackgroundId ??
    (options.selectDefaultBackground && !settings.backgroundImage
      ? pickRandomBuiltinBackgroundId()
      : null)
  const activeImage = backgroundImages.find((image) => image.id === activeBackgroundId)

  return {
    ...settings,
    backgroundImage: activeImage?.dataUrl ?? null,
    backgroundImages,
    activeBackgroundId: activeImage?.id ?? null,
    backgroundOpacity: settings.backgroundOpacity ?? 0.85,
    idleBackgroundModeEnabled: settings.idleBackgroundModeEnabled ?? false,
    idleTimeoutPreset: settings.idleTimeoutPreset ?? '300',
    idleCustomSeconds: settings.idleCustomSeconds ?? 120,
  }
}

const applyTheme = (mode: ThemeMode) => {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)
  root.classList.toggle('dark', isDark)
}

const initial = loadPersisted()

export const useSettings = create<SettingsState>((set, get) => ({
  theme: initial.theme,
  backgroundImage: initial.backgroundImage,
  backgroundImages: initial.backgroundImages ?? [],
  activeBackgroundId: initial.activeBackgroundId ?? null,
  backgroundOpacity: initial.backgroundOpacity,
  idleBackgroundModeEnabled: initial.idleBackgroundModeEnabled ?? false,
  idleTimeoutPreset: initial.idleTimeoutPreset ?? '300',
  idleCustomSeconds: initial.idleCustomSeconds ?? 120,
  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    persistCurrent(get())
  },
  setBackgroundImage: (backgroundImage) => {
    if (!backgroundImage) {
      set({ backgroundImage: null, activeBackgroundId: null })
      persistCurrent(get())
      return
    }
    get().addBackgroundImage('自定义背景', backgroundImage)
  },
  addBackgroundImage: (name, dataUrl) => {
    const image: BackgroundImageItem = {
      id: createBackgroundId(),
      name,
      dataUrl,
      createdAt: new Date().toISOString(),
    }
    const { backgroundImages } = get()
    const nextImages = [image, ...backgroundImages]
    set({ backgroundImages: nextImages, activeBackgroundId: image.id, backgroundImage: image.dataUrl })
    persistCurrent(get())
  },
  selectBackgroundImage: (id) => {
    const { backgroundImages } = get()
    const selected = backgroundImages.find((image) => image.id === id)
    set({ activeBackgroundId: selected?.id ?? null, backgroundImage: selected?.dataUrl ?? null })
    persistCurrent(get())
  },
  removeBackgroundImage: (id) => {
    if (BUILTIN_BACKGROUND_IDS.has(id)) return
    const { backgroundImages, activeBackgroundId } = get()
    const nextImages = backgroundImages.filter((image) => image.id !== id)
    const nextActiveId = activeBackgroundId === id ? nextImages[0]?.id ?? null : activeBackgroundId
    const nextBackground = nextImages.find((image) => image.id === nextActiveId)?.dataUrl ?? null
    set({
      backgroundImages: nextImages,
      activeBackgroundId: nextActiveId,
      backgroundImage: nextBackground,
    })
    persistCurrent(get())
  },
  setBackgroundOpacity: (backgroundOpacity) => {
    const clamped = Math.min(1, Math.max(0.1, backgroundOpacity))
    set({ backgroundOpacity: clamped })
    persistCurrent(get())
  },
  setIdleBackgroundModeEnabled: (idleBackgroundModeEnabled) => {
    set({ idleBackgroundModeEnabled })
    persistCurrent(get())
  },
  setIdleTimeoutPreset: (idleTimeoutPreset) => {
    set({ idleTimeoutPreset })
    persistCurrent(get())
  },
  setIdleCustomSeconds: (idleCustomSeconds) => {
    set({ idleCustomSeconds: Math.max(5, Math.floor(idleCustomSeconds)) })
    persistCurrent(get())
  },
}))

function persistCurrent(state: SettingsState) {
  persist({
    theme: state.theme,
    backgroundImage: state.backgroundImage,
    backgroundImages: state.backgroundImages,
    activeBackgroundId: state.activeBackgroundId,
    backgroundOpacity: state.backgroundOpacity,
    idleBackgroundModeEnabled: state.idleBackgroundModeEnabled,
    idleTimeoutPreset: state.idleTimeoutPreset,
    idleCustomSeconds: state.idleCustomSeconds,
  })
}

export function initThemeFromStorage() {
  if (typeof window === 'undefined') return
  applyTheme(initial.theme)
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      const { theme } = useSettings.getState()
      if (theme === 'system') applyTheme('system')
    })
}

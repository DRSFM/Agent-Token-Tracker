import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { QuotaVisibilitySettings } from '../src/types/api'
import { getUserDataPath } from './app-paths'

const defaultSettings: QuotaVisibilitySettings = {
  hiddenAccounts: [],
}

function settingsPath() {
  return path.join(getUserDataPath(), 'quota-visibility.json')
}

function normalizeHiddenAccounts(value: unknown) {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim()),
    ),
  ]
}

export async function getQuotaVisibilitySettings(): Promise<QuotaVisibilitySettings> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<QuotaVisibilitySettings>
    return {
      hiddenAccounts: normalizeHiddenAccounts(raw.hiddenAccounts),
    }
  } catch {
    return defaultSettings
  }
}

export async function setQuotaVisibilitySettings(
  settings: QuotaVisibilitySettings,
): Promise<QuotaVisibilitySettings> {
  const next: QuotaVisibilitySettings = {
    hiddenAccounts: normalizeHiddenAccounts(settings.hiddenAccounts),
  }
  const targetPath = settingsPath()
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, JSON.stringify(next, null, 2), 'utf8')
  return next
}

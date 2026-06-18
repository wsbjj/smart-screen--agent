import Store from 'electron-store'

export type AppSettings = {
  model: string
  baseUrl: string
}

const defaultSettings: AppSettings = {
  model: 'gpt-5.2',
  baseUrl: '',
}

const storeOptions = {
  name: 'smart-screen-agent-settings',
  projectName: 'smart-screen-agent',
  defaults: {
    settings: defaultSettings,
  },
}

const store = new Store<{
  settings: AppSettings
}>(storeOptions as ConstructorParameters<typeof Store<{ settings: AppSettings }>>[0])

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('自定义 URL 必须是有效 URL，例如 https://api.example.com/v1')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('自定义 URL 必须使用 http 或 https')
  }

  return url.toString().replace(/\/+$/, '')
}

export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    model: settings.model?.trim() || defaultSettings.model,
    baseUrl: normalizeBaseUrl(settings.baseUrl ?? ''),
  }
}

export function getSettings(): AppSettings {
  return normalizeSettings(store.get('settings'))
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const normalized = normalizeSettings(settings)
  store.set('settings', normalized)
  return normalized
}

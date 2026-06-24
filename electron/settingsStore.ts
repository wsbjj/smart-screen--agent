import Store from 'electron-store'
import type { FilenameRouteAlias, RoutingMode } from '../src/shared/types.js'

export type AppSettings = {
  model: string
  baseUrl: string
  routingMode: RoutingMode
  filenameAliases: FilenameRouteAlias[]
  llmRoutingConcurrency: number
}

const defaultSettings: AppSettings = {
  model: 'gpt-5.2',
  baseUrl: '',
  routingMode: 'hybrid',
  filenameAliases: [],
  llmRoutingConcurrency: 10,
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

function normalizeRoutingMode(value: unknown): RoutingMode {
  return value === 'local_only' ? 'local_only' : 'hybrid'
}

function normalizeLlmRoutingConcurrency(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) {
    return defaultSettings.llmRoutingConcurrency
  }
  return Math.max(1, Math.min(30, Math.round(numericValue)))
}

function normalizeFilenameAliases(value: unknown): FilenameRouteAlias[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item): FilenameRouteAlias[] => {
    if (typeof item !== 'object' || item === null) {
      return []
    }
    const candidate = item as Partial<FilenameRouteAlias>
    const id = String(candidate.id ?? '').trim()
    const pattern = String(candidate.pattern ?? '').trim()
    const agentId = String(candidate.agentId ?? '').trim()
    if (!id || !pattern || !agentId) {
      return []
    }
    return [{ id, pattern, agentId }]
  })
}

export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    model: settings.model?.trim() || defaultSettings.model,
    baseUrl: normalizeBaseUrl(settings.baseUrl ?? ''),
    routingMode: normalizeRoutingMode(settings.routingMode),
    filenameAliases: normalizeFilenameAliases(settings.filenameAliases),
    llmRoutingConcurrency: normalizeLlmRoutingConcurrency(settings.llmRoutingConcurrency),
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

import { createHash } from 'node:crypto'
import Store from 'electron-store'
import type { AppSettings } from './settingsStore.js'
import type {
  JobAgentConfig,
  ResumeDocument,
  RouterDecision,
  RoutingDecisionCache,
} from '../src/shared/types.js'

const routingCacheVersion = 'routing-v1'
const defaultMaxEntries = 10000

type RoutingCacheEntry = {
  decision: RouterDecision
  createdAt: number
}

type RoutingCacheData = {
  entries: Record<string, RoutingCacheEntry>
}

export type RoutingCacheStore = {
  get: (key: 'entries') => unknown
  set: (key: 'entries', value: Record<string, RoutingCacheEntry>) => void
}

const defaultStore = new Store<RoutingCacheData>({
  name: 'smart-screen-agent-routing-cache',
  projectName: 'smart-screen-agent',
  defaults: {
    entries: {},
  },
} as ConstructorParameters<typeof Store<RoutingCacheData>>[0])

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function readEntries(store: RoutingCacheStore): Record<string, RoutingCacheEntry> {
  const entries = store.get('entries')
  return typeof entries === 'object' && entries !== null
    ? { ...(entries as Record<string, RoutingCacheEntry>) }
    : {}
}

function pruneEntries(
  entries: Record<string, RoutingCacheEntry>,
  maxEntries: number,
): Record<string, RoutingCacheEntry> {
  const sorted = Object.entries(entries).sort((left, right) => left[1].createdAt - right[1].createdAt)
  while (sorted.length > maxEntries) {
    const [oldestKey] = sorted.shift()!
    delete entries[oldestKey]
  }
  return entries
}

export function createRoutingCacheKey(
  resume: ResumeDocument,
  agents: JobAgentConfig[],
  settings: AppSettings,
): string {
  const fingerprint = {
    version: routingCacheVersion,
    resume: {
      fileName: resume.fileName,
      wordCount: resume.wordCount,
      textHash: hashValue(resume.text),
    },
    agents: agents.map((agent) => ({
      id: agent.id,
      title: agent.title,
      summary: agent.summary,
      mustHaves: agent.mustHaves,
    })),
    routing: {
      model: settings.model,
      baseUrl: settings.baseUrl,
      routingMode: settings.routingMode,
      filenameAliases: settings.filenameAliases,
    },
  }
  return `${routingCacheVersion}:${hashValue(JSON.stringify(fingerprint))}`
}

export function createRoutingCache(
  settings: AppSettings,
  options: {
    store?: RoutingCacheStore
    maxEntries?: number
  } = {},
): RoutingDecisionCache {
  const store = options.store ?? defaultStore
  const maxEntries = Math.max(1, options.maxEntries ?? defaultMaxEntries)

  return {
    get: async (resume, agents) => {
      const entries = readEntries(store)
      const entry = entries[createRoutingCacheKey(resume, agents, settings)]
      if (!entry) {
        return null
      }
      return {
        ...entry.decision,
        resumeId: resume.id,
      }
    },
    set: async (resume, agents, decision) => {
      const entries = readEntries(store)
      entries[createRoutingCacheKey(resume, agents, settings)] = {
        decision,
        createdAt: Date.now(),
      }
      store.set('entries', pruneEntries(entries, maxEntries))
    },
  }
}

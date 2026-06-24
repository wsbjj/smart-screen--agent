import { describe, expect, it } from 'vitest'
import {
  createRoutingCache,
  createRoutingCacheKey,
  type RoutingCacheStore,
} from './routingCache.js'
import type { AppSettings } from './settingsStore.js'
import type { JobAgentConfig, ResumeDocument, RouterDecision } from '../src/shared/types.js'

const settings: AppSettings = {
  model: 'gpt-5.2',
  baseUrl: '',
  routingMode: 'hybrid',
  filenameAliases: [],
  llmRoutingConcurrency: 10,
}

const agents: JobAgentConfig[] = [
  {
    id: 'job-1',
    title: '前端工程师',
    summary: '负责桌面端产品开发',
    mustHaves: ['React'],
    niceToHaves: [],
    riskFlags: [],
    criteria: [{ id: 'frontend', label: '前端', weight: 100, description: 'React' }],
    instructions: '只根据证据评分。',
    thresholds: { strongYes: 85, yes: 75, maybe: 60 },
  },
]

const resume: ResumeDocument = {
  id: 'resume-1',
  fileName: '张三.pdf',
  extension: '.pdf',
  text: '张三 React 项目经验',
  wordCount: 4,
}

function createFakeStore(initial: Record<string, unknown> = {}): RoutingCacheStore {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    get: (key) => data.get(key),
    set: (key, value) => {
      data.set(key, value)
    },
  }
}

describe('routing cache', () => {
  it('changes cache keys when routing settings change without including resume text', () => {
    const baseKey = createRoutingCacheKey(resume, agents, settings)
    const aliasKey = createRoutingCacheKey(resume, agents, {
      ...settings,
      filenameAliases: [{ id: 'alias-1', pattern: '亚马逊运营', agentId: 'job-1' }],
    })

    expect(baseKey).not.toBe(aliasKey)
    expect(baseKey).not.toContain(resume.text)
    expect(baseKey).toMatch(/^routing-v1:/)
  })

  it('stores and restores route decisions by stable hash key', async () => {
    const store = createFakeStore()
    const cache = createRoutingCache(settings, { store, maxEntries: 10 })
    const decision: RouterDecision = {
      resumeId: resume.id,
      agentId: 'job-1',
      layer: 'filename',
      confidence: 1,
    }

    await cache.set(resume, agents, decision)

    await expect(cache.get({ ...resume, id: 'resume-current' }, agents)).resolves.toEqual({
      ...decision,
      resumeId: 'resume-current',
    })
    expect(JSON.stringify(store.get('entries'))).not.toContain(resume.text)
  })

  it('prunes the oldest cache entries when the max size is exceeded', async () => {
    const store = createFakeStore()
    const cache = createRoutingCache(settings, { store, maxEntries: 2 })
    const decision: RouterDecision = {
      resumeId: resume.id,
      agentId: 'job-1',
      layer: 'filename',
      confidence: 1,
    }

    await cache.set({ ...resume, id: 'resume-1', fileName: '一.pdf' }, agents, decision)
    await cache.set({ ...resume, id: 'resume-2', fileName: '二.pdf' }, agents, decision)
    await cache.set({ ...resume, id: 'resume-3', fileName: '三.pdf' }, agents, decision)

    const entries = store.get('entries') as Record<string, unknown>
    expect(Object.keys(entries)).toHaveLength(2)
    await expect(cache.get({ ...resume, id: 'resume-current', fileName: '一.pdf' }, agents)).resolves.toBeNull()
  })
})

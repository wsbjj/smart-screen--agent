import { describe, expect, it } from 'vitest'
import { normalizeSettings, normalizeBaseUrl } from './settingsStore.js'

describe('settings store normalization', () => {
  it('normalizes a custom OpenAI-compatible base URL', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1')
  })

  it('rejects invalid custom URLs', () => {
    expect(() => normalizeBaseUrl('localhost:3000')).toThrow('http 或 https')
  })

  it('keeps model and base URL as persisted app settings', () => {
    expect(
      normalizeSettings({
        model: 'gpt-5.4-mini',
        baseUrl: 'https://api.example.com/v1/',
      }),
    ).toEqual({
      model: 'gpt-5.4-mini',
      baseUrl: 'https://api.example.com/v1',
      routingMode: 'hybrid',
      filenameAliases: [],
      llmRoutingConcurrency: 10,
    })
  })

  it('normalizes routing settings and filters invalid filename aliases', () => {
    expect(
      normalizeSettings({
        model: 'gpt-5.4-mini',
        baseUrl: '',
        routingMode: 'local_only',
        llmRoutingConcurrency: 99,
        filenameAliases: [
          { id: ' alias-1 ', pattern: ' 亚马逊运营 ', agentId: ' hanlin-amazon-operator ' },
          { id: 'blank-pattern', pattern: ' ', agentId: 'hanlin-amazon-operator' },
          { id: 'blank-agent', pattern: '独立站运营', agentId: ' ' },
        ],
      }),
    ).toEqual({
      model: 'gpt-5.4-mini',
      baseUrl: '',
      routingMode: 'local_only',
      filenameAliases: [
        { id: 'alias-1', pattern: '亚马逊运营', agentId: 'hanlin-amazon-operator' },
      ],
      llmRoutingConcurrency: 30,
    })
  })
})

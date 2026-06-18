import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModelIds } from './modelService.js'

describe('model service', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches model ids from the configured OpenAI-compatible /models endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'gpt-5.4-mini' }, { id: 'gpt-5.4' }, { id: '' }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchModelIds({ apiKey: 'sk-test', baseUrl: 'https://proxy.example.com/v1/' })).resolves.toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
    ])

    expect(fetchMock).toHaveBeenCalledWith('https://proxy.example.com/v1/models', {
      headers: {
        Authorization: 'Bearer sk-test',
      },
    })
  })

  it('uses the default OpenAI API base URL when custom URL is blank', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-5.2' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchModelIds({ apiKey: 'sk-test', baseUrl: '' })

    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
      headers: {
        Authorization: 'Bearer sk-test',
      },
    })
  })
})

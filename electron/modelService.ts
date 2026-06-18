const defaultBaseUrl = 'https://api.openai.com/v1'

export type FetchModelIdsOptions = {
  apiKey: string
  baseUrl: string
}

function createModelsUrl(baseUrl: string): string {
  const normalizedBaseUrl = (baseUrl.trim() || defaultBaseUrl).replace(/\/+$/, '')
  return `${normalizedBaseUrl}/models`
}

export async function fetchModelIds({ apiKey, baseUrl }: FetchModelIdsOptions): Promise<string[]> {
  if (!apiKey.trim()) {
    throw new Error('请先保存 OpenAI API key')
  }

  const response = await fetch(createModelsUrl(baseUrl), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`获取模型失败：HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: unknown }>
  }
  const ids = (payload.data ?? [])
    .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
    .filter((id) => id.length > 0)

  return [...new Set(ids)].sort((left, right) => left.localeCompare(right))
}

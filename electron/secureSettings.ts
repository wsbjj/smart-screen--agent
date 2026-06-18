import keytar from 'keytar'

const service = 'smart-screen-agent'
const account = 'openai-api-key'

export async function hasApiKey(): Promise<boolean> {
  const key = await keytar.getPassword(service, account)
  return Boolean(key)
}

export async function getApiKey(): Promise<string> {
  const key = await keytar.getPassword(service, account)
  if (!key) {
    throw new Error('OpenAI API key is not configured')
  }
  return key
}

export async function saveApiKey(apiKey: string): Promise<void> {
  if (!apiKey.trim()) {
    throw new Error('API key cannot be empty')
  }
  await keytar.setPassword(service, account, apiKey.trim())
}

export async function clearApiKey(): Promise<void> {
  await keytar.deletePassword(service, account)
}

import type {
  JobAgentConfig,
  LlmRouterFn,
  ResumeDocument,
  RouterDecision,
  RouterLayer,
} from '../shared/types.js'

export function tokenize(text: string): string[] {
  // Split on non-CJK, non-alphanumeric boundaries; CJK range 㐀-鿿
  return text
    .toLowerCase()
    .split(/[^㐀-鿿a-z0-9]+/)
    .filter((t) => t.length > 1)
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[【】[\]（）()「」『』、，。！？·_\s-]+/g, '')
    .trim()
}

const filenameAliasesByAgentId: Record<string, string[]> = {
  'hanlin-brand-visual-design': ['电商AI美工', '电商美工', 'AI美工', '美工'],
}

export function matchByFilename(
  fileName: string,
  agents: JobAgentConfig[],
): RouterDecision | null {
  const baseName = normalizeForMatch(stripExtension(fileName))
  if (!baseName) return null

  let bestAgent: JobAgentConfig | null = null
  let bestMatchLength = 0

  for (const agent of agents) {
    const titleNorm = normalizeForMatch(agent.title)
    if (!titleNorm) continue

    // 岗位标题作为子串完整出现在文件名中才算匹配（"完全能匹配上"）
    if (baseName.includes(titleNorm)) {
      if (titleNorm.length > bestMatchLength) {
        bestMatchLength = titleNorm.length
        bestAgent = agent
      }
    }
  }

  if (!bestAgent) {
    for (const agent of agents) {
      const aliases = filenameAliasesByAgentId[agent.id] ?? []
      if (aliases.some((alias) => baseName.includes(normalizeForMatch(alias)))) {
        bestAgent = agent
        break
      }
    }
  }

  if (!bestAgent) return null
  return { resumeId: '', agentId: bestAgent.id, layer: 'filename' as RouterLayer, confidence: 1 }
}

export function matchByNlp(
  resume: ResumeDocument,
  agents: JobAgentConfig[],
  threshold = 0.25,
): RouterDecision | null {
  const head200 = resume.text.slice(0, 200)
  const head600 = resume.text.slice(0, 600)
  const head200Lower = head200.toLowerCase()
  const head600Lower = head600.toLowerCase()
  const tokens200 = new Set(tokenize(head200))
  const tokens600 = new Set(tokenize(head600))

  let bestAgent: JobAgentConfig | null = null
  let bestScore = 0

  for (const agent of agents) {
    // 岗位标题直接出现在简历开头给予大幅加分（处理中文无分词场景）
    const titleLower = agent.title.toLowerCase()
    const keywordBag = [
      ...tokenize(agent.title),
      ...tokenize(agent.mustHaves.join(' ')),
    ]
    if (keywordBag.length === 0) continue

    const uniqueKeywords = [...new Set(keywordBag)]
    let hits = 0

    if (head200Lower.includes(titleLower)) hits += uniqueKeywords.length * 2
    else if (head600Lower.includes(titleLower)) hits += uniqueKeywords.length

    for (const kw of uniqueKeywords) {
      if (tokens200.has(kw)) hits += 2
      else if (tokens600.has(kw)) hits += 1
      // 子串匹配：处理中文 token 与周围文字连成大 token 的情况
      else if (head200Lower.includes(kw)) hits += 1.5
      else if (head600Lower.includes(kw)) hits += 0.5
    }

    const score = hits / (uniqueKeywords.length * 2)
    if (score > bestScore) {
      bestScore = score
      bestAgent = agent
    }
  }

  if (!bestAgent || bestScore < threshold) return null
  return {
    resumeId: '',
    agentId: bestAgent.id,
    layer: 'nlp' as RouterLayer,
    confidence: Math.min(bestScore, 1),
  }
}

export function createAgentRouter(options: {
  nlpThreshold?: number
  llmFn?: LlmRouterFn
}) {
  const { nlpThreshold = 0.25, llmFn } = options

  return async (resume: ResumeDocument, agents: JobAgentConfig[]): Promise<RouterDecision> => {
    if (agents.length === 0) {
      throw new Error('No agents provided to router')
    }
    if (agents.length === 1) {
      return { resumeId: resume.id, agentId: agents[0].id, layer: 'fallback', confidence: 1 }
    }

    // Layer 1: filename match
    const byFilename = matchByFilename(resume.fileName, agents)
    if (byFilename) {
      return { ...byFilename, resumeId: resume.id }
    }

    // Layer 2: NLP keyword overlap
    const byNlp = matchByNlp(resume, agents, nlpThreshold)
    if (byNlp) {
      return { ...byNlp, resumeId: resume.id }
    }

    // Layer 3: LLM
    if (llmFn) {
      try {
        const excerpt = resume.text.slice(0, 500)
        const agentId = await llmFn(excerpt, agents)
        const matched = agents.find((a) => a.id === agentId)
        if (matched) {
          return { resumeId: resume.id, agentId: matched.id, layer: 'llm', confidence: 0.7 }
        }
      } catch {
        // fall through to fallback
      }
    }

    // Fallback: first agent
    return { resumeId: resume.id, agentId: agents[0].id, layer: 'fallback', confidence: 0 }
  }
}

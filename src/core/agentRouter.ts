import type {
  FilenameRouteAlias,
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
  'hanlin-ai-agent-builder': ['AI智能体', '智能体搭建', 'Agent技术员', 'AI Agent技术员', '智能体技术员'],
  'hanlin-product-manager-sports-protection': ['产品经理', '产品经理人', '运动护具产品经理', '护具产品经理'],
  'hanlin-brand-development-sports-protection': ['品牌开发', '品牌开发专员', '品牌专员', '运动护具品牌'],
  'hanlin-brand-visual-design': ['电商AI美工', '电商美工', 'AI美工', '美工', '品牌视觉', '视觉设计'],
  'hanlin-independent-site-operator': ['独立站运营', '跨境独立站', 'Shopify', 'shopify运营', '独立站'],
  'hanlin-amazon-product-manager': ['亚马逊产品经理', 'Amazon产品经理', '亚马逊选品', '选品'],
  'hanlin-amazon-operator': ['亚马逊运营', 'Amazon运营', 'amazon运营', '亚马逊运营专员', '跨境亚马逊运营'],
}

export function matchByFilename(
  fileName: string,
  agents: JobAgentConfig[],
  customAliases: FilenameRouteAlias[] = [],
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
    let bestAliasPriority = -1
    for (const [agentId, aliases] of Object.entries(filenameAliasesByAgentId)) {
      for (const alias of aliases) {
        const aliasNorm = normalizeForMatch(alias)
        const agent = agents.find((item) => item.id === agentId)
        if (!aliasNorm || !agent || !baseName.includes(aliasNorm)) continue
        if (aliasNorm.length > bestMatchLength) {
          bestMatchLength = aliasNorm.length
          bestAliasPriority = 0
          bestAgent = agent
        }
      }
    }

    for (const alias of customAliases) {
      const aliasNorm = normalizeForMatch(alias.pattern)
      const agent = agents.find((item) => item.id === alias.agentId)
      if (!aliasNorm || !agent || !baseName.includes(aliasNorm)) continue
      const aliasPriority = 1
      if (
        aliasNorm.length > bestMatchLength ||
        (aliasNorm.length === bestMatchLength && aliasPriority >= bestAliasPriority)
      ) {
        bestMatchLength = aliasNorm.length
        bestAliasPriority = aliasPriority
        bestAgent = agent
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

export function createLocalRouter(options: {
  filenameAliases?: FilenameRouteAlias[]
  nlpThreshold?: number
} = {}) {
  const { filenameAliases = [], nlpThreshold = 0.25 } = options

  return (resume: ResumeDocument, agents: JobAgentConfig[]): RouterDecision | null => {
    if (agents.length === 0) {
      throw new Error('No agents provided to router')
    }
    if (agents.length === 1) {
      return { resumeId: resume.id, agentId: agents[0].id, layer: 'fallback', confidence: 1 }
    }

    const byFilename = matchByFilename(resume.fileName, agents, filenameAliases)
    if (byFilename) {
      return { ...byFilename, resumeId: resume.id }
    }

    const byNlp = matchByNlp(resume, agents, nlpThreshold)
    if (byNlp) {
      return { ...byNlp, resumeId: resume.id }
    }

    return null
  }
}

export function createAgentRouter(options: {
  filenameAliases?: FilenameRouteAlias[]
  nlpThreshold?: number
  llmFn?: LlmRouterFn
}) {
  const { filenameAliases = [], nlpThreshold = 0.25, llmFn } = options
  const localRouter = createLocalRouter({ filenameAliases, nlpThreshold })

  return async (resume: ResumeDocument, agents: JobAgentConfig[]): Promise<RouterDecision> => {
    const byLocal = localRouter(resume, agents)
    if (byLocal) {
      return byLocal
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

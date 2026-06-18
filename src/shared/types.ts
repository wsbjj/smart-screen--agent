export type SupportedExtension = '.pdf' | '.docx' | '.txt'

export type Recommendation = 'strong_yes' | 'yes' | 'maybe' | 'no'

export type JobInput = {
  text: string
  sourceFileName?: string
}

export type JobCriterion = {
  id: string
  label: string
  weight: number
  description: string
}

export type JobAgentConfig = {
  id: string
  title: string
  summary: string
  mustHaves: string[]
  niceToHaves: string[]
  riskFlags: string[]
  criteria: JobCriterion[]
  instructions: string
  thresholds: {
    strongYes: number
    yes: number
    maybe: number
  }
}

export type FileExtractionInput = {
  name: string
  extension: string
  buffer: Buffer
}

export type ParsedDocument = {
  fileName: string
  extension: SupportedExtension
  text: string
  wordCount: number
}

export type ResumeDocument = ParsedDocument & {
  id: string
}

export type CriterionScore = {
  criterionId: string
  label: string
  score: number
  weight: number
  evidence: string[]
  missing: string[]
}

export type CandidateScorecard = {
  resumeId: string
  fileName: string
  candidateName: string
  overallScore: number
  recommendation: Recommendation
  criterionScores: CriterionScore[]
  strengths: string[]
  gaps: string[]
  risks: string[]
  evidenceSummary: string[]
  reviewerNotes: string
}

export type ScreeningBatchError = {
  resumeId: string
  fileName: string
  message: string
}

export type ScreeningBatchResult = {
  scorecards: CandidateScorecard[]
  errors: ScreeningBatchError[]
}

export type ScreeningProgressEvent = {
  status: 'started' | 'completed' | 'failed'
  resumeId: string
  fileName: string
  completed: number
  total: number
  agentId?: string
}

export type ScreeningAgentInput = {
  jobConfig: JobAgentConfig
  resume: ResumeDocument
}

export type ScreeningAgentRunner = (
  input: ScreeningAgentInput,
) => Promise<CandidateScorecard>

export type ScreeningBatchOptions = {
  jobConfig: JobAgentConfig
  resumes: ResumeDocument[]
  runner: ScreeningAgentRunner
  concurrency?: number
  maxRetries?: number
  onProgress?: (event: ScreeningProgressEvent) => void
}

export type GeneratedJobConfigInput = {
  jdText: string
  sourceFileName?: string
}

export type RouterLayer = 'filename' | 'nlp' | 'llm' | 'fallback'

export type RouterDecision = {
  resumeId: string
  agentId: string
  layer: RouterLayer
  confidence: number
}

export type AgentStatusEvent = {
  agentId: string
  agentTitle: string
  status: 'idle' | 'running' | 'completed' | 'error'
  currentResumeFileName?: string
  processedCount: number
  totalAssigned: number
}

export type LlmRouterFn = (resumeExcerpt: string, agents: JobAgentConfig[]) => Promise<string>

export type MultiAgentBatchOptions = {
  agents: JobAgentConfig[]
  resumes: ResumeDocument[]
  routerFn: (resume: ResumeDocument, agents: JobAgentConfig[]) => Promise<RouterDecision>
  runner: ScreeningAgentRunner
  concurrency?: number
  maxRetries?: number
  onProgress?: (event: ScreeningProgressEvent) => void
  onAgentStatus?: (event: AgentStatusEvent) => void
}

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

export type SavedJobRecord = {
  id: string
  title: string
  salary: string
  meta: string
  jdText: string
  sourceFileName?: string
  config: JobAgentConfig
  createdAt: string
  updatedAt: string
}

export type SaveJobInput = {
  id?: string
  title?: string
  salary?: string
  meta?: string
  jdText: string
  sourceFileName?: string
  config: JobAgentConfig
}

export type RoutingMode = 'hybrid' | 'local_only'

export type FilenameRouteAlias = {
  id: string
  pattern: string
  agentId: string
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

export type ImportedResumeSummary = {
  id: string
  fileName: string
  extension: SupportedExtension
  wordCount: number
  preview: string
  sessionId: string
  cacheKey: string
}

export type ResumeImportError = {
  fileName: string
  message: string
}

export type ResumeImportProgressEvent = {
  sessionId: string
  status: 'started' | 'scanning' | 'progress' | 'completed' | 'cancelled'
  processed: number
  total: number
  cached: number
  failed: number
  currentFileName?: string
  batch?: ImportedResumeSummary[]
  errors?: ResumeImportError[]
}

export type ResumeImportResult = {
  sessionId: string
  resumes: ImportedResumeSummary[]
  errors: ResumeImportError[]
  cancelled: boolean
}

export type ResumeScreeningInput = ResumeDocument | ImportedResumeSummary

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
  jobAgentId?: string
  jobAgentTitle?: string
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
  status: 'routing' | 'started' | 'completed' | 'failed'
  phase?: 'routing' | 'screening'
  resumeId: string
  fileName: string
  completed: number
  total: number
  started?: number
  active?: number
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
  signal?: AbortSignal
  onProgress?: (event: ScreeningProgressEvent) => void
}

export type GeneratedJobConfigInput = {
  jdText: string
  sourceFileName?: string
  currentConfig?: JobAgentConfig
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

export type LocalRouterFn = (
  resume: ResumeDocument,
  agents: JobAgentConfig[],
) => RouterDecision | null

export type BatchLlmRouterItem = {
  resumeId: string
  excerpt: string
}

export type BatchLlmRouterDecision = {
  resumeId: string
  agentId: string
}

export type BatchLlmRouterFn = (
  items: BatchLlmRouterItem[],
  agents: JobAgentConfig[],
) => Promise<BatchLlmRouterDecision[]>

export type RoutingDecisionCache = {
  get: (
    resume: ResumeDocument,
    agents: JobAgentConfig[],
  ) => Promise<RouterDecision | null> | RouterDecision | null
  set: (
    resume: ResumeDocument,
    agents: JobAgentConfig[],
    decision: RouterDecision,
  ) => Promise<void> | void
}

export type MultiAgentBatchOptions = {
  agents: JobAgentConfig[]
  resumes: ResumeDocument[]
  routerFn?: (resume: ResumeDocument, agents: JobAgentConfig[]) => Promise<RouterDecision>
  localRouterFn?: LocalRouterFn
  batchRouterFn?: BatchLlmRouterFn
  routingMode?: RoutingMode
  runner: ScreeningAgentRunner
  concurrency?: number
  routingConcurrency?: number
  llmRoutingConcurrency?: number
  routingBatchSize?: number
  routeCache?: RoutingDecisionCache
  maxRetries?: number
  signal?: AbortSignal
  onProgress?: (event: ScreeningProgressEvent) => void
  onAgentStatus?: (event: AgentStatusEvent) => void
}

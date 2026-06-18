import type {
  AgentStatusEvent,
  CandidateScorecard,
  JobAgentConfig,
  ParsedDocument,
  ResumeDocument,
  ScreeningBatchResult,
  ScreeningProgressEvent,
} from './types.js'

export type ResumeImportResult = {
  resumes: ResumeDocument[]
  errors: Array<{ fileName: string; message: string }>
}

export type AppSettings = {
  model: string
  baseUrl: string
}

export type FetchModelsInput = {
  baseUrl: string
}

export type DesktopApi = {
  settings: {
    hasApiKey: () => Promise<boolean>
    getSettings: () => Promise<AppSettings>
    saveSettings: (settings: AppSettings) => Promise<AppSettings>
    fetchModels: (input: FetchModelsInput) => Promise<string[]>
    saveApiKey: (apiKey: string) => Promise<void>
    clearApiKey: () => Promise<void>
  }
  files: {
    pickJobFile: () => Promise<ParsedDocument | null>
    pickResumeFiles: () => Promise<ResumeImportResult>
    pickResumeFolder: () => Promise<ResumeImportResult>
  }
  agents: {
    generateJobConfig: (payload: {
      jdText: string
      sourceFileName?: string
      model: string
    }) => Promise<JobAgentConfig>
    runScreening: (payload: {
      jobConfig: JobAgentConfig
      resumes: ResumeDocument[]
      model: string
    }) => Promise<ScreeningBatchResult>
    runMultiAgentScreening: (payload: {
      agents: JobAgentConfig[]
      resumes: ResumeDocument[]
      model: string
    }) => Promise<ScreeningBatchResult>
    onScreeningProgress: (listener: (event: ScreeningProgressEvent) => void) => () => void
    onAgentStatus: (listener: (event: AgentStatusEvent) => void) => () => void
  }
  export: {
    csv: (scorecards: CandidateScorecard[]) => Promise<string | null>
    xlsx: (scorecards: CandidateScorecard[]) => Promise<string | null>
  }
}

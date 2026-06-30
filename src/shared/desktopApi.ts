import type {
  AgentStatusEvent,
  CandidateScorecard,
  FilenameRouteAlias,
  ImportedResumeSummary,
  JobAgentConfig,
  ParsedDocument,
  ResumeImportProgressEvent,
  ResumeImportResult,
  ResumeScreeningInput,
  ResumeDocument,
  RoutingMode,
  SavedJobRecord,
  SaveJobInput,
  ScreeningBatchResult,
  ScreeningProgressEvent,
} from './types.js'

export type AppSettings = {
  model: string
  baseUrl: string
  routingMode: RoutingMode
  filenameAliases: FilenameRouteAlias[]
  llmRoutingConcurrency: number
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
    onResumeImportProgress: (listener: (event: ResumeImportProgressEvent) => void) => () => void
    cancelResumeImport: (sessionId: string) => Promise<void>
    clearResumeImportCache: (sessionIds: string[]) => Promise<void>
    loadCachedResumes: (items: ImportedResumeSummary[]) => Promise<ResumeDocument[]>
  }
  jobs: {
    list: () => Promise<SavedJobRecord[]>
    save: (input: SaveJobInput) => Promise<SavedJobRecord>
    delete: (id: string) => Promise<boolean>
  }
  agents: {
    generateJobConfig: (payload: {
      jdText: string
      sourceFileName?: string
      model: string
      currentConfig?: JobAgentConfig
    }) => Promise<JobAgentConfig>
    runScreening: (payload: {
      jobConfig: JobAgentConfig
      resumes: ResumeScreeningInput[]
      model: string
    }) => Promise<ScreeningBatchResult>
    runMultiAgentScreening: (payload: {
      agents: JobAgentConfig[]
      resumes: ResumeScreeningInput[]
      model: string
    }) => Promise<ScreeningBatchResult>
    cancelScreening: () => Promise<boolean>
    onScreeningProgress: (listener: (event: ScreeningProgressEvent) => void) => () => void
    onAgentStatus: (listener: (event: AgentStatusEvent) => void) => () => void
  }
  export: {
    csv: (scorecards: CandidateScorecard[]) => Promise<string | null>
    xlsx: (scorecards: CandidateScorecard[]) => Promise<string | null>
  }
}

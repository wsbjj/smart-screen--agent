import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { channels } from './channels.js'
import { app, BrowserWindow, ipcMain } from './electronApi.js'
import { createRoutingCache } from './routingCache.js'
import { clearApiKey, getApiKey, hasApiKey, saveApiKey } from './secureSettings.js'
import {
  cancelResumeImport,
  cleanupAllResumeImportCaches,
  cleanupStaleResumeImportCaches,
  clearResumeImportCache,
  loadCachedResumes,
  pickAndParseJobFile,
  pickAndParseResumeFiles,
  pickAndParseResumeFolder,
} from './fileService.js'
import { exportCsv, exportXlsx } from './exportService.js'
import { fetchModelIds } from './modelService.js'
import { closeJobLibraryStore, deleteSavedJob, listSavedJobs, saveSavedJob } from './jobLibraryStore.js'
import { getSettings, saveSettings } from './settingsStore.js'
import { defaultScreeningConcurrency, runMultiAgentBatch, runScreeningBatch } from '../src/core/screeningEngine.js'
import type { ImportedResumeSummary, JobAgentConfig, ResumeDocument, ResumeScreeningInput } from '../src/shared/types.js'
import type { AppSettings, FetchModelsInput } from '../src/shared/desktopApi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged
const screeningControllers = new Map<number, AbortController>()

function beginScreeningRun(webContentsId: number): AbortController {
  screeningControllers.get(webContentsId)?.abort()
  const controller = new AbortController()
  screeningControllers.set(webContentsId, controller)
  return controller
}

function finishScreeningRun(webContentsId: number, controller: AbortController) {
  if (screeningControllers.get(webContentsId) === controller) {
    screeningControllers.delete(webContentsId)
  }
}

function cancelScreeningRun(webContentsId: number): boolean {
  const controller = screeningControllers.get(webContentsId)
  if (!controller) {
    return false
  }
  controller.abort()
  return true
}

async function loadOpenAIAgents() {
  process.env.OPENAI_AGENTS_DISABLE_TRACING ??= '1'
  return import('../src/core/openaiAgents.js')
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1040,
    minHeight: 720,
    title: '简历筛选助手',
    backgroundColor: '#f6f3ec',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173')
  } else {
    await window.loadFile(join(__dirname, '../../dist/index.html'))
  }
}

async function resolveResumeDocuments(resumes: ResumeScreeningInput[]): Promise<ResumeDocument[]> {
  const cachedInputs = resumes.filter((resume): resume is ImportedResumeSummary => !('text' in resume))
  if (cachedInputs.length === 0) {
    return resumes as ResumeDocument[]
  }

  const cachedResumes = await loadCachedResumes(cachedInputs)
  const cachedResumeMap = new Map(
    cachedResumes.map((resume, index) => {
      const source = cachedInputs[index]
      return [`${source.sessionId}:${source.cacheKey}`, resume]
    }),
  )

  return resumes.map((resume) => {
    if ('text' in resume) {
      return resume
    }
    const cached = cachedResumeMap.get(`${resume.sessionId}:${resume.cacheKey}`)
    if (!cached) {
      throw new Error(`简历缓存不存在：${resume.fileName}`)
    }
    return cached
  })
}

function registerIpcHandlers() {
  ipcMain.handle(channels.getApiKeyStatus, () => hasApiKey())
  ipcMain.handle(channels.getSettings, () => getSettings())
  ipcMain.handle(channels.saveSettings, (_event, settings: AppSettings) => saveSettings(settings))
  ipcMain.handle(channels.fetchModels, async (_event, input: FetchModelsInput) =>
    fetchModelIds({
      apiKey: await getApiKey(),
      baseUrl: input.baseUrl,
    }),
  )
  ipcMain.handle(channels.saveApiKey, (_event, apiKey: string) => saveApiKey(apiKey))
  ipcMain.handle(channels.clearApiKey, () => clearApiKey())
  ipcMain.handle(channels.pickJobFile, () => pickAndParseJobFile())
  ipcMain.handle(channels.pickResumeFiles, (event) =>
    pickAndParseResumeFiles({
      onProgress: (progress) => event.sender.send(channels.resumeImportProgress, progress),
    }),
  )
  ipcMain.handle(channels.pickResumeFolder, (event) =>
    pickAndParseResumeFolder({
      onProgress: (progress) => event.sender.send(channels.resumeImportProgress, progress),
    }),
  )
  ipcMain.handle(channels.cancelResumeImport, (_event, sessionId: string) => cancelResumeImport(sessionId))
  ipcMain.handle(channels.clearResumeImportCache, (_event, sessionIds: string[]) => clearResumeImportCache(sessionIds))
  ipcMain.handle(channels.loadCachedResumes, (_event, resumes: ResumeScreeningInput[]) => resolveResumeDocuments(resumes))
  ipcMain.handle(channels.listJobs, () => listSavedJobs())
  ipcMain.handle(channels.saveJob, (_event, input) => saveSavedJob(input))
  ipcMain.handle(channels.deleteJob, (_event, id: string) => deleteSavedJob(id))
  ipcMain.handle(channels.cancelScreening, (event) => cancelScreeningRun(event.sender.id))
  ipcMain.handle(
    channels.generateJobConfig,
    async (
      _event,
      payload: { jdText: string; sourceFileName?: string; model: string; currentConfig?: JobAgentConfig },
    ) => {
      const { generateJobAgentConfig } = await loadOpenAIAgents()
      return generateJobAgentConfig(payload, {
        apiKey: await getApiKey(),
        model: payload.model,
        baseUrl: getSettings().baseUrl,
      })
    },
  )
  ipcMain.handle(
    channels.runScreening,
    async (
      event,
      payload: { jobConfig: JobAgentConfig; resumes: ResumeScreeningInput[]; model: string },
    ) => {
      const controller = beginScreeningRun(event.sender.id)
      try {
        const { createScreeningAgentRunner } = await loadOpenAIAgents()
        const resumes = await resolveResumeDocuments(payload.resumes)
        return await runScreeningBatch({
          jobConfig: payload.jobConfig,
          resumes,
          runner: createScreeningAgentRunner({
            apiKey: await getApiKey(),
            model: payload.model,
            baseUrl: getSettings().baseUrl,
          }),
          concurrency: defaultScreeningConcurrency,
          maxRetries: 2,
          signal: controller.signal,
          onProgress: (progress) => event.sender.send(channels.screeningProgress, progress),
        })
      } finally {
        finishScreeningRun(event.sender.id, controller)
      }
    },
  )
  ipcMain.handle(channels.exportCsv, (_event, scorecards) => exportCsv(scorecards))
  ipcMain.handle(channels.exportXlsx, (_event, scorecards) => exportXlsx(scorecards))

  ipcMain.handle(
    channels.runMultiAgentScreening,
    async (
      event,
      payload: { agents: JobAgentConfig[]; resumes: ResumeScreeningInput[]; model: string },
    ) => {
      const controller = beginScreeningRun(event.sender.id)
      try {
        const { createScreeningAgentRunner, createBatchLlmRouterFn } = await loadOpenAIAgents()
        const { createLocalRouter } = await import('../src/core/agentRouter.js')
        const resumes = await resolveResumeDocuments(payload.resumes)
        const settings = getSettings()
        const runtimeSettings = { ...settings, model: payload.model }
        const runnerOptions = {
          apiKey: await getApiKey(),
          model: payload.model,
          baseUrl: settings.baseUrl,
        }
        const localRouter = createLocalRouter({
          filenameAliases: settings.filenameAliases,
          nlpThreshold: 0.25,
        })
        return await runMultiAgentBatch({
          agents: payload.agents,
          resumes,
          localRouterFn: localRouter,
          batchRouterFn: settings.routingMode === 'hybrid' ? createBatchLlmRouterFn(runnerOptions) : undefined,
          routingMode: settings.routingMode,
          llmRoutingConcurrency: settings.llmRoutingConcurrency,
          routeCache: createRoutingCache(runtimeSettings),
          runner: createScreeningAgentRunner(runnerOptions),
          concurrency: 10,
          maxRetries: 2,
          signal: controller.signal,
          onProgress: (progress) => event.sender.send(channels.screeningProgress, progress),
          onAgentStatus: (status) => event.sender.send(channels.agentStatus, status),
        })
      } finally {
        finishScreeningRun(event.sender.id, controller)
      }
    },
  )
}

registerIpcHandlers()

app.whenReady().then(async () => {
  await cleanupStaleResumeImportCaches().catch(() => undefined)
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void cleanupAllResumeImportCaches()
  closeJobLibraryStore()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})

import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { channels } from './channels.js'
import { clearApiKey, getApiKey, hasApiKey, saveApiKey } from './secureSettings.js'
import { pickAndParseJobFile, pickAndParseResumeFiles, pickAndParseResumeFolder } from './fileService.js'
import { exportCsv, exportXlsx } from './exportService.js'
import { fetchModelIds } from './modelService.js'
import { getSettings, saveSettings } from './settingsStore.js'
import { defaultScreeningConcurrency, runMultiAgentBatch, runScreeningBatch } from '../src/core/screeningEngine.js'
import type { JobAgentConfig, ResumeDocument } from '../src/shared/types.js'
import type { AppSettings, FetchModelsInput } from '../src/shared/desktopApi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged

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
    title: 'Smart Screen Agent',
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
  ipcMain.handle(channels.pickResumeFiles, () => pickAndParseResumeFiles())
  ipcMain.handle(channels.pickResumeFolder, () => pickAndParseResumeFolder())
  ipcMain.handle(
    channels.generateJobConfig,
    async (_event, payload: { jdText: string; sourceFileName?: string; model: string }) => {
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
      payload: { jobConfig: JobAgentConfig; resumes: ResumeDocument[]; model: string },
    ) => {
      const { createScreeningAgentRunner } = await loadOpenAIAgents()
      return runScreeningBatch({
        jobConfig: payload.jobConfig,
        resumes: payload.resumes,
        runner: createScreeningAgentRunner({
          apiKey: await getApiKey(),
          model: payload.model,
          baseUrl: getSettings().baseUrl,
        }),
        concurrency: defaultScreeningConcurrency,
        maxRetries: 2,
        onProgress: (progress) => event.sender.send(channels.screeningProgress, progress),
      })
    },
  )
  ipcMain.handle(channels.exportCsv, (_event, scorecards) => exportCsv(scorecards))
  ipcMain.handle(channels.exportXlsx, (_event, scorecards) => exportXlsx(scorecards))

  ipcMain.handle(
    channels.runMultiAgentScreening,
    async (
      event,
      payload: { agents: JobAgentConfig[]; resumes: ResumeDocument[]; model: string },
    ) => {
      const { createScreeningAgentRunner, createLlmRouterFn } = await loadOpenAIAgents()
      const { createAgentRouter } = await import('../src/core/agentRouter.js')
      const runnerOptions = {
        apiKey: await getApiKey(),
        model: payload.model,
        baseUrl: getSettings().baseUrl,
      }
      const router = createAgentRouter({
        nlpThreshold: 0.25,
        llmFn: createLlmRouterFn(runnerOptions),
      })
      return runMultiAgentBatch({
        agents: payload.agents,
        resumes: payload.resumes,
        routerFn: router,
        runner: createScreeningAgentRunner(runnerOptions),
        concurrency: 10,
        maxRetries: 2,
        onProgress: (progress) => event.sender.send(channels.screeningProgress, progress),
        onAgentStatus: (status) => event.sender.send(channels.agentStatus, status),
      })
    },
  )
}

registerIpcHandlers()

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})

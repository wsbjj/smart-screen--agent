import type { DesktopApi } from '../src/shared/desktopApi.js'
import type { AgentStatusEvent, ScreeningProgressEvent } from '../src/shared/types.js'

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const channels = {
  getApiKeyStatus: 'settings:get-api-key-status',
  getSettings: 'settings:get-settings',
  saveSettings: 'settings:save-settings',
  fetchModels: 'settings:fetch-models',
  saveApiKey: 'settings:save-api-key',
  clearApiKey: 'settings:clear-api-key',
  pickJobFile: 'files:pick-job-file',
  pickResumeFiles: 'files:pick-resume-files',
  pickResumeFolder: 'files:pick-resume-folder',
  generateJobConfig: 'agents:generate-job-config',
  runScreening: 'agents:run-screening',
  screeningProgress: 'agents:screening-progress',
  runMultiAgentScreening: 'agents:run-multi-agent-screening',
  agentStatus: 'agents:agent-status',
  exportCsv: 'export:csv',
  exportXlsx: 'export:xlsx',
} as const

const api: DesktopApi = {
  settings: {
    hasApiKey: () => ipcRenderer.invoke(channels.getApiKeyStatus),
    getSettings: () => ipcRenderer.invoke(channels.getSettings),
    saveSettings: (settings) => ipcRenderer.invoke(channels.saveSettings, settings),
    fetchModels: (input) => ipcRenderer.invoke(channels.fetchModels, input),
    saveApiKey: (apiKey) => ipcRenderer.invoke(channels.saveApiKey, apiKey),
    clearApiKey: () => ipcRenderer.invoke(channels.clearApiKey),
  },
  files: {
    pickJobFile: () => ipcRenderer.invoke(channels.pickJobFile),
    pickResumeFiles: () => ipcRenderer.invoke(channels.pickResumeFiles),
    pickResumeFolder: () => ipcRenderer.invoke(channels.pickResumeFolder),
  },
  agents: {
    generateJobConfig: (payload) => ipcRenderer.invoke(channels.generateJobConfig, payload),
    runScreening: (payload) => ipcRenderer.invoke(channels.runScreening, payload),
    runMultiAgentScreening: (payload) => ipcRenderer.invoke(channels.runMultiAgentScreening, payload),
    onScreeningProgress: (listener) => {
      const wrapped = (_event: unknown, progress: ScreeningProgressEvent) => listener(progress)
      ipcRenderer.on(channels.screeningProgress, wrapped)
      return () => ipcRenderer.removeListener(channels.screeningProgress, wrapped)
    },
    onAgentStatus: (listener) => {
      const wrapped = (_event: unknown, status: AgentStatusEvent) => listener(status)
      ipcRenderer.on(channels.agentStatus, wrapped)
      return () => ipcRenderer.removeListener(channels.agentStatus, wrapped)
    },
  },
  export: {
    csv: (scorecards) => ipcRenderer.invoke(channels.exportCsv, scorecards),
    xlsx: (scorecards) => ipcRenderer.invoke(channels.exportXlsx, scorecards),
  },
}

contextBridge.exposeInMainWorld('desktopApi', api)

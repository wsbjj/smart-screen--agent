import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { createFallbackJobConfig } from './core/jobConfig.js'
import { companyJobPresets } from './core/jobPresets.js'
import { defaultScreeningConcurrency, runScreeningBatch } from './core/screeningEngine.js'
import type {
  AgentStatusEvent,
  CandidateScorecard,
  FilenameRouteAlias,
  ImportedResumeSummary,
  JobAgentConfig,
  ResumeDocument,
  ResumeImportProgressEvent,
  ResumeImportResult,
  RoutingMode,
  ScreeningBatchResult,
  ScreeningProgressEvent,
} from './shared/types.js'
import type { DesktopApi } from './shared/desktopApi.js'

const defaultModel = 'gpt-5.2'

type StepId = 'settings' | 'job' | 'resumes' | 'screening' | 'results'

type Toast = {
  tone: 'info' | 'success' | 'error'
  message: string
}

type BusyTask = 'job' | 'import' | 'screening' | null

type ScreeningProgressState = {
  completed: number
  total: number
  currentFileName: string
  status: ScreeningProgressEvent['status'] | 'pending'
  phase: ScreeningProgressEvent['phase'] | 'pending'
  started: number
  active: number
}

type ResumeImportProgressState = Pick<
  ResumeImportProgressEvent,
  'sessionId' | 'status' | 'processed' | 'total' | 'cached' | 'failed' | 'currentFileName'
>

const bridgeUnavailableMessage = '桌面端桥接未加载，请重启应用或重新构建'
const defaultRoutingMode: RoutingMode = 'hybrid'
const defaultLlmRoutingConcurrency = 10

function hasFunction(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'function'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDesktopApiReady(api: unknown): api is DesktopApi {
  if (!isObject(api) || !isObject(api.settings) || !isObject(api.files) || !isObject(api.agents) || !isObject(api.export)) {
    return false
  }

  return Boolean(
    hasFunction(api.settings, 'hasApiKey') &&
      hasFunction(api.settings, 'getSettings') &&
      hasFunction(api.settings, 'saveSettings') &&
      hasFunction(api.settings, 'fetchModels') &&
      hasFunction(api.settings, 'saveApiKey') &&
      hasFunction(api.settings, 'clearApiKey') &&
      hasFunction(api.files, 'pickJobFile') &&
      hasFunction(api.files, 'pickResumeFiles') &&
      hasFunction(api.files, 'pickResumeFolder') &&
      hasFunction(api.files, 'onResumeImportProgress') &&
      hasFunction(api.files, 'cancelResumeImport') &&
      hasFunction(api.files, 'clearResumeImportCache') &&
      hasFunction(api.files, 'loadCachedResumes') &&
      hasFunction(api.agents, 'generateJobConfig') &&
      hasFunction(api.agents, 'runScreening') &&
      hasFunction(api.agents, 'runMultiAgentScreening') &&
      hasFunction(api.agents, 'cancelScreening') &&
      hasFunction(api.agents, 'onScreeningProgress') &&
      hasFunction(api.agents, 'onAgentStatus') &&
      hasFunction(api.export, 'csv') &&
      hasFunction(api.export, 'xlsx'),
  )
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function isScreeningStoppedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('筛选已停止')
}

function createLocalRunner(jobConfig: JobAgentConfig) {
  return async ({ resume }: { resume: ResumeDocument }): Promise<CandidateScorecard> => {
    const normalizedText = resume.text.toLowerCase()
    const criterionScores = jobConfig.criteria.map((criterion) => {
      const tokens = [criterion.label, criterion.description, ...jobConfig.mustHaves]
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9\u3400-\u9fff]+/)
        .filter((token) => token.length > 1)
      const hits = tokens.filter((token) => normalizedText.includes(token)).slice(0, 5)
      const score = Math.min(100, Math.max(45, hits.length * 18 + (normalizedText.length > 120 ? 18 : 0)))

      return {
        criterionId: criterion.id,
        label: criterion.label,
        score,
        weight: criterion.weight,
        evidence: hits.length > 0 ? hits.map((hit) => `简历出现 "${hit}"`) : [],
        missing: hits.length === 0 ? [`未找到 ${criterion.label} 的直接证据`] : [],
      }
    })
    const weightedTotal = criterionScores.reduce((sum, item) => sum + item.score * item.weight, 0)
    const weightTotal = criterionScores.reduce((sum, item) => sum + item.weight, 0) || 1
    const overallScore = Math.round(weightedTotal / weightTotal)

    return {
      resumeId: resume.id,
      fileName: resume.fileName,
      candidateName: resume.fileName.replace(/\.[^.]+$/, ''),
      overallScore,
      recommendation:
        overallScore >= jobConfig.thresholds.strongYes
          ? 'strong_yes'
          : overallScore >= jobConfig.thresholds.yes
            ? 'yes'
            : overallScore >= jobConfig.thresholds.maybe
              ? 'maybe'
              : 'no',
      criterionScores,
      strengths: criterionScores.flatMap((item) => item.evidence).slice(0, 4),
      gaps: criterionScores.flatMap((item) => item.missing).slice(0, 4),
      risks: criterionScores.some((item) => item.score < 55) ? ['关键维度证据不足，需要人工复核'] : [],
      evidenceSummary: criterionScores.flatMap((item) => item.evidence).slice(0, 5),
      reviewerNotes: '本地预览评分仅用于界面演示；真实筛选请配置 API key 后运行 OpenAI agent。',
    }
  }
}

function getRecommendationLabel(recommendation: CandidateScorecard['recommendation']) {
  const labels: Record<CandidateScorecard['recommendation'], string> = {
    strong_yes: '强推荐',
    yes: '推荐',
    maybe: '待定',
    no: '不推荐',
  }
  return labels[recommendation]
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function toPreviewCsv(scorecards: CandidateScorecard[]): string {
  const headers = ['排名', '候选人', '文件名', '岗位 Agent', '总分', '推荐等级', '亮点', '缺失项', '风险点', '证据摘要', '复核建议']
  const escape = (value: string | number) => {
    const text = String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [
    headers.join(','),
    ...scorecards.map((scorecard, index) =>
      [
        index + 1,
        scorecard.candidateName,
        scorecard.fileName,
        scorecard.jobAgentTitle ?? '',
        scorecard.overallScore,
        scorecard.recommendation,
        scorecard.strengths.join('；'),
        scorecard.gaps.join('；'),
        scorecard.risks.join('；'),
        scorecard.evidenceSummary.join('；'),
        scorecard.reviewerNotes,
      ]
        .map(escape)
        .join(','),
    ),
  ].join('\n')
}

function mergeResumeSummaries(
  current: ImportedResumeSummary[],
  imported: ImportedResumeSummary[],
): ImportedResumeSummary[] {
  if (imported.length === 0) {
    return current
  }
  const seen = new Set(current.map((resume) => `${resume.sessionId}:${resume.cacheKey}`))
  const next = [...current]
  for (const resume of imported) {
    const key = `${resume.sessionId}:${resume.cacheKey}`
    if (!seen.has(key)) {
      seen.add(key)
      next.push(resume)
    }
  }
  return next
}

function createFilenameAliasId() {
  return `alias-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function App() {
  const [activeStep, setActiveStep] = useState<StepId>('settings')
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [model, setModel] = useState(defaultModel)
  const [baseUrl, setBaseUrl] = useState('')
  const [routingMode, setRoutingMode] = useState<RoutingMode>(defaultRoutingMode)
  const [filenameAliases, setFilenameAliases] = useState<FilenameRouteAlias[]>([])
  const [llmRoutingConcurrency, setLlmRoutingConcurrency] = useState(defaultLlmRoutingConcurrency)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [jdText, setJdText] = useState('')
  const [jobSourceName, setJobSourceName] = useState<string | undefined>()
  const [jobConfigs, setJobConfigs] = useState<JobAgentConfig[]>([])
  const [resumes, setResumes] = useState<ImportedResumeSummary[]>([])
  const [batchResult, setBatchResult] = useState<ScreeningBatchResult | null>(null)
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null)
  const [busyTask, setBusyTask] = useState<BusyTask>(null)
  const [resumeImportProgress, setResumeImportProgress] = useState<ResumeImportProgressState | null>(null)
  const [screeningProgress, setScreeningProgress] = useState<ScreeningProgressState | null>(null)
  const [agentStatusMap, setAgentStatusMap] = useState<Map<string, AgentStatusEvent>>(new Map())
  const [isStoppingScreening, setIsStoppingScreening] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const localScreeningAbortRef = useRef<AbortController | null>(null)
  const screeningStopRequestedRef = useRef(false)

  // Backward-compatible single config reference
  const jobConfig = jobConfigs[0] ?? null

  const desktopApi = isDesktopApiReady(window.desktopApi) ? window.desktopApi : undefined
  const hasDesktopApi = Boolean(desktopApi)
  const isGeneratingJob = busyTask === 'job'
  const isImporting = busyTask === 'import'
  const isScreening = busyTask === 'screening'
  const isBusy = busyTask !== null
  const selectedScorecard = useMemo(
    () => batchResult?.scorecards.find((item) => item.resumeId === selectedResumeId) ?? batchResult?.scorecards[0],
    [batchResult, selectedResumeId],
  )
  const resumeStepMeta = isImporting ? `${resumes.length} 份 · 导入中` : `${resumes.length} 份`
  const screeningStepMeta = isScreening ? '运行中' : jobConfigs.length === 0 ? '待岗位' : resumes.length === 0 ? '待简历' : '就绪'
  const aliasTargetAgents = useMemo(() => {
    const byId = new Map<string, JobAgentConfig>()
    for (const preset of companyJobPresets) {
      byId.set(preset.config.id, preset.config)
    }
    for (const config of jobConfigs) {
      byId.set(config.id, config)
    }
    return [...byId.values()]
  }, [jobConfigs])

  useEffect(() => {
    desktopApi?.settings.hasApiKey().then(setApiKeyConfigured).catch(() => setApiKeyConfigured(false))
    desktopApi?.settings
      .getSettings()
      .then((settings) => {
        setModel(settings.model)
        setBaseUrl(settings.baseUrl)
        setRoutingMode(settings.routingMode ?? defaultRoutingMode)
        setFilenameAliases(settings.filenameAliases ?? [])
        setLlmRoutingConcurrency(settings.llmRoutingConcurrency ?? defaultLlmRoutingConcurrency)
      })
      .catch(() => undefined)
  }, [desktopApi])

  useEffect(() => {
    return desktopApi?.files.onResumeImportProgress((event) => {
      setResumeImportProgress({
        sessionId: event.sessionId,
        status: event.status,
        processed: event.processed,
        total: event.total,
        cached: event.cached,
        failed: event.failed,
        currentFileName: event.currentFileName,
      })
      if (event.batch?.length) {
        setResumes((current) => mergeResumeSummaries(current, event.batch ?? []))
      }
      if (event.status === 'cancelled') {
        setResumes((current) => current.filter((resume) => resume.sessionId !== event.sessionId))
      }
    })
  }, [desktopApi])

  function notify(tone: Toast['tone'], message: string) {
    setToast({ tone, message })
    window.setTimeout(() => setToast(null), 4200)
  }

  async function saveApiKey() {
    if (!apiKeyDraft.trim()) {
      notify('error', '请输入 OpenAI API key')
      return
    }
    if (!desktopApi) {
      setApiKeyConfigured(true)
      setApiKeyDraft('')
      notify('info', bridgeUnavailableMessage)
      return
    }
    await desktopApi.settings.saveApiKey(apiKeyDraft)
    setApiKeyConfigured(true)
    setApiKeyDraft('')
    notify('success', 'API key 已保存到系统安全凭据')
  }

  async function saveSettings() {
    if (!desktopApi) {
      notify('info', bridgeUnavailableMessage)
      return
    }

    try {
      const settings = await desktopApi.settings.saveSettings({
        model,
        baseUrl,
        routingMode,
        filenameAliases,
        llmRoutingConcurrency,
      })
      setModel(settings.model)
      setBaseUrl(settings.baseUrl)
      setRoutingMode(settings.routingMode)
      setFilenameAliases(settings.filenameAliases)
      setLlmRoutingConcurrency(settings.llmRoutingConcurrency)
      notify('success', '连接设置已保存')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '连接设置保存失败')
    }
  }

  async function fetchModels() {
    if (!desktopApi) {
      setAvailableModels([])
      notify('info', bridgeUnavailableMessage)
      return
    }

    setIsFetchingModels(true)
    try {
      const models = await desktopApi.settings.fetchModels({ baseUrl })
      setAvailableModels(models)
      notify(models.length > 0 ? 'success' : 'info', models.length > 0 ? `已获取 ${models.length} 个模型` : '没有返回可用模型')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '模型列表获取失败')
    } finally {
      setIsFetchingModels(false)
    }
  }

  async function importJobFile() {
    if (!desktopApi) {
      const sample =
        '前端工程师\n负责 React TypeScript 桌面端产品开发，要求熟悉组件化、性能优化和跨团队沟通。Electron 经验加分。'
      setJdText(sample)
      setJobSourceName('示例岗位.txt')
      notify('info', '当前是浏览器预览模式，已填入示例 JD')
      return
    }
    const parsed = await desktopApi.files.pickJobFile()
    if (parsed) {
      setJdText(parsed.text)
      setJobSourceName(parsed.fileName)
      setJobConfigs([])
      notify('success', `已导入 ${parsed.fileName}`)
    }
  }

  async function generateConfig() {
    const trimmedJd = jdText.trim()

    // 预设是手工调好的完整配置，本身就是岗位 Agent，不需要再用 LLM 生成。
    // 已选岗位且当前 JD 属于某个预设（或为空）时，直接进入下一步，
    // 避免单个生成结果覆盖掉其它已选的岗位 Agent。
    const jdBelongsToPreset = companyJobPresets.some((preset) => preset.jdText.trim() === trimmedJd)
    if (jobConfigs.length > 0 && (trimmedJd === '' || jdBelongsToPreset)) {
      setActiveStep('resumes')
      notify('success', `已就绪 ${jobConfigs.length} 个岗位 Agent`)
      return
    }

    if (!trimmedJd) {
      notify('error', '请先导入或粘贴岗位描述')
      return
    }
    setBusyTask('job')
    try {
      const config =
        desktopApi && apiKeyConfigured
          ? await desktopApi.agents.generateJobConfig({
              jdText,
              sourceFileName: jobSourceName,
              model,
            })
          : createFallbackJobConfig(jdText, jobSourceName)
      // 追加而非替换：保留其它已选岗位 Agent，按 id 去重
      setJobConfigs((current) => [...current.filter((item) => item.id !== config.id), config])
      setActiveStep('resumes')
      notify('success', '岗位 agent 配置已生成，可继续编辑')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '岗位 agent 生成失败')
    } finally {
      setBusyTask(null)
    }
  }

  async function importResumes() {
    if (!desktopApi) {
      notify('info', bridgeUnavailableMessage)
      return
    }

    setBusyTask('import')
    setResumeImportProgress(null)
    try {
      const result = await desktopApi.files.pickResumeFiles()
      appendResumeImportResult(result)
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '简历导入失败')
    } finally {
      setBusyTask(null)
      setResumeImportProgress(null)
    }
  }

  function addFilenameAlias() {
    const defaultAgentId = aliasTargetAgents[0]?.id ?? ''
    setFilenameAliases((current) => [
      ...current,
      {
        id: createFilenameAliasId(),
        pattern: '',
        agentId: defaultAgentId,
      },
    ])
  }

  function updateFilenameAlias(aliasId: string, patch: Partial<FilenameRouteAlias>) {
    setFilenameAliases((current) =>
      current.map((alias) => (alias.id === aliasId ? { ...alias, ...patch } : alias)),
    )
  }

  function removeFilenameAlias(aliasId: string) {
    setFilenameAliases((current) => current.filter((alias) => alias.id !== aliasId))
  }

  async function importResumeFolder() {
    if (!desktopApi) {
      notify('info', bridgeUnavailableMessage)
      return
    }

    setBusyTask('import')
    setResumeImportProgress(null)
    try {
      const result = await desktopApi.files.pickResumeFolder()
      appendResumeImportResult(result)
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '简历文件夹导入失败')
    } finally {
      setBusyTask(null)
      setResumeImportProgress(null)
    }
  }

  function removeImportedSession(sessionId: string) {
    setResumes((current) => current.filter((resume) => resume.sessionId !== sessionId))
  }

  function replaceImportedSession(sessionId: string, imported: ImportedResumeSummary[]) {
    setResumes((current) => mergeResumeSummaries(
      current.filter((resume) => resume.sessionId !== sessionId),
      imported,
    ))
  }

  function appendResumeImportResult(result: ResumeImportResult) {
    if (result.cancelled) {
      removeImportedSession(result.sessionId)
      notify('info', '已取消本次简历导入')
      return
    }

    replaceImportedSession(result.sessionId, result.resumes)
    if (result.errors.length > 0) {
      notify('error', `${result.errors.length} 个文件解析失败`)
    } else if (result.resumes.length > 0) {
      notify('success', `已导入 ${result.resumes.length} 份简历`)
    }
  }

  async function cancelResumeImport() {
    if (!desktopApi || !resumeImportProgress?.sessionId) {
      return
    }
    await desktopApi.files.cancelResumeImport(resumeImportProgress.sessionId)
    notify('info', '正在取消导入...')
  }

  async function clearResumes() {
    if (desktopApi) {
      const sessionIds = [...new Set(resumes.map((resume) => resume.sessionId))]
      if (sessionIds.length > 0) {
        await desktopApi.files.clearResumeImportCache(sessionIds)
      }
    }
    setResumes([])
    setBatchResult(null)
    setSelectedResumeId(null)
    setResumeImportProgress(null)
    setScreeningProgress(null)
    setAgentStatusMap(new Map())
    notify('success', '已删除全部简历')
  }

  function requestScreening() {
    if (isImporting) {
      notify('info', '请等待简历导入完成后再开始筛选')
      return
    }

    if (jobConfigs.length === 0) {
      notify('error', '请先生成岗位 Agent，再开始筛选')
      setActiveStep('job')
      return
    }

    if (resumes.length === 0) {
      notify('error', '请先导入简历，再开始筛选')
      return
    }

    void runScreening()
  }

  function updateCriterion(index: number, field: 'label' | 'description' | 'weight', value: string) {
    if (!jobConfig) {
      return
    }
    setJobConfigs((current) => {
      const updated = structuredClone(current)
      if (!updated[0]) return current
      updated[0] = {
        ...updated[0],
        criteria: updated[0].criteria.map((criterion, criterionIndex) =>
          criterionIndex === index
            ? { ...criterion, [field]: field === 'weight' ? Number(value) : value }
            : criterion,
        ),
      }
      return updated
    })
  }

  function updateJobConfigField(field: 'title' | 'summary' | 'instructions', value: string) {
    if (!jobConfig) {
      return
    }
    setJobConfigs((current) => {
      const updated = structuredClone(current)
      if (!updated[0]) return current
      updated[0] = { ...updated[0], [field]: value }
      return updated
    })
  }

  function updateJobConfigList(field: 'mustHaves' | 'niceToHaves' | 'riskFlags', value: string) {
    if (!jobConfig) {
      return
    }
    setJobConfigs((current) => {
      const updated = structuredClone(current)
      if (!updated[0]) return current
      updated[0] = {
        ...updated[0],
        [field]: value.split('\n').map((item) => item.trim()).filter(Boolean),
      }
      return updated
    })
  }

  function toggleJobPreset(presetId: string) {
    const preset = companyJobPresets.find((item) => item.id === presetId)
    if (!preset) return

    // 用当前 closure 的 jobConfigs 计算新状态（用于 side effects）
    const alreadySelected = jobConfigs.some((c) => c.id === preset.config.id)
    const newConfigs = alreadySelected
      ? jobConfigs.filter((c) => c.id !== preset.config.id)
      : [...jobConfigs, structuredClone(preset.config)]

    // functional update 确保写入最新状态，避免 stale closure 导致丢失并发选择
    setJobConfigs((current) => {
      const inCurrent = current.some((c) => c.id === preset.config.id)
      return inCurrent
        ? current.filter((c) => c.id !== preset.config.id)
        : [...current, structuredClone(preset.config)]
    })

    // 单岗位时同步显示对应 JD 文本；多岗位时只更新标题
    if (newConfigs.length === 1) {
      const singlePreset = companyJobPresets.find((p) => p.config.id === newConfigs[0].id)
      if (singlePreset) {
        setJdText(singlePreset.jdText)
        setJobSourceName(`${singlePreset.title} 预设`)
      }
    } else if (newConfigs.length === 0) {
      setJdText('')
      setJobSourceName(undefined)
    } else {
      setJobSourceName(`已选 ${newConfigs.length} 个岗位`)
    }

    notify('success', `已${alreadySelected ? '取消' : '选择'} ${preset.title}`)
  }

  function updateScreeningProgress(event: ScreeningProgressEvent) {
    setScreeningProgress({
      completed: event.completed,
      total: event.total,
      currentFileName: event.fileName,
      status: event.status,
      phase: event.phase ?? 'screening',
      started: event.started ?? event.completed,
      active: event.active ?? 0,
    })
  }

  function updateAgentStatus(event: AgentStatusEvent) {
    setAgentStatusMap((current) => {
      const next = new Map(current)
      next.set(event.agentId, event)
      return next
    })
  }

  async function stopScreening() {
    if (!isScreening || isStoppingScreening) {
      return
    }
    setIsStoppingScreening(true)
    screeningStopRequestedRef.current = true

    try {
      if (desktopApi && apiKeyConfigured) {
        await desktopApi.agents.cancelScreening()
        return
      }

      if (!localScreeningAbortRef.current) {
        return
      }
      localScreeningAbortRef.current.abort()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '停止筛选失败')
      setIsStoppingScreening(false)
    }
  }

  async function runScreening() {
    if (jobConfigs.length === 0 || resumes.length === 0) {
      notify('error', '请先准备岗位 agent 和简历')
      return
    }
    const useDesktopScreening = Boolean(desktopApi && apiKeyConfigured)
    screeningStopRequestedRef.current = false
    localScreeningAbortRef.current = useDesktopScreening ? null : new AbortController()
    setBusyTask('screening')
    setIsStoppingScreening(false)
    setBatchResult(null)
    setSelectedResumeId(null)
    setAgentStatusMap(new Map())
    setScreeningProgress({
      completed: 0,
      total: resumes.length,
      currentFileName: resumes[0]?.fileName ?? '准备中',
      status: 'pending',
      phase: 'pending',
      started: 0,
      active: 0,
    })
    setActiveStep('screening')
    let unsubscribeProgress: (() => void) | undefined
    let unsubscribeAgentStatus: (() => void) | undefined

    try {
      await delay(80)
      if (screeningStopRequestedRef.current) {
        throw new Error('筛选已停止')
      }

      unsubscribeProgress =
        desktopApi && apiKeyConfigured ? desktopApi.agents.onScreeningProgress(updateScreeningProgress) : undefined
      unsubscribeAgentStatus =
        desktopApi && apiKeyConfigured ? desktopApi.agents.onAgentStatus(updateAgentStatus) : undefined

      let result: ScreeningBatchResult

      if (useDesktopScreening && desktopApi) {
        // 统一走多 Agent 路径（含单 Agent），以便触发 onAgentStatus 显示状态卡片
        result = await desktopApi.agents.runMultiAgentScreening({ agents: jobConfigs, resumes, model })
      } else {
        const localController = localScreeningAbortRef.current ?? new AbortController()
        localScreeningAbortRef.current = localController
        const hydratedResumes = desktopApi ? await desktopApi.files.loadCachedResumes(resumes) : []
        if (hydratedResumes.length === 0) {
          throw new Error(bridgeUnavailableMessage)
        }
        // 本地预览降级
        result = await runScreeningBatch({
          jobConfig: jobConfigs[0]!,
          resumes: hydratedResumes,
          runner: createLocalRunner(jobConfigs[0]!),
          concurrency: defaultScreeningConcurrency,
          maxRetries: 0,
          signal: localController.signal,
          onProgress: updateScreeningProgress,
        })
      }

      if (screeningStopRequestedRef.current) {
        throw new Error('筛选已停止')
      }
      setBatchResult(result)
      setSelectedResumeId(result.scorecards[0]?.resumeId ?? null)
      setScreeningProgress(null)
      setActiveStep('results')
      notify('success', `筛选完成：${result.scorecards.length} 份成功，${result.errors.length} 份失败`)
    } catch (error) {
      if (isScreeningStoppedError(error)) {
        notify('info', '已停止筛选')
        setScreeningProgress(null)
        setAgentStatusMap(new Map())
        setActiveStep('screening')
      } else {
        notify('error', error instanceof Error ? error.message : '筛选失败')
        setActiveStep('resumes')
      }
    } finally {
      unsubscribeProgress?.()
      unsubscribeAgentStatus?.()
      localScreeningAbortRef.current = null
      screeningStopRequestedRef.current = false
      setIsStoppingScreening(false)
      setBusyTask(null)
    }
  }

  async function exportCsv() {
    if (!batchResult?.scorecards.length) {
      return
    }
    if (desktopApi) {
      const filePath = await desktopApi.export.csv(batchResult.scorecards)
      if (filePath) {
        notify('success', `CSV 已导出：${filePath}`)
      }
    } else {
      downloadText('筛选结果.csv', toPreviewCsv(batchResult.scorecards))
      notify('success', 'CSV 已下载')
    }
  }

  async function exportXlsx() {
    if (!batchResult?.scorecards.length) {
      return
    }
    if (!desktopApi) {
      notify('info', '浏览器预览模式只支持 CSV 下载；桌面端支持 Excel 导出')
      return
    }
    const filePath = await desktopApi.export.xlsx(batchResult.scorecards)
    if (filePath) {
      notify('success', `Excel 已导出：${filePath}`)
    }
  }

  const steps: Array<{ id: StepId; label: string; meta: string }> = [
    { id: 'settings', label: '设置', meta: apiKeyConfigured ? '已配置' : '待配置' },
    { id: 'job', label: '岗位 Agent', meta: isGeneratingJob ? '生成中' : jobConfigs.length > 0 ? `${jobConfigs.length} 个` : '待生成' },
    { id: 'resumes', label: '简历导入', meta: resumeStepMeta },
    { id: 'screening', label: '运行筛选', meta: screeningStepMeta },
    { id: 'results', label: '结果导出', meta: `${batchResult?.scorecards.length ?? 0} 份` },
  ]
  const screeningPhase = screeningProgress?.phase ?? 'pending'
  const visibleScreeningProgress = screeningProgress
    ? Math.max(screeningProgress.completed, screeningProgress.started)
    : 0
  const screeningHeading = !isScreening
    ? '筛选任务待开始'
    : screeningPhase === 'routing'
      ? '正在分配简历给岗位 Agent'
      : '岗位 Agent 正在筛选简历'
  const screeningCurrentText = !isScreening
    ? '等待开始'
    : screeningPhase === 'routing'
      ? `正在分配：${screeningProgress?.currentFileName ?? resumes[0]?.fileName ?? '准备中'}`
      : `正在处理：${screeningProgress?.currentFileName ?? resumes[0]?.fileName ?? '准备中'}`
  const screeningActivityText =
    screeningProgress && isScreening
      ? screeningPhase === 'routing'
        ? `已分配 ${screeningProgress.completed} / ${screeningProgress.total}，分配中 ${screeningProgress.active} 份`
        : screeningProgress.started > screeningProgress.completed
          ? `已发起 ${screeningProgress.started} / ${screeningProgress.total}，等待返回 ${screeningProgress.active} 份`
          : `已完成 ${screeningProgress.completed} / ${screeningProgress.total}`
      : null

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">SS</span>
          <div>
            <p>Smart Screen</p>
            <strong>简历筛选 Agent</strong>
          </div>
        </div>
        <nav className="step-nav" aria-label="工作流">
          {steps.map((step, index) => (
            <button
              key={step.id}
              className={activeStep === step.id ? 'active' : ''}
              aria-label={`${String(index + 1).padStart(2, '0')} ${step.label} ${step.meta}`}
              type="button"
              onClick={() => setActiveStep(step.id)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{step.label}</strong>
              <em>{step.meta}</em>
            </button>
          ))}
        </nav>
        <div className="privacy-note">
          <span>隐私模式</span>
          <p>不保存筛选历史。解析文本仅在当前会话中使用，关闭应用后清空。</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">macOS / Windows 11 Desktop</p>
            <h1>为每个岗位生成一个专属筛选 agent</h1>
          </div>
          <div className="status-stack">
            <span className={hasDesktopApi ? 'pill ok' : 'pill warn'}>
              {hasDesktopApi ? '桌面端桥接正常' : '桥接未加载'}
            </span>
            <span className={apiKeyConfigured ? 'pill ok' : 'pill warn'}>
              {apiKeyConfigured ? 'API key 已配置' : 'API key 未配置'}
            </span>
          </div>
        </header>

        {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}

        {activeStep === 'settings' && (
          <section className="panel settings-grid">
            <div>
              <p className="section-kicker">Settings</p>
              <h2>OpenAI 连接</h2>
              <p className="muted">
                API key 会写入系统安全凭据；模型和自定义 URL 会保存在本机设置中。自定义 URL 适用于 OpenAI 兼容网关。
              </p>
            </div>
            <div className="form-card">
              <label htmlFor="api-key-input">
                <span>OpenAI API key</span>
                <input
                  id="api-key-input"
                  type="password"
                  value={apiKeyDraft}
                  placeholder={apiKeyConfigured ? '已配置，可重新输入覆盖' : 'sk-...'}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                />
              </label>
              <label htmlFor="model-input">
                <span>模型</span>
                <div className="inline-control">
                  <input
                    id="model-input"
                    type="text"
                    value={model}
                    placeholder="gpt-5.4-mini 或自定义模型名"
                    onChange={(event) => setModel(event.target.value)}
                  />
                  <button type="button" onClick={fetchModels} disabled={isFetchingModels}>
                    {isFetchingModels ? '获取中...' : '获取模型'}
                  </button>
                </div>
              </label>
              {availableModels.length > 0 && (
                <label htmlFor="available-model-select">
                  <span>可用模型</span>
                  <select
                    id="available-model-select"
                    value={availableModels.includes(model) ? model : ''}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    <option value="" disabled>
                      选择一个已获取模型
                    </option>
                    {availableModels.map((modelId) => (
                      <option key={modelId} value={modelId}>
                        {modelId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label htmlFor="base-url-input">
                <span>自定义 URL</span>
                <input
                  id="base-url-input"
                  type="url"
                  value={baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </label>
              <p className="form-hint">留空时使用 OpenAI 默认地址；填写时会作为 Agents SDK 的 baseURL。</p>
              <div className="routing-settings">
                <label htmlFor="routing-mode-select">
                  <span>路由模式</span>
                  <select
                    id="routing-mode-select"
                    value={routingMode}
                    onChange={(event) => setRoutingMode(event.target.value as RoutingMode)}
                  >
                    <option value="hybrid">混合加速</option>
                    <option value="local_only">纯本地快速</option>
                  </select>
                </label>
                <label htmlFor="llm-routing-concurrency-input">
                  <span>LLM 分配并发</span>
                  <input
                    id="llm-routing-concurrency-input"
                    type="number"
                    min={1}
                    max={30}
                    value={llmRoutingConcurrency}
                    onChange={(event) => setLlmRoutingConcurrency(Number(event.target.value))}
                  />
                </label>
                <div className="alias-editor">
                  <div className="alias-editor-header">
                    <span>文件名映射</span>
                    <button type="button" onClick={addFilenameAlias}>
                      新增映射
                    </button>
                  </div>
                  {filenameAliases.map((alias, index) => (
                    <div className="alias-row" key={alias.id}>
                      <input
                        aria-label={`文件名映射关键词 ${index + 1}`}
                        type="text"
                        value={alias.pattern}
                        onChange={(event) => updateFilenameAlias(alias.id, { pattern: event.target.value })}
                      />
                      <select
                        aria-label={`文件名映射目标 ${index + 1}`}
                        value={alias.agentId}
                        onChange={(event) => updateFilenameAlias(alias.id, { agentId: event.target.value })}
                      >
                        {aliasTargetAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.title}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removeFilenameAlias(alias.id)}>
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="button-row">
                <button type="button" className="primary" onClick={saveSettings}>
                  保存设置
                </button>
                <button type="button" className="primary" onClick={saveApiKey}>
                  保存 key
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await desktopApi?.settings.clearApiKey()
                    setApiKeyConfigured(false)
                    notify('success', 'API key 已清除')
                  }}
                >
                  清除
                </button>
              </div>
            </div>
          </section>
        )}

        {activeStep === 'job' && (
          <section className="panel job-layout">
            <div className="editor-column">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Job Agent</p>
                  <h2>岗位描述</h2>
                </div>
                <button type="button" onClick={importJobFile}>
                  导入 JD 文件
                </button>
              </div>
              <div className="preset-strip" aria-label="公司岗位预设">
                {companyJobPresets.map((preset) => {
                  const isSelected = jobConfigs.some((c) => c.id === preset.config.id)
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={isSelected ? 'preset-selected' : ''}
                      onClick={() => toggleJobPreset(preset.id)}
                    >
                      <strong>{preset.title}</strong>
                      <span>{preset.salary} · {preset.meta}</span>
                      {isSelected && <span className="preset-check">✓</span>}
                    </button>
                  )
                })}
              </div>
              <textarea
                value={jdText}
                onChange={(event) => {
                  setJdText(event.target.value)
                }}
                placeholder="粘贴岗位描述，或导入 PDF / DOCX / TXT 文件"
              />
              <button type="button" className="primary wide" disabled={isBusy} onClick={generateConfig}>
                {isGeneratingJob ? '生成中...' : '生成岗位 Agent 配置'}
              </button>
            </div>
            <div className="config-column">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Editable Config</p>
                  <h2>{jobConfig?.title ?? '尚未生成'}</h2>
                </div>
              </div>
              {jobConfig ? (
                <div className="criteria-list">
                  <article className="criterion-card config-editor-card">
                    <label className="config-field" htmlFor="job-title-input">
                      <span>岗位名称</span>
                      <input
                        id="job-title-input"
                        value={jobConfig.title}
                        onChange={(event) => updateJobConfigField('title', event.target.value)}
                      />
                    </label>
                    <label className="config-field" htmlFor="job-summary-input">
                      <span>岗位摘要</span>
                      <textarea
                        id="job-summary-input"
                        className="config-textarea-compact"
                        value={jobConfig.summary}
                        onChange={(event) => updateJobConfigField('summary', event.target.value)}
                      />
                    </label>
                    <label className="config-field" htmlFor="job-must-haves-input">
                      <span>硬性要求</span>
                      <textarea
                        id="job-must-haves-input"
                        className="config-textarea-compact"
                        value={jobConfig.mustHaves.join('\n')}
                        onChange={(event) => updateJobConfigList('mustHaves', event.target.value)}
                      />
                    </label>
                    <label className="config-field" htmlFor="job-nice-to-haves-input">
                      <span>加分项</span>
                      <textarea
                        id="job-nice-to-haves-input"
                        className="config-textarea-compact"
                        value={jobConfig.niceToHaves.join('\n')}
                        onChange={(event) => updateJobConfigList('niceToHaves', event.target.value)}
                      />
                    </label>
                    <label className="config-field" htmlFor="job-risk-flags-input">
                      <span>风险项</span>
                      <textarea
                        id="job-risk-flags-input"
                        className="config-textarea-compact"
                        value={jobConfig.riskFlags.join('\n')}
                        onChange={(event) => updateJobConfigList('riskFlags', event.target.value)}
                      />
                    </label>
                    <label className="config-field config-field-wide" htmlFor="job-instructions-input">
                      <span>Agent 指令</span>
                      <textarea
                        id="job-instructions-input"
                        className="config-textarea-large"
                        value={jobConfig.instructions}
                        onChange={(event) => updateJobConfigField('instructions', event.target.value)}
                      />
                    </label>
                  </article>
                  {jobConfig.criteria.map((criterion, index) => (
                    <article key={criterion.id} className="criterion-card scoring-criterion-card">
                      <label className="config-field criterion-title-field" htmlFor={`criterion-${criterion.id}-label`}>
                        <span>{`维度 ${index + 1} 名称`}</span>
                        <input
                          id={`criterion-${criterion.id}-label`}
                          value={criterion.label}
                          onChange={(event) => updateCriterion(index, 'label', event.target.value)}
                        />
                      </label>
                      <label className="config-field criterion-weight-field" htmlFor={`criterion-${criterion.id}-weight`}>
                        <span>{`维度 ${index + 1} 权重`}</span>
                        <input
                          id={`criterion-${criterion.id}-weight`}
                          type="number"
                          min="0"
                          max="100"
                          value={criterion.weight}
                          onChange={(event) => updateCriterion(index, 'weight', event.target.value)}
                        />
                      </label>
                      <label className="config-field criterion-description-field" htmlFor={`criterion-${criterion.id}-description`}>
                        <span>{`维度 ${index + 1} 说明`}</span>
                        <textarea
                          id={`criterion-${criterion.id}-description`}
                          className="config-textarea-compact"
                          value={criterion.description}
                          onChange={(event) => updateCriterion(index, 'description', event.target.value)}
                        />
                      </label>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">导入 JD 后生成可编辑评分维度、硬性要求和岗位 agent 指令。</div>
              )}
            </div>
          </section>
        )}

        {activeStep === 'resumes' && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Resume Import</p>
                <h2>批量导入简历</h2>
              </div>
              <div className="button-row">
                <button type="button" className="danger" onClick={clearResumes} disabled={resumes.length === 0 || isBusy}>
                  删除全部简历
                </button>
                <button type="button" onClick={importResumes} disabled={isBusy}>
                  选择多份简历
                </button>
                <button type="button" onClick={importResumeFolder} disabled={isBusy}>
                  导入文件夹
                </button>
                <button type="button" className="primary" onClick={requestScreening} disabled={isBusy || resumes.length === 0}>
                  开始筛选
                </button>
              </div>
            </div>
            {resumeImportProgress && (
              <div className="import-progress">
                <div className="screening-progress-header">
                  <div>
                    <p className="section-kicker">Importing</p>
                    <h3>{resumeImportProgress.status === 'scanning' ? '正在扫描文件夹' : '正在导入简历'}</h3>
                  </div>
                  <strong>{`${resumeImportProgress.processed} / ${Math.max(resumeImportProgress.total, 1)}`}</strong>
                </div>
                <progress
                  aria-label="简历导入进度"
                  value={resumeImportProgress.processed}
                  max={Math.max(resumeImportProgress.total, 1)}
                />
                <p className="screening-current">
                  {resumeImportProgress.currentFileName
                    ? `正在处理：${resumeImportProgress.currentFileName}`
                    : '准备解析简历'}
                </p>
                <div className="import-progress-meta">
                  <span>{`已解析 ${resumeImportProgress.processed} / ${resumeImportProgress.total}`}</span>
                  <span>{`成功 ${resumeImportProgress.cached}，失败 ${resumeImportProgress.failed}`}</span>
                </div>
                {isImporting && (
                  <button type="button" onClick={cancelResumeImport}>
                    取消导入
                  </button>
                )}
              </div>
            )}
            <div className="resume-grid">
              {resumes.map((resume) => (
                <article key={resume.id} className="resume-card">
                  <strong>{resume.fileName}</strong>
                  <span>{resume.extension.toUpperCase()} · {resume.wordCount} words</span>
                  <p>{resume.preview}</p>
                  <button type="button" onClick={() => setResumes((current) => current.filter((item) => item.id !== resume.id))}>
                    移除
                  </button>
                </article>
              ))}
              {resumes.length === 0 && (
                <div className="empty-state">还没有简历。请从电脑选择多份简历，或导入一个包含简历的文件夹。</div>
              )}
            </div>
          </section>
        )}

        {activeStep === 'screening' && (
          <section className="panel run-panel">
            {isScreening && <div className="loader-ring" />}
            <div className="screening-progress">
              <div className="screening-progress-header">
                <div>
                  <p className="section-kicker">Screening</p>
                  <h2>{screeningHeading}</h2>
                </div>
                <div className="screening-progress-actions">
                  {isScreening && (
                    <button type="button" className="danger" onClick={stopScreening} disabled={isStoppingScreening}>
                      {isStoppingScreening ? '停止中...' : '停止筛选'}
                    </button>
                  )}
                  <strong>{screeningProgress ? `${visibleScreeningProgress} / ${screeningProgress.total}` : `0 / ${resumes.length}`}</strong>
                </div>
              </div>
              <progress
                aria-label="筛选进度"
                value={visibleScreeningProgress}
                max={screeningProgress?.total ?? Math.max(resumes.length, 1)}
              />
              <p className="screening-current">{screeningCurrentText}</p>
              {screeningActivityText && (
                <div className="import-progress-meta">
                  <span>{screeningActivityText}</span>
                </div>
              )}
              {agentStatusMap.size > 0 && (
                <div className="agent-status-grid">
                  {[...agentStatusMap.values()].map((s) => (
                    <div key={s.agentId} className={`agent-status-card agent-status-${s.status}`}>
                      <strong>{s.agentTitle}</strong>
                      <span className="agent-status-badge">{
                        s.status === 'idle' ? '待机' :
                        s.status === 'running' ? '运行中' :
                        s.status === 'completed' ? '已完成' : '出错'
                      }</span>
                      <span className="agent-progress">{s.processedCount} / {s.totalAssigned}</span>
                      {s.status === 'running' && s.currentResumeFileName && (
                        <p className="agent-current-file">{s.currentResumeFileName}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="muted">应用代码负责任务并发、重试和排序；岗位 agent 只负责基于证据输出结构化评分卡。</p>
            </div>
          </section>
        )}

        {activeStep === 'results' && (
          <section className="panel results-layout">
            <div className="result-list">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Ranking</p>
                  <h2>候选人排序</h2>
                </div>
                <div className="button-row">
                  <button type="button" onClick={exportCsv}>
                    导出 CSV
                  </button>
                  <button type="button" className="primary" onClick={exportXlsx}>
                    导出 Excel
                  </button>
                </div>
              </div>
              {batchResult?.scorecards.map((scorecard, index) => (
                <button
                  type="button"
                  key={scorecard.resumeId}
                  className={`rank-row ${selectedScorecard?.resumeId === scorecard.resumeId ? 'selected' : ''}`}
                  onClick={() => setSelectedResumeId(scorecard.resumeId)}
                >
                  <span>#{index + 1}</span>
                  <strong>{scorecard.candidateName}</strong>
                  <em>{getRecommendationLabel(scorecard.recommendation)}</em>
                  <b>{scorecard.overallScore}</b>
                </button>
              ))}
              {batchResult?.errors.map((error) => (
                <div key={error.resumeId} className="error-row">
                  {error.fileName}: {error.message}
                </div>
              ))}
            </div>

            <div className="scorecard-detail">
              {selectedScorecard ? (
                <>
                  <div className="score-hero">
                    <div>
                      <p className="section-kicker">Scorecard</p>
                      <h2>{selectedScorecard.candidateName}</h2>
                      <span>{selectedScorecard.fileName}</span>
                    </div>
                    <strong>{selectedScorecard.overallScore}</strong>
                  </div>
                  <div className="signal-columns">
                    <section>
                      <h3>亮点</h3>
                      {selectedScorecard.strengths.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
                    </section>
                    <section>
                      <h3>缺失/风险</h3>
                      {[...selectedScorecard.gaps, ...selectedScorecard.risks].map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
                    </section>
                  </div>
                  <div className="criteria-bars">
                    {selectedScorecard.criterionScores.map((criterion) => (
                      <article key={criterion.criterionId}>
                        <div>
                          <strong>{criterion.label}</strong>
                          <span>{criterion.score}</span>
                        </div>
                        <progress value={criterion.score} max="100" />
                        <p>{criterion.evidence[0] ?? criterion.missing[0] ?? '无明确证据'}</p>
                      </article>
                    ))}
                  </div>
                  <blockquote>{selectedScorecard.reviewerNotes}</blockquote>
                </>
              ) : (
                <div className="empty-state">暂无筛选结果。</div>
              )}
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

export default App

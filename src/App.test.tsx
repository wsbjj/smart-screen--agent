/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.js'
import type { DesktopApi } from './shared/desktopApi.js'
import type {
  CandidateScorecard,
  ImportedResumeSummary,
  ResumeDocument,
  ResumeImportProgressEvent,
  SavedJobRecord,
  JobAgentConfig,
  ScreeningBatchResult,
  ScreeningProgressEvent,
} from './shared/types.js'

describe('App smoke flow', () => {
  afterEach(() => {
    delete window.desktopApi
    vi.restoreAllMocks()
  })

  type DesktopApiMockOverrides = {
    settings?: Partial<DesktopApi['settings']>
    files?: Partial<DesktopApi['files']>
    jobs?: Partial<DesktopApi['jobs']>
    agents?: Partial<DesktopApi['agents']>
    export?: Partial<DesktopApi['export']>
  }

  const defaultSettings = {
    model: 'gpt-5.2',
    baseUrl: '',
    routingMode: 'hybrid' as const,
    filenameAliases: [],
    llmRoutingConcurrency: 10,
  }

  function toImportedResume(resume: ResumeDocument, sessionId = 'test-session'): ImportedResumeSummary {
    return {
      id: resume.id,
      fileName: resume.fileName,
      extension: resume.extension,
      wordCount: resume.wordCount,
      preview: resume.text.slice(0, 150),
      sessionId,
      cacheKey: resume.id,
    }
  }

  function importResult(resumes: ResumeDocument[], sessionId = 'test-session') {
    return {
      sessionId,
      resumes: resumes.map((resume) => toImportedResume(resume, sessionId)),
      errors: [],
      cancelled: false,
    }
  }

  const generatedJobConfig: JobAgentConfig = {
    id: 'generated-job',
    title: '生成岗位',
    summary: '生成岗位摘要',
    mustHaves: ['核心要求'],
    niceToHaves: [],
    riskFlags: [],
    criteria: [{ id: 'core', label: '核心匹配', weight: 100, description: '核心能力' }],
    instructions: '只看证据',
    thresholds: { strongYes: 85, yes: 75, maybe: 60 },
  }

  function toSavedJob(config: JobAgentConfig, patch: Partial<SavedJobRecord> = {}): SavedJobRecord {
    return {
      id: config.id,
      title: config.title,
      salary: '10-20K',
      meta: '1-3年 / 本科 / 深圳',
      jdText: `${config.title} JD`,
      sourceFileName: `${config.title}.txt`,
      config,
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      ...patch,
    }
  }

  function createDesktopApiMock(overrides: DesktopApiMockOverrides = {}): DesktopApi {
    return {
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(false),
        getSettings: vi.fn().mockResolvedValue(defaultSettings),
        saveSettings: vi.fn().mockImplementation(async (settings) => settings),
        fetchModels: vi.fn().mockResolvedValue([]),
        saveApiKey: vi.fn().mockResolvedValue(undefined),
        clearApiKey: vi.fn().mockResolvedValue(undefined),
        ...overrides.settings,
      },
      files: {
        pickJobFile: vi.fn().mockResolvedValue(null),
        pickResumeFiles: vi.fn().mockResolvedValue({ sessionId: '', resumes: [], errors: [], cancelled: false }),
        pickResumeFolder: vi.fn().mockResolvedValue({ sessionId: '', resumes: [], errors: [], cancelled: false }),
        onResumeImportProgress: vi.fn().mockReturnValue(() => undefined),
        cancelResumeImport: vi.fn().mockResolvedValue(undefined),
        clearResumeImportCache: vi.fn().mockResolvedValue(undefined),
        loadCachedResumes: vi.fn(async (items: ImportedResumeSummary[]) =>
          items.map((item) => ({
            id: item.id,
            fileName: item.fileName,
            extension: item.extension,
            text: item.preview,
            wordCount: item.wordCount,
          })),
        ),
        ...overrides.files,
      },
      jobs: {
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockImplementation(async (input) =>
          toSavedJob(input.config, {
            id: input.id ?? input.config.id,
            title: input.title ?? input.config.title,
            salary: input.salary ?? '',
            meta: input.meta ?? '',
            jdText: input.jdText,
            sourceFileName: input.sourceFileName,
          }),
        ),
        delete: vi.fn().mockResolvedValue(true),
        ...overrides.jobs,
      },
      agents: {
        generateJobConfig: vi.fn(),
        runScreening: vi.fn(),
        runMultiAgentScreening: vi.fn().mockResolvedValue({ scorecards: [], errors: [] }),
        cancelScreening: vi.fn().mockResolvedValue(false),
        onScreeningProgress: vi.fn().mockReturnValue(() => undefined),
        onAgentStatus: vi.fn().mockReturnValue(() => undefined),
        ...overrides.agents,
      },
      export: {
        csv: vi.fn(),
        xlsx: vi.fn(),
        ...overrides.export,
      },
    }
  }

  it('does not populate sample models when desktop bridge is unavailable', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: '为每个岗位生成一个专属筛选 agent' })).toBeInTheDocument()
    expect(screen.getByLabelText('应用版本号')).toHaveTextContent('v0.3.1')
    expect(screen.getByText('桥接未加载')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '获取模型' }))

    expect(screen.queryByLabelText('可用模型')).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-5.4-mini')).not.toBeInTheDocument()
    expect(screen.getByText('桌面端桥接未加载，请重启应用或重新构建')).toBeInTheDocument()
  })

  it('does not add sample resumes when desktop bridge is unavailable', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))

    expect(screen.getByText('还没有简历。请从电脑选择多份简历，或导入一个包含简历的文件夹。')).toBeInTheDocument()
    expect(screen.queryByText('张三-前端.txt')).not.toBeInTheDocument()
    expect(screen.queryByText('李四-后端.txt')).not.toBeInTheDocument()
    expect(screen.getByText('桌面端桥接未加载，请重启应用或重新构建')).toBeInTheDocument()
  })

  it('loads saved jobs and uses AI to save an imported JD as a new custom job', async () => {
    const user = userEvent.setup()
    const saveJob = vi.fn().mockImplementation(async (input) =>
      toSavedJob(input.config, {
        id: input.config.id,
        title: input.config.title,
        jdText: input.jdText,
        sourceFileName: input.sourceFileName,
      }),
    )
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
      },
      files: {
        pickJobFile: vi.fn().mockResolvedValue({
          fileName: '运营经理.txt',
          extension: '.txt',
          text: '运营经理 JD',
          wordCount: 2,
        }),
      },
      jobs: {
        save: saveJob,
      },
      agents: {
        generateJobConfig: vi.fn().mockResolvedValue(generatedJobConfig),
      },
    })

    render(<App />)
    await waitFor(() => expect(window.desktopApi!.jobs.list).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    expect(screen.getByRole('heading', { name: '岗位库' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新增岗位' }))
    await user.click(screen.getByRole('button', { name: '导入 JD 文件' }))
    await user.click(screen.getByRole('button', { name: 'AI 生成并新增' }))

    expect(window.desktopApi.agents.generateJobConfig).toHaveBeenCalledWith({
      jdText: '运营经理 JD',
      sourceFileName: '运营经理.txt',
      model: 'gpt-5.2',
      currentConfig: undefined,
    })
    expect(saveJob).toHaveBeenCalledWith(expect.objectContaining({
      jdText: '运营经理 JD',
      sourceFileName: '运营经理.txt',
      config: generatedJobConfig,
    }))
    expect(await screen.findByRole('button', { name: /编辑 生成岗位/ })).toBeInTheDocument()
    expect(screen.getByText('岗位已保存到本机岗位库')).toBeInTheDocument()
  })

  it('sends the current custom job config when AI updates an existing saved job', async () => {
    const user = userEvent.setup()
    const savedJob = toSavedJob(generatedJobConfig, {
      id: 'saved-job-1',
      title: '自定义运营',
      config: { ...generatedJobConfig, id: 'saved-job-1', title: '自定义运营' },
      jdText: '旧 JD',
    })
    const updatedConfig = { ...savedJob.config, title: '自定义高级运营' }
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
      },
      jobs: {
        list: vi.fn().mockResolvedValue([savedJob]),
        save: vi.fn().mockImplementation(async (input) =>
          toSavedJob(input.config, {
            id: input.id,
            title: input.config.title,
            jdText: input.jdText,
          }),
        ),
      },
      agents: {
        generateJobConfig: vi.fn().mockResolvedValue(updatedConfig),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(await screen.findByRole('button', { name: /编辑 自定义运营/ }))
    await user.click(screen.getByRole('button', { name: 'AI 更新并保存' }))

    expect(window.desktopApi.agents.generateJobConfig).toHaveBeenCalledWith({
      jdText: '旧 JD',
      sourceFileName: '生成岗位.txt',
      model: 'gpt-5.2',
      currentConfig: savedJob.config,
    })
    expect(window.desktopApi.jobs.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'saved-job-1',
      config: updatedConfig,
    }))
  })

  it('clears the active config when starting a new job draft', async () => {
    const user = userEvent.setup()
    const savedJob = toSavedJob(generatedJobConfig, {
      id: 'saved-job-clear',
      title: '已有岗位',
      config: { ...generatedJobConfig, id: 'saved-job-clear', title: '已有岗位' },
    })
    window.desktopApi = createDesktopApiMock({
      jobs: {
        list: vi.fn().mockResolvedValue([savedJob]),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(await screen.findByRole('button', { name: /编辑 已有岗位/ }))
    expect(screen.getByLabelText('岗位名称')).toHaveValue('已有岗位')

    await user.click(screen.getByRole('button', { name: '新增岗位' }))

    expect(screen.getByRole('heading', { name: '尚未生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /02 岗位 Agent 待生成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动保存' })).toBeDisabled()
  })

  it('closes a selected custom job when clicking it again', async () => {
    const user = userEvent.setup()
    const savedJob = toSavedJob(generatedJobConfig, {
      id: 'saved-job-toggle',
      title: '可关闭岗位',
      config: { ...generatedJobConfig, id: 'saved-job-toggle', title: '可关闭岗位' },
    })
    window.desktopApi = createDesktopApiMock({
      jobs: {
        list: vi.fn().mockResolvedValue([savedJob]),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    const jobButton = await screen.findByRole('button', { name: /编辑 可关闭岗位/ })
    await user.click(jobButton)
    expect(screen.getByLabelText('岗位名称')).toHaveValue('可关闭岗位')
    expect(screen.getByRole('button', { name: /02 岗位 Agent 1 个/ })).toBeInTheDocument()

    await user.click(jobButton)

    expect(screen.getByRole('heading', { name: '尚未生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /02 岗位 Agent 待生成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动保存' })).toBeDisabled()
  })

  it('deletes custom jobs from the library and active agent selection', async () => {
    const user = userEvent.setup()
    const savedJob = toSavedJob(generatedJobConfig, {
      id: 'saved-job-delete',
      title: '待删除岗位',
      config: { ...generatedJobConfig, id: 'saved-job-delete', title: '待删除岗位' },
    })
    window.desktopApi = createDesktopApiMock({
      jobs: {
        list: vi.fn().mockResolvedValue([savedJob]),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(await screen.findByRole('button', { name: /编辑 待删除岗位/ }))
    await user.click(screen.getByRole('button', { name: '删除岗位' }))

    expect(window.desktopApi.jobs.delete).toHaveBeenCalledWith('saved-job-delete')
    expect(await screen.findByText('岗位已删除')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /编辑 待删除岗位/ })).not.toBeInTheDocument()
  })

  it('saves routing optimization settings with filename aliases and LLM concurrency', async () => {
    const user = userEvent.setup()
    const saveSettings = vi.fn().mockImplementation(async (settings) => settings)
    window.desktopApi = createDesktopApiMock({
      settings: {
        saveSettings,
      },
    })

    render(<App />)

    await waitFor(() => expect(window.desktopApi!.settings.getSettings).toHaveBeenCalled())
    await user.selectOptions(screen.getByLabelText('路由模式'), 'local_only')
    await user.clear(screen.getByLabelText('LLM 分配并发'))
    await user.type(screen.getByLabelText('LLM 分配并发'), '20')
    await user.click(screen.getByRole('button', { name: '新增映射' }))
    await user.type(screen.getByLabelText('文件名映射关键词 1'), '亚马逊运营')
    await user.selectOptions(screen.getByLabelText('文件名映射目标 1'), 'hanlin-amazon-operator')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(saveSettings).toHaveBeenCalledWith({
      model: 'gpt-5.2',
      baseUrl: '',
      routingMode: 'local_only',
      llmRoutingConcurrency: 20,
      filenameAliases: [
        expect.objectContaining({
          pattern: '亚马逊运营',
          agentId: 'hanlin-amazon-operator',
        }),
      ],
    })
  })

  it('shows live resume import progress and appends imported batches', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-progress-1',
      fileName: '候选人A.txt',
      extension: '.txt',
      text: '候选人A React TypeScript Electron',
      wordCount: 4,
    }
    const summary = toImportedResume(resume, 'import-session-a')
    let importListener: ((event: ResumeImportProgressEvent) => void) | undefined
    let resolveImport: ((result: ReturnType<typeof importResult>) => void) | undefined
    window.desktopApi = createDesktopApiMock({
      files: {
        pickResumeFiles: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveImport = resolve
            }),
        ),
        onResumeImportProgress: vi.fn((listener) => {
          importListener = listener
          return () => undefined
        }),
      },
    })

    render(<App />)
    await waitFor(() => expect(window.desktopApi!.files.onResumeImportProgress).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))

    act(() => {
      importListener?.({
        sessionId: 'import-session-a',
        status: 'started',
        processed: 0,
        total: 2,
        cached: 0,
        failed: 0,
      })
      importListener?.({
        sessionId: 'import-session-a',
        status: 'progress',
        processed: 1,
        total: 2,
        cached: 1,
        failed: 0,
        currentFileName: '候选人A.txt',
        batch: [summary],
      })
    })

    expect(await screen.findByRole('progressbar', { name: '简历导入进度' })).toHaveAttribute('max', '2')
    expect(screen.getByText('已解析 1 / 2')).toBeInTheDocument()
    expect(screen.getByText('正在处理：候选人A.txt')).toBeInTheDocument()
    expect(screen.getByText('成功 1，失败 0')).toBeInTheDocument()
    expect(screen.getByText('候选人A.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /03 简历导入 1 份/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始筛选' })).toBeDisabled()

    await act(async () => {
      resolveImport?.({
        sessionId: 'import-session-a',
        resumes: [summary],
        errors: [],
        cancelled: false,
      })
    })

    await waitFor(() => expect(screen.getByRole('button', { name: '开始筛选' })).toBeEnabled())
  })

  it('cancels an active resume import and removes the current session summaries', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-cancel-1',
      fileName: '待取消候选人.txt',
      extension: '.txt',
      text: 'React TypeScript',
      wordCount: 2,
    }
    const summary = toImportedResume(resume, 'cancel-session')
    let importListener: ((event: ResumeImportProgressEvent) => void) | undefined
    let resolveImport: ((result: ReturnType<typeof importResult>) => void) | undefined
    const cancelResumeImport = vi.fn().mockResolvedValue(undefined)
    window.desktopApi = createDesktopApiMock({
      files: {
        pickResumeFiles: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveImport = resolve
            }),
        ),
        onResumeImportProgress: vi.fn((listener) => {
          importListener = listener
          return () => undefined
        }),
        cancelResumeImport,
      },
    })

    render(<App />)
    await waitFor(() => expect(window.desktopApi!.files.onResumeImportProgress).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))

    act(() => {
      importListener?.({
        sessionId: 'cancel-session',
        status: 'progress',
        processed: 1,
        total: 2,
        cached: 1,
        failed: 0,
        currentFileName: '待取消候选人.txt',
        batch: [summary],
      })
    })

    expect(await screen.findByText('待取消候选人.txt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消导入' }))

    expect(cancelResumeImport).toHaveBeenCalledWith('cancel-session')

    await act(async () => {
      resolveImport?.({
        sessionId: 'cancel-session',
        resumes: [],
        errors: [],
        cancelled: true,
      })
    })

    await waitFor(() => expect(screen.queryByText('待取消候选人.txt')).not.toBeInTheDocument())
  })

  it('imports selected desktop resume files and runs screening without sample data', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-1',
      fileName: '王五-前端.txt',
      extension: '.txt',
      text: '王五 React TypeScript Electron 三年，负责桌面端项目和性能优化。',
      wordCount: 9,
    }
    window.desktopApi = createDesktopApiMock({
      files: {
        pickResumeFiles: vi.fn().mockResolvedValue(importResult([resume])),
      },
    })

    render(<App />)

    expect(await screen.findByText('桌面端桥接正常')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))

    expect(await screen.findByText('王五-前端.txt')).toBeInTheDocument()
    expect(window.desktopApi.files.pickResumeFiles).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '开始筛选' }))

    await waitFor(() =>
      expect(window.desktopApi!.files.loadCachedResumes).toHaveBeenCalledWith([
        expect.objectContaining({ cacheKey: 'resume-1', sessionId: 'test-session' }),
      ]),
    )
    expect(await screen.findByRole('heading', { name: '候选人排序' })).toBeInTheDocument()
    expect(screen.getAllByText('王五-前端').length).toBeGreaterThan(0)
  })

  it('includes the job agent column in preview CSV downloads', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-preview-export-1',
      fileName: '预览导出候选人.txt',
      extension: '.txt',
      text: '预览导出候选人 React TypeScript',
      wordCount: 4,
    }
    const scorecard: CandidateScorecard & { jobAgentId: string; jobAgentTitle: string } = {
      resumeId: resume.id,
      fileName: resume.fileName,
      candidateName: '预览导出候选人',
      jobAgentId: 'hanlin-ai-agent-technician',
      jobAgentTitle: 'AI智能体搭建技术员',
      overallScore: 88,
      recommendation: 'strong_yes',
      criterionScores: [],
      strengths: ['AI Agent 项目经验'],
      gaps: [],
      risks: [],
      evidenceSummary: ['React TypeScript'],
      reviewerNotes: '建议一面',
    }
    let capturedBlob: Blob | undefined
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        capturedBlob = blob
        return 'blob:preview-csv'
      }),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
      },
      files: {
        pickResumeFiles: vi.fn().mockResolvedValue(importResult([resume])),
      },
      agents: {
        runMultiAgentScreening: vi.fn().mockResolvedValue({ scorecards: [scorecard], errors: [] }),
      },
    })

    try {
      render(<App />)
      expect(await screen.findByText('API key 已配置')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
      await user.click(screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ }))
      await user.click(screen.getByRole('button', { name: /简历导入/ }))
      await user.click(screen.getByRole('button', { name: '选择多份简历' }))
      await user.click(screen.getByRole('button', { name: '开始筛选' }))
      expect(await screen.findByRole('heading', { name: '候选人排序' })).toBeInTheDocument()

      delete (window.desktopApi!.export as Partial<DesktopApi['export']>).csv
      await user.click(screen.getByRole('button', { name: /运行筛选/ }))
      await user.click(screen.getByRole('button', { name: /结果导出/ }))
      await user.click(screen.getByRole('button', { name: '导出 CSV' }))

      expect(clickSpy).toHaveBeenCalled()
      const csv = await capturedBlob!.text()
      expect(csv.split('\n')[0]).toContain('岗位 Agent')
      expect(csv).toContain('AI智能体搭建技术员')
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      })
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      })
      clickSpy.mockRestore()
    }
  })

  it('resets the screening waiting state after a completed run', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-reset-1',
      fileName: '重跑候选人.txt',
      extension: '.txt',
      text: 'React TypeScript Electron',
      wordCount: 3,
    }
    window.desktopApi = createDesktopApiMock({
      files: {
        pickResumeFiles: vi.fn().mockResolvedValue(importResult([resume])),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))
    await user.click(screen.getByRole('button', { name: '开始筛选' }))
    expect(await screen.findByRole('heading', { name: '候选人排序' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /运行筛选/ }))

    expect(screen.getByRole('heading', { name: '筛选任务待开始' })).toBeInTheDocument()
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument()
  })

  it('shows live screening progress while resumes are being screened', async () => {
    const user = userEvent.setup()
    const resumeA: ResumeDocument = {
      id: 'resume-a',
      fileName: '候选人A.txt',
      extension: '.txt',
      text: '候选人A React TypeScript Electron',
      wordCount: 4,
    }
    const resumeB: ResumeDocument = {
      id: 'resume-b',
      fileName: '候选人B.txt',
      extension: '.txt',
      text: '候选人B React 数据分析',
      wordCount: 3,
    }
    window.desktopApi = createDesktopApiMock({
      files: {
        pickResumeFiles: vi.fn().mockResolvedValue(importResult([resumeA, resumeB])),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))
    await user.click(screen.getByRole('button', { name: '开始筛选' }))

    expect(await screen.findByText('正在处理：候选人A.txt')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '筛选进度' })).toHaveAttribute('max', '2')
  })

  it('shows routing and model-waiting progress during desktop multi-agent screening', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-routing-1',
      fileName: '路由候选人.txt',
      extension: '.txt',
      text: '路由候选人 React TypeScript',
      wordCount: 3,
    }
    let progressListener: ((event: ScreeningProgressEvent) => void) | undefined
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
      },
      files: {
        pickResumeFiles: vi.fn().mockResolvedValue(importResult([resume])),
      },
      agents: {
        onScreeningProgress: vi.fn((listener) => {
          progressListener = listener
          return () => undefined
        }),
        runMultiAgentScreening: vi.fn(
          async () =>
            await new Promise<ScreeningBatchResult>(() => {
              // keep the run active so progress events remain visible
            }),
        ),
      },
    })

    render(<App />)

    expect(await screen.findByText('API key 已配置')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))
    await user.click(screen.getByRole('button', { name: '开始筛选' }))

    await waitFor(() => expect(window.desktopApi!.agents.onScreeningProgress).toHaveBeenCalled())

    act(() => {
      progressListener?.({
        status: 'routing',
        phase: 'routing',
        resumeId: 'resume-routing-1',
        fileName: '路由候选人.txt',
        completed: 1,
        total: 3,
        started: 1,
        active: 0,
      })
    })

    expect(await screen.findByRole('heading', { name: '正在分配简历给岗位 Agent' })).toBeInTheDocument()
    expect(screen.getByText('正在分配：路由候选人.txt')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    act(() => {
      progressListener?.({
        status: 'started',
        phase: 'screening',
        resumeId: 'resume-routing-1',
        fileName: '路由候选人.txt',
        completed: 0,
        total: 3,
        started: 2,
        active: 2,
      })
    })

    expect(await screen.findByRole('heading', { name: '岗位 Agent 正在筛选简历' })).toBeInTheDocument()
    expect(screen.getByText('正在处理：路由候选人.txt')).toBeInTheDocument()
    expect(screen.getByText('已发起 2 / 3，等待返回 2 份')).toBeInTheDocument()
  })

  it('stops an active desktop screening run without opening results', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-stop-1',
      fileName: '停止候选人.txt',
      extension: '.txt',
      text: '停止候选人 React TypeScript',
      wordCount: 3,
    }
    let rejectScreening: ((error: Error) => void) | undefined
    const cancelScreening = vi.fn().mockResolvedValue(true)
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
      },
      files: {
        pickResumeFiles: vi.fn().mockResolvedValue(importResult([resume])),
      },
      agents: {
        cancelScreening,
        runMultiAgentScreening: vi.fn(
          async () =>
            await new Promise<ScreeningBatchResult>((_resolve, reject) => {
              rejectScreening = reject
            }),
        ),
      },
    })

    render(<App />)
    expect(await screen.findByText('API key 已配置')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))
    await user.click(screen.getByRole('button', { name: '开始筛选' }))

    await user.click(await screen.findByRole('button', { name: '停止筛选' }))
    expect(cancelScreening).toHaveBeenCalled()

    await act(async () => {
      rejectScreening?.(new Error('筛选已停止'))
    })

    expect(await screen.findByText('已停止筛选')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '筛选任务待开始' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '候选人排序' })).not.toBeInTheDocument()
  })

  it('marks the job agent step as generating while a config request is in flight', async () => {
    const user = userEvent.setup()
    let resolveConfig: ((config: unknown) => void) | undefined
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
      },
      agents: {
        generateJobConfig: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveConfig = resolve
            }),
        ),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    const jdTextarea = screen.getByPlaceholderText('粘贴岗位描述，或导入 PDF / DOCX / TXT 文件')
    await user.type(jdTextarea, '资深前端工程师，负责 React 桌面端产品开发，需要性能优化经验。')
    await user.click(screen.getByRole('button', { name: 'AI 生成并新增' }))

    expect(await screen.findByRole('button', { name: /02 岗位 Agent 生成中/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /02 岗位 Agent 已生成/ })).not.toBeInTheDocument()

    resolveConfig?.({
      id: 'generated',
      title: '生成岗位',
      summary: '生成中状态测试',
      mustHaves: ['React'],
      niceToHaves: [],
      riskFlags: [],
      criteria: [{ id: 'frontend', label: '前端经验', weight: 100, description: 'React' }],
      instructions: '只看证据',
      thresholds: { strongYes: 85, yes: 75, maybe: 60 },
    })
  })

  it('imports resumes from a desktop folder picker', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-folder-1',
      fileName: '赵六-运营.txt',
      extension: '.txt',
      text: '赵六 亚马逊 独立站 运营 数据分析 转化优化。',
      wordCount: 7,
    }
    window.desktopApi = createDesktopApiMock({
      files: {
        pickResumeFolder: vi.fn().mockResolvedValue(importResult([resume])),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '导入文件夹' }))

    expect(await screen.findByText('赵六-运营.txt')).toBeInTheDocument()
    expect(window.desktopApi.files.pickResumeFolder).toHaveBeenCalledTimes(1)
  })

  it('clears all imported resumes', async () => {
    const user = userEvent.setup()
    const resumes: ResumeDocument[] = [
      {
        id: 'resume-clear-1',
        fileName: '清空候选人A.txt',
        extension: '.txt',
        text: 'React TypeScript Electron',
        wordCount: 3,
      },
      {
        id: 'resume-clear-2',
        fileName: '清空候选人B.txt',
        extension: '.txt',
        text: '数据分析 自动化',
        wordCount: 2,
      },
    ]
    window.desktopApi = createDesktopApiMock({
      files: {
        pickResumeFiles: vi.fn().mockResolvedValue(importResult(resumes)),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))
    expect(await screen.findByText('清空候选人A.txt')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除全部简历' }))

    expect(window.desktopApi.files.clearResumeImportCache).toHaveBeenCalledWith(['test-session'])
    expect(screen.queryByText('清空候选人A.txt')).not.toBeInTheDocument()
    expect(screen.queryByText('清空候选人B.txt')).not.toBeInTheDocument()
    expect(screen.getByText('还没有简历。请从电脑选择多份简历，或导入一个包含简历的文件夹。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /03 简历导入 0 份/ })).toBeInTheDocument()
  })

  it('explains the missing job agent instead of silently blocking screening', async () => {
    const user = userEvent.setup()
    const resume: ResumeDocument = {
      id: 'resume-long-1',
      fileName: '长文本候选人.txt',
      extension: '.txt',
      text: '113513959275d9a11HF43920FFVOxYW-V_KYWOOhmf7YPxNj2g~~'.repeat(6),
      wordCount: 1,
    }
    window.desktopApi = createDesktopApiMock({
      files: {
        pickResumeFiles: vi.fn().mockResolvedValue(importResult([resume])),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))
    expect(await screen.findByText('待岗位')).toBeInTheDocument()

    const startScreeningButton = await screen.findByRole('button', { name: '开始筛选' })
    expect(startScreeningButton).toBeEnabled()
    await user.click(startScreeningButton)

    expect(screen.getByText('请先生成岗位 Agent，再开始筛选')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '岗位库' })).toBeInTheDocument()
  })

  it('shows and saves custom API base URL settings', async () => {
    const user = userEvent.setup()
    const saveSettings = vi.fn().mockImplementation(async (settings) => settings)
    window.desktopApi = createDesktopApiMock({
      settings: {
        getSettings: vi.fn().mockResolvedValue({ ...defaultSettings, baseUrl: 'https://api.example.com/v1' }),
        saveSettings,
        fetchModels: vi.fn().mockResolvedValue(['gpt-5.4-mini', 'gpt-5.4']),
      },
    })

    render(<App />)

    const baseUrlInput = await screen.findByLabelText('自定义 URL')
    expect(baseUrlInput).toHaveValue('https://api.example.com/v1')

    await user.clear(baseUrlInput)
    await user.type(baseUrlInput, 'https://proxy.example.com/v1')
    await user.clear(screen.getByLabelText('模型'))
    await user.type(screen.getByLabelText('模型'), 'gpt-5.4-mini')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(saveSettings).toHaveBeenCalledWith({
      model: 'gpt-5.4-mini',
      baseUrl: 'https://proxy.example.com/v1',
      routingMode: 'hybrid',
      filenameAliases: [],
      llmRoutingConcurrency: 10,
    })

  })

  it('loads available models and allows a custom model input', async () => {
    const user = userEvent.setup()
    const saveSettings = vi.fn().mockImplementation(async (settings) => settings)
    const fetchModels = vi.fn().mockResolvedValue(['gpt-5.4-mini', 'o4-mini'])
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
        getSettings: vi.fn().mockResolvedValue({ ...defaultSettings, model: 'custom-local-model' }),
        saveSettings,
        fetchModels,
      },
    })

    render(<App />)

    const modelInput = await screen.findByLabelText('模型')
    expect(modelInput).toHaveValue('custom-local-model')

    await user.click(screen.getByRole('button', { name: '获取模型' }))
    expect(fetchModels).toHaveBeenCalledWith({ baseUrl: '' })

    await user.selectOptions(await screen.findByLabelText('可用模型'), 'o4-mini')
    expect(modelInput).toHaveValue('o4-mini')

    await user.clear(modelInput)
    await user.type(modelInput, 'my-router-model')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(saveSettings).toHaveBeenLastCalledWith({
      model: 'my-router-model',
      baseUrl: '',
      routingMode: 'hybrid',
      filenameAliases: [],
      llmRoutingConcurrency: 10,
    })

  })

  it('fetches models with the current custom URL draft', async () => {
    const user = userEvent.setup()
    const fetchModels = vi.fn().mockResolvedValue(['router-model'])
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
        fetchModels,
      },
    })

    render(<App />)

    const baseUrlInput = await screen.findByLabelText('自定义 URL')
    await user.type(baseUrlInput, 'https://router.example.com/v1')
    await user.click(screen.getByRole('button', { name: '获取模型' }))

    expect(fetchModels).toHaveBeenCalledWith({ baseUrl: 'https://router.example.com/v1' })

  })

  it('applies company job agent presets and keeps the config editable', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ }))

    const jdTextarea = screen.getByPlaceholderText('粘贴岗位描述，或导入 PDF / DOCX / TXT 文件') as HTMLTextAreaElement
    expect(jdTextarea.value).toContain('AI智能体搭建技术员')
    expect(screen.getByLabelText('岗位名称')).toHaveValue('AI智能体搭建技术员')
    const instructionsInput = screen.getByLabelText('Agent 指令') as HTMLTextAreaElement
    expect(instructionsInput.value).toContain('只根据简历中的明确证据')
    expect(instructionsInput).toHaveClass('config-textarea-large')
    expect(screen.getByLabelText('维度 1 名称')).toHaveValue('智能体搭建能力')
    expect(screen.getByLabelText('维度 1 说明')).toHaveValue('是否有 AI Agent、工作流、自动化或大模型应用搭建的明确项目证据。')
    expect(screen.getByLabelText('维度 1 权重')).toHaveValue(35)

    await user.clear(screen.getByLabelText('岗位名称'))
    await user.type(screen.getByLabelText('岗位名称'), 'AI Agent 技术员')

    expect(screen.getByRole('heading', { name: 'AI Agent 技术员' })).toBeInTheDocument()
  })

  it('closes a selected preset job when clicking it again', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    const presetButton = screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ })
    await user.click(presetButton)
    expect(screen.getByLabelText('岗位名称')).toHaveValue('AI智能体搭建技术员')
    expect(screen.getByRole('button', { name: /02 岗位 Agent 1 个/ })).toBeInTheDocument()

    await user.click(presetButton)

    expect(screen.getByRole('heading', { name: '尚未生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /02 岗位 Agent 待生成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动保存' })).toBeDisabled()
  })

  it('keeps every selected preset agent after clicking generate', async () => {
    const user = userEvent.setup()
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
      },
      agents: {
        generateJobConfig: vi.fn().mockResolvedValue({
          ...generatedJobConfig,
          id: 'saved-from-preset',
          title: '另存岗位',
        }),
      },
    })
    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    // 选中多个公司预设岗位
    await user.click(screen.getByRole('button', { name: /编辑 AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /编辑 产品经理人（运动护具向）/ }))
    await user.click(screen.getByRole('button', { name: /编辑 品牌视觉设计/ }))

    // 侧边栏应显示已选 3 个岗位
    expect(screen.getByRole('button', { name: /02 岗位 Agent 3 个/ })).toBeInTheDocument()

    // 点击"生成"不应把多个预设折叠成一个
    await user.click(screen.getByRole('button', { name: 'AI 生成并另存' }))

    expect(screen.getByRole('button', { name: /02 岗位 Agent 4 个/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /02 岗位 Agent 1 个/ })).not.toBeInTheDocument()
  })
})

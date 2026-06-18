/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.js'
import type { DesktopApi } from './shared/desktopApi.js'
import type { ResumeDocument } from './shared/types.js'

describe('App smoke flow', () => {
  afterEach(() => {
    delete window.desktopApi
    vi.restoreAllMocks()
  })

  type DesktopApiMockOverrides = {
    settings?: Partial<DesktopApi['settings']>
    files?: Partial<DesktopApi['files']>
    agents?: Partial<DesktopApi['agents']>
    export?: Partial<DesktopApi['export']>
  }

  function createDesktopApiMock(overrides: DesktopApiMockOverrides = {}): DesktopApi {
    return {
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(false),
        getSettings: vi.fn().mockResolvedValue({ model: 'gpt-5.2', baseUrl: '' }),
        saveSettings: vi.fn().mockImplementation(async (settings) => settings),
        fetchModels: vi.fn().mockResolvedValue([]),
        saveApiKey: vi.fn().mockResolvedValue(undefined),
        clearApiKey: vi.fn().mockResolvedValue(undefined),
        ...overrides.settings,
      },
      files: {
        pickJobFile: vi.fn().mockResolvedValue(null),
        pickResumeFiles: vi.fn().mockResolvedValue({ resumes: [], errors: [] }),
        pickResumeFolder: vi.fn().mockResolvedValue({ resumes: [], errors: [] }),
        ...overrides.files,
      },
      agents: {
        generateJobConfig: vi.fn(),
        runScreening: vi.fn(),
        runMultiAgentScreening: vi.fn().mockResolvedValue({ scorecards: [], errors: [] }),
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
        pickResumeFiles: vi.fn().mockResolvedValue({ resumes: [resume], errors: [] }),
      },
    })

    render(<App />)

    expect(await screen.findByText('桌面端桥接正常')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))

    expect(await screen.findByText('王五-前端.txt')).toBeInTheDocument()
    expect(window.desktopApi.files.pickResumeFiles).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '开始筛选' }))

    expect(await screen.findByRole('heading', { name: '候选人排序' })).toBeInTheDocument()
    expect(screen.getAllByText('王五-前端').length).toBeGreaterThan(0)
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
        pickResumeFiles: vi.fn().mockResolvedValue({ resumes: [resume], errors: [] }),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /AI智能体搭建技术员/ }))
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
        pickResumeFiles: vi.fn().mockResolvedValue({ resumes: [resumeA, resumeB], errors: [] }),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    await user.click(screen.getByRole('button', { name: /AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))
    await user.click(screen.getByRole('button', { name: '开始筛选' }))

    expect(await screen.findByText('正在处理：候选人A.txt')).toBeInTheDocument()
    expect(screen.getByText('0 / 2')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '筛选进度' })).toHaveAttribute('max', '2')
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
    await user.click(screen.getByRole('button', { name: '生成岗位 Agent 配置' }))

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
        pickResumeFolder: vi.fn().mockResolvedValue({ resumes: [resume], errors: [] }),
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
        pickResumeFiles: vi.fn().mockResolvedValue({ resumes, errors: [] }),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /简历导入/ }))
    await user.click(screen.getByRole('button', { name: '选择多份简历' }))
    expect(await screen.findByText('清空候选人A.txt')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除全部简历' }))

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
        pickResumeFiles: vi.fn().mockResolvedValue({ resumes: [resume], errors: [] }),
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
    expect(screen.getByRole('heading', { name: '岗位描述' })).toBeInTheDocument()
  })

  it('shows and saves custom API base URL settings', async () => {
    const user = userEvent.setup()
    const saveSettings = vi.fn().mockImplementation(async (settings) => settings)
    window.desktopApi = createDesktopApiMock({
      settings: {
        getSettings: vi.fn().mockResolvedValue({ model: 'gpt-5.2', baseUrl: 'https://api.example.com/v1' }),
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
    })

  })

  it('loads available models and allows a custom model input', async () => {
    const user = userEvent.setup()
    const saveSettings = vi.fn().mockImplementation(async (settings) => settings)
    const fetchModels = vi.fn().mockResolvedValue(['gpt-5.4-mini', 'o4-mini'])
    window.desktopApi = createDesktopApiMock({
      settings: {
        hasApiKey: vi.fn().mockResolvedValue(true),
        getSettings: vi.fn().mockResolvedValue({ model: 'custom-local-model', baseUrl: '' }),
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
    await user.click(screen.getByRole('button', { name: /AI智能体搭建技术员/ }))

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

  it('keeps every selected preset agent after clicking generate', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /岗位 Agent/ }))
    // 选中多个公司预设岗位
    await user.click(screen.getByRole('button', { name: /AI智能体搭建技术员/ }))
    await user.click(screen.getByRole('button', { name: /产品经理人（运动护具向）/ }))
    await user.click(screen.getByRole('button', { name: /品牌视觉设计/ }))

    // 侧边栏应显示已选 3 个岗位
    expect(screen.getByRole('button', { name: /02 岗位 Agent 3 个/ })).toBeInTheDocument()

    // 点击"生成"不应把多个预设折叠成一个
    await user.click(screen.getByRole('button', { name: '生成岗位 Agent 配置' }))

    expect(screen.getByRole('button', { name: /02 岗位 Agent 3 个/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /02 岗位 Agent 1 个/ })).not.toBeInTheDocument()
  })
})

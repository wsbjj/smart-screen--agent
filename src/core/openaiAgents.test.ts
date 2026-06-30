import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBatchLlmRouterFn, createScreeningAgentRunner, generateJobAgentConfig } from './openaiAgents.js'
import type { JobAgentConfig, ResumeDocument } from '../shared/types.js'

const runMock = vi.hoisted(() => vi.fn())
const runnerRunMock = vi.hoisted(() => vi.fn())
const setDefaultOpenAIKeyMock = vi.hoisted(() => vi.fn())
const openAIProviderMock = vi.hoisted(() => vi.fn())

vi.mock('@openai/agents', () => {
  class Agent {
    config: unknown

    constructor(config: unknown) {
      this.config = config
    }
  }

  class OpenAIProvider {
    constructor(config: unknown) {
      openAIProviderMock(config)
    }
  }

  class Runner {
    constructor() {}

    run = runnerRunMock
  }

  return {
    Agent,
    OpenAIProvider,
    Runner,
    run: runMock,
    setDefaultOpenAIKey: setDefaultOpenAIKeyMock,
  }
})

function makeStreamedResult(finalOutput: unknown) {
  return {
    finalOutput,
    completed: Promise.resolve(),
    async *[Symbol.asyncIterator]() {
      yield { type: 'raw_model_stream_event' }
    },
  }
}

function makeBrokenStreamedResult() {
  return {
    finalOutput: undefined,
    completed: Promise.reject({
      name: 'ZodError',
      issues: [
        {
          code: 'invalid_value',
          path: ['response', 'output', 0, 'status'],
        },
      ],
    }),
    async *[Symbol.asyncIterator]() {},
  }
}

function makeTerminatedStreamedResult() {
  return {
    finalOutput: undefined,
    completed: Promise.reject(
      Object.assign(new TypeError('terminated'), {
        cause: {
          code: 'UND_ERR_SOCKET',
          message: 'other side closed',
        },
      }),
    ),
    async *[Symbol.asyncIterator]() {},
  }
}

const jobConfig: JobAgentConfig = {
  id: 'job-1',
  title: '前端工程师',
  summary: '负责桌面端产品开发',
  mustHaves: ['React', 'TypeScript'],
  niceToHaves: ['Electron'],
  riskFlags: ['频繁跳槽'],
  criteria: [
    { id: 'frontend', label: '前端经验', weight: 100, description: 'React 和 TypeScript 经验' },
  ],
  instructions: '只根据简历证据评分。',
  thresholds: {
    strongYes: 85,
    yes: 75,
    maybe: 60,
  },
}

const resume: ResumeDocument = {
  id: 'resume-1',
  fileName: '张三.txt',
  extension: '.txt',
  text: '张三，React TypeScript Electron 三年',
  wordCount: 5,
}

describe('OpenAI agent runners', () => {
  beforeEach(() => {
    runMock.mockReset()
    runnerRunMock.mockReset()
    setDefaultOpenAIKeyMock.mockReset()
    openAIProviderMock.mockReset()
  })

  it('streams job config generation requests', async () => {
    runMock.mockResolvedValue(makeStreamedResult(jobConfig))

    await expect(
      generateJobAgentConfig({ jdText: '招聘 React 工程师' }, { apiKey: 'sk-test', model: 'gpt-5.2' }),
    ).resolves.toMatchObject({ title: '前端工程师' })

    expect(runMock.mock.calls[0]?.[2]).toEqual({ stream: true })
  })

  it('includes the current config when asking AI to edit an existing job', async () => {
    runMock.mockResolvedValue(makeStreamedResult({ ...jobConfig, title: '资深前端工程师' }))

    await generateJobAgentConfig(
      {
        jdText: '更新后的 React 岗位 JD',
        sourceFileName: 'frontend-updated.txt',
        currentConfig: jobConfig,
      },
      { apiKey: 'sk-test', model: 'gpt-5.2' },
    )

    const request = JSON.parse(runMock.mock.calls[0]?.[1] as string)
    expect(request).toMatchObject({
      jdText: '更新后的 React 岗位 JD',
      sourceFileName: 'frontend-updated.txt',
      currentConfig: jobConfig,
    })
  })

  it('falls back to a non-streaming job config request when the SDK rejects provider stream status values', async () => {
    runMock.mockResolvedValueOnce(makeBrokenStreamedResult())
    runMock.mockResolvedValueOnce({ finalOutput: jobConfig })

    await expect(
      generateJobAgentConfig({ jdText: '招聘 React 工程师' }, { apiKey: 'sk-test', model: 'gpt-5.2' }),
    ).resolves.toMatchObject({ title: '前端工程师' })

    expect(runMock.mock.calls[0]?.[2]).toEqual({ stream: true })
    expect(runMock.mock.calls[1]?.[2]).toBeUndefined()
  })

  it('falls back to a non-streaming job config request when the provider terminates the stream', async () => {
    runMock.mockResolvedValueOnce(makeTerminatedStreamedResult())
    runMock.mockResolvedValueOnce({ finalOutput: jobConfig })

    await expect(
      generateJobAgentConfig({ jdText: '招聘 React 工程师' }, { apiKey: 'sk-test', model: 'gpt-5.2' }),
    ).resolves.toMatchObject({ title: '前端工程师' })

    expect(runMock.mock.calls[0]?.[2]).toEqual({ stream: true })
    expect(runMock.mock.calls[1]?.[2]).toBeUndefined()
  })

  it('streams screening requests through configured OpenAI-compatible providers', async () => {
    runnerRunMock.mockResolvedValue(
      makeStreamedResult({
        resumeId: resume.id,
        fileName: resume.fileName,
        candidateName: '张三',
        overallScore: 88,
        recommendation: 'strong_yes',
        criterionScores: [],
        strengths: ['React'],
        gaps: [],
        risks: [],
        evidenceSummary: ['简历写到 React'],
        reviewerNotes: '',
      }),
    )

    const runner = createScreeningAgentRunner({
      apiKey: 'sk-test',
      model: 'gpt-5.2',
      baseUrl: 'https://proxy.example.com/v1',
    })

    await expect(runner({ jobConfig, resume })).resolves.toMatchObject({
      resumeId: resume.id,
      fileName: resume.fileName,
      candidateName: '张三',
    })

    expect(runnerRunMock.mock.calls[0]?.[2]).toEqual({ stream: true })
    expect(openAIProviderMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://proxy.example.com/v1',
    })
  })

  it('falls back to non-streaming screening when the SDK rejects provider stream status values', async () => {
    const scorecard = {
      resumeId: resume.id,
      fileName: resume.fileName,
      candidateName: '张三',
      overallScore: 88,
      recommendation: 'strong_yes',
      criterionScores: [],
      strengths: ['React'],
      gaps: [],
      risks: [],
      evidenceSummary: ['简历写到 React'],
      reviewerNotes: '',
    }
    runnerRunMock.mockResolvedValueOnce(makeBrokenStreamedResult())
    runnerRunMock.mockResolvedValueOnce({ finalOutput: scorecard })

    const runner = createScreeningAgentRunner({
      apiKey: 'sk-test',
      model: 'gpt-5.2',
      baseUrl: 'https://proxy.example.com/v1',
    })

    await expect(runner({ jobConfig, resume })).resolves.toMatchObject({
      resumeId: resume.id,
      fileName: resume.fileName,
      candidateName: '张三',
    })

    expect(runnerRunMock.mock.calls[0]?.[2]).toEqual({ stream: true })
    expect(runnerRunMock.mock.calls[1]?.[2]).toBeUndefined()
  })

  it('falls back to non-streaming screening when the provider terminates the stream', async () => {
    const scorecard = {
      resumeId: resume.id,
      fileName: resume.fileName,
      candidateName: '张三',
      overallScore: 88,
      recommendation: 'strong_yes',
      criterionScores: [],
      strengths: ['React'],
      gaps: [],
      risks: [],
      evidenceSummary: ['简历写到 React'],
      reviewerNotes: '',
    }
    runnerRunMock.mockResolvedValueOnce(makeTerminatedStreamedResult())
    runnerRunMock.mockResolvedValueOnce({ finalOutput: scorecard })

    const runner = createScreeningAgentRunner({
      apiKey: 'sk-test',
      model: 'gpt-5.2',
      baseUrl: 'https://proxy.example.com/v1',
    })

    await expect(runner({ jobConfig, resume })).resolves.toMatchObject({
      resumeId: resume.id,
      fileName: resume.fileName,
      candidateName: '张三',
    })

    expect(runnerRunMock.mock.calls[0]?.[2]).toEqual({ stream: true })
    expect(runnerRunMock.mock.calls[1]?.[2]).toBeUndefined()
  })

  it('routes multiple resume excerpts in one structured LLM request', async () => {
    runMock.mockResolvedValue(
      makeStreamedResult({
        decisions: [
          { resumeId: 'resume-1', agentId: 'job-1', reasoning: 'React evidence' },
          { resumeId: 'resume-2', agentId: 'job-2', reasoning: 'Operations evidence' },
        ],
      }),
    )
    const secondJob: JobAgentConfig = {
      ...jobConfig,
      id: 'job-2',
      title: '运营专员',
      summary: '负责跨境电商运营',
    }

    const router = createBatchLlmRouterFn({ apiKey: 'sk-test', model: 'gpt-5.2' })

    await expect(
      router(
        [
          { resumeId: 'resume-1', excerpt: '候选人具备 React TypeScript 项目经验' },
          { resumeId: 'resume-2', excerpt: '候选人负责亚马逊 Listing 和广告投放' },
        ],
        [jobConfig, secondJob],
      ),
    ).resolves.toEqual([
      { resumeId: 'resume-1', agentId: 'job-1' },
      { resumeId: 'resume-2', agentId: 'job-2' },
    ])

    const request = JSON.parse(runMock.mock.calls[0]?.[1] as string)
    expect(request.resumes).toEqual([
      { resumeId: 'resume-1', excerpt: '候选人具备 React TypeScript 项目经验' },
      { resumeId: 'resume-2', excerpt: '候选人负责亚马逊 Listing 和广告投放' },
    ])
    expect(request.agents).toEqual([
      { id: 'job-1', title: '前端工程师', summary: '负责桌面端产品开发' },
      { id: 'job-2', title: '运营专员', summary: '负责跨境电商运营' },
    ])
  })
})

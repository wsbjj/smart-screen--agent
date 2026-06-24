import { describe, expect, it, vi } from 'vitest'
import { runMultiAgentBatch, runScreeningBatch } from './screeningEngine.js'
import type {
  CandidateScorecard,
  JobAgentConfig,
  RouterDecision,
  ResumeDocument,
  ScreeningAgentRunner,
  ScreeningProgressEvent,
} from '../shared/types.js'

const jobConfig: JobAgentConfig = {
  id: 'job-1',
  title: '前端工程师',
  summary: '负责桌面端产品开发',
  mustHaves: ['React', 'TypeScript'],
  niceToHaves: ['Electron'],
  riskFlags: ['频繁跳槽'],
  criteria: [
    { id: 'frontend', label: '前端经验', weight: 60, description: 'React 和 TypeScript 经验' },
    { id: 'desktop', label: '桌面端经验', weight: 40, description: 'Electron 或跨平台客户端经验' },
  ],
  instructions: '只根据简历证据评分。',
  thresholds: {
    strongYes: 85,
    yes: 75,
    maybe: 60,
  },
}

const resumes: ResumeDocument[] = [
  {
    id: 'resume-1',
    fileName: '张三.txt',
    extension: '.txt',
    text: '张三，React TypeScript Electron 三年',
    wordCount: 5,
  },
  {
    id: 'resume-2',
    fileName: '李四.txt',
    extension: '.txt',
    text: '李四，Java 后端',
    wordCount: 3,
  },
]

function makeScorecard(resumeId: string, fileName: string, score: number): CandidateScorecard {
  return {
    resumeId,
    fileName,
    candidateName: fileName.replace('.txt', ''),
    overallScore: score,
    recommendation: score > 80 ? 'strong_yes' : 'maybe',
    criterionScores: [],
    strengths: [],
    gaps: [],
    risks: [],
    evidenceSummary: [],
    reviewerNotes: '',
  }
}

describe('runScreeningBatch', () => {
  it('screens resumes, retries transient failures, ranks results, and keeps failed items', async () => {
    const attempts = new Map<string, number>()
    const runner: ScreeningAgentRunner = async ({ resume }) => {
      const attempt = (attempts.get(resume.id) ?? 0) + 1
      attempts.set(resume.id, attempt)

      if (resume.id === 'resume-1' && attempt === 1) {
        throw new Error('rate limit')
      }

      return makeScorecard(resume.id, resume.fileName, resume.id === 'resume-1' ? 88 : 62)
    }

    const result = await runScreeningBatch({
      jobConfig,
      resumes,
      runner,
      maxRetries: 2,
      concurrency: 1,
    })

    expect(attempts.get('resume-1')).toBe(2)
    expect(result.scorecards.map((item) => item.resumeId)).toEqual(['resume-1', 'resume-2'])
    expect(result.scorecards).toEqual([
      expect.objectContaining({ jobAgentId: 'job-1', jobAgentTitle: '前端工程师' }),
      expect.objectContaining({ jobAgentId: 'job-1', jobAgentTitle: '前端工程师' }),
    ])
    expect(result.errors).toEqual([])
  })

  it('reports per-resume screening progress', async () => {
    const progressEvents: ScreeningProgressEvent[] = []
    const runner: ScreeningAgentRunner = async ({ resume }) => makeScorecard(resume.id, resume.fileName, 80)

    await runScreeningBatch({
      jobConfig,
      resumes,
      runner,
      maxRetries: 0,
      concurrency: 1,
      onProgress: (event) => progressEvents.push(event),
    })

    expect(progressEvents).toEqual([
      {
        status: 'started',
        phase: 'screening',
        resumeId: 'resume-1',
        fileName: '张三.txt',
        completed: 0,
        total: 2,
        started: 1,
        active: 1,
      },
      {
        status: 'completed',
        phase: 'screening',
        resumeId: 'resume-1',
        fileName: '张三.txt',
        completed: 1,
        total: 2,
        started: 1,
        active: 0,
      },
      {
        status: 'started',
        phase: 'screening',
        resumeId: 'resume-2',
        fileName: '李四.txt',
        completed: 1,
        total: 2,
        started: 2,
        active: 1,
      },
      {
        status: 'completed',
        phase: 'screening',
        resumeId: 'resume-2',
        fileName: '李四.txt',
        completed: 2,
        total: 2,
        started: 2,
        active: 0,
      },
    ])
  })

  it('screens up to three resumes concurrently by default', async () => {
    const concurrentResumes: ResumeDocument[] = [
      ...resumes,
      {
        id: 'resume-3',
        fileName: '王五.txt',
        extension: '.txt',
        text: '王五，React 工程化',
        wordCount: 3,
      },
      {
        id: 'resume-4',
        fileName: '赵六.txt',
        extension: '.txt',
        text: '赵六，TypeScript 客户端',
        wordCount: 3,
      },
    ]
    let activeRuns = 0
    let peakActiveRuns = 0
    const runner: ScreeningAgentRunner = async ({ resume }) => {
      activeRuns += 1
      peakActiveRuns = Math.max(peakActiveRuns, activeRuns)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeRuns -= 1
      return makeScorecard(resume.id, resume.fileName, 80)
    }

    await runScreeningBatch({
      jobConfig,
      resumes: concurrentResumes,
      runner,
      maxRetries: 0,
    })

    expect(peakActiveRuns).toBe(3)
  })

  it('reports routing progress before multi-agent scoring waits for model results', async () => {
    const progressEvents: ScreeningProgressEvent[] = []
    const agents: JobAgentConfig[] = [
      jobConfig,
      {
        ...jobConfig,
        id: 'job-2',
        title: '运营专员',
      },
    ]
    const routerFn = async (resume: ResumeDocument): Promise<RouterDecision> => ({
      resumeId: resume.id,
      agentId: resume.id === 'resume-1' ? 'job-1' : 'job-2',
      layer: 'filename',
      confidence: 1,
    })
    const runner: ScreeningAgentRunner = async ({ resume }) => makeScorecard(resume.id, resume.fileName, 80)

    const result = await runMultiAgentBatch({
      agents,
      resumes,
      routerFn,
      runner,
      concurrency: 1,
      routingConcurrency: 1,
      maxRetries: 0,
      onProgress: (event) => progressEvents.push(event),
    })

    expect(progressEvents.slice(0, 3)).toEqual([
      {
        status: 'routing',
        phase: 'routing',
        resumeId: 'resume-1',
        fileName: '张三.txt',
        completed: 0,
        total: 2,
        started: 1,
        active: 1,
      },
      {
        status: 'routing',
        phase: 'routing',
        resumeId: 'resume-1',
        fileName: '张三.txt',
        completed: 1,
        total: 2,
        started: 1,
        active: 0,
        agentId: 'job-1',
      },
      {
        status: 'routing',
        phase: 'routing',
        resumeId: 'resume-2',
        fileName: '李四.txt',
        completed: 1,
        total: 2,
        started: 2,
        active: 1,
      },
    ])
    expect(progressEvents).toContainEqual({
      status: 'routing',
      phase: 'routing',
      resumeId: 'resume-2',
      fileName: '李四.txt',
      completed: 2,
      total: 2,
      started: 2,
      active: 0,
      agentId: 'job-2',
    })
    expect(progressEvents).toContainEqual(
      expect.objectContaining({
        status: 'started',
        phase: 'screening',
        resumeId: 'resume-1',
        started: 1,
        active: 1,
      }),
    )
    expect(progressEvents.findIndex((event) => event.status === 'started' && event.resumeId === 'resume-1'))
      .toBeLessThan(progressEvents.findIndex((event) => event.status === 'routing' && event.resumeId === 'resume-2' && event.completed === 2))
    expect(result.scorecards).toEqual([
      expect.objectContaining({ resumeId: 'resume-1', jobAgentId: 'job-1', jobAgentTitle: '前端工程师' }),
      expect.objectContaining({ resumeId: 'resume-2', jobAgentId: 'job-2', jobAgentTitle: '运营专员' }),
    ])
  })

  it('routes unresolved resumes in LLM batches and falls back missing batch decisions', async () => {
    const agents: JobAgentConfig[] = [
      jobConfig,
      {
        ...jobConfig,
        id: 'job-2',
        title: '运营专员',
      },
    ]
    const routedByResume = new Map<string, string>()
    const batchSizes: number[] = []
    const localRouterFn = vi.fn(() => null)
    const batchRouterFn = vi.fn(async (items: Array<{ resumeId: string }>) => {
      batchSizes.push(items.length)
      return items
        .filter((item) => item.resumeId !== 'resume-2')
        .map((item) => ({ resumeId: item.resumeId, agentId: 'job-2' }))
    })
    const runner: ScreeningAgentRunner = async ({ jobConfig: routedJob, resume }) => {
      routedByResume.set(resume.id, routedJob.id)
      return makeScorecard(resume.id, resume.fileName, 80)
    }

    await runMultiAgentBatch({
      agents,
      resumes: [
        ...resumes,
        {
          id: 'resume-3',
          fileName: '王五.txt',
          extension: '.txt',
          text: '王五 运营',
          wordCount: 2,
        },
      ],
      localRouterFn,
      batchRouterFn,
      routingMode: 'hybrid',
      routingBatchSize: 2,
      llmRoutingConcurrency: 1,
      runner,
      maxRetries: 0,
    })

    expect(localRouterFn).toHaveBeenCalledTimes(3)
    expect(batchSizes).toEqual([2, 1])
    expect(routedByResume).toEqual(new Map([
      ['resume-1', 'job-2'],
      ['resume-2', 'job-1'],
      ['resume-3', 'job-2'],
    ]))
  })

  it('uses cached routing decisions before local or LLM routing', async () => {
    const agents: JobAgentConfig[] = [
      jobConfig,
      {
        ...jobConfig,
        id: 'job-2',
        title: '运营专员',
      },
    ]
    const localRouterFn = vi.fn((resume: ResumeDocument): RouterDecision | null => ({
      resumeId: resume.id,
      agentId: 'job-1',
      layer: 'nlp',
      confidence: 0.6,
    }))
    const batchRouterFn = vi.fn()
    const routeCache = {
      get: vi.fn(async (resume: ResumeDocument) =>
        resume.id === 'resume-1'
          ? { resumeId: resume.id, agentId: 'job-2', layer: 'filename' as const, confidence: 1 }
          : null,
      ),
      set: vi.fn(async () => undefined),
    }
    const routedByResume = new Map<string, string>()
    const runner: ScreeningAgentRunner = async ({ jobConfig: routedJob, resume }) => {
      routedByResume.set(resume.id, routedJob.id)
      return makeScorecard(resume.id, resume.fileName, 80)
    }

    await runMultiAgentBatch({
      agents,
      resumes,
      localRouterFn,
      batchRouterFn,
      routeCache,
      runner,
      maxRetries: 0,
    })

    expect(routeCache.get).toHaveBeenCalledTimes(2)
    expect(localRouterFn).toHaveBeenCalledTimes(1)
    expect(batchRouterFn).not.toHaveBeenCalled()
    expect(routeCache.set).toHaveBeenCalledWith(resumes[1], agents, {
      resumeId: 'resume-2',
      agentId: 'job-1',
      layer: 'nlp',
      confidence: 0.6,
    })
    expect(routedByResume).toEqual(new Map([
      ['resume-1', 'job-2'],
      ['resume-2', 'job-1'],
    ]))
  })

  it('starts scoring local routes before pending batch LLM routing completes', async () => {
    const agents: JobAgentConfig[] = [
      jobConfig,
      {
        ...jobConfig,
        id: 'job-2',
        title: '运营专员',
      },
    ]
    let releaseBatch: ((decisions: Array<{ resumeId: string; agentId: string }>) => void) | undefined
    let firstScoreStarted = false
    const batchRouterFn = vi.fn(
      async (items: Array<{ resumeId: string }>) =>
        await new Promise<Array<{ resumeId: string; agentId: string }>>((batchResolve) => {
          releaseBatch = batchResolve
          expect(items.map((item) => item.resumeId)).toEqual(['resume-2'])
        }),
    )
    const localRouterFn = vi.fn((resume: ResumeDocument): RouterDecision | null =>
      resume.id === 'resume-1'
        ? { resumeId: resume.id, agentId: 'job-1', layer: 'filename', confidence: 1 }
        : null,
    )
    const runner: ScreeningAgentRunner = async ({ resume }) => {
      if (resume.id === 'resume-1') {
        firstScoreStarted = true
      }
      return makeScorecard(resume.id, resume.fileName, 80)
    }
    async function waitForCondition(predicate: () => boolean) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      throw new Error('condition was not met')
    }

    const runPromise = runMultiAgentBatch({
      agents,
      resumes,
      localRouterFn,
      batchRouterFn,
      runner,
      concurrency: 1,
      llmRoutingConcurrency: 1,
      maxRetries: 0,
    })

    await waitForCondition(() => batchRouterFn.mock.calls.length === 1)
    await waitForCondition(() => firstScoreStarted)
    expect(firstScoreStarted).toBe(true)

    releaseBatch?.([{ resumeId: 'resume-2', agentId: 'job-2' }])
    await runPromise
  })

  it('stops routing and rejects when the abort signal is triggered', async () => {
    const controller = new AbortController()
    const localRouterFn = vi.fn((resume: ResumeDocument): RouterDecision | null => {
      controller.abort()
      return { resumeId: resume.id, agentId: 'job-1', layer: 'filename', confidence: 1 }
    })
    const runner: ScreeningAgentRunner = vi.fn(async ({ resume }) =>
      makeScorecard(resume.id, resume.fileName, 80),
    )

    await expect(
      runMultiAgentBatch({
        agents: [jobConfig],
        resumes,
        localRouterFn,
        runner,
        signal: controller.signal,
        maxRetries: 0,
      }),
    ).rejects.toThrow('筛选已停止')

    expect(localRouterFn).toHaveBeenCalledTimes(1)
    expect(runner).not.toHaveBeenCalled()
  })
})

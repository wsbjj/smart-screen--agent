import { describe, expect, it } from 'vitest'
import { runScreeningBatch } from './screeningEngine.js'
import type {
  CandidateScorecard,
  JobAgentConfig,
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
        resumeId: 'resume-1',
        fileName: '张三.txt',
        completed: 0,
        total: 2,
      },
      {
        status: 'completed',
        resumeId: 'resume-1',
        fileName: '张三.txt',
        completed: 1,
        total: 2,
      },
      {
        status: 'started',
        resumeId: 'resume-2',
        fileName: '李四.txt',
        completed: 1,
        total: 2,
      },
      {
        status: 'completed',
        resumeId: 'resume-2',
        fileName: '李四.txt',
        completed: 2,
        total: 2,
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
})

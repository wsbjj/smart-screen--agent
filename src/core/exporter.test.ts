import { describe, expect, it } from 'vitest'
import { exportScorecardsToCsv, exportScorecardsToWorkbookBuffer } from './exporter.js'
import type { CandidateScorecard } from '../shared/types.js'

const scorecards: CandidateScorecard[] = [
  {
    resumeId: 'r-1',
    fileName: '张三.pdf',
    candidateName: '张三',
    overallScore: 91,
    recommendation: 'strong_yes',
    criterionScores: [
      {
        criterionId: 'frontend',
        label: '前端经验',
        score: 95,
        weight: 50,
        evidence: ['React 项目 3 年', 'TypeScript'],
        missing: [],
      },
    ],
    strengths: ['React 项目 3 年'],
    gaps: ['管理经验不足'],
    risks: ['频繁跳槽'],
    evidenceSummary: ['React 项目 3 年'],
    reviewerNotes: '建议一面',
  },
]

describe('scorecard export', () => {
  it('exports a CSV summary with Chinese text escaped safely', () => {
    const csv = exportScorecardsToCsv(scorecards)

    expect(csv).toContain('候选人')
    expect(csv).toContain('张三')
    expect(csv).toContain('React 项目 3 年')
  })

  it('exports an xlsx workbook buffer with content', async () => {
    const buffer = await exportScorecardsToWorkbookBuffer(scorecards)

    expect(buffer.byteLength).toBeGreaterThan(1000)
  })
})

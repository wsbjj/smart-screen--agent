import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { exportScorecardsToCsv, exportScorecardsToWorkbookBuffer } from './exporter.js'
import type { CandidateScorecard } from '../shared/types.js'

const scorecards: Array<CandidateScorecard & { jobAgentId: string; jobAgentTitle: string }> = [
  {
    resumeId: 'r-1',
    fileName: '张三.pdf',
    candidateName: '张三',
    jobAgentId: 'job-frontend',
    jobAgentTitle: '前端工程师',
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
    expect(csv.split('\n')[0]).toContain('岗位 Agent')
    expect(csv).toContain('张三')
    expect(csv).toContain('前端工程师')
    expect(csv).toContain('React 项目 3 年')
  })

  it('exports an xlsx workbook summary with the job agent column only on ranking sheet', async () => {
    const buffer = await exportScorecardsToWorkbookBuffer(scorecards)
    const workbook = new ExcelJS.Workbook()
    const workbookData = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    await workbook.xlsx.load(workbookData as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const summary = workbook.getWorksheet('候选人排名')!
    const details = workbook.getWorksheet('详细评分卡')!

    expect(buffer.byteLength).toBeGreaterThan(1000)
    expect(summary.getRow(1).values).toContain('岗位 Agent')
    expect(summary.getRow(2).getCell(4).value).toBe('前端工程师')
    expect(details.getRow(1).values).not.toContain('岗位 Agent')
  })
})

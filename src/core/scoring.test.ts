import { describe, expect, it } from 'vitest'
import { normalizeScorecard, rankScorecards } from './scoring.js'
import type { CandidateScorecard } from '../shared/types.js'

const baseScorecard: CandidateScorecard = {
  resumeId: 'r-1',
  fileName: '张三.pdf',
  candidateName: '张三',
  overallScore: 123,
  recommendation: 'strong_yes',
  criterionScores: [
    {
      criterionId: 'frontend',
      label: '前端经验',
      score: 120,
      weight: 60,
      evidence: ['React 项目 3 年'],
      missing: [],
    },
    {
      criterionId: 'english',
      label: '英语',
      score: -4,
      weight: 40,
      evidence: [],
      missing: ['未体现英语沟通'],
    },
  ],
  strengths: ['React 项目 3 年'],
  gaps: [],
  risks: [],
  evidenceSummary: ['React 项目 3 年'],
  reviewerNotes: '值得优先沟通',
}

describe('scorecard normalization', () => {
  it('clamps overall and criterion scores into 0-100', () => {
    const normalized = normalizeScorecard(baseScorecard)

    expect(normalized.overallScore).toBe(100)
    expect(normalized.criterionScores.map((item) => item.score)).toEqual([100, 0])
  })

  it('ranks scorecards by score then recommendation strength', () => {
    const ranked = rankScorecards([
      { ...baseScorecard, resumeId: 'a', overallScore: 80, recommendation: 'maybe' },
      { ...baseScorecard, resumeId: 'b', overallScore: 92, recommendation: 'no' },
      { ...baseScorecard, resumeId: 'c', overallScore: 80, recommendation: 'strong_yes' },
    ])

    expect(ranked.map((item) => item.resumeId)).toEqual(['b', 'c', 'a'])
  })
})

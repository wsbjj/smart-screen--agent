import type { CandidateScorecard, Recommendation } from '../shared/types.js'

const recommendationRank: Record<Recommendation, number> = {
  strong_yes: 4,
  yes: 3,
  maybe: 2,
  no: 1,
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function normalizeScorecard(scorecard: CandidateScorecard): CandidateScorecard {
  return {
    ...scorecard,
    overallScore: clampScore(scorecard.overallScore),
    criterionScores: scorecard.criterionScores.map((criterion) => ({
      ...criterion,
      score: clampScore(criterion.score),
      weight: Math.max(0, Math.round(criterion.weight)),
      evidence: criterion.evidence.filter(Boolean),
      missing: criterion.missing.filter(Boolean),
    })),
    strengths: scorecard.strengths.filter(Boolean),
    gaps: scorecard.gaps.filter(Boolean),
    risks: scorecard.risks.filter(Boolean),
    evidenceSummary: scorecard.evidenceSummary.filter(Boolean),
  }
}

export function rankScorecards(scorecards: CandidateScorecard[]): CandidateScorecard[] {
  return scorecards
    .map(normalizeScorecard)
    .toSorted((left, right) => {
      const scoreDelta = right.overallScore - left.overallScore
      if (scoreDelta !== 0) {
        return scoreDelta
      }
      return recommendationRank[right.recommendation] - recommendationRank[left.recommendation]
    })
}

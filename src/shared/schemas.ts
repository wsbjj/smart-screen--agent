import { z } from 'zod'

export const recommendationSchema = z.enum(['strong_yes', 'yes', 'maybe', 'no'])

export const criterionScoreSchema = z.object({
  criterionId: z.string(),
  label: z.string(),
  score: z.number(),
  weight: z.number(),
  evidence: z.array(z.string()),
  missing: z.array(z.string()),
})

export const candidateScorecardSchema = z.object({
  resumeId: z.string(),
  fileName: z.string(),
  candidateName: z.string(),
  jobAgentId: z.string().optional(),
  jobAgentTitle: z.string().optional(),
  overallScore: z.number(),
  recommendation: recommendationSchema,
  criterionScores: z.array(criterionScoreSchema),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  risks: z.array(z.string()),
  evidenceSummary: z.array(z.string()),
  reviewerNotes: z.string(),
})

export const jobCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number(),
  description: z.string(),
})

export const routingOutputSchema = z.object({
  agentId: z.string(),
  reasoning: z.string(),
})

export const routingBatchOutputSchema = z.object({
  decisions: z.array(z.object({
    resumeId: z.string(),
    agentId: z.string(),
    reasoning: z.string(),
  })),
})

export const jobAgentConfigSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  mustHaves: z.array(z.string()),
  niceToHaves: z.array(z.string()),
  riskFlags: z.array(z.string()),
  criteria: z.array(jobCriterionSchema).min(1),
  instructions: z.string(),
  thresholds: z.object({
    strongYes: z.number(),
    yes: z.number(),
    maybe: z.number(),
  }),
})

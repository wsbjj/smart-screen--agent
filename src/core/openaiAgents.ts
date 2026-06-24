import { Agent, OpenAIProvider, Runner, run, setDefaultOpenAIKey } from '@openai/agents'
import type { AgentOutputType } from '@openai/agents'
import type { z } from 'zod'
import {
  candidateScorecardSchema,
  jobAgentConfigSchema,
  routingBatchOutputSchema,
  routingOutputSchema,
} from '../shared/schemas.js'
import type {
  BatchLlmRouterFn,
  CandidateScorecard,
  GeneratedJobConfigInput,
  JobAgentConfig,
  LlmRouterFn,
  ScreeningAgentRunner,
} from '../shared/types.js'
import { createFallbackJobConfig } from './jobConfig.js'
import { normalizeScorecard } from './scoring.js'

export type OpenAIRunnerOptions = {
  apiKey: string
  model: string
  baseUrl?: string
}

type JobAgentConfigOutput = z.infer<typeof jobAgentConfigSchema>
type CandidateScorecardOutput = z.infer<typeof candidateScorecardSchema>
type RoutingOutput = z.infer<typeof routingOutputSchema>
type RoutingBatchOutput = z.infer<typeof routingBatchOutputSchema>

function ensureOpenAIKey(apiKey: string) {
  if (!apiKey.trim()) {
    throw new Error('OpenAI API key is required')
  }
  setDefaultOpenAIKey(apiKey)
}

function createRunner(options: OpenAIRunnerOptions): Runner | undefined {
  const baseURL = options.baseUrl?.trim()
  return baseURL
    ? new Runner({
        modelProvider: new OpenAIProvider({
          apiKey: options.apiKey,
          baseURL,
        }),
      })
    : undefined
}

function isStreamStatusSchemaError(error: unknown) {
  const issues = typeof error === 'object' && error !== null && 'issues' in error
    ? (error as { issues?: unknown }).issues
    : undefined

  return Array.isArray(issues) && issues.some((issue) => {
    if (typeof issue !== 'object' || issue === null) {
      return false
    }
    const path = 'path' in issue ? (issue as { path?: unknown }).path : undefined
    return Array.isArray(path) && path.join('.') === 'response.output.0.status'
  })
}

function isTerminatedStreamError(error: unknown) {
  if (!(error instanceof Error) || error.message !== 'terminated') {
    return false
  }

  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined
  if (typeof cause !== 'object' || cause === null) {
    return false
  }

  return 'code' in cause && (cause as { code?: unknown }).code === 'UND_ERR_SOCKET'
}

function shouldFallbackToNonStreaming(error: unknown) {
  return isStreamStatusSchemaError(error) || isTerminatedStreamError(error)
}

async function runWithProvider<TOutput extends AgentOutputType>(
  agent: Agent<unknown, TOutput>,
  input: string,
  options: OpenAIRunnerOptions,
) {
  const runner = createRunner(options)
  try {
    const result = runner
      ? await runner.run(agent, input, { stream: true })
      : await run(agent, input, { stream: true })
    await result.completed
    return result
  } catch (error) {
    if (!shouldFallbackToNonStreaming(error)) {
      throw error
    }
    return runner ? runner.run(agent, input) : run(agent, input)
  }
}

export async function generateJobAgentConfig(
  input: GeneratedJobConfigInput,
  options: OpenAIRunnerOptions,
): Promise<JobAgentConfig> {
  ensureOpenAIKey(options.apiKey)

  const fallback = createFallbackJobConfig(input.jdText, input.sourceFileName)
  const agent = new Agent({
    name: '岗位 Agent 配置生成器',
    model: options.model,
    outputType: jobAgentConfigSchema,
    instructions: [
      '你负责把招聘 JD 转换成一个可编辑的岗位专属简历筛选 agent 配置。',
      '输出必须是结构化对象，不要输出 markdown。',
      '评分维度权重总和应接近 100。',
      '必须保留严格证据原则：简历没有写到的能力不可推断。',
    ].join('\n'),
  })

  const result = await runWithProvider(agent, JSON.stringify({ jdText: input.jdText, fallback }), options)
  const output = result.finalOutput as JobAgentConfigOutput | undefined

  if (!output) {
    throw new Error('OpenAI did not return a job agent config')
  }

  return jobAgentConfigSchema.parse(output)
}

export function createScreeningAgentRunner(options: OpenAIRunnerOptions): ScreeningAgentRunner {
  ensureOpenAIKey(options.apiKey)

  return async ({ jobConfig, resume }) => {
    const agent = new Agent({
      name: `${jobConfig.title} 简历筛选 Agent`,
      model: options.model,
      outputType: candidateScorecardSchema,
      instructions: [
        jobConfig.instructions,
        '你正在为一个岗位筛选单份简历。',
        '只根据 JD、岗位配置和简历原文中的明确证据评分。',
        '每条优势、缺失项、风险点都要尽量对应简历证据；不能凭空猜测年龄、性别、学校层次或未写明经历。',
        'overallScore 和 criterionScores.score 必须为 0 到 100。',
      ].join('\n'),
    })

    const result = await runWithProvider(
      agent,
      JSON.stringify({
        jobConfig,
        resume: {
          id: resume.id,
          fileName: resume.fileName,
          text: resume.text,
        },
      }),
      options,
    )
    const output = result.finalOutput as CandidateScorecardOutput | undefined

    if (!output) {
      throw new Error('OpenAI did not return a candidate scorecard')
    }

    const parsed = candidateScorecardSchema.parse(output) as CandidateScorecard
    return normalizeScorecard({
      ...parsed,
      resumeId: resume.id,
      fileName: resume.fileName,
    })
  }
}

export function createLlmRouterFn(options: OpenAIRunnerOptions): LlmRouterFn {
  ensureOpenAIKey(options.apiKey)

  return async (resumeExcerpt, agents) => {
    const agentList = agents.map((a) => ({ id: a.id, title: a.title, summary: a.summary }))
    const agent = new Agent({
      name: '简历分拣员',
      model: options.model,
      outputType: routingOutputSchema,
      instructions: [
        '你是简历分拣员。根据简历摘要，从给定岗位列表中选出最匹配的一个岗位。',
        '只返回 agentId（对应岗位的 id）和选择理由，不要输出任何其他内容。',
      ].join('\n'),
    })

    const result = await runWithProvider(
      agent,
      JSON.stringify({ resumeExcerpt, agents: agentList }),
      options,
    )
    const output = result.finalOutput as RoutingOutput | undefined
    if (!output) throw new Error('LLM router returned no output')
    const parsed = routingOutputSchema.parse(output)
    return parsed.agentId
  }
}

export function createBatchLlmRouterFn(options: OpenAIRunnerOptions): BatchLlmRouterFn {
  ensureOpenAIKey(options.apiKey)

  return async (items, agents) => {
    if (items.length === 0) {
      return []
    }

    const agentList = agents.map((a) => ({ id: a.id, title: a.title, summary: a.summary }))
    const agent = new Agent({
      name: '批量简历分拣员',
      model: options.model,
      outputType: routingBatchOutputSchema,
      instructions: [
        '你是简历分拣员。根据每份简历摘要，从给定岗位列表中为每份简历选出最匹配的一个岗位。',
        '必须返回 decisions 数组；每个元素包含 resumeId、agentId 和 reasoning。',
        'agentId 必须来自给定岗位列表，不要输出任何其他内容。',
      ].join('\n'),
    })

    const result = await runWithProvider(
      agent,
      JSON.stringify({ resumes: items, agents: agentList }),
      options,
    )
    const output = result.finalOutput as RoutingBatchOutput | undefined
    if (!output) throw new Error('Batch LLM router returned no output')
    const parsed = routingBatchOutputSchema.parse(output)
    return parsed.decisions.map((decision) => ({
      resumeId: decision.resumeId,
      agentId: decision.agentId,
    }))
  }
}

import { normalizeScorecard, rankScorecards } from './scoring.js'
import type {
  AgentStatusEvent,
  CandidateScorecard,
  MultiAgentBatchOptions,
  ResumeDocument,
  RouterDecision,
  ScreeningBatchError,
  ScreeningBatchOptions,
} from '../shared/types.js'

export const defaultScreeningConcurrency = 3

async function retryScorecard(
  resume: ResumeDocument,
  options: ScreeningBatchOptions,
): Promise<CandidateScorecard> {
  const maxRetries = options.maxRetries ?? 2
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const scorecard = await options.runner({
        jobConfig: options.jobConfig,
        resume,
      })
      return normalizeScorecard({
        ...scorecard,
        resumeId: resume.id,
        fileName: resume.fileName,
      })
    } catch (error) {
      lastError = error
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Unknown screening failure'
  throw new Error(message)
}

export async function runScreeningBatch(options: ScreeningBatchOptions) {
  const concurrency = Math.max(1, options.concurrency ?? defaultScreeningConcurrency)
  const scorecards: CandidateScorecard[] = []
  const errors: ScreeningBatchError[] = []
  let cursor = 0
  let completed = 0
  const total = options.resumes.length

  async function worker() {
    while (cursor < options.resumes.length) {
      const resume = options.resumes[cursor]
      cursor += 1
      options.onProgress?.({
        status: 'started',
        resumeId: resume.id,
        fileName: resume.fileName,
        completed,
        total,
      })

      try {
        scorecards.push(await retryScorecard(resume, options))
        completed += 1
        options.onProgress?.({
          status: 'completed',
          resumeId: resume.id,
          fileName: resume.fileName,
          completed,
          total,
        })
      } catch (error) {
        completed += 1
        errors.push({
          resumeId: resume.id,
          fileName: resume.fileName,
          message: error instanceof Error ? error.message : 'Unknown screening failure',
        })
        options.onProgress?.({
          status: 'failed',
          resumeId: resume.id,
          fileName: resume.fileName,
          completed,
          total,
        })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, options.resumes.length) }, () => worker()),
  )

  return {
    scorecards: rankScorecards(scorecards),
    errors,
  }
}

export const defaultMultiAgentConcurrency = 10

export async function runMultiAgentBatch(options: MultiAgentBatchOptions): Promise<{
  scorecards: CandidateScorecard[]
  errors: ScreeningBatchError[]
  routingDecisions: RouterDecision[]
}> {
  const concurrency = Math.max(1, options.concurrency ?? defaultMultiAgentConcurrency)

  // Route all resumes concurrently (up to 5 at once)
  const routingDecisions: RouterDecision[] = []
  const routingQueue = [...options.resumes]
  let routingCursor = 0
  const routingConcurrency = Math.min(5, options.resumes.length)

  async function routeWorker() {
    while (routingCursor < routingQueue.length) {
      const resume = routingQueue[routingCursor]
      routingCursor += 1
      const decision = await options.routerFn(resume, options.agents)
      routingDecisions.push(decision)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, routingConcurrency) }, () => routeWorker()),
  )

  // Group resumes by agentId
  const groupMap = new Map<string, ResumeDocument[]>()
  for (const agent of options.agents) {
    groupMap.set(agent.id, [])
  }
  for (const decision of routingDecisions) {
    const group = groupMap.get(decision.agentId)
    if (group) {
      const resume = options.resumes.find((r) => r.id === decision.resumeId)
      if (resume) group.push(resume)
    }
  }

  // Build per-agent status tracking
  const agentStatusMap = new Map<string, AgentStatusEvent>()
  for (const agent of options.agents) {
    const totalAssigned = groupMap.get(agent.id)?.length ?? 0
    const initial: AgentStatusEvent = {
      agentId: agent.id,
      agentTitle: agent.title,
      status: 'idle',
      processedCount: 0,
      totalAssigned,
    }
    agentStatusMap.set(agent.id, initial)
    options.onAgentStatus?.(initial)
  }

  // Flatten to work queue: [{agentId, resume}, ...]
  type WorkItem = { agentId: string; resume: ResumeDocument }
  const workQueue: WorkItem[] = []
  for (const [agentId, resumes] of groupMap) {
    for (const resume of resumes) {
      workQueue.push({ agentId, resume })
    }
  }

  const scorecards: CandidateScorecard[] = []
  const errors: ScreeningBatchError[] = []
  let cursor = 0
  let completed = 0
  const total = workQueue.length

  async function worker() {
    while (cursor < workQueue.length) {
      const item = workQueue[cursor]
      cursor += 1
      const { agentId, resume } = item
      const agent = options.agents.find((a) => a.id === agentId)
      if (!agent) continue

      // Emit running status
      const currentStatus = agentStatusMap.get(agentId)!
      const running: AgentStatusEvent = {
        ...currentStatus,
        status: 'running',
        currentResumeFileName: resume.fileName,
      }
      agentStatusMap.set(agentId, running)
      options.onAgentStatus?.(running)

      options.onProgress?.({
        status: 'started',
        resumeId: resume.id,
        fileName: resume.fileName,
        completed,
        total,
        agentId,
      })

      const maxRetries = options.maxRetries ?? 2
      let lastError: unknown
      let scorecard: CandidateScorecard | null = null

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const raw = await options.runner({ jobConfig: agent, resume })
          scorecard = normalizeScorecard({ ...raw, resumeId: resume.id, fileName: resume.fileName })
          break
        } catch (err) {
          lastError = err
        }
      }

      completed += 1
      const updatedStatus = agentStatusMap.get(agentId)!
      const newCount = updatedStatus.processedCount + 1
      const allDone = newCount >= updatedStatus.totalAssigned

      if (scorecard) {
        scorecards.push(scorecard)
        options.onProgress?.({
          status: 'completed',
          resumeId: resume.id,
          fileName: resume.fileName,
          completed,
          total,
          agentId,
        })
      } else {
        const message =
          lastError instanceof Error ? lastError.message : 'Unknown screening failure'
        errors.push({ resumeId: resume.id, fileName: resume.fileName, message })
        options.onProgress?.({
          status: 'failed',
          resumeId: resume.id,
          fileName: resume.fileName,
          completed,
          total,
          agentId,
        })
      }

      const nextStatus: AgentStatusEvent = {
        ...updatedStatus,
        status: allDone ? 'completed' : 'running',
        processedCount: newCount,
        currentResumeFileName: allDone ? undefined : resume.fileName,
      }
      agentStatusMap.set(agentId, nextStatus)
      options.onAgentStatus?.(nextStatus)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, workQueue.length || 1) }, () => worker()),
  )

  return { scorecards: rankScorecards(scorecards), errors, routingDecisions }
}

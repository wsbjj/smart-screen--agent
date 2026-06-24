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

export class ScreeningCancelledError extends Error {
  constructor() {
    super('筛选已停止')
    this.name = 'ScreeningCancelledError'
  }
}

function isScreeningCancelledError(error: unknown): error is ScreeningCancelledError {
  return error instanceof ScreeningCancelledError
}

function throwIfScreeningCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ScreeningCancelledError()
  }
}

function resolveUnlessScreeningCancelled<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return task
  }
  throwIfScreeningCancelled(signal)

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ScreeningCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    task
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function retryScorecard(
  resume: ResumeDocument,
  options: ScreeningBatchOptions,
): Promise<CandidateScorecard> {
  const maxRetries = options.maxRetries ?? 2
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      throwIfScreeningCancelled(options.signal)
      const scorecard = await resolveUnlessScreeningCancelled(
        options.runner({
          jobConfig: options.jobConfig,
          resume,
        }),
        options.signal,
      )
      throwIfScreeningCancelled(options.signal)
      return normalizeScorecard({
        ...scorecard,
        resumeId: resume.id,
        fileName: resume.fileName,
        jobAgentId: options.jobConfig.id,
        jobAgentTitle: options.jobConfig.title,
      })
    } catch (error) {
      if (isScreeningCancelledError(error)) {
        throw error
      }
      lastError = error
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Unknown screening failure'
  throw new Error(message)
}

export async function runScreeningBatch(options: ScreeningBatchOptions) {
  throwIfScreeningCancelled(options.signal)
  const concurrency = Math.max(1, options.concurrency ?? defaultScreeningConcurrency)
  const scorecards: CandidateScorecard[] = []
  const errors: ScreeningBatchError[] = []
  let cursor = 0
  let started = 0
  let active = 0
  let completed = 0
  const total = options.resumes.length

  async function worker() {
    while (cursor < options.resumes.length) {
      throwIfScreeningCancelled(options.signal)
      const resume = options.resumes[cursor]
      cursor += 1
      started += 1
      active += 1
      options.onProgress?.({
        status: 'started',
        phase: 'screening',
        resumeId: resume.id,
        fileName: resume.fileName,
        completed,
        total,
        started,
        active,
      })

      try {
        const scorecard = await retryScorecard(resume, options)
        throwIfScreeningCancelled(options.signal)
        scorecards.push(scorecard)
        completed += 1
        active -= 1
        options.onProgress?.({
          status: 'completed',
          phase: 'screening',
          resumeId: resume.id,
          fileName: resume.fileName,
          completed,
          total,
          started,
          active,
        })
      } catch (error) {
        if (isScreeningCancelledError(error)) {
          active -= 1
          throw error
        }
        completed += 1
        active -= 1
        errors.push({
          resumeId: resume.id,
          fileName: resume.fileName,
          message: error instanceof Error ? error.message : 'Unknown screening failure',
        })
        options.onProgress?.({
          status: 'failed',
          phase: 'screening',
          resumeId: resume.id,
          fileName: resume.fileName,
          completed,
          total,
          started,
          active,
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
const defaultRoutingBatchSize = 30

export async function runMultiAgentBatch(options: MultiAgentBatchOptions): Promise<{
  scorecards: CandidateScorecard[]
  errors: ScreeningBatchError[]
  routingDecisions: RouterDecision[]
}> {
  if (options.agents.length === 0) {
    throw new Error('No agents provided to multi-agent screening')
  }

  const signal = options.signal
  throwIfScreeningCancelled(signal)
  const concurrency = Math.max(1, options.concurrency ?? defaultMultiAgentConcurrency)
  const routingDecisions: RouterDecision[] = []
  const resumeById = new Map(options.resumes.map((resume) => [resume.id, resume]))
  let routingStarted = 0
  let routingActive = 0
  let routingCompleted = 0
  let routingDone = false

  const agentStatusMap = new Map<string, AgentStatusEvent>()
  for (const agent of options.agents) {
    const initial: AgentStatusEvent = {
      agentId: agent.id,
      agentTitle: agent.title,
      status: 'idle',
      processedCount: 0,
      totalAssigned: 0,
    }
    agentStatusMap.set(agent.id, initial)
    options.onAgentStatus?.(initial)
  }

  type WorkItem = { agentId: string; resume: ResumeDocument }
  const workQueue: WorkItem[] = []
  const waitingWorkers: Array<(item: WorkItem | null) => void> = []

  const scorecards: CandidateScorecard[] = []
  const errors: ScreeningBatchError[] = []
  let started = 0
  let active = 0
  let completed = 0
  const total = options.resumes.length

  function fallbackDecision(resume: ResumeDocument): RouterDecision {
    return { resumeId: resume.id, agentId: options.agents[0].id, layer: 'fallback', confidence: 0 }
  }

  function normalizeDecision(resume: ResumeDocument, decision: RouterDecision | null): RouterDecision {
    const candidate = decision ? { ...decision, resumeId: resume.id } : fallbackDecision(resume)
    return options.agents.some((agent) => agent.id === candidate.agentId)
      ? candidate
      : fallbackDecision(resume)
  }

  function emitRoutingStarted(resume: ResumeDocument) {
    routingStarted += 1
    routingActive += 1
    options.onProgress?.({
      status: 'routing',
      phase: 'routing',
      resumeId: resume.id,
      fileName: resume.fileName,
      completed: routingCompleted,
      total,
      started: routingStarted,
      active: routingActive,
    })
  }

  function emitRoutingCompleted(resume: ResumeDocument, decision: RouterDecision) {
    routingActive -= 1
    routingCompleted += 1
    options.onProgress?.({
      status: 'routing',
      phase: 'routing',
      resumeId: resume.id,
      fileName: resume.fileName,
      completed: routingCompleted,
      total,
      started: routingStarted,
      active: routingActive,
      agentId: decision.agentId,
    })
  }

  async function cacheDecision(resume: ResumeDocument, decision: RouterDecision) {
    try {
      await options.routeCache?.set(resume, options.agents, decision)
    } catch {
      // Routing cache failures should never block screening.
    }
  }

  function enqueueWork(decision: RouterDecision) {
    throwIfScreeningCancelled(signal)
    const resume = resumeById.get(decision.resumeId)
    if (!resume) return

    routingDecisions.push(decision)
    const currentStatus = agentStatusMap.get(decision.agentId)
    if (currentStatus) {
      const assigned: AgentStatusEvent = {
        ...currentStatus,
        totalAssigned: currentStatus.totalAssigned + 1,
      }
      agentStatusMap.set(decision.agentId, assigned)
      options.onAgentStatus?.(assigned)
    }

    const item = { agentId: decision.agentId, resume }
    const waitingWorker = waitingWorkers.shift()
    if (waitingWorker) {
      waitingWorker(item)
    } else {
      workQueue.push(item)
    }
  }

  function closeWorkQueue() {
    routingDone = true
    while (waitingWorkers.length > 0) {
      waitingWorkers.shift()?.(null)
    }
  }

  async function nextWorkItem(): Promise<WorkItem | null> {
    if (signal?.aborted) return null
    const item = workQueue.shift()
    if (item) return item
    if (routingDone) return null
    return new Promise((resolve) => waitingWorkers.push(resolve))
  }

  function finalizeCompletedAgentStatuses() {
    for (const [agentId, status] of agentStatusMap) {
      if (status.totalAssigned > 0 && status.processedCount >= status.totalAssigned) {
        const completedStatus: AgentStatusEvent = {
          ...status,
          status: 'completed',
          currentResumeFileName: undefined,
        }
        agentStatusMap.set(agentId, completedStatus)
        options.onAgentStatus?.(completedStatus)
      }
    }
  }

  async function worker() {
    while (true) {
      const item = await nextWorkItem()
      if (!item) return
      throwIfScreeningCancelled(signal)
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

      started += 1
      active += 1
      options.onProgress?.({
        status: 'started',
        phase: 'screening',
        resumeId: resume.id,
        fileName: resume.fileName,
        completed,
        total,
        started,
        active,
        agentId,
      })

      const maxRetries = options.maxRetries ?? 2
      let lastError: unknown
      let scorecard: CandidateScorecard | null = null

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          throwIfScreeningCancelled(signal)
          const raw = await resolveUnlessScreeningCancelled(
            options.runner({ jobConfig: agent, resume }),
            signal,
          )
          throwIfScreeningCancelled(signal)
          scorecard = normalizeScorecard({
            ...raw,
            resumeId: resume.id,
            fileName: resume.fileName,
            jobAgentId: agent.id,
            jobAgentTitle: agent.title,
          })
          break
        } catch (err) {
          if (isScreeningCancelledError(err)) {
            throw err
          }
          lastError = err
        }
      }

      throwIfScreeningCancelled(signal)

      completed += 1
      active -= 1
      const updatedStatus = agentStatusMap.get(agentId)!
      const newCount = updatedStatus.processedCount + 1
      const allDone = routingDone && newCount >= updatedStatus.totalAssigned

      if (scorecard) {
        scorecards.push(scorecard)
        options.onProgress?.({
          status: 'completed',
          phase: 'screening',
          resumeId: resume.id,
          fileName: resume.fileName,
          completed,
          total,
          started,
          active,
          agentId,
        })
      } else {
        const message =
          lastError instanceof Error ? lastError.message : 'Unknown screening failure'
        errors.push({ resumeId: resume.id, fileName: resume.fileName, message })
        options.onProgress?.({
          status: 'failed',
          phase: 'screening',
          resumeId: resume.id,
          fileName: resume.fileName,
          completed,
          total,
          started,
          active,
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

  async function routeOneWithLegacyRouter(resume: ResumeDocument) {
    if (!options.routerFn) {
      throw new Error('No router provided for multi-agent screening')
    }
    throwIfScreeningCancelled(signal)
    emitRoutingStarted(resume)
    const decision = normalizeDecision(
      resume,
      await resolveUnlessScreeningCancelled(options.routerFn(resume, options.agents), signal),
    )
    throwIfScreeningCancelled(signal)
    await cacheDecision(resume, decision)
    throwIfScreeningCancelled(signal)
    emitRoutingCompleted(resume, decision)
    enqueueWork(decision)
  }

  async function routeWithLegacyRouter() {
    let routingCursor = 0
    const routingConcurrency = Math.min(options.routingConcurrency ?? 5, options.resumes.length)

    async function routeWorker() {
      while (routingCursor < options.resumes.length) {
        throwIfScreeningCancelled(signal)
        const resume = options.resumes[routingCursor]
        routingCursor += 1
        await routeOneWithLegacyRouter(resume)
      }
    }

    await Promise.all(
      Array.from({ length: Math.max(1, routingConcurrency) }, () => routeWorker()),
    )
  }

  async function routeWithLocalAndBatchRouters() {
    const unresolved: ResumeDocument[] = []

    async function readCachedDecision(resume: ResumeDocument): Promise<RouterDecision | null> {
      throwIfScreeningCancelled(signal)
      try {
        const decision = await resolveUnlessScreeningCancelled(
          Promise.resolve(options.routeCache?.get(resume, options.agents) ?? null),
          signal,
        )
        throwIfScreeningCancelled(signal)
        return decision
      } catch (error) {
        if (isScreeningCancelledError(error)) {
          throw error
        }
        return null
      }
    }

    async function routeBatchWithLlm(batch: ResumeDocument[]) {
      throwIfScreeningCancelled(signal)
      try {
        const decisions = await resolveUnlessScreeningCancelled(
          options.batchRouterFn!(
            batch.map((resume) => ({ resumeId: resume.id, excerpt: resume.text.slice(0, 500) })),
            options.agents,
          ),
          signal,
        )
        throwIfScreeningCancelled(signal)
        return decisions
      } catch (error) {
        if (isScreeningCancelledError(error)) {
          throw error
        }
        return []
      }
    }

    for (const resume of options.resumes) {
      throwIfScreeningCancelled(signal)
      const cachedDecision = await readCachedDecision(resume)
      if (cachedDecision) {
        const decision = normalizeDecision(resume, cachedDecision)
        throwIfScreeningCancelled(signal)
        emitRoutingStarted(resume)
        emitRoutingCompleted(resume, decision)
        enqueueWork(decision)
        continue
      }

      const localDecision = options.localRouterFn?.(resume, options.agents) ?? null
      throwIfScreeningCancelled(signal)
      if (localDecision) {
        const decision = normalizeDecision(resume, localDecision)
        await cacheDecision(resume, decision)
        throwIfScreeningCancelled(signal)
        emitRoutingStarted(resume)
        emitRoutingCompleted(resume, decision)
        enqueueWork(decision)
        continue
      }

      if (options.routingMode === 'local_only' || !options.batchRouterFn) {
        const decision = fallbackDecision(resume)
        await cacheDecision(resume, decision)
        throwIfScreeningCancelled(signal)
        emitRoutingStarted(resume)
        emitRoutingCompleted(resume, decision)
        enqueueWork(decision)
        continue
      }

      unresolved.push(resume)
    }

    const batchSize = Math.max(1, options.routingBatchSize ?? defaultRoutingBatchSize)
    const llmConcurrency = Math.max(1, Math.min(30, options.llmRoutingConcurrency ?? 10))
    const batches: ResumeDocument[][] = []
    for (let index = 0; index < unresolved.length; index += batchSize) {
      batches.push(unresolved.slice(index, index + batchSize))
    }
    let batchCursor = 0

    async function batchWorker() {
      while (batchCursor < batches.length) {
        throwIfScreeningCancelled(signal)
        const batch = batches[batchCursor]
        batchCursor += 1
        for (const resume of batch) {
          throwIfScreeningCancelled(signal)
          emitRoutingStarted(resume)
        }
        const decisions = await routeBatchWithLlm(batch)

        const decisionMap = new Map(decisions.map((decision) => [decision.resumeId, decision.agentId]))
        for (const resume of batch) {
          const agentId = decisionMap.get(resume.id)
          const decision = normalizeDecision(
            resume,
            agentId ? { resumeId: resume.id, agentId, layer: 'llm', confidence: 0.7 } : null,
          )
          await cacheDecision(resume, decision)
          throwIfScreeningCancelled(signal)
          emitRoutingCompleted(resume, decision)
          enqueueWork(decision)
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(llmConcurrency, Math.max(batches.length, 1)) }, () => batchWorker()),
    )
  }

  const screeningWorkers = Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(total, 1)) }, () => worker()),
  )

  let routeError: unknown
  try {
    if (options.localRouterFn || options.batchRouterFn || options.routingMode) {
      await routeWithLocalAndBatchRouters()
    } else {
      await routeWithLegacyRouter()
    }
  } catch (error) {
    routeError = error
  } finally {
    closeWorkQueue()
    finalizeCompletedAgentStatuses()
  }

  try {
    await screeningWorkers
  } catch (error) {
    routeError ??= error
  }
  finalizeCompletedAgentStatuses()

  if (routeError) {
    throw routeError
  }
  throwIfScreeningCancelled(signal)

  return { scorecards: rankScorecards(scorecards), errors, routingDecisions }
}

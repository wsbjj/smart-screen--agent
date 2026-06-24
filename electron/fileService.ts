import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { app, dialog } from './electronApi.js'
import { extractTextFromFile } from '../src/core/documentParser.js'
import type {
  ImportedResumeSummary,
  ParsedDocument,
  ResumeDocument,
  ResumeImportError,
  ResumeImportProgressEvent,
  ResumeImportResult,
  SupportedExtension,
} from '../src/shared/types.js'

const filters = [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt'] }]
const supportedResumeExtensions = new Set<SupportedExtension>(['.pdf', '.docx', '.txt'])
const defaultImportConcurrency = 2
const defaultImportBatchSize = 20
const defaultImportBatchIntervalMs = 200
const cacheKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ResumeImportOptions = {
  onProgress?: (event: ResumeImportProgressEvent) => void
  concurrency?: number
  batchSize?: number
  batchIntervalMs?: number
}

type ImportSession = {
  id: string
  directory: string
  cancelled: boolean
}

const importSessions = new Map<string, ImportSession>()

export async function pickAndParseJobFile(): Promise<ParsedDocument | null> {
  const result = await dialog.showOpenDialog({
    title: '选择岗位描述文件',
    filters,
    properties: ['openFile'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]
  return extractTextFromFile({
    name: basename(filePath),
    extension: extname(filePath),
    buffer: await readFile(filePath),
  })
}

export async function pickAndParseResumeFiles(options: ResumeImportOptions = {}): Promise<ResumeImportResult> {
  const result = await dialog.showOpenDialog({
    title: '选择简历文件',
    filters,
    properties: ['openFile', 'multiSelections'],
  })

  if (result.canceled) {
    return { sessionId: '', resumes: [], errors: [], cancelled: false }
  }

  return parseResumeFilePaths(result.filePaths, options)
}

export async function pickAndParseResumeFolder(options: ResumeImportOptions = {}): Promise<ResumeImportResult> {
  const result = await dialog.showOpenDialog({
    title: '选择简历文件夹',
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { sessionId: '', resumes: [], errors: [], cancelled: false }
  }

  const session = await createImportSession()
  emitProgress(options, session, {
    status: 'scanning',
    processed: 0,
    total: 0,
    cached: 0,
    failed: 0,
    currentFileName: '扫描文件夹',
  })
  const filePaths = await collectSupportedFiles(result.filePaths[0])
  return parseResumeFilePaths(filePaths, options, session)
}

export async function cancelResumeImport(sessionId: string): Promise<void> {
  const session = importSessions.get(sessionId)
  if (session) {
    session.cancelled = true
  }
}

export async function clearResumeImportCache(sessionIds: string[]): Promise<void> {
  const uniqueSessionIds = [...new Set(sessionIds)].filter(Boolean)
  await Promise.all(
    uniqueSessionIds.map(async (sessionId) => {
      const session = importSessions.get(sessionId)
      if (!session) {
        return
      }
      await removeImportSession(session)
    }),
  )
}

export async function cleanupAllResumeImportCaches(): Promise<void> {
  await Promise.all([...importSessions.values()].map((session) => removeImportSession(session)))
}

export async function cleanupStaleResumeImportCaches(): Promise<void> {
  importSessions.clear()
  await rm(getImportCacheRoot(), { recursive: true, force: true })
}

export async function loadCachedResumes(items: ImportedResumeSummary[]): Promise<ResumeDocument[]> {
  return Promise.all(
    items.map(async (item) => {
      const session = importSessions.get(item.sessionId)
      if (!session) {
        throw new Error(`简历缓存不存在：${item.fileName}`)
      }
      const raw = await readFile(getCacheFilePath(session, item.cacheKey), 'utf8')
      return JSON.parse(raw) as ResumeDocument
    }),
  )
}

async function createImportSession(): Promise<ImportSession> {
  const id = crypto.randomUUID()
  const directory = join(getImportCacheRoot(), id)
  await mkdir(directory, { recursive: true })
  const session: ImportSession = {
    id,
    directory,
    cancelled: false,
  }
  importSessions.set(id, session)
  return session
}

async function removeImportSession(session: ImportSession): Promise<void> {
  session.cancelled = true
  importSessions.delete(session.id)
  await rm(session.directory, { recursive: true, force: true })
}

function getCacheFilePath(session: ImportSession, cacheKey: string): string {
  if (!cacheKeyPattern.test(cacheKey)) {
    throw new Error('简历缓存 key 无效')
  }
  const sessionDirectory = resolve(session.directory)
  const cachePath = resolve(sessionDirectory, `${cacheKey}.json`)
  const relativePath = relative(sessionDirectory, cachePath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('简历缓存路径无效')
  }
  return cachePath
}

function getImportCacheRoot(): string {
  return join(app.getPath('temp'), 'smart-screen-agent', 'resume-imports')
}

async function collectSupportedFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const filePathGroups = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      .map(async (entry) => {
        const filePath = join(directory, entry.name)
        if (entry.isDirectory()) {
          return collectSupportedFiles(filePath)
        }
        if (entry.isFile() && supportedResumeExtensions.has(extname(entry.name).toLowerCase() as SupportedExtension)) {
          return [filePath]
        }
        return []
      }),
  )

  return filePathGroups.flat()
}

async function parseResumeFilePaths(
  filePaths: string[],
  options: ResumeImportOptions = {},
  existingSession?: ImportSession,
): Promise<ResumeImportResult> {
  const session = existingSession ?? await createImportSession()
  const resumeSlots: Array<ImportedResumeSummary | undefined> = []
  const errors: ResumeImportError[] = []
  const pendingBatch: ImportedResumeSummary[] = []
  const pendingErrors: ResumeImportError[] = []
  const total = filePaths.length
  const concurrency = Math.max(1, options.concurrency ?? defaultImportConcurrency)
  const batchSize = Math.max(1, options.batchSize ?? defaultImportBatchSize)
  const batchIntervalMs = Math.max(0, options.batchIntervalMs ?? defaultImportBatchIntervalMs)
  let processed = 0
  let cached = 0
  let failed = 0
  let currentFileName: string | undefined
  let cursor = 0
  let lastFlushAt = Date.now()

  const emitCurrentProgress = (force = false) => {
    const shouldFlushBySize = pendingBatch.length >= batchSize || pendingErrors.length > 0
    const shouldFlushByTime = Date.now() - lastFlushAt >= batchIntervalMs
    if (!force && !shouldFlushBySize && !shouldFlushByTime) {
      return
    }

    emitProgress(options, session, {
      status: 'progress',
      processed,
      total,
      cached,
      failed,
      currentFileName,
      batch: pendingBatch.length > 0 ? [...pendingBatch] : undefined,
      errors: pendingErrors.length > 0 ? [...pendingErrors] : undefined,
    })
    pendingBatch.length = 0
    pendingErrors.length = 0
    lastFlushAt = Date.now()
  }

  emitProgress(options, session, {
    status: 'started',
    processed,
    total,
    cached,
    failed,
  })

  async function worker() {
    while (!session.cancelled) {
      const index = cursor
      cursor += 1
      if (index >= filePaths.length) {
        return
      }

      const filePath = filePaths[index]
      const fileName = basename(filePath)
      currentFileName = fileName
      emitProgress(options, session, {
        status: 'progress',
        processed,
        total,
        cached,
        failed,
        currentFileName,
      })

      try {
        const parsed = await extractTextFromFile({
          name: fileName,
          extension: extname(filePath),
          buffer: await readFile(filePath),
        })
        if (session.cancelled) {
          return
        }
        const summary = await cacheResumeDocument(session, {
          id: crypto.randomUUID(),
          ...parsed,
        })
        resumeSlots[index] = summary
        pendingBatch.push(summary)
        processed += 1
        cached += 1
      } catch (error) {
        if (session.cancelled) {
          return
        }
        const importError = {
          fileName,
          message: error instanceof Error ? error.message : '未知解析错误',
        }
        errors.push(importError)
        pendingErrors.push(importError)
        processed += 1
        failed += 1
      }

      emitCurrentProgress()
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(filePaths.length, 1)) }, () => worker()),
  )

  if (pendingBatch.length > 0 || pendingErrors.length > 0) {
    emitCurrentProgress(true)
  }

  if (session.cancelled) {
    await removeImportSession(session)
    emitProgress(options, session, {
      status: 'cancelled',
      processed,
      total,
      cached,
      failed,
      currentFileName,
    })
    return {
      sessionId: session.id,
      resumes: [],
      errors: [],
      cancelled: true,
    }
  }

  emitProgress(options, session, {
    status: 'completed',
    processed,
    total,
    cached,
    failed,
    currentFileName,
  })

  return {
    sessionId: session.id,
    resumes: resumeSlots.filter((resume): resume is ImportedResumeSummary => Boolean(resume)),
    errors,
    cancelled: false,
  }
}

async function cacheResumeDocument(session: ImportSession, resume: ResumeDocument): Promise<ImportedResumeSummary> {
  const cacheKey = crypto.randomUUID()
  await writeFile(getCacheFilePath(session, cacheKey), JSON.stringify(resume), 'utf8')
  return {
    id: resume.id,
    fileName: resume.fileName,
    extension: resume.extension,
    wordCount: resume.wordCount,
    preview: resume.text.slice(0, 150),
    sessionId: session.id,
    cacheKey,
  }
}

function emitProgress(
  options: ResumeImportOptions,
  session: ImportSession,
  progress: Omit<ResumeImportProgressEvent, 'sessionId'>,
) {
  options.onProgress?.({
    sessionId: session.id,
    ...progress,
  })
}

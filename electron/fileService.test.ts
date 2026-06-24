import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResumeImportProgressEvent, SupportedExtension } from '../src/shared/types.js'

const showOpenDialog = vi.fn()

vi.mock('./electronApi.js', () => ({
  app: {
    getPath: () => tmpdir(),
  },
  dialog: {
    showOpenDialog,
  },
}))

vi.mock('../src/core/documentParser.js', () => ({
  extractTextFromFile: vi.fn(async ({ name, extension }: { name: string; extension: string }) => ({
    fileName: name,
    extension: extension.toLowerCase(),
    text: `${name} parsed text`,
    wordCount: 3,
  })),
}))

describe('file service resume import', () => {
  beforeEach(() => {
    showOpenDialog.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses multiple selected resume files from the desktop dialog', async () => {
    const { pickAndParseResumeFiles } = await import('./fileService.js')
    const directory = join(tmpdir(), `smart-screen-files-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    const resumePath = join(directory, 'candidate.txt')
    await writeFile(resumePath, 'React TypeScript')
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [resumePath],
    })

    const result = await pickAndParseResumeFiles()

    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ['openFile', 'multiSelections'],
      }),
    )
    expect(result.resumes).toHaveLength(1)
    expect(result.resumes[0]).toMatchObject({
      fileName: 'candidate.txt',
      extension: '.txt',
      preview: 'candidate.txt parsed text',
    })
    expect(result.resumes[0]).not.toHaveProperty('text')
  })

  it('emits resume import progress and stores full documents in the temporary cache', async () => {
    const { loadCachedResumes, pickAndParseResumeFiles } = await import('./fileService.js')
    const directory = join(tmpdir(), `smart-screen-progress-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    const resumeA = join(directory, 'candidate-a.txt')
    const resumeB = join(directory, 'candidate-b.txt')
    await writeFile(resumeA, 'React TypeScript')
    await writeFile(resumeB, 'Marketplace operations')
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [resumeA, resumeB],
    })
    const events: ResumeImportProgressEvent[] = []

    const result = await pickAndParseResumeFiles({
      batchSize: 1,
      batchIntervalMs: 0,
      concurrency: 1,
      onProgress: (event) => events.push(event),
    })

    expect(result.cancelled).toBe(false)
    expect(result.resumes).toHaveLength(2)
    expect(result.resumes[0]).toMatchObject({
      fileName: 'candidate-a.txt',
      preview: 'candidate-a.txt parsed text',
      sessionId: result.sessionId,
    })
    expect(result.resumes[0]).not.toHaveProperty('text')
    expect(events[0]).toMatchObject({
      status: 'started',
      processed: 0,
      total: 2,
      cached: 0,
      failed: 0,
    })
    expect(events.some((event) => event.status === 'progress' && event.batch?.length === 1)).toBe(true)
    expect(events.at(-1)).toMatchObject({
      status: 'completed',
      processed: 2,
      total: 2,
      cached: 2,
      failed: 0,
    })

    await expect(loadCachedResumes(result.resumes)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'candidate-a.txt',
          text: 'candidate-a.txt parsed text',
        }),
        expect.objectContaining({
          fileName: 'candidate-b.txt',
          text: 'candidate-b.txt parsed text',
        }),
      ]),
    )
  })

  it('rejects cache keys that try to read outside the import session directory', async () => {
    const { loadCachedResumes, pickAndParseResumeFiles } = await import('./fileService.js')
    const directory = join(tmpdir(), `smart-screen-traversal-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    const resumePath = join(directory, 'candidate.txt')
    await writeFile(resumePath, 'React TypeScript')
    const outsidePath = join(tmpdir(), 'smart-screen-agent', 'outside.json')
    await mkdir(join(tmpdir(), 'smart-screen-agent'), { recursive: true })
    await writeFile(
      outsidePath,
      JSON.stringify({
        id: 'outside-resume',
        fileName: 'outside.txt',
        extension: '.txt',
        text: 'outside cache data',
        wordCount: 3,
      }),
      'utf8',
    )
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [resumePath],
    })

    const result = await pickAndParseResumeFiles()
    const maliciousSummary = {
      ...result.resumes[0],
      cacheKey: '../../outside',
    }

    await expect(loadCachedResumes([maliciousSummary])).rejects.toThrow('缓存 key 无效')
  })

  it('removes stale resume import cache directories from previous app runs', async () => {
    const { cleanupStaleResumeImportCaches } = await import('./fileService.js')
    const stalePath = join(tmpdir(), 'smart-screen-agent', 'resume-imports', 'stale-session', 'resume.json')
    await mkdir(join(tmpdir(), 'smart-screen-agent', 'resume-imports', 'stale-session'), { recursive: true })
    await writeFile(stalePath, '{}', 'utf8')

    await cleanupStaleResumeImportCaches()

    await expect(readFile(stalePath, 'utf8')).rejects.toThrow()
  })

  it('continues importing after a parse failure and reports failed files', async () => {
    const { extractTextFromFile } = await import('../src/core/documentParser.js')
    vi.mocked(extractTextFromFile).mockImplementation(async ({ name, extension }: { name: string; extension: string }) => {
      if (name === 'broken.txt') {
        throw new Error('cannot parse broken resume')
      }
      return {
        fileName: name,
        extension: extension.toLowerCase() as SupportedExtension,
        text: `${name} parsed text`,
        wordCount: 3,
      }
    })
    const { pickAndParseResumeFiles } = await import('./fileService.js')
    const directory = join(tmpdir(), `smart-screen-errors-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    const okPath = join(directory, 'ok.txt')
    const brokenPath = join(directory, 'broken.txt')
    await writeFile(okPath, 'ok')
    await writeFile(brokenPath, 'broken')
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [okPath, brokenPath],
    })
    const events: ResumeImportProgressEvent[] = []

    const result = await pickAndParseResumeFiles({
      batchSize: 1,
      batchIntervalMs: 0,
      concurrency: 1,
      onProgress: (event) => events.push(event),
    })

    expect(result.resumes.map((resume) => resume.fileName)).toEqual(['ok.txt'])
    expect(result.errors).toEqual([{ fileName: 'broken.txt', message: 'cannot parse broken resume' }])
    expect(events.at(-1)).toMatchObject({
      status: 'completed',
      processed: 2,
      cached: 1,
      failed: 1,
    })
  })

  it('cancels an active resume import and removes the session cache', async () => {
    const { cancelResumeImport, loadCachedResumes, pickAndParseResumeFiles } = await import('./fileService.js')
    const directory = join(tmpdir(), `smart-screen-cancel-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    const resumeA = join(directory, 'candidate-a.txt')
    const resumeB = join(directory, 'candidate-b.txt')
    await writeFile(resumeA, 'React')
    await writeFile(resumeB, 'Operations')
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [resumeA, resumeB],
    })
    const cachedItems: NonNullable<ResumeImportProgressEvent['batch']> = []

    const result = await pickAndParseResumeFiles({
      batchSize: 1,
      batchIntervalMs: 0,
      concurrency: 1,
      onProgress: (event) => {
        if (event.batch?.length) {
          cachedItems.push(...event.batch)
          void cancelResumeImport(event.sessionId)
        }
      },
    })

    expect(result.cancelled).toBe(true)
    expect(result.resumes).toEqual([])
    expect(result.errors).toEqual([])
    expect(cachedItems).toHaveLength(1)
    await expect(loadCachedResumes(cachedItems)).rejects.toThrow(/缓存不存在|cache/i)
  })

  it('recursively parses supported resume files from a selected folder', async () => {
    const { pickAndParseResumeFolder } = await import('./fileService.js')
    const directory = join(tmpdir(), `smart-screen-folder-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    const nested = join(directory, 'nested')
    await mkdir(nested)
    await writeFile(join(directory, 'candidate-a.txt'), 'React')
    await writeFile(join(nested, 'candidate-b.docx'), 'DOCX bytes')
    await writeFile(join(directory, 'ignore.png'), 'image')
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [directory],
    })

    const result = await pickAndParseResumeFolder()

    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ['openDirectory'],
      }),
    )
    expect(result.errors).toEqual([])
    expect(result.resumes.map((resume) => resume.fileName)).toEqual(['candidate-a.txt', 'candidate-b.docx'])
  })
})

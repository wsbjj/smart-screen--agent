import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const showOpenDialog = vi.fn()

vi.mock('./electronApi.js', () => ({
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
      text: 'candidate.txt parsed text',
    })
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

import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { dialog } from './electronApi.js'
import { extractTextFromFile } from '../src/core/documentParser.js'
import type { ParsedDocument, ResumeDocument, SupportedExtension } from '../src/shared/types.js'

const filters = [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt'] }]
const supportedResumeExtensions = new Set<SupportedExtension>(['.pdf', '.docx', '.txt'])

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
    name: filePath.split(/[\\/]/).at(-1) ?? 'job-description',
    extension: extname(filePath),
    buffer: await readFile(filePath),
  })
}

export async function pickAndParseResumeFiles(): Promise<{
  resumes: ResumeDocument[]
  errors: Array<{ fileName: string; message: string }>
}> {
  const result = await dialog.showOpenDialog({
    title: '选择简历文件',
    filters,
    properties: ['openFile', 'multiSelections'],
  })

  if (result.canceled) {
    return { resumes: [], errors: [] }
  }

  return parseResumeFilePaths(result.filePaths)
}

export async function pickAndParseResumeFolder(): Promise<{
  resumes: ResumeDocument[]
  errors: Array<{ fileName: string; message: string }>
}> {
  const result = await dialog.showOpenDialog({
    title: '选择简历文件夹',
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { resumes: [], errors: [] }
  }

  const filePaths = await collectSupportedFiles(result.filePaths[0])
  return parseResumeFilePaths(filePaths)
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

async function parseResumeFilePaths(filePaths: string[]): Promise<{
  resumes: ResumeDocument[]
  errors: Array<{ fileName: string; message: string }>
}> {
  const resumes: ResumeDocument[] = []
  const errors: Array<{ fileName: string; message: string }> = []

  for (const filePath of filePaths) {
    const fileName = filePath.split(/[\\/]/).at(-1) ?? filePath
    try {
      const parsed = await extractTextFromFile({
        name: fileName,
        extension: extname(filePath),
        buffer: await readFile(filePath),
      })
      resumes.push({
        id: crypto.randomUUID(),
        ...parsed,
      })
    } catch (error) {
      errors.push({
        fileName,
        message: error instanceof Error ? error.message : '未知解析错误',
      })
    }
  }

  return { resumes, errors }
}

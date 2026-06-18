import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import type { FileExtractionInput, ParsedDocument, SupportedExtension } from '../shared/types.js'

const supportedExtensions = new Set<SupportedExtension>(['.pdf', '.docx', '.txt'])

function normalizeExtension(extension: string): string {
  return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
}

function countWords(text: string): number {
  const latinWords = text.match(/[A-Za-z0-9_]+/g) ?? []
  const cjkWords = text.match(/[\u3400-\u9fff]+/g) ?? []
  return latinWords.length + cjkWords.length
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export async function extractTextFromFile(input: FileExtractionInput): Promise<ParsedDocument> {
  const normalizedExtension = normalizeExtension(input.extension)
  if (!supportedExtensions.has(normalizedExtension as SupportedExtension)) {
    throw new Error(`Unsupported file type: ${normalizedExtension}`)
  }

  let rawText: string
  if (normalizedExtension === '.txt') {
    rawText = input.buffer.toString('utf8')
  } else if (normalizedExtension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: input.buffer })
    rawText = result.value
  } else {
    const parser = new PDFParse({ data: input.buffer })
    const result = await parser.getText()
    rawText = result.text
    await parser.destroy()
  }

  const text = cleanExtractedText(rawText)
  if (!text) {
    throw new Error(`${input.name} is empty after text extraction`)
  }

  return {
    fileName: input.name,
    extension: normalizedExtension as SupportedExtension,
    text,
    wordCount: countWords(text),
  }
}

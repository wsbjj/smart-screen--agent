import { describe, expect, it } from 'vitest'
import { extractTextFromFile } from './documentParser.js'

describe('extractTextFromFile', () => {
  it('extracts text from txt files and trims surrounding whitespace', async () => {
    const result = await extractTextFromFile({
      name: 'candidate.txt',
      extension: '.txt',
      buffer: Buffer.from('  张三\nReact developer  '),
    })

    expect(result.text).toBe('张三\nReact developer')
    expect(result.wordCount).toBe(3)
  })

  it('rejects empty documents', async () => {
    await expect(
      extractTextFromFile({
        name: 'empty.txt',
        extension: '.txt',
        buffer: Buffer.from('   \n\t'),
      }),
    ).rejects.toThrow('empty')
  })

  it('rejects unsupported file types', async () => {
    await expect(
      extractTextFromFile({
        name: 'candidate.png',
        extension: '.png',
        buffer: Buffer.from('not a resume'),
      }),
    ).rejects.toThrow('Unsupported')
  })
})

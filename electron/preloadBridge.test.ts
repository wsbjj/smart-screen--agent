import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('electron preload bridge wiring', () => {
  it('loads a CommonJS preload file from BrowserWindow', async () => {
    const mainSource = await readFile(new URL('./main.ts', import.meta.url), 'utf8')

    expect(mainSource).toContain("preload: join(__dirname, 'preload.cjs')")
    expect(mainSource).not.toContain("preload: join(__dirname, 'preload.js')")
  })

  it('exposes the full desktop API from a sandbox-compatible preload script', async () => {
    const preloadSource = await readFile(new URL('./preload.cts', import.meta.url), 'utf8')

    expect(preloadSource).toContain("require('electron')")
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('desktopApi', api)")
    expect(preloadSource).toContain("'settings:fetch-models'")
    expect(preloadSource).toContain("'files:pick-resume-files'")
    expect(preloadSource).toContain("'files:pick-resume-folder'")
    expect(preloadSource).toContain("'agents:screening-progress'")
    expect(preloadSource).toContain('removeListener(channels.screeningProgress')
    expect(preloadSource).not.toContain("from './channels")
  })

  it('includes cts preload files in the Electron TypeScript build', async () => {
    const tsconfig = JSON.parse(await readFile(new URL('../tsconfig.electron.json', import.meta.url), 'utf8')) as {
      include?: string[]
    }

    expect(tsconfig.include).toContain('electron/**/*.cts')
  })
})

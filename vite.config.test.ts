import { describe, expect, it } from 'vitest'
import config from './vite.config.js'
import type { UserConfig } from 'vite'

describe('Vite production asset paths', () => {
  it('uses relative asset URLs so Electron can load packaged files from file URLs', () => {
    expect((config as UserConfig).base).toBe('./')
  })
})

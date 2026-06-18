import { describe, expect, it } from 'vitest'
import { matchByFilename } from './agentRouter.js'
import { companyJobPresets } from './jobPresets.js'

const agents = companyJobPresets.map((preset) => preset.config)

describe('agent router', () => {
  it('routes ecommerce AI art resumes to the visual design agent by filename', () => {
    const decision = matchByFilename('【电商AI美工_深圳 8-12K】申达瑞 4年.pdf', agents)

    expect(decision?.agentId).toBe('hanlin-brand-visual-design')
  })
})

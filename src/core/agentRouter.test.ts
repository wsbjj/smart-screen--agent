import { describe, expect, it } from 'vitest'
import { createLocalRouter, matchByFilename } from './agentRouter.js'
import { companyJobPresets } from './jobPresets.js'

const agents = companyJobPresets.map((preset) => preset.config)

describe('agent router', () => {
  it('routes ecommerce AI art resumes to the visual design agent by filename', () => {
    const decision = matchByFilename('【电商AI美工_深圳 8-12K】申达瑞 4年.pdf', agents)

    expect(decision?.agentId).toBe('hanlin-brand-visual-design')
  })

  it('routes short amazon operation filenames through built-in aliases', () => {
    const decision = matchByFilename('蔡辨建_不通过_亚马逊运营.pdf', agents)

    expect(decision).toMatchObject({
      agentId: 'hanlin-amazon-operator',
      layer: 'filename',
      confidence: 1,
    })
  })

  it('lets user aliases override built-in aliases for the same pattern', () => {
    const decision = matchByFilename('候选人_亚马逊运营.pdf', agents, [
      { id: 'custom-amazon-product', pattern: '亚马逊运营', agentId: 'hanlin-amazon-product-manager' },
    ])

    expect(decision?.agentId).toBe('hanlin-amazon-product-manager')
  })

  it('uses the longest matching filename alias when several patterns match', () => {
    const decision = matchByFilename('候选人_亚马逊产品经理.pdf', agents, [
      { id: 'short-product', pattern: '产品经理', agentId: 'hanlin-product-manager-sports-protection' },
      { id: 'long-amazon-product', pattern: '亚马逊产品经理', agentId: 'hanlin-amazon-product-manager' },
    ])

    expect(decision?.agentId).toBe('hanlin-amazon-product-manager')
  })

  it('returns null from local routing when filename and NLP evidence are weak', () => {
    const router = createLocalRouter({ nlpThreshold: 0.9 })
    const resume = {
      id: 'resume-weak',
      fileName: '普通候选人.pdf',
      extension: '.pdf' as const,
      text: '候选人具备行政支持与门店接待经验。',
      wordCount: 16,
    }

    expect(router(resume, agents)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { jobAgentConfigSchema } from '../shared/schemas.js'
import { companyJobPresets } from './jobPresets.js'

describe('company job presets', () => {
  it('contains editable agent configs for the company roles', () => {
    expect(companyJobPresets.map((preset) => preset.title)).toEqual([
      'AI智能体搭建技术员',
      '产品经理人（运动护具向）',
      '品牌开发专员（运动护具向）',
      '品牌视觉设计',
      '双休跨境电商运营（独立站）',
      '亚马逊产品经理人',
      '跨境电商亚马逊运营专员',
      '跨境电商财务专员',
    ])

    for (const preset of companyJobPresets) {
      expect(() => jobAgentConfigSchema.parse(preset.config)).not.toThrow()
      expect(preset.jdText).toContain(preset.title)
      expect(preset.config.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)).toBe(100)
    }
  })

  it('contains the cross-border ecommerce finance specialist preset details', () => {
    const preset = companyJobPresets.find((item) => item.id === 'hanlin-cross-border-finance-specialist')

    expect(preset).toMatchObject({
      title: '跨境电商财务专员',
      salary: '10-15K',
      meta: '1-3年 / 学历不限 / 深圳龙岗坂田',
    })
    expect(preset?.jdText).toContain('平台回款、广告消耗、物流费用、平台佣金、退款售后、SKU利润')
    expect(preset?.config.mustHaves).toEqual(expect.arrayContaining([
      '2年以上财务相关工作经验',
      '熟悉跨境电商平台对账、回款、佣金、广告和物流费用核对',
      '能做店铺/SKU/渠道维度利润统计分析',
    ]))
    expect(preset?.config.niceToHaves).toEqual(expect.arrayContaining([
      '亚马逊店铺账号注册或资料准备经验',
      'TikTok Shop、eBay、Shopify 或独立站账号注册经验',
    ]))
    expect(preset?.config.criteria.map((criterion) => criterion.id)).toEqual([
      'finance-tax-foundation',
      'cross-border-reconciliation',
      'profit-data-analysis',
      'tax-risk-control',
      'business-support',
    ])
  })
})

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
    ])

    for (const preset of companyJobPresets) {
      expect(() => jobAgentConfigSchema.parse(preset.config)).not.toThrow()
      expect(preset.jdText).toContain(preset.title)
      expect(preset.config.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)).toBe(100)
    }
  })
})

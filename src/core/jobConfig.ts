import type { JobAgentConfig } from '../shared/types.js'

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'job'
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function inferTitle(jdText: string, sourceFileName?: string): string {
  const titleLine = jdText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length <= 40)

  if (titleLine) {
    return titleLine.replace(/^岗位[:：]\s*/, '')
  }

  return sourceFileName?.replace(/\.[^.]+$/, '') || '未命名岗位'
}

function extractSignals(jdText: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns
    .filter(([pattern]) => pattern.test(jdText))
    .map(([, signal]) => signal)
}

export function createFallbackJobConfig(jdText: string, sourceFileName?: string): JobAgentConfig {
  const title = inferTitle(jdText, sourceFileName)
  const mustHaves = extractSignals(jdText, [
    [/react/i, 'React 经验'],
    [/typescript|ts\b/i, 'TypeScript 经验'],
    [/electron|桌面端|客户端/i, '桌面端或客户端经验'],
    [/node\.?js|node/i, 'Node.js 经验'],
    [/沟通|协作|跨部门/i, '沟通协作能力'],
  ])

  const niceToHaves = extractSignals(jdText, [
    [/性能|优化/i, '性能优化经验'],
    [/测试|vitest|jest|自动化/i, '自动化测试经验'],
    [/英文|英语/i, '英文沟通能力'],
  ])

  return {
    id: uniqueId(slugify(title)),
    title,
    summary: jdText.slice(0, 180),
    mustHaves: mustHaves.length > 0 ? mustHaves : ['与岗位职责相关的项目经验', '核心技能与 JD 匹配'],
    niceToHaves,
    riskFlags: ['关键要求缺少证据', '经历时间线不清晰', '频繁跳槽但无解释'],
    criteria: [
      {
        id: 'required-skills',
        label: '硬性要求匹配',
        weight: 40,
        description: '候选人是否满足 JD 中明确要求的技能、经验年限和背景。',
      },
      {
        id: 'project-evidence',
        label: '项目证据质量',
        weight: 30,
        description: '简历是否给出可验证的项目、职责、结果和技术深度。',
      },
      {
        id: 'growth-fit',
        label: '岗位成长匹配',
        weight: 20,
        description: '过往经历是否能支撑其在该岗位中稳定发展。',
      },
      {
        id: 'communication-risk',
        label: '风险与沟通线索',
        weight: 10,
        description: '识别信息缺失、表达模糊、稳定性或协作风险。',
      },
    ],
    instructions:
      '你是该岗位的简历筛选 agent。只能根据 JD 和简历中的明确证据评分，不要编造经历；缺少证据时写入缺失项或风险点。',
    thresholds: {
      strongYes: 85,
      yes: 75,
      maybe: 60,
    },
  }
}

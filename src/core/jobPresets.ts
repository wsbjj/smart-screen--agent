import type { JobAgentConfig } from '../shared/types.js'

export type CompanyJobPreset = {
  id: string
  title: string
  salary: string
  meta: string
  jdText: string
  config: JobAgentConfig
}

function config(
  id: string,
  title: string,
  summary: string,
  mustHaves: string[],
  niceToHaves: string[],
  riskFlags: string[],
  criteria: JobAgentConfig['criteria'],
  instructions: string,
): JobAgentConfig {
  return {
    id,
    title,
    summary,
    mustHaves,
    niceToHaves,
    riskFlags,
    criteria,
    instructions,
    thresholds: {
      strongYes: 85,
      yes: 75,
      maybe: 60,
    },
  }
}

const strictEvidenceInstruction =
  '你是该岗位的简历筛选 agent。只根据简历中的明确证据评分，不要推断候选人未写明的经历、业务规模或能力；缺少证据必须写入缺失项或风险点。'

export const companyJobPresets: CompanyJobPreset[] = [
  {
    id: 'hanlin-ai-agent-builder',
    title: 'AI智能体搭建技术员',
    salary: '9-14K',
    meta: '经验不限 / 本科 / 深圳龙岗坂田',
    jdText: [
      'AI智能体搭建技术员',
      '公司简介：自研，非外包。公司专注国内外电商业务，覆盖跨境电商、国内电商平台运营、供应链管理等领域。',
      '岗位职责：结合国内外电商业务场景，深入理解业务流程与需求，负责搭建适配电商运营、客户服务、供应链管理、营销推广等环节的各类专属智能体。',
      '主导智能体需求拆解、架构设计、核心功能开发与落地实现，制定符合电商业务特性的技术方案。',
      '持续迭代优化智能体性能，根据电商业务动态变化调整技术策略，确保智能体精准匹配业务流程升级需求。',
      '调研电商领域 AI 应用前沿技术，引入适配的技术与方法，推动 AI 在电商场景的创新应用。',
      '与电商运营、产品、供应链等团队高效协作，精准对接业务需求，保障智能体落地效果与业务价值实现。',
      '负责智能体开发相关技术文档撰写与维护，包括需求分析、设计方案、落地复盘等文档。',
      '任职要求：本科及以上学历，计算机科学与技术、人工智能、软件工程等相关专业；接受应届高校毕业生，或具备 1-2 年 AI 相关领域开发/研究经验。',
    ].join('\n'),
    config: config(
      'hanlin-ai-agent-builder',
      'AI智能体搭建技术员',
      '为电商运营、客服、供应链、营销等场景搭建和迭代 AI 智能体，强调业务理解、方案设计、落地实现和文档沉淀。',
      ['本科及以上学历', '计算机/人工智能/软件工程相关专业优先', '能拆解电商业务需求并设计智能体方案', '具备 AI 工具/智能体搭建或开发经验'],
      ['跨境电商或国内电商业务理解', 'AI Agent、提示词工程、工作流编排经验', '技术文档与落地复盘能力', '跨团队协作经验'],
      ['只有工具使用体验但缺少落地案例', '无法说明智能体业务价值', '缺少需求拆解或架构设计证据'],
      [
        { id: 'ai-agent-build', label: '智能体搭建能力', weight: 35, description: '是否有 AI Agent、工作流、自动化或大模型应用搭建的明确项目证据。' },
        { id: 'ecommerce-fit', label: '电商业务理解', weight: 25, description: '是否理解电商运营、客服、供应链、营销等业务流程，并能映射到智能体方案。' },
        { id: 'technical-delivery', label: '技术落地与迭代', weight: 25, description: '是否能完成需求拆解、方案设计、实现、测试、迭代和文档沉淀。' },
        { id: 'collaboration', label: '协作与表达', weight: 15, description: '是否能和运营、产品、供应链团队沟通需求并交付可复用成果。' },
      ],
      `${strictEvidenceInstruction} 优先识别候选人在 AI 智能体、电商业务自动化、工作流编排、LLM 应用落地方面的证据。`,
    ),
  },
  {
    id: 'hanlin-product-manager-sports-protection',
    title: '产品经理人（运动护具向）',
    salary: '15-30K',
    meta: '3-5年 / 大专 / 深圳龙岗坂田',
    jdText: [
      '产品经理人（运动护具向）',
      '岗位方向：运动护具产品规划、需求定义、供应链协同和上市推进。',
      '职责包括市场洞察、竞品分析、用户需求整理、产品定义、打样跟进、成本与质量协同、销售反馈复盘。',
      '任职要求：有运动护具、运动户外、健康护理或消费品类产品经验；能把市场机会转化为可落地产品方案。',
    ].join('\n'),
    config: config(
      'hanlin-product-manager-sports-protection',
      '产品经理人（运动护具向）',
      '负责运动护具产品从市场洞察、需求定义到供应链打样和上市复盘的全链路产品管理。',
      ['3年以上消费品或运动护具相关产品经验', '能独立完成市场/竞品/用户需求分析', '有产品定义、打样、成本和质量协同经验'],
      ['运动户外、康复护具、亚马逊爆品经验', '供应链资源协调经验', '数据化选品和销售复盘能力'],
      ['只有运营经验但缺少产品定义经验', '无打样/供应链协同证据', '无法说明产品成功指标'],
      [
        { id: 'market-insight', label: '市场与用户洞察', weight: 25, description: '是否能通过市场、竞品、用户反馈识别产品机会。' },
        { id: 'product-definition', label: '产品定义能力', weight: 35, description: '是否能输出功能、材料、规格、卖点、成本和质量要求。' },
        { id: 'supply-chain', label: '供应链协同', weight: 25, description: '是否有打样、验货、成本控制、供应商协同经验。' },
        { id: 'commercial-results', label: '商业结果', weight: 15, description: '是否有上市、销量、转化、利润或复盘数据。' },
      ],
      `${strictEvidenceInstruction} 重点看运动护具/消费品产品规划、供应链打样、上市结果和数据复盘证据。`,
    ),
  },
  {
    id: 'hanlin-brand-development-sports-protection',
    title: '品牌开发专员（运动护具向）',
    salary: '14-25K',
    meta: '3-5年 / 大专 / 深圳龙岗坂田',
    jdText: [
      '品牌开发专员（运动护具向）',
      '岗位方向：围绕运动护具品类进行品牌定位、产品线规划、市场调研、渠道素材协同与新品开发支持。',
      '任职要求：熟悉运动护具或运动户外消费品，对品牌定位、消费者洞察、卖点包装和新品开发有实践经验。',
    ].join('\n'),
    config: config(
      'hanlin-brand-development-sports-protection',
      '品牌开发专员（运动护具向）',
      '面向运动护具品类，负责品牌定位、产品卖点、市场调研和新品开发支持。',
      ['3年以上品牌/品类/产品开发相关经验', '熟悉运动护具或运动户外消费品', '能做市场调研和品牌卖点提炼'],
      ['跨境电商品牌经验', '新品上市项目经验', '内容素材或渠道协同经验'],
      ['只做执行素材但缺少品牌策略', '缺少运动护具品类理解', '无新品开发或商业结果证据'],
      [
        { id: 'brand-positioning', label: '品牌定位能力', weight: 30, description: '是否能明确目标人群、品牌差异化和核心卖点。' },
        { id: 'category-knowledge', label: '品类理解', weight: 25, description: '是否理解运动护具/运动户外用户场景和产品特性。' },
        { id: 'development-support', label: '新品开发协同', weight: 25, description: '是否参与调研、需求、素材、渠道和上市协同。' },
        { id: 'data-feedback', label: '数据与反馈', weight: 20, description: '是否能用销售、评价、广告或用户反馈迭代品牌策略。' },
      ],
      `${strictEvidenceInstruction} 重点寻找品牌定位、运动护具品类理解、新品开发和跨团队协同证据。`,
    ),
  },
  {
    id: 'hanlin-brand-visual-design',
    title: '品牌视觉设计',
    salary: '12-24K',
    meta: '1-3年 / 本科 / 深圳龙岗坂田',
    jdText: [
      '品牌视觉设计',
      '岗位方向：负责品牌视觉、产品详情页、电商素材、广告图、包装与活动视觉设计。',
      '任职要求：有电商视觉或品牌设计经验，审美稳定，能围绕品牌调性和转化目标输出高质量视觉方案。',
    ].join('\n'),
    config: config(
      'hanlin-brand-visual-design',
      '品牌视觉设计',
      '负责品牌视觉、电商详情页、广告素材、包装和活动视觉，兼顾品牌一致性与转化效果。',
      ['1年以上品牌视觉或电商设计经验', '熟练使用主流设计工具', '有详情页、广告图或包装设计作品'],
      ['运动户外/消费品设计经验', '跨境电商平台素材经验', '会用数据反馈优化视觉'],
      ['作品集缺失或质量不稳定', '只会套模板缺少品牌思考', '缺少电商转化目标意识'],
      [
        { id: 'portfolio-quality', label: '作品质量', weight: 40, description: '作品是否体现审美、版式、细节和品牌一致性。' },
        { id: 'ecommerce-design', label: '电商视觉经验', weight: 25, description: '是否有详情页、广告素材、主图、A+ 页面等经验。' },
        { id: 'brand-thinking', label: '品牌思考', weight: 20, description: '是否能解释设计如何服务品牌定位和用户认知。' },
        { id: 'delivery-efficiency', label: '交付协作', weight: 15, description: '是否能按节奏交付并与运营、产品协作。' },
      ],
      `${strictEvidenceInstruction} 对设计岗位必须要求作品集证据，重点评估品牌一致性、电商素材经验和交付能力。`,
    ),
  },
  {
    id: 'hanlin-independent-site-operator',
    title: '双休跨境电商运营（独立站）',
    salary: '15-30K',
    meta: '1-3年 / 中专或中技 / 深圳龙岗坂田',
    jdText: [
      '双休跨境电商运营（独立站）',
      '岗位方向：负责独立站运营、选品、页面优化、广告投放协同、数据分析和转化提升。',
      '任职要求：有跨境电商独立站运营经验，熟悉 Shopify 或类似建站工具，能围绕流量、转化、客单价和复购做增长。',
    ].join('\n'),
    config: config(
      'hanlin-independent-site-operator',
      '双休跨境电商运营（独立站）',
      '负责跨境独立站运营增长，覆盖选品、页面、广告协同、数据分析和转化优化。',
      ['1年以上跨境电商或独立站运营经验', '熟悉 Shopify/独立站后台或类似工具', '能分析流量、转化、客单价等数据'],
      ['运动户外品类经验', '广告投放协同经验', '站外推广或内容营销经验'],
      ['只做平台运营缺少独立站经验', '缺少数据复盘证据', '无法说明增长动作与结果'],
      [
        { id: 'independent-site', label: '独立站运营经验', weight: 35, description: '是否实际负责过独立站商品、页面、活动和后台运营。' },
        { id: 'growth-data', label: '增长数据能力', weight: 30, description: '是否用数据定位问题并提升流量、转化、客单价或复购。' },
        { id: 'marketing-collab', label: '营销协同', weight: 20, description: '是否能和广告、内容、设计协同推进增长。' },
        { id: 'category-fit', label: '品类匹配', weight: 15, description: '是否有运动户外或相近消费品经验。' },
      ],
      `${strictEvidenceInstruction} 重点看独立站运营、增长数据、页面转化优化和跨境电商经验。`,
    ),
  },
  {
    id: 'hanlin-amazon-product-manager',
    title: '亚马逊产品经理人',
    salary: '10-15K',
    meta: '1-3年 / 大专 / 深圳龙岗坂田',
    jdText: [
      '亚马逊产品经理人',
      '岗位方向：围绕亚马逊平台进行选品、竞品分析、产品定义、Listing 协同、供应链跟进和销售反馈复盘。',
      '任职要求：有亚马逊产品、选品或运营相关经验，能理解平台规则、用户评价和市场机会。',
    ].join('\n'),
    config: config(
      'hanlin-amazon-product-manager',
      '亚马逊产品经理人',
      '负责亚马逊平台选品、产品定义、Listing 协同和销售反馈复盘。',
      ['1年以上亚马逊产品/选品/运营相关经验', '能进行竞品分析和市场机会判断', '熟悉 Listing、评价和平台基础规则'],
      ['爆品打造经验', '供应链沟通经验', '运动户外或家居品类经验'],
      ['只有店铺执行经验缺少产品判断', '无竞品/评价分析证据', '缺少结果数据'],
      [
        { id: 'amazon-knowledge', label: '亚马逊平台理解', weight: 25, description: '是否理解亚马逊平台规则、Listing、评价和运营指标。' },
        { id: 'selection-analysis', label: '选品与竞品分析', weight: 35, description: '是否能基于市场、竞品、评论和数据做产品机会判断。' },
        { id: 'product-followup', label: '产品跟进能力', weight: 25, description: '是否能推动产品定义、供应链、Listing 和上市。' },
        { id: 'result-proof', label: '结果证明', weight: 15, description: '是否有销量、排名、转化或利润等结果证据。' },
      ],
      `${strictEvidenceInstruction} 重点评估亚马逊选品、产品定义、Listing 协同和商业结果。`,
    ),
  },
  {
    id: 'hanlin-amazon-operator',
    title: '跨境电商亚马逊运营专员',
    salary: '**-**元',
    meta: '1-3年 / 本科 / 深圳龙岗坂田',
    jdText: [
      '跨境电商亚马逊运营专员',
      '本公司全部岗位都是双休。',
      '负责亚马逊新店铺/新品类从 0 到 1 的全流程运营，包括市场调研、选品分析、Listing 优化、关键词策略及推广落地。',
      '制定销售目标与增长计划，通过广告投放（SP/SD/SB）、促销活动（Coupon/Deal）等手段提升产品曝光与转化。',
      '监控店铺数据（流量、转化率、客单价、退货率等），定期复盘并优化运营策略，确保目标达成。',
      '对接供应链与物流团队，协调库存管理、发货时效及售后问题处理，保障店铺健康指标。',
      '研究平台政策与竞争对手动态，捕捉市场机会，推动新业务快速起量。',
      '任职要求：2年以上亚马逊独立运营经验，必须有新店铺/新品从0到1打爆案例（需附具体数据）。',
    ].join('\n'),
    config: config(
      'hanlin-amazon-operator',
      '跨境电商亚马逊运营专员',
      '负责亚马逊新店铺/新品类从 0 到 1 运营，覆盖选品、Listing、广告、数据复盘、供应链协同和店铺健康。',
      ['2年以上亚马逊独立运营经验', '有新店铺/新品从0到1案例', '熟悉 Listing 优化、关键词和广告投放', '能用运营数据复盘和优化'],
      ['运动户外、家居、3C 等品类经验', '站外推广经验', '供应链/物流协同经验', '多站点运营经验'],
      ['没有独立负责店铺或新品案例', '缺少销售/广告/转化等具体数据', '只做辅助执行且职责边界不清'],
      [
        { id: 'amazon-operation', label: '亚马逊独立运营', weight: 35, description: '是否独立负责过亚马逊店铺、新品或品类运营。' },
        { id: 'zero-to-one', label: '0到1起量经验', weight: 25, description: '是否有新店铺/新品从0到1起量并能提供数据。' },
        { id: 'ads-listing-data', label: '广告/Listing/数据', weight: 25, description: '是否掌握广告投放、Listing 优化、关键词策略和数据复盘。' },
        { id: 'supply-chain-service', label: '供应链与售后协同', weight: 15, description: '是否能协调库存、物流、售后和店铺健康指标。' },
      ],
      `${strictEvidenceInstruction} 重点看亚马逊独立运营、0到1打爆案例、广告 Listing 优化和数据结果。`,
    ),
  },
]

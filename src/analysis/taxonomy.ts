export interface TagDef {
  id: string
  label: string
  desc: string
}

export interface CategoryDef {
  id: string
  label: string
  desc: string
  tags: TagDef[]
}

const t = (id: string, label: string, desc: string): TagDef => ({ id, label, desc })

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'arg',
    label: '论证要素',
    desc: '议论文的论证构件',
    tags: [
      t('arg.thesis', '中心论点', '全文的核心主张'),
      t('arg.claim', '分论点', '支撑中心论点的下一级主张'),
      t('arg.question', '提出问题', '引出要讨论的问题、现象或矛盾'),
      t('arg.background', '背景交代', '交代讨论的背景、语境或前情'),
      t('arg.definition', '概念界定', '定义或解释关键概念'),
      t('arg.premise', '前提假设', '论证所依赖的前提（含隐含前提）'),
      t('arg.evidence-fact', '事实论据', '事例、史实、新闻、亲身经历'),
      t('arg.evidence-data', '数据论据', '统计数字、调查或研究结果'),
      t('arg.evidence-authority', '引证论据', '名言、经典、专家或文献观点'),
      t('arg.reasoning', '分析推理', '由论据推出结论的分析过程'),
      t('arg.concession', '让步', '承认对立观点的合理之处'),
      t('arg.counter', '反驳', '指出对立观点的错误'),
      t('arg.counterexample', '反例', '用反面事例检验或削弱某个论断'),
      t('arg.qualification', '限定条件', '限定论断的适用范围或条件'),
      t('arg.conclusion', '结论', '论证得出的结果或判断'),
      t('arg.solution', '对策建议', '提出解决办法、倡议或行动'),
    ],
  },
  {
    id: 'method',
    label: '论证方法',
    desc: '组织论据、推出论点的方式',
    tags: [
      t('method.example', '举例论证', '用具体事例证明观点'),
      t('method.reason', '道理论证', '用道理、常识、原理证明观点'),
      t('method.quote', '引用论证', '引用名言、经典、权威观点'),
      t('method.contrast', '对比论证', '正反、古今、彼此对照'),
      t('method.analogy', '类比论证', '借相似事物推理（含比喻论证）'),
      t('method.causal', '因果论证', '分析原因与结果的关系'),
      t('method.hypothetical', '假设论证', '假设某种情形并推演后果'),
      t('method.reductio', '归谬法', '顺着对方逻辑推出荒谬结论'),
      t('method.progressive', '层进论证', '层层递进、逐步深入'),
      t('method.classification', '分类论证', '分门别类、分层次展开'),
      t('method.induction', '归纳', '由多个个别事实概括一般结论'),
      t('method.deduction', '演绎', '由一般原理推出个别结论'),
    ],
  },
  {
    id: 'struct',
    label: '结构功能',
    desc: '句段在篇章中的位置与作用',
    tags: [
      t('struct.opening', '开篇引入', '开头引出话题'),
      t('struct.topic', '总起/中心句', '统领一段或一部分的句子'),
      t('struct.elaboration', '展开阐释', '对上文的进一步解释、展开'),
      t('struct.supplement', '补充说明', '补充细节、例外或附加信息'),
      t('struct.transition', '过渡', '连接前后内容'),
      t('struct.bridge', '承上启下', '既总结上文又引出下文'),
      t('struct.turn', '转折', '话锋或语义转向'),
      t('struct.foreshadow', '铺垫/伏笔', '为后文做准备'),
      t('struct.climax', '升华', '把内容推向更高的意义层面'),
      t('struct.summary', '总结收束', '归纳、收束上文'),
      t('struct.echo', '首尾呼应', '与前文（尤其开头）相呼应'),
      t('struct.title-point', '点题', '直接点明题旨'),
    ],
  },
  {
    id: 'expr',
    label: '表达方式',
    desc: '五种基本表达方式',
    tags: [
      t('expr.narration', '叙述', '交代人物、事件的经过'),
      t('expr.description', '描写', '描绘人物、景物、场面的状态'),
      t('expr.argument', '议论', '发表看法、评价、判断'),
      t('expr.lyric', '抒情', '抒发情感'),
      t('expr.exposition', '说明', '客观解说事物的特征、原理'),
    ],
  },
  {
    id: 'rhet',
    label: '修辞手法',
    desc: '词句层面的修辞',
    tags: [
      t('rhet.metaphor', '比喻', '明喻、暗喻、借喻'),
      t('rhet.personification', '拟人', '把物当作人来写'),
      t('rhet.parallelism', '排比', '三项及以上结构相似的句子成分'),
      t('rhet.antithesis', '对偶', '字数相等、结构相同的对称句'),
      t('rhet.hypophora', '设问', '自问自答'),
      t('rhet.rhetorical-q', '反问', '以问句表达确定的意思'),
      t('rhet.hyperbole', '夸张', '有意夸大或缩小'),
      t('rhet.repetition', '反复', '有意重复词句以强调'),
      t('rhet.contrast', '对比映衬', '用相反或相关事物互相衬托'),
      t('rhet.climax', '层递', '按程度、范围逐层推进'),
      t('rhet.metonymy', '借代', '以相关事物代替本体'),
      t('rhet.synesthesia', '通感', '感官之间的挪移'),
      t('rhet.irony', '反语反讽', '正话反说或反话正说'),
      t('rhet.allusion', '用典', '引用典故、成语、诗文'),
      t('rhet.pun', '双关', '一语兼顾两层意思'),
    ],
  },
  {
    id: 'craft',
    label: '写作技法',
    desc: '叙事、描写与谋篇的技巧',
    tags: [
      t('craft.hook', '开头钩子', '用悬念、反常、冲突抓住注意力'),
      t('craft.anecdote', '故事化', '用小故事承载观点'),
      t('craft.detail', '细节描写', '抓住细微之处刻画'),
      t('craft.scene', '场景描写', '环境、场面的描绘'),
      t('craft.psychology', '心理描写', '刻画内心活动'),
      t('craft.dialogue', '对话描写', '用人物语言推动或刻画'),
      t('craft.sketch', '白描', '简练勾勒、不加渲染'),
      t('craft.side', '侧面烘托', '借他人他物衬托主体'),
      t('craft.small-big', '以小见大', '从小处折射大主题'),
      t('craft.suppress', '欲扬先抑', '先抑后扬或先扬后抑'),
      t('craft.symbol', '象征/托物言志', '借具体事物寄托抽象意义'),
      t('craft.imagery', '意象', '富含情感或意义的物象'),
      t('craft.suspense', '悬念', '设置疑问吸引读者往下读'),
    ],
  },
  {
    id: 'tone',
    label: '语气立场',
    desc: '作者的语气与立场强度',
    tags: [
      t('tone.assert', '断言', '语气确定、立场鲜明'),
      t('tone.hedge', '保留推测', '留有余地的判断'),
      t('tone.emphasis', '强调', '刻意加强语势'),
      t('tone.emotive', '情感渲染', '调动读者情绪'),
      t('tone.address', '对话读者', '直接呼告或与读者交流'),
      t('tone.skeptic', '质疑批判', '怀疑、批评的立场'),
      t('tone.humor', '幽默调侃', '轻松、诙谐的语气'),
    ],
  },
  {
    id: 'issue',
    label: '问题诊断',
    desc: '值得修改的地方',
    tags: [
      t('issue.weak', '论证薄弱', '论据不足以支撑论断'),
      t('issue.leap', '逻辑跳跃', '缺少中间推理环节'),
      t('issue.no-evidence', '缺少论据', '只有断言、没有支撑'),
      t('issue.overgeneral', '以偏概全', '概括过度或绝对化'),
      t('issue.inconsistent', '前后矛盾', '与上下文观点冲突'),
      t('issue.vague', '表述含糊', '语义不清、指代不明'),
      t('issue.redundant', '冗余重复', '与上文重复或可删减'),
      t('issue.cliche', '套话/AI腔', '空泛、模板化、堆砌的表达'),
      t('issue.off-topic', '偏离主题', '与中心论点关系不大'),
      t('issue.fact-check', '待核实', '事实、数据或引文需要核实'),
    ],
  },
]

export const TAGS = new Map<string, TagDef & { cat: string }>()
for (const c of CATEGORIES) for (const tg of c.tags) TAGS.set(tg.id, { ...tg, cat: c.id })

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]))

export function tagCat(id: string): string {
  return TAGS.get(id)?.cat ?? id.split('.')[0] ?? 'other'
}

export function tagLabel(id: string): string {
  return TAGS.get(id)?.label ?? id
}

/** 单元的主类别：优先取第一个标签的类别 */
export function primaryCat(tags: string[]): string {
  for (const id of tags) {
    const c = tagCat(id)
    if (CATEGORY_BY_ID.has(c)) return c
  }
  return 'other'
}

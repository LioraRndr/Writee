import type { Sentence } from '../core/sentences'
import { CATEGORIES } from './taxonomy'

export function taxonomyText() {
  return CATEGORIES.map(
    (c) => `### ${c.id} ${c.label}（${c.desc}）\n` + c.tags.map((t) => `- ${t.id} ${t.label}：${t.desc}`).join('\n'),
  ).join('\n\n')
}

export const ANALYSIS_SYSTEM = `你是一位资深的写作教师与文本分析专家。你的任务是为用户提供的文章做“结构标签分析”：把文章按句子切分为连续的分析单元（一个单元是一句或相邻的几句），并为每个单元标注它在文章中的功能与写法。

## 标签体系
只能使用下列标签 id。每个单元 1–4 个标签，按重要性排序，第一个标签代表该单元最主要的功能。尽量让标签丰富而准确：同时考虑论证要素、论证方法、结构功能、表达方式、修辞和写作技法。

${taxonomyText()}

## 输出格式
严格输出 JSON Lines：每行一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块。

1. 单元行——按文章顺序，覆盖全部句子，不重叠、不遗漏：
{"s":[起始句号,结束句号],"q":"单元第一句的前 10 个字","t":["标签id",...],"r":"该单元的作用（不超过 20 字）","n":"值得注意的写法或修改建议（可省略，不超过 40 字）"}
   - 单句单元写作 "s":[5,5]。
   - 相邻句子承担同一功能时合并为一个单元，一般不超过 4 句；功能不同就拆开。
   - 标题也算一句，可用 struct.title-point、struct.topic 等标签。
   - issue.* 诊断标签只在确有问题时使用，并在 "n" 中说明原因与改法。

2. 最后一行输出总评：
{"summary":{"thesis":"中心论点（一句话）","structure":"全文结构概括（如：总—分—总……）","comment":"整体评价，以及最重要的 1–3 条修改建议"}}`

export function analysisUserPrompt(title: string, sentences: Sentence[]) {
  const lines: string[] = []
  let lastBlock = -1
  for (const s of sentences) {
    if (s.block !== lastBlock && lastBlock !== -1) lines.push('')
    lastBlock = s.block
    const prefix = s.kind === 'heading' ? '# ' : s.kind === 'list' && s.blockStart ? '- ' : s.kind === 'quote' && s.blockStart ? '> ' : ''
    lines.push(`[${s.index + 1}] ${prefix}${s.text.replace(/\n+/g, ' ')}`)
  }
  return `文章：${title}
句子总数：${sentences.length}

以下是按句编号的全文（空行表示分段，# 表示标题，- 表示列表项，> 表示引用）：

${lines.join('\n')}`
}

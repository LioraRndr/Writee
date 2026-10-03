import type { Analysis, AnalysisSummary, Unit } from '../core/types'
import { splitSentences, sentenceAt, type Sentence } from '../core/sentences'
import { uid } from '../core/uid'
import { TAGS } from './taxonomy'

/**
 * Writee 结构分析文件格式（writee-structure/1）
 *
 * {
 *   "format": "writee-structure/1",
 *   "source": { "title": "文章名", "sentences": 128, "chars": 5321 },
 *   "generatedBy": "claude-opus-5-5",
 *   "createdAt": "2026-10-03T08:00:00.000Z",
 *   "summary": { "thesis": "中心论点", "structure": "结构概括", "comment": "总评与建议" },
 *   "units": [
 *     { "sentences": [3, 4], "text": "单元开头的原文", "tags": ["arg.claim", "method.contrast"],
 *       "role": "该单元的作用", "note": "写法或修改建议" }
 *   ]
 * }
 *
 * - sentences：单元覆盖的句子序号区间（从 1 开始，闭区间），句子按 Writee 的规则切分；
 * - text：单元开头的一小段原文，用于在文章改动后重新定位（可选但推荐）；
 * - tags：标签 id，见 taxonomy.ts；第一个标签为主标签。
 *
 * AI 流式输出时使用更紧凑的 JSON Lines 形式：
 *   {"s":[3,4],"q":"单元开头","t":["arg.claim"],"r":"作用","n":"建议"}
 *   {"summary":{"thesis":"…","structure":"…","comment":"…"}}
 */
export const FORMAT_ID = 'writee-structure/1'

export interface FileUnit {
  sentences: number[]
  text?: string
  tags: string[]
  role?: string
  note?: string
}

export interface StructureFile {
  format: typeof FORMAT_ID
  source?: { title?: string; sentences?: number; chars?: number }
  generatedBy?: string
  createdAt?: string
  summary?: AnalysisSummary
  units: FileUnit[]
}

export function exportAnalysis(analysis: Analysis, text: string, title: string): StructureFile {
  const sentences = splitSentences(text)
  const units: FileUnit[] = analysis.units.map((u) => {
    const a = sentenceAt(sentences, u.from)
    const b = sentenceAt(sentences, Math.max(u.from, u.to - 1))
    const first = a ? a.index + 1 : 1
    const last = b ? Math.max(first, b.index + 1) : first
    const out: FileUnit = {
      sentences: [first, last],
      text: text.slice(u.from, Math.min(u.to, u.from + 24)),
      tags: u.tags,
    }
    if (u.role) out.role = u.role
    if (u.note) out.note = u.note
    return out
  })
  return {
    format: FORMAT_ID,
    source: { title, sentences: sentences.length, chars: text.length },
    generatedBy: analysis.model,
    createdAt: new Date(analysis.createdAt).toISOString(),
    summary: analysis.summary,
    units,
  }
}

const norm = (s: string) => s.replace(/[\s*_`#>\-[\]()]/g, '')

/** 把句子区间（1 起）定位为文本范围；若提供了开头原文，则用它校正 */
export function locateUnit(
  sentences: Sentence[],
  text: string,
  range: number[],
  quote?: string,
): { from: number; to: number } | null {
  const a = Math.max(1, Math.round(range[0] ?? 1))
  const b = Math.max(a, Math.round(range[range.length - 1] ?? a))
  let sa = sentences[a - 1]
  let sb = sentences[Math.min(b, sentences.length) - 1]
  const q = quote ? norm(quote).slice(0, 6) : ''
  // 开头原文出现在句子的前几个字中即视为匹配（允许“1.”之类的编号前缀）
  const matches = (s: Sentence | undefined) => !!s && norm(s.text).slice(0, q.length + 8).includes(q)
  if (q && !matches(sa)) {
    // 序号对不上：在附近寻找以该原文开头的句子
    let best: Sentence | null = null
    let bestDist = Infinity
    for (const s of sentences) {
      if (matches(s)) {
        const d = Math.abs(s.index - (a - 1))
        if (d < bestDist) {
          bestDist = d
          best = s
        }
      }
    }
    if (best) {
      const span = b - a
      sa = best
      sb = sentences[Math.min(sentences.length - 1, best.index + span)]
    }
  }
  if (!sa || !sb) return null
  if (sb.to <= sa.from) sb = sa
  return { from: sa.from, to: Math.min(text.length, sb.to) }
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const id = t.trim()
    if (TAGS.has(id)) out.push(id)
    else {
      // 宽容：接受中文标签名
      for (const [k, v] of TAGS) if (v.label === id) out.push(k)
    }
  }
  return [...new Set(out)]
}

export interface ParsedLine {
  unit?: { range: number[]; quote?: string; tags: string[]; role?: string; note?: string }
  summary?: AnalysisSummary
}

/** 解析一行 JSON Lines 输出 */
export function parseLine(line: string): ParsedLine | null {
  let s = line.trim()
  if (!s || s.startsWith('```')) return null
  s = s.replace(/,$/, '')
  if (!s.startsWith('{')) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(s)
  } catch {
    return null
  }
  if (obj.summary && typeof obj.summary === 'object') return { summary: obj.summary as AnalysisSummary }
  const range = (obj.s ?? obj.sentences) as unknown
  const tags = cleanTags(obj.t ?? obj.tags)
  if (!Array.isArray(range) || !range.length || !tags.length) return null
  return {
    unit: {
      range: range.map(Number).filter((n) => Number.isFinite(n)),
      quote: (obj.q ?? obj.text) as string | undefined,
      tags,
      role: (obj.r ?? obj.role) as string | undefined,
      note: (obj.n ?? obj.note) as string | undefined,
    },
  }
}

/** 导入：接受标准 JSON 文件，或 AI 输出的 JSON Lines */
export function importAnalysis(raw: string, text: string): Analysis {
  const sentences = splitSentences(text)
  const units: Unit[] = []
  let summary: AnalysisSummary | undefined
  let model: string | undefined
  const addUnit = (u: NonNullable<ParsedLine['unit']>) => {
    const loc = locateUnit(sentences, text, u.range, u.quote)
    if (!loc) return
    units.push({ id: uid('u'), from: loc.from, to: loc.to, tags: u.tags, role: u.role, note: u.note })
  }
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  let parsedFile: StructureFile | null = null
  if (trimmed.startsWith('{') && /"units"\s*:/.test(trimmed)) {
    try {
      parsedFile = JSON.parse(trimmed)
    } catch {
      parsedFile = null
    }
  }
  if (parsedFile && Array.isArray(parsedFile.units)) {
    summary = parsedFile.summary
    model = parsedFile.generatedBy
    for (const fu of parsedFile.units) {
      const tags = cleanTags(fu.tags)
      if (!tags.length || !Array.isArray(fu.sentences)) continue
      addUnit({ range: fu.sentences, quote: fu.text, tags, role: fu.role, note: fu.note })
    }
  } else {
    for (const line of trimmed.split('\n')) {
      const p = parseLine(line)
      if (p?.summary) summary = p.summary
      if (p?.unit) addUnit(p.unit)
    }
  }
  if (!units.length) throw new Error('没有识别到任何分析单元。请确认内容为 writee-structure/1 JSON 或 JSON Lines。')
  units.sort((a, b) => a.from - b.from)
  return { units, summary, model, createdAt: Date.now() }
}

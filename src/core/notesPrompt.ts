import type { DocData, Tag } from './types'
import { tagNumbers } from '../store/docStore'
import { sectionPath, type SectionTree } from './sections'
import { splitSentences } from './sentences'

export type CopyScope = 'full' | 'paragraphs' | 'quotes'

export interface CopyOptions {
  scope: CopyScope
  instruction: string
  listEdits: boolean
}

export const INSTRUCTION_PRESETS: { label: string; text: string }[] = [
  { label: '不加指令', text: '' },
  { label: '按批注修改全文', text: '请根据下面的批注修改文章，输出修改后的完整全文（Markdown）。' },
  { label: '只改相关段落', text: '请根据下面的批注逐条修改，只输出改动过的段落，并标明对应的批注序号。' },
  { label: '先给修改建议', text: '请针对下面每一条批注给出具体的修改建议和改写示例，先不要改动全文。' },
]

export const EDIT_REMINDER = '我做了一些修改，注意不要替换成原来的文字，必要的话可以修改。'

interface Block {
  from: number
  to: number
}

/** 以空行 / 标题为界切分段落块 */
function blocks(text: string): Block[] {
  const out: Block[] = []
  let start = -1
  let pos = 0
  let inFence = false
  const lines = text.split('\n')
  for (const line of lines) {
    const end = pos + line.length
    const fence = /^\s{0,3}(```|~~~)/.test(line)
    const blank = !line.trim() && !inFence
    const heading = !inFence && /^\s{0,3}#{1,6}\s/.test(line)
    if (blank || heading) {
      if (start >= 0) out.push({ from: start, to: pos - 1 })
      start = -1
      if (heading) out.push({ from: pos, to: end })
    } else if (start < 0) start = pos
    if (fence) inFence = !inFence
    pos = end + 1
  }
  if (start >= 0) out.push({ from: start, to: text.length })
  return out.filter((b) => b.to > b.from)
}

/** 在 [from, to) 的文本中插入标签标记 */
function withMarkers(text: string, from: number, to: number, tags: Tag[], nums: Map<string, number>) {
  const events: { pos: number; open: boolean; n: number; len: number }[] = []
  for (const t of tags) {
    if (t.to <= from || t.from >= to) continue
    const n = nums.get(t.id) ?? 0
    events.push({ pos: Math.max(from, t.from), open: true, n, len: t.to - t.from })
    events.push({ pos: Math.min(to, t.to), open: false, n, len: t.to - t.from })
  }
  events.sort((a, b) => a.pos - b.pos || (a.open === b.open ? (a.open ? b.len - a.len : a.len - b.len) : a.open ? 1 : -1))
  let out = ''
  let pos = from
  for (const e of events) {
    out += text.slice(pos, e.pos) + (e.open ? `【${e.n}】` : `【/${e.n}】`)
    pos = e.pos
  }
  return out + text.slice(pos, to)
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function buildNotesPrompt(
  data: DocData,
  tree: SectionTree,
  title: string,
  noteIds: string[],
  opts: CopyOptions,
): string {
  const text = data.text
  const nums = tagNumbers(data.tags)
  const tagById = new Map(data.tags.map((t) => [t.id, t]))
  const notes = data.notes
    .filter((n) => noteIds.includes(n.id))
    .map((n) => ({ ...n, tags: n.tagIds.map((id) => tagById.get(id)).filter((t): t is Tag => !!t).sort((a, b) => a.from - b.from) }))
    .sort((a, b) => (a.tags[0]?.from ?? Infinity) - (b.tags[0]?.from ?? Infinity) || a.created - b.created)
  const usedTags = [...new Map(notes.flatMap((n) => n.tags).map((t) => [t.id, t])).values()].sort((a, b) => a.from - b.from)

  const parts: string[] = []
  if (opts.instruction.trim()) parts.push(opts.instruction.trim())

  const docTitle = title.replace(/\.(md|markdown|txt)$/i, '')
  // 纳入上下文的范围（用于筛选修改记录）
  let ranges: Block[] = []

  if (opts.scope === 'quotes') {
    parts.push(`以下是我对文章《${docTitle}》的批注，每条批注后附有对应的原文。`)
  } else {
    parts.push(`以下是我对文章《${docTitle}》的批注。原文中用【n】…【/n】标出了每个批注对应的文字。`)
    let body: string
    if (opts.scope === 'full') {
      body = withMarkers(text, 0, text.length, usedTags, nums).trim()
      ranges = [{ from: 0, to: text.length }]
    } else {
      const bs = blocks(text)
      const picked = bs.filter((b) => usedTags.some((t) => t.from < b.to && t.to > b.from))
      ranges = picked
      const out: string[] = []
      let lastPath = ''
      let lastIdx = -2
      for (const b of picked) {
        const idx = bs.indexOf(b)
        const path = sectionPath(tree, b.from)
          .filter((s) => s.heading && s !== tree.title && s.heading.from !== b.from)
          .map((s) => s.heading!.text)
          .join(' › ')
        if (out.length && idx !== lastIdx + 1) out.push('……')
        const para = withMarkers(text, b.from, b.to, usedTags, nums).trim()
        out.push(path && path !== lastPath ? `（位于：${path}）\n${para}` : para)
        lastPath = path
        lastIdx = idx
      }
      body = out.join('\n\n')
    }
    parts.push(`<原文>\n${body}\n</原文>`)
  }

  const noteLines: string[] = []
  notes.forEach((n, i) => {
    const refs = n.tags.length
      ? n.tags
          .map((t) => `【${nums.get(t.id)}】「${clip(text.slice(t.from, t.to), opts.scope === 'quotes' ? 200 : 36)}」`)
          .join(' ')
      : '（针对全文）'
    const body = n.text.trim() || '（未填写内容）'
    noteLines.push(`${i + 1}. ${refs}\n   → ${body.replace(/\n/g, '\n     ')}`)
  })
  parts.push(`<批注>\n${noteLines.join('\n')}\n</批注>`)

  if (data.edits.length) {
    let reminder = EDIT_REMINDER
    if (opts.listEdits) {
      const sentences = splitSentences(text)
      const inScope = (e: Block) =>
        opts.scope === 'quotes'
          ? usedTags.some((t) => e.from <= t.to && e.to >= t.from)
          : ranges.some((r) => e.from <= r.to && e.to >= r.from)
      const picked: string[] = []
      const seen = new Set<number>()
      for (const e of data.edits) {
        if (!inScope(e)) continue
        for (const s of sentences) {
          if (s.to < e.from || s.from > e.to || seen.has(s.index)) continue
          seen.add(s.index)
          picked.push(s.text)
        }
      }
      if (picked.length) {
        const shown = picked.slice(0, 12).map((s) => `- 「${clip(s, 80)}」`)
        if (picked.length > 12) shown.push(`- ……等共 ${picked.length} 处`)
        reminder += '改动涉及的句子：\n' + shown.join('\n')
      }
    }
    parts.push(reminder)
  }

  return parts.join('\n\n') + '\n'
}

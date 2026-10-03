export type SentenceKind = 'heading' | 'para' | 'list' | 'quote'

export interface Sentence {
  index: number
  from: number
  to: number
  text: string
  kind: SentenceKind
  /** 是否为所在段落/块的第一句 */
  blockStart: boolean
  /** 所属块的序号，用于在提示词中还原分段 */
  block: number
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+/
const LIST_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/
const QUOTE_RE = /^ {0,3}(?:>[ \t]?)+/
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const TABLE_RE = /^\s*\|.*\|\s*$/

const TERMINATORS = new Set(['。', '！', '？', '!', '?', '…'])
const CLOSERS = new Set(['”', '’', '」', '』', '）', ')', '】', '》', '"', "'", '*', '_', '〕'])

interface Block {
  kind: SentenceKind
  /** 内容片段：[from, to) */
  parts: [number, number][]
}

function collectBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let pos = 0
  let fence: string | null = null
  let cur: Block | null = null
  let lineNo = 0
  const len = text.length
  const flush = () => {
    if (cur && cur.parts.length) blocks.push(cur)
    cur = null
  }
  while (pos <= len) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = len
    const line = text.slice(pos, end)
    if (lineNo === 0 && line === '---') {
      const close = text.indexOf('\n---', end)
      if (close > 0) {
        const after = text.indexOf('\n', close + 4)
        pos = after < 0 ? len + 1 : after + 1
        lineNo++
        continue
      }
    }
    lineNo++
    const fm = FENCE_RE.exec(line)
    if (fence) {
      if (fm && fm[1][0] === fence[0] && line.trim() === fm[1]) fence = null
      pos = end + 1
      continue
    }
    if (fm) {
      flush()
      fence = fm[1]
      pos = end + 1
      continue
    }
    if (!line.trim() || HR_RE.test(line) || TABLE_RE.test(line) || /^\s*<\/?[a-zA-Z!]/.test(line)) {
      flush()
      pos = end + 1
      continue
    }
    let m: RegExpExecArray | null
    if ((m = HEADING_RE.exec(line))) {
      flush()
      const contentEnd = pos + line.replace(/[ \t]+#+[ \t]*$/, '').length
      blocks.push({ kind: 'heading', parts: [[pos + m[0].length, contentEnd]] })
    } else if ((m = LIST_RE.exec(line))) {
      flush()
      cur = { kind: 'list', parts: [[pos + m[0].length, end]] }
    } else if ((m = QUOTE_RE.exec(line))) {
      if (!cur || cur.kind !== 'quote') {
        flush()
        cur = { kind: 'quote', parts: [] }
      }
      if (pos + m[0].length < end) cur.parts.push([pos + m[0].length, end])
    } else {
      const indent = /^\s*/.exec(line)![0].length
      if (!cur || cur.kind === 'quote') {
        flush()
        cur = { kind: 'para', parts: [] }
      }
      cur.parts.push([pos + indent, end])
    }
    pos = end + 1
  }
  flush()
  return blocks
}

function isLatinPeriodEnd(text: string, i: number, end: number) {
  // 英文句点：后接空白或结束，且前一个字符不是数字/单字母缩写
  const next = i + 1 < end ? text[i + 1] : ''
  if (next && !/\s/.test(next) && !CLOSERS.has(next)) return false
  const prev = text[i - 1] ?? ''
  if (/\d/.test(prev) && /\d/.test(next)) return false
  const word = /([A-Za-z]+)$/.exec(text.slice(Math.max(0, i - 6), i))
  if (word && /^(Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e|No|Fig)$/i.test(word[1])) return false
  if (word && word[1].length === 1 && /[A-Z]/.test(word[1])) return false
  return true
}

/** 把文本切分为句子；保留原文位置 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = []
  const blocks = collectBlocks(text)
  blocks.forEach((b, bi) => {
    let first = true
    const push = (from: number, to: number) => {
      while (from < to && /\s/.test(text[from])) from++
      while (to > from && /\s/.test(text[to - 1])) to--
      if (to <= from) return
      const t = text.slice(from, to)
      if (!/[\p{L}\p{N}]/u.test(t)) {
        // 纯标点：并入上一句
        const last = out[out.length - 1]
        if (last && last.block === bi) {
          last.to = to
          last.text = text.slice(last.from, to)
        }
        return
      }
      out.push({ index: out.length, from, to, text: t, kind: b.kind, blockStart: first, block: bi })
      first = false
    }
    if (b.kind === 'heading') {
      push(b.parts[0][0], b.parts[0][1])
      return
    }
    // 把多行内容视为连续文本切分（软换行不打断句子）
    const start = b.parts[0][0]
    const stop = b.parts[b.parts.length - 1][1]
    let sFrom = start
    const inPart = (i: number) => b.parts.some(([f, t]) => i >= f && i < t)
    for (let i = start; i < stop; i++) {
      if (!inPart(i)) continue
      const ch = text[i]
      let isEnd = false
      if (TERMINATORS.has(ch)) {
        isEnd = true
        // 连续的终止符（如 ……、？！）
        while (i + 1 < stop && TERMINATORS.has(text[i + 1])) i++
      } else if (ch === '.' && isLatinPeriodEnd(text, i, stop)) {
        isEnd = true
      }
      if (isEnd) {
        while (i + 1 < stop && CLOSERS.has(text[i + 1])) i++
        push(sFrom, i + 1)
        sFrom = i + 1
      }
    }
    push(sFrom, stop)
  })
  out.forEach((s, i) => (s.index = i))
  return out
}

/** 找到包含 pos 的句子 */
export function sentenceAt(sentences: Sentence[], pos: number): Sentence | null {
  let lo = 0
  let hi = sentences.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = sentences[mid]
    if (pos < s.from) hi = mid - 1
    else if (pos > s.to) lo = mid + 1
    else return s
  }
  // 落在句间空白：取前一句
  return hi >= 0 ? sentences[hi] : null
}

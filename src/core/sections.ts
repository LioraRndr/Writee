import type { HeadingAnchor } from './types'

export interface Heading {
  level: number
  text: string
  /** 标题行起点 */
  from: number
  /** 标题行终点（不含换行） */
  lineEnd: number
}

export interface Section {
  id: string
  heading: Heading | null
  level: number
  /** 整个小节（含子小节）的范围 [from, to) */
  from: number
  to: number
  /** 自身内容（标题行 + 引言正文，不含子小节）的范围，已去除尾部空白 */
  ownFrom: number
  ownTo: number
  depth: number
  parent: Section | null
  children: Section[]
}

export interface SectionTree {
  /** 文首无标题部分 */
  preamble: Section | null
  /** 文档标题（唯一的 H1，位于最前） */
  title: Section | null
  /** 顶层卡片 */
  roots: Section[]
  /** 按文档顺序排列的全部小节（不含 preamble） */
  flat: Section[]
  byId: Map<string, Section>
  headings: Heading[]
}

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

export function parseHeadings(text: string): Heading[] {
  const out: Heading[] = []
  let pos = 0
  let fence: string | null = null
  let lineNo = 0
  const len = text.length
  while (pos <= len) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = len
    const line = text.slice(pos, end)
    if (lineNo === 0 && line === '---') {
      // front matter
      const close = text.indexOf('\n---', end)
      if (close > 0) {
        const after = text.indexOf('\n', close + 4)
        pos = after < 0 ? len + 1 : after + 1
        lineNo++
        continue
      }
    }
    const fm = FENCE_RE.exec(line)
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && line.trim() === fm[1]) fence = null
    } else if (fm) {
      fence = fm[1]
    } else {
      const m = HEADING_RE.exec(line)
      if (m) out.push({ level: m[1].length, text: (m[2] ?? '').trim(), from: pos, lineEnd: end })
    }
    pos = end + 1
    lineNo++
  }
  return out
}

function trimEnd(text: string, from: number, to: number) {
  while (to > from && /\s/.test(text[to - 1])) to--
  return to
}

function trimStart(text: string, from: number, to: number) {
  while (from < to && (text[from] === '\n' || text[from] === '\r')) from++
  return from
}

let anchorSeq = 0
export function newAnchorId() {
  anchorSeq++
  return 'h' + Date.now().toString(36) + anchorSeq.toString(36)
}

/**
 * 解析小节树。anchors 为上一次的标题锚点（已经过位置映射），
 * 与新标题按位置匹配以保持 id 稳定；返回新的锚点列表。
 */
export function buildSections(text: string, anchors: HeadingAnchor[]): { tree: SectionTree; anchors: HeadingAnchor[] } {
  const headings = parseHeadings(text)
  const anchorByPos = new Map<number, string>()
  for (const a of anchors) if (!anchorByPos.has(a.pos)) anchorByPos.set(a.pos, a.id)
  const used = new Set<string>()
  const newAnchors: HeadingAnchor[] = []
  const ids = headings.map((h) => {
    let id = anchorByPos.get(h.from)
    if (!id || used.has(id)) id = newAnchorId()
    used.add(id)
    newAnchors.push({ id, pos: h.from })
    return id
  })

  const byId = new Map<string, Section>()
  const flat: Section[] = []
  const roots: Section[] = []
  const stack: Section[] = []

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    const parent = stack.length ? stack[stack.length - 1] : null
    const s: Section = {
      id: ids[i],
      heading: h,
      level: h.level,
      from: h.from,
      to: text.length,
      ownFrom: h.from,
      ownTo: text.length,
      depth: parent ? parent.depth + 1 : 0,
      parent,
      children: [],
    }
    if (parent) parent.children.push(s)
    else roots.push(s)
    stack.push(s)
    flat.push(s)
    byId.set(s.id, s)
  }

  // 计算范围：小节结束于下一个同级或更高级标题
  for (let i = 0; i < flat.length; i++) {
    const s = flat[i]
    let end = text.length
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].level <= s.level) {
        end = flat[j].from
        break
      }
    }
    s.to = end
    const ownEnd = i + 1 < flat.length && flat[i + 1].from < end ? flat[i + 1].from : end
    s.ownTo = trimEnd(text, s.from, ownEnd)
  }

  let preamble: Section | null = null
  const firstFrom = flat.length ? flat[0].from : text.length
  if (firstFrom > 0 || flat.length === 0) {
    const pFrom = trimStart(text, 0, firstFrom)
    const pTo = trimEnd(text, 0, firstFrom)
    if (pTo > pFrom || flat.length === 0) {
      preamble = {
        id: '__preamble',
        heading: null,
        level: 0,
        from: 0,
        to: firstFrom,
        ownFrom: flat.length === 0 ? 0 : pFrom,
        ownTo: flat.length === 0 ? text.length : pTo,
        depth: 0,
        parent: null,
        children: [],
      }
    }
  }

  // 唯一且位于最前的 H1 视为文章标题
  let title: Section | null = null
  let cardRoots = roots
  const h1s = flat.filter((s) => s.level === 1)
  if (h1s.length === 1 && roots.length === 1 && roots[0] === h1s[0]) {
    title = roots[0]
    cardRoots = title.children
  }

  return {
    tree: { preamble, title, roots: cardRoots, flat, byId, headings },
    anchors: newAnchors,
  }
}

/** 小节在卡片视图中的层级深度（标题卡片之下从 0 开始） */
export function cardDepth(tree: SectionTree, s: Section) {
  return tree.title ? s.depth - 1 : s.depth
}

/** 返回卡片树（考虑标题卡片）中的兄弟列表 */
export function siblingsOf(tree: SectionTree, s: Section): Section[] {
  if (s.parent && s.parent !== tree.title) return s.parent.children
  return tree.roots
}

export function cardParent(tree: SectionTree, s: Section): Section | null {
  if (!s.parent || s.parent === tree.title) return null
  return s.parent
}

export function sectionPath(tree: SectionTree, pos: number): Section[] {
  const path: Section[] = []
  let list = tree.title ? [tree.title] : tree.roots
  if (tree.title && !(pos >= tree.title.from && pos < tree.title.to)) list = tree.roots
  for (;;) {
    const s = list.find((x) => pos >= x.from && pos < x.to)
    if (!s) break
    path.push(s)
    list = s.children
  }
  return path
}

export function structureKey(tree: SectionTree) {
  let k = tree.preamble ? 'p|' : ''
  k += tree.title ? 't' + tree.title.id + '|' : ''
  for (const s of tree.flat) k += s.id + ':' + s.level + ':' + (s.parent?.id ?? '') + ','
  return k
}

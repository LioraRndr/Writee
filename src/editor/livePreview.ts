import { syntaxTree } from '@codemirror/language'
import { EditorState, Facet, Prec, StateEffect, StateField, type Range, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { findMathRanges, type MathRange, type TextRange } from '../core/math'
import { findWikiLinks, linkKind, type WikiLink } from '../core/links'
import { MathWidget } from './MathWidget'
import { LinkWidget } from './LinkWidget'
import { TableWidget, focusTableAt } from './TableWidget'

/** 是否隐藏 Markdown 标记（实时预览）；关闭时为“源码模式”，仍保留排版样式 */
export const hideMarks = Facet.define<boolean, boolean>({ combine: (v) => (v.length ? v[v.length - 1] : true) })

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super()
  }
  eq(o: BulletWidget) {
    return o.depth === this.depth
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = ['•', '◦', '▪'][this.depth % 3]
    return s
  }
}

class OrderWidget extends WidgetType {
  constructor(readonly label: string) {
    super()
  }
  eq(o: OrderWidget) {
    return o.label === this.label
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-olnum'
    s.textContent = this.label
    return s
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super()
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos
  }
  toDOM(view: EditorView) {
    const s = document.createElement('span')
    s.className = 'cm-md-check' + (this.checked ? ' is-checked' : '')
    s.setAttribute('role', 'checkbox')
    s.setAttribute('aria-checked', String(this.checked))
    s.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const insert = this.checked ? '[ ]' : '[x]'
      view.dispatch({ changes: { from: this.pos, to: this.pos + 3, insert }, userEvent: 'input.toggle' })
    })
    return s
  }
  ignoreEvent() {
    return true
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-hr'
    return s
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super()
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image'
    if (/^(https?:|data:|blob:)/.test(this.src)) {
      const img = document.createElement('img')
      img.src = this.src
      img.alt = this.alt
      img.loading = 'lazy'
      img.onerror = () => {
        wrap.textContent = '🖼 ' + (this.alt || this.src)
        wrap.classList.add('is-broken')
      }
      wrap.appendChild(img)
    } else {
      wrap.textContent = '🖼 ' + (this.alt || this.src)
      wrap.classList.add('is-broken')
      wrap.title = this.src
    }
    return wrap
  }
}

function touches(state: EditorState, focused: boolean, from: number, to: number) {
  if (!focused) return false
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true
  return false
}

function lineTouched(state: EditorState, focused: boolean, pos: number) {
  if (!focused) return false
  const line = state.doc.lineAt(pos)
  return touches(state, true, line.from, line.to)
}

function listDepth(node: SyntaxNode) {
  let d = 0
  for (let p = node.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') d++
  return Math.max(0, d - 1)
}

const mathCache = new WeakMap<EditorState, MathRange[]>()

function mathRanges(state: EditorState) {
  const cached = mathCache.get(state)
  if (cached) return cached
  const excluded: TextRange[] = []
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (!['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Comment', 'Table', 'Image', 'URL'].includes(ref.name)) return
      excluded.push({ from: ref.from, to: ref.to })
      return false
    },
  })
  const ranges = findMathRanges(state.doc.toString(), excluded)
  mathCache.set(state, ranges)
  return ranges
}

const wikiCache = new WeakMap<EditorState, WikiLink[]>()

function wikiRanges(state: EditorState) {
  const cached = wikiCache.get(state)
  if (cached) return cached
  const excluded: TextRange[] = [...mathRanges(state)]
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (!['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Comment', 'Table', 'Image'].includes(ref.name)) return
      excluded.push({ from: ref.from, to: ref.to })
      return false
    },
  })
  const ranges = findWikiLinks(state.doc.toString(), excluded)
  wikiCache.set(state, ranges)
  return ranges
}

function isMathBlock(state: EditorState, range: MathRange) {
  if (!range.display) return false
  const first = state.doc.lineAt(range.from)
  const last = state.doc.lineAt(range.to)
  return !first.text.slice(0, range.from - first.from).trim() && !last.text.slice(range.to - last.from).trim()
}

function buildInline(view: EditorView): DecorationSet {
  const state = view.state
  const hide = state.facet(hideMarks)
  const focused = view.hasFocus
  const decos: Range<Decoration>[] = []
  const doc = state.doc
  const maths = mathRanges(state)
  const wikis = wikiRanges(state)
  const lineDecoDone = new Set<number>()
  const addLine = (pos: number, cls: string, attrs?: Record<string, string>) => {
    const line = doc.lineAt(pos)
    const key = line.from * 8 + cls.length
    if (lineDecoDone.has(key) && !attrs) return
    lineDecoDone.add(key)
    decos.push(Decoration.line({ class: cls, attributes: attrs }).range(line.from))
  }
  const hideRange = (from: number, to: number) => {
    if (to > from) decos.push(Decoration.replace({}).range(from, to))
  }
  const mark = (from: number, to: number, cls: string) => {
    if (to > from) decos.push(Decoration.mark({ class: cls }).range(from, to))
  }

  // 空行收窄，段落间距更自然
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      if (line.length === 0 || !line.text.trim()) decos.push(Decoration.line({ class: 'cm-blank' }).range(line.from))
      pos = line.to + 1
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const name = ref.name
        const node = ref.node
        if (/^ATXHeading(\d)$/.test(name)) {
          const lvl = name.slice(-1)
          addLine(ref.from, 'cm-h cm-h' + lvl)
          const active = lineTouched(state, focused, ref.from)
          for (let c = node.firstChild; c; c = c.nextSibling) {
            if (c.name !== 'HeaderMark') continue
            if (hide && !active) {
              let end = c.to
              while (end < ref.to && doc.sliceString(end, end + 1) === ' ') end++
              let start = c.from
              if (c.from > ref.from) while (start > ref.from && doc.sliceString(start - 1, start) === ' ') start--
              hideRange(start, end)
            } else mark(c.from, c.to, 'cm-md-mark cm-md-hmark')
          }
          return
        }
        if (/^SetextHeading(\d)$/.test(name)) {
          addLine(ref.from, 'cm-h cm-h' + name.slice(-1))
          return
        }
        if (maths.some((m) => ref.from >= m.from && ref.to <= m.to) || wikis.some((w) => ref.from >= w.from && ref.to <= w.to)) return false
        switch (name) {
          case 'Emphasis':
          case 'StrongEmphasis':
          case 'Strikethrough':
          case 'InlineCode': {
            const cls =
              name === 'Emphasis'
                ? 'cm-md-em'
                : name === 'StrongEmphasis'
                  ? 'cm-md-strong'
                  : name === 'Strikethrough'
                    ? 'cm-md-strike'
                    : 'cm-md-code-inline'
            mark(ref.from, ref.to, cls)
            const active = touches(state, focused, ref.from, ref.to)
            for (let c = node.firstChild; c; c = c.nextSibling) {
              if (c.name === 'EmphasisMark' || c.name === 'CodeMark' || c.name === 'StrikethroughMark') {
                if (hide && !active) hideRange(c.from, c.to)
                else mark(c.from, c.to, 'cm-md-mark')
              }
            }
            return
          }
          case 'Link': {
            const active = touches(state, focused, ref.from, ref.to)
            const marks: SyntaxNode[] = []
            let url = ''
            for (let c = node.firstChild; c; c = c.nextSibling) {
              if (c.name === 'LinkMark') marks.push(c)
              if (c.name === 'URL') url = doc.sliceString(c.from, c.to)
            }
            if (marks.length >= 2) {
              const textFrom = marks[0].to
              const textTo = marks[1].from
              const safe = linkKind(url) !== 'unsafe'
              decos.push(
                Decoration.mark({
                  class: 'cm-md-link',
                  attributes: safe ? { 'data-href': url, title: url + '（Ctrl/Cmd+点击打开）' } : { title: '不支持此链接协议' },
                }).range(textFrom, textTo),
              )
              if (hide && !active) {
                hideRange(marks[0].from, marks[0].to)
                hideRange(marks[1].from, ref.to)
              } else {
                mark(marks[0].from, marks[0].to, 'cm-md-mark')
                mark(marks[1].from, ref.to, 'cm-md-mark cm-md-url')
              }
            }
            return false
          }
          case 'Autolink':
          case 'URL': {
            if (node.parent?.name === 'Link' || node.parent?.name === 'Image') return
            const urlNode = node.getChild('URL')
            const url = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : doc.sliceString(ref.from, ref.to).replace(/^<|>$/g, '')
            if (linkKind(url) !== 'unsafe') {
              decos.push(
                Decoration.mark({ class: 'cm-md-link', attributes: { 'data-href': url, title: url + '（Ctrl/Cmd+点击打开）' } }).range(ref.from, ref.to),
              )
            } else mark(ref.from, ref.to, 'cm-md-link')
            if (name === 'Autolink') return false
            return
          }
          case 'Image': {
            const active = touches(state, focused, ref.from, ref.to)
            let src = ''
            const marks: SyntaxNode[] = []
            for (let c = node.firstChild; c; c = c.nextSibling) {
              if (c.name === 'URL') src = doc.sliceString(c.from, c.to)
              if (c.name === 'LinkMark') marks.push(c)
            }
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : ''
            if (hide && !active) {
              decos.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(ref.from, ref.to))
            } else mark(ref.from, ref.to, 'cm-md-mark')
            return false
          }
          case 'Blockquote': {
            for (let pos = ref.from; pos <= ref.to; ) {
              const line = doc.lineAt(pos)
              addLine(line.from, 'cm-md-quote')
              pos = line.to + 1
            }
            return
          }
          case 'QuoteMark': {
            if (hide && !lineTouched(state, focused, ref.from)) {
              let end = ref.to
              if (doc.sliceString(end, end + 1) === ' ') end++
              hideRange(ref.from, end)
            } else mark(ref.from, ref.to, 'cm-md-mark')
            return
          }
          case 'ListMark': {
            const item = node.parent
            const list = item?.parent
            const depth = listDepth(node)
            const line = doc.lineAt(ref.from)
            const active = lineTouched(state, focused, ref.from)
            const ordered = list?.name === 'OrderedList'
            if (hide && !active) {
              let end = ref.to
              if (doc.sliceString(end, end + 1) === ' ') end++
              const label = doc.sliceString(ref.from, ref.to)
              decos.push(
                Decoration.replace({
                  widget: ordered ? new OrderWidget(label) : new BulletWidget(depth),
                }).range(line.from, end),
              )
              addLine(line.from, 'cm-md-li', { style: `--li-depth:${depth}` })
            } else {
              mark(ref.from, ref.to, ordered ? 'cm-md-olmark' : 'cm-md-mark')
            }
            return
          }
          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(ref.from, ref.to))
            if (checked) addLine(ref.from, 'cm-md-done')
            if (hide && !lineTouched(state, focused, ref.from)) {
              let end = ref.to
              if (doc.sliceString(end, end + 1) === ' ') end++
              decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, ref.from) }).range(ref.from, end))
            } else mark(ref.from, ref.to, 'cm-md-mark')
            return
          }
          case 'HorizontalRule': {
            if (hide && !lineTouched(state, focused, ref.from)) {
              decos.push(Decoration.replace({ widget: new HrWidget() }).range(ref.from, ref.to))
              addLine(ref.from, 'cm-md-hr-line')
            } else mark(ref.from, ref.to, 'cm-md-mark')
            return
          }
          case 'FencedCode':
          case 'CodeBlock': {
            const first = doc.lineAt(ref.from).number
            const last = doc.lineAt(ref.to).number
            for (let n = first; n <= last; n++) {
              const l = doc.line(n)
              let cls = 'cm-md-codeblock'
              if (n === first) cls += ' is-first'
              if (n === last) cls += ' is-last'
              addLine(l.from, cls)
            }
            for (let c = node.firstChild; c; c = c.nextSibling) {
              if (c.name === 'CodeMark' || c.name === 'CodeInfo') mark(c.from, c.to, 'cm-md-mark cm-md-fence')
            }
            return false
          }
          case 'HTMLBlock':
          case 'Comment':
          case 'HTMLTag':
            mark(ref.from, ref.to, 'cm-md-html')
            return
          case 'Escape':
            if (hide && !touches(state, focused, ref.from, ref.to)) hideRange(ref.from, ref.from + 1)
            return
          case 'Table':
            return false
        }
      },
    })
  }
  for (const { from, to } of view.visibleRanges) {
    if (hide) {
      for (const m of maths) {
        if (m.to < from || m.from > to || isMathBlock(state, m) || touches(state, focused, m.from, m.to)) continue
        decos.push(Decoration.replace({ widget: new MathWidget(m.source, m.display, false, m.from) }).range(m.from, m.to))
      }
    }
    for (const w of wikis) {
      if (w.to < from || w.from > to) continue
      if (hide && !touches(state, focused, w.from, w.to)) {
        decos.push(Decoration.replace({ widget: new LinkWidget(w.label, w.target, w.from) }).range(w.from, w.to))
      } else {
        decos.push(
          Decoration.mark({ class: 'cm-md-link cm-md-wiki-source', attributes: { 'data-href': w.target, title: w.target } }).range(w.from, w.to),
        )
      }
    }
  }
  return Decoration.set(decos, true)
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInline(view)
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.startState.facet(hideMarks) !== u.state.facet(hideMarks)
      )
        this.decorations = buildInline(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)

// ---- 表格：块级替换必须来自 StateField ----

const focusEffect = EditorView.focusChangeEffect
const setFocused = StateEffect.define<boolean>()

const focusedField = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) return e.value
    return v
  },
})

function buildTables(state: EditorState): DecorationSet {
  if (!state.facet(hideMarks)) return Decoration.none
  const focused = state.field(focusedField)
  const decos: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'Table') return
      const from = state.doc.lineAt(ref.from).from
      const to = state.doc.lineAt(ref.to).to
      if (!touches(state, focused, from, to)) {
        decos.push(
          Decoration.replace({ widget: new TableWidget(state.doc.sliceString(from, to), from), block: true }).range(
            from,
            to,
          ),
        )
      }
      return false
    },
  })
  return Decoration.set(decos)
}

const tableField = StateField.define<DecorationSet>({
  create: (s) => buildTables(s),
  update(v, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setFocused)) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.startState.facet(hideMarks) !== tr.state.facet(hideMarks)
    )
      return buildTables(tr.state)
    return v
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** pos 所在的已渲染表格（未渲染成部件时返回 null） */
export function renderedTableAt(state: EditorState, pos: number) {
  let hit: { from: number; to: number } | null = null
  state.field(tableField, false)?.between(pos, pos, (from, to) => {
    hit = { from, to }
    return false
  })
  return hit as { from: number; to: number } | null
}

/** 上下方向键移入渲染表格时选中单元格，而不是把表格切回源码 */
function enterTable(forward: boolean) {
  return (view: EditorView) => {
    const sel = view.state.selection.main
    if (!sel.empty) return false
    const line = view.state.doc.lineAt(sel.head)
    const next = forward ? line.to + 1 : line.from - 1
    if (next < 0 || next > view.state.doc.length) return false
    // 只在光标处于紧邻表格的那一行的首 / 末视觉行时接管
    const target = view.moveVertically(sel, forward)
    if (view.state.doc.lineAt(target.head).number === line.number) return false
    const table = renderedTableAt(view.state, next)
    if (!table) return false
    return focusTableAt(view, table.from, forward ? 'first' : 'last')
  }
}

const tableKeys = Prec.high(
  keymap.of([
    { key: 'ArrowDown', run: enterTable(true) },
    { key: 'ArrowUp', run: enterTable(false) },
  ]),
)

function buildMathBlocks(state: EditorState): DecorationSet {
  if (!state.facet(hideMarks)) return Decoration.none
  const focused = state.field(focusedField)
  const decos: Range<Decoration>[] = []
  for (const m of mathRanges(state)) {
    if (!isMathBlock(state, m) || touches(state, focused, m.from, m.to)) continue
    const from = state.doc.lineAt(m.from).from
    const to = state.doc.lineAt(m.to).to
    decos.push(Decoration.replace({ widget: new MathWidget(m.source, true, true, m.from), block: true }).range(from, to))
  }
  return Decoration.set(decos, true)
}

const mathBlockField = StateField.define<DecorationSet>({
  create: (s) => buildMathBlocks(s),
  update(v, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setFocused)) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.startState.facet(hideMarks) !== tr.state.facet(hideMarks)
    )
      return buildMathBlocks(tr.state)
    return v
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 语法树逐步解析完成后刷新表格与公式 */
const treeWatcher = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      if (syntaxTree(u.startState) !== syntaxTree(u.state) && !u.docChanged) {
        // 触发一次表格重建
        queueMicrotask(() => u.view.dispatch({ effects: setFocused.of(u.view.hasFocus) }))
      }
    }
  },
)

export function livePreview(): Extension {
  return [
    inlinePlugin,
    focusedField,
    tableField,
    tableKeys,
    mathBlockField,
    treeWatcher,
    focusEffect.of((_s, focusing) => setFocused.of(focusing)),
  ]
}

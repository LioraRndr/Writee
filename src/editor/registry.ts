import type { EditorView } from '@codemirror/view'

export interface ViewEntry {
  id: string
  kind: 'main' | 'card'
  view: EditorView
  /** 视图内容在全文中的起点 */
  base(): number
  sectionId?: string
}

export interface CollapsedEntry {
  id: string
  from(): number
  to(): number
  el: HTMLElement
}

const views = new Map<string, ViewEntry>()
const collapsed = new Map<string, CollapsedEntry>()
let pageEl: HTMLElement | null = null
let scrollEl: HTMLElement | null = null

type Listener = () => void
const layoutListeners = new Set<Listener>()
let layoutQueued = false

export const registry = {
  add(e: ViewEntry) {
    views.set(e.id, e)
    registry.requestLayout()
  },
  remove(id: string) {
    views.delete(id)
    registry.requestLayout()
  },
  get(id: string) {
    return views.get(id)
  },
  all() {
    return [...views.values()]
  },
  addCollapsed(e: CollapsedEntry) {
    collapsed.set(e.id, e)
    registry.requestLayout()
  },
  removeCollapsed(id: string) {
    collapsed.delete(id)
    registry.requestLayout()
  },
  setPage(el: HTMLElement | null, scroller: HTMLElement | null) {
    pageEl = el
    scrollEl = scroller
  },
  page() {
    return pageEl
  },
  scroller() {
    return scrollEl
  },
  /** 找到包含全文位置 pos 的视图 */
  forPos(pos: number): ViewEntry | null {
    let best: ViewEntry | null = null
    for (const e of views.values()) {
      const b = e.base()
      const len = e.view.state.doc.length
      if (pos >= b && pos <= b + len) {
        if (!best || e.kind === 'card') best = e
      }
    }
    return best
  },
  focused(): ViewEntry | null {
    for (const e of views.values()) if (e.view.hasFocus) return e
    return null
  },
  onLayout(fn: Listener) {
    layoutListeners.add(fn)
    return () => layoutListeners.delete(fn)
  },
  requestLayout() {
    if (layoutQueued) return
    layoutQueued = true
    requestAnimationFrame(() => {
      layoutQueued = false
      for (const fn of layoutListeners) fn()
    })
  },
  collapsedFor(pos: number): CollapsedEntry | null {
    let best: CollapsedEntry | null = null
    for (const c of collapsed.values()) {
      if (pos >= c.from() && pos < c.to()) {
        if (!best || c.from() >= best.from()) best = c
      }
    }
    return best
  },
}

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
  /** 是否为估算位置（视图未渲染该处） */
  approx?: boolean
}

/** 计算全文位置在页面坐标系（相对于 page 元素）中的位置 */
export function posBox(pos: number, side: 1 | -1 = 1): Box | null {
  const page = pageEl
  if (!page) return null
  const pr = page.getBoundingClientRect()
  const c = registry.collapsedFor(pos)
  const e = registry.forPos(pos)
  if (c && (!e || !c.el.contains(e.view.dom))) {
    const r = c.el.getBoundingClientRect()
    return { top: r.top - pr.top, bottom: r.top - pr.top + 28, left: r.right - pr.left - 40, right: r.right - pr.left, approx: true }
  }
  if (!e) return null
  const view = e.view
  const local = Math.max(0, Math.min(view.state.doc.length, pos - e.base()))
  const { from, to } = view.viewport
  if (local >= from && local <= to) {
    const r = view.coordsAtPos(local, side)
    if (r) return { top: r.top - pr.top, bottom: r.bottom - pr.top, left: r.left - pr.left, right: r.right - pr.left }
  }
  const block = view.lineBlockAt(local)
  const top = view.documentTop + block.top - pr.top
  const cr = view.contentDOM.getBoundingClientRect()
  return { top, bottom: top + Math.min(block.height, view.defaultLineHeight), left: cr.left - pr.left, right: cr.left - pr.left + 40, approx: true }
}

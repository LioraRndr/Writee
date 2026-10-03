import type { EditorView } from '@codemirror/view'
import { flash, smoothScroll } from './motion'
import { useDoc } from '../store/docStore'
import { useUI } from '../store/uiStore'
import { registry } from '../editor/registry'
import { sectionPath } from '../core/sections'

/** 平滑滚动，使视图中的某个位置出现在顶部（start）或中间（center） */
export function scrollViewTo(view: EditorView, local: number, align: 'start' | 'center', after?: () => void) {
  const sc = registry.scroller()
  if (!sc) return
  const target = () => {
    const block = view.lineBlockAt(Math.max(0, Math.min(view.state.doc.length, local)))
    const top = sc.scrollTop + view.documentTop + block.top - sc.getBoundingClientRect().top
    return align === 'center' ? top - sc.clientHeight / 2 + Math.min(block.height, 80) / 2 : top - 90
  }
  smoothScroll(sc, target(), () => {
    // 远处的行高是估算值，到位后再校正一次
    const t = target()
    if (Math.abs(t - sc.scrollTop) > 24) smoothScroll(sc, t, after)
    else after?.()
  })
}

/** 滚动到全文中的某个位置（编辑模式与卡片模式通用），可选地选中一段文字 */
export function reveal(pos: number, select?: [number, number], flashTag?: string) {
  const ui = useUI.getState()
  if (flashTag) {
    useUI.setState({ focusTag: flashTag })
    setTimeout(() => {
      if (useUI.getState().focusTag === flashTag) useUI.setState({ focusTag: null })
    }, 1600)
  }
  if (ui.mode === 'editor') {
    ui.revealPos(pos, select, 'center')
    return
  }
  const tree = useDoc.getState().tree
  const path = sectionPath(tree, pos)
  const collapsed = ui.collapsed.filter((id) => !path.some((s) => s.id === id))
  if (collapsed.length !== ui.collapsed.length) useUI.setState({ collapsed })
  const go = (tries: number) => {
    const e = registry.forPos(pos)
    if (!e) {
      if (tries > 0) requestAnimationFrame(() => go(tries - 1))
      return
    }
    const base = e.base()
    const len = e.view.state.doc.length
    if (select)
      e.view.dispatch({
        selection: { anchor: Math.max(0, Math.min(len, select[0] - base)), head: Math.max(0, Math.min(len, select[1] - base)) },
      })
    scrollViewTo(e.view, pos - base, 'center', () => select && e.view.focus())
  }
  requestAnimationFrame(() => go(5))
}

export function revealSection(id: string) {
  const s = useDoc.getState().tree.byId.get(id)
  if (!s) return
  const ui = useUI.getState()
  if (ui.mode === 'cards') {
    const tree = useDoc.getState().tree
    const path = sectionPath(tree, s.from)
    const collapsed = ui.collapsed.filter((cid) => !path.slice(0, -1).some((p) => p.id === cid))
    if (collapsed.length !== ui.collapsed.length) useUI.setState({ collapsed })
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-card="${id}"]`)
      const sc = registry.scroller()
      if (el && sc) {
        const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 24
        smoothScroll(sc, top)
        flash(el)
      }
    })
    return
  }
  ui.revealPos(s.from)
}

import { useDoc } from '../../store/docStore'
import { useUI } from '../../store/uiStore'
import { cardDepth } from '../../core/sections'
import { flash } from '../motion'

interface Item {
  id: string
  depth: number
  el: HTMLElement
  head: DOMRect
  box: DOMRect
}

export interface DragOpts {
  /** 容器（只在其中查找 [data-drag-item]） */
  container: HTMLElement
  scroller: HTMLElement | null
  /** 每一层缩进的像素宽度 */
  indent: number
}

/** 树形拖拽排序：上下决定插入位置，左右决定层级（扁平树投影算法） */
export function startTreeDrag(e: React.PointerEvent, id: string, opts: DragOpts) {
  if (e.button !== 0) return
  e.preventDefault()
  const doc = useDoc.getState()
  const tree = doc.tree
  const sec = tree.byId.get(id)
  if (!sec) return
  const subtree = new Set<string>()
  const walk = (s: typeof sec) => {
    subtree.add(s.id)
    s.children.forEach(walk)
  }
  walk(sec)
  const dragDepth = cardDepth(tree, sec)
  const startX = e.clientX
  const startY = e.clientY
  let started = false
  let ghost: HTMLDivElement | null = null
  let line: HTMLDivElement | null = null
  let target: { parentId: string | null; index: number } | null = null
  let autoScroll = 0
  let raf = 0
  let lastEvent: PointerEvent | null = null
  const srcEl = opts.container.querySelector<HTMLElement>(`[data-drag-item="${id}"]`)

  const collect = (): Item[] => {
    const els = [...opts.container.querySelectorAll<HTMLElement>('[data-drag-item]')]
    return els
      .filter((el) => !subtree.has(el.dataset.dragItem!))
      .map((el) => {
        const head = (el.querySelector('[data-drag-head]') as HTMLElement | null) ?? el
        return {
          id: el.dataset.dragItem!,
          depth: Number(el.dataset.depth ?? 0),
          el,
          head: head.getBoundingClientRect(),
          box: el.getBoundingClientRect(),
        }
      })
  }

  const begin = () => {
    started = true
    document.body.classList.add('is-dragging')
    srcEl?.classList.add('is-drag-source')
    ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    ghost.style.transform = `translate(${startX + 14}px, ${startY - 14}px)`
    ghost.textContent = sec.heading?.text || '（无标题）'
    document.body.appendChild(ghost)
    line = document.createElement('div')
    line.className = 'drop-line'
    document.body.appendChild(line)
  }

  const update = (ev: PointerEvent) => {
    if (!ghost || !line) return
    ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY - 14}px)`
    const items = collect()
    const crect = opts.container.getBoundingClientRect()
    let i = items.findIndex((it) => ev.clientY < it.head.top + it.head.height / 2)
    if (i < 0) i = items.length
    const prev = items[i - 1]
    const next = items[i]
    const maxDepth = prev ? prev.depth + 1 : 0
    const minDepth = next ? next.depth : 0
    const projected = dragDepth + Math.round((ev.clientX - startX) / opts.indent)
    const depth = Math.max(minDepth, Math.min(maxDepth, projected))
    // 找父级
    let parentId: string | null = null
    let parentIdx = -1
    if (depth > 0) {
      for (let k = i - 1; k >= 0; k--) {
        if (items[k].depth === depth - 1) {
          parentId = items[k].id
          parentIdx = k
          break
        }
      }
    }
    let index = 0
    for (let k = parentIdx + 1; k < i; k++) if (items[k].depth === depth) index++
    target = { parentId, index }
    let y: number
    if (next) y = next.box.top - 5
    else if (prev) {
      // 末尾：放在最外层容器的底部
      const last = items[items.length - 1]
      let outer = last.el
      for (let p = last.el.parentElement; p && p !== opts.container; p = p.parentElement) {
        if (p.dataset.dragItem) outer = p
      }
      y = outer.getBoundingClientRect().bottom + 5
    } else y = crect.top + 10
    const left = crect.left + depth * opts.indent
    line.style.transform = `translate(${left}px, ${y}px)`
    line.style.width = `${Math.max(120, crect.right - left)}px`
    const parent = parentId ? tree.byId.get(parentId) : null
    line.dataset.label = parent ? `放入「${parent.heading?.text || '无标题'}」` : '顶层'

    // 自动滚动
    const sc = opts.scroller
    if (sc) {
      const sr = sc.getBoundingClientRect()
      const edge = 70
      if (ev.clientY < sr.top + edge) autoScroll = -Math.ceil((sr.top + edge - ev.clientY) / 4)
      else if (ev.clientY > sr.bottom - edge) autoScroll = Math.ceil((ev.clientY - (sr.bottom - edge)) / 4)
      else autoScroll = 0
    }
  }

  const tick = () => {
    if (autoScroll && opts.scroller) {
      opts.scroller.scrollTop += autoScroll
      if (lastEvent) update(lastEvent)
    }
    raf = requestAnimationFrame(tick)
  }

  const onMove = (ev: PointerEvent) => {
    lastEvent = ev
    if (!started) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
      begin()
      raf = requestAnimationFrame(tick)
    }
    update(ev)
  }

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('keydown', onKey, true)
    cancelAnimationFrame(raf)
    ghost?.remove()
    line?.remove()
    srcEl?.classList.remove('is-drag-source')
    document.body.classList.remove('is-dragging')
  }

  const onUp = () => {
    cleanup()
    if (!started || !target) return
    const ok = useDoc.getState().moveSection(id, target.parentId, target.index)
    if (ok) {
      requestAnimationFrame(() => flash(opts.container.querySelector(`[data-drag-item="${id}"]`)))
      useUI.getState().toast('已移动「' + (sec.heading?.text || '无标题') + '」', {
        action: { label: '撤销', run: () => useDoc.getState().undo() },
      })
    }
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      target = null
      cleanup()
    }
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey, true)
}

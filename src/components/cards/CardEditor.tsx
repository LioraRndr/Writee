import { useEffect, useRef } from 'react'
import { createEditor, type EditorHandle } from '../../editor/setup'
import { useDoc } from '../../store/docStore'
import { useUI } from '../../store/uiStore'
import type { Section } from '../../core/sections'
import { cardFocus } from './focus'

function findSection(id: string): Section | null {
  const tree = useDoc.getState().tree
  if (id === '__preamble') return tree.preamble
  return tree.byId.get(id) ?? null
}

export function CardEditor({ sectionId, placeholder }: { sectionId: string; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const handle = useRef<EditorHandle | null>(null)
  const viewId = 'card:' + sectionId
  const last = useRef<[number, number]>([0, 0])

  useEffect(() => {
    const range = (): [number, number] => {
      const s = findSection(sectionId)
      if (!s) return last.current
      last.current = [s.ownFrom, Math.max(s.ownFrom, s.ownTo)]
      return last.current
    }
    const h = createEditor({
      id: viewId,
      kind: 'card',
      parent: ref.current!,
      range,
      sectionId,
      placeholder,
      onFocusChange: (f) => cardFocus.set(f ? viewId : null),
    })
    handle.current = h

    const tryFocus = () => {
      const req = useUI.getState().focusCard
      if (!req) return
      const [from, to] = range()
      if (req.pos < from || req.pos > to) return
      useUI.setState({ focusCard: null })
      h.view.focus()
      const sel = req.select ?? [req.pos, req.pos]
      h.view.dispatch({
        selection: { anchor: sel[0] - from, head: sel[1] - from },
        scrollIntoView: true,
      })
    }
    tryFocus()
    const unsub = useUI.subscribe((s, p) => {
      if (s.focusCard !== p.focusCard) tryFocus()
    })
    return () => {
      unsub()
      if (cardFocus.get() === viewId) cardFocus.set(null)
      h.destroy()
      handle.current = null
    }
  }, [sectionId, viewId, placeholder])

  // 结构变化后，范围可能变化：每次渲染都校准一次
  useEffect(() => {
    handle.current?.resync()
  })

  return <div className="card-editor" ref={ref} />
}

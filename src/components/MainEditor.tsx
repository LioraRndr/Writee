import { useEffect, useRef } from 'react'
import { createEditor, type EditorHandle } from '../editor/setup'
import { useDoc } from '../store/docStore'
import { useUI } from '../store/uiStore'
import { scrollViewTo } from './reveal'

export function MainEditor() {
  const ref = useRef<HTMLDivElement>(null)
  const handle = useRef<EditorHandle | null>(null)

  useEffect(() => {
    const h = createEditor({
      id: 'main',
      kind: 'main',
      parent: ref.current!,
      range: () => [0, useDoc.getState().data.text.length],
      placeholder: '开始写作…',
    })
    handle.current = h

    const reveal = () => {
      const r = useUI.getState().reveal
      if (!r) return
      const len = h.view.state.doc.length
      const pos = Math.min(r.pos, len)
      if (r.select) h.view.dispatch({ selection: { anchor: Math.min(r.select[0], len), head: Math.min(r.select[1], len) } })
      scrollViewTo(h.view, pos, r.align ?? 'start', () => r.select && h.view.focus())
    }
    const unsub = useUI.subscribe((s, p) => {
      if (s.reveal !== p.reveal) reveal()
    })
    return () => {
      unsub()
      h.destroy()
    }
  }, [])

  return <div className="main-editor" ref={ref} />
}

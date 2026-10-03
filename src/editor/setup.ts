import { Annotation, ChangeSet, Compartment, EditorState, Transaction, type ChangeSpec, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { create } from 'zustand'
import { useDoc } from '../store/docStore'
import { useUI } from '../store/uiStore'
import { minimalChange } from '../core/mapping'
import { tagInfo } from '../core/derive'
import { primaryCat, tagLabel } from '../analysis/taxonomy'
import { hideMarks, livePreview } from './livePreview'
import { overlayField, setOverlay, type OverlaySpec } from './overlays'
import { registry } from './registry'

/** 由 store 同步进来的变更，不再回写 */
export const syncAnnot = Annotation.define<boolean>()

export interface SelInfo {
  viewId: string
  from: number
  to: number
}

export const useSel = create<{ sel: SelInfo | null; cursor: number | null }>()(() => ({ sel: null, cursor: null }))

export interface EditorHandle {
  view: EditorView
  destroy(): void
  /** 卡片编辑器：立即与当前范围同步 */
  resync(): void
}

export interface EditorOpts {
  id: string
  kind: 'main' | 'card'
  parent: HTMLElement
  /** 当前对应的全文范围（卡片编辑器） */
  range: () => [number, number]
  sectionId?: string
  placeholder?: string
  onFocusChange?: (focused: boolean) => void
}

const hideComp = new Compartment()

function groupFor(tr: Transaction) {
  if (tr.isUserEvent('input.type') || tr.isUserEvent('input.compose')) return 'type'
  if (tr.isUserEvent('delete')) return 'delete'
  return null
}

export function computeOverlay(base: number, len: number): OverlaySpec {
  const { data } = useDoc.getState()
  const ui = useUI.getState()
  const info = tagInfo(data)
  const end = base + len
  const tags: OverlaySpec['tags'] = []
  const activeNote = ui.activeNote ?? ui.hoverNote
  const activeNoteObj = activeNote ? data.notes.find((n) => n.id === activeNote) : null
  for (const t of data.tags) {
    if (t.to < base || t.from > end) continue
    const notes = info.notesByTag.get(t.id) ?? []
    const color = notes.length ? notes[0].color : null
    let state: OverlaySpec['tags'][number]['state'] = ''
    if (ui.linkNote && notes.some((n) => n.id === ui.linkNote)) state = 'linking'
    else if (ui.hoverTag === t.id || ui.focusTag === t.id) state = 'hover'
    else if (activeNoteObj && activeNoteObj.tagIds.includes(t.id)) state = ui.activeNote ? 'active' : 'hover'
    else if (ui.activeNote && ui.rail === 'notes') state = 'dim'
    tags.push({ id: t.id, from: t.from - base, to: t.to - base, n: info.numbers.get(t.id) ?? 0, color, state })
  }
  const units: OverlaySpec['units'] = []
  if (ui.rail === 'structure' && ui.settings.railOpen && data.analysis) {
    for (const u of data.analysis.units) {
      if (u.to < base || u.from > end) continue
      const cat = primaryCat(u.tags)
      units.push({
        id: u.id,
        from: u.from - base,
        to: u.to - base,
        cat,
        label: u.tags.map(tagLabel).join(' · '),
        active: ui.activeUnit === u.id,
        dim: ui.hiddenCats.length > 0 && !u.tags.some((id) => !ui.hiddenCats.includes(primaryCat([id]))),
      })
    }
  }
  const edits: OverlaySpec['edits'] = []
  if (ui.settings.showEdits) {
    for (const e of data.edits) {
      if (e.to < base || e.from > end) continue
      edits.push({ from: e.from - base, to: e.to - base })
    }
  }
  return { tags, units, edits }
}

export function createEditor(opts: EditorOpts): EditorHandle {
  const { id, kind } = opts
  const [r0, r1] = opts.range()
  const initial = useDoc.getState().data.text.slice(r0, r1)
  let base = r0
  let destroyed = false

  const keys = keymap.of([
    { key: 'Mod-z', run: () => (useDoc.getState().undo(), true), preventDefault: true },
    { key: 'Mod-y', run: () => (useDoc.getState().redo(), true), preventDefault: true },
    { key: 'Mod-Shift-z', run: () => (useDoc.getState().redo(), true), preventDefault: true },
  ])

  const extensions: Extension[] = [
    keys,
    markdown({ base: markdownLanguage, addKeymap: true }),
    EditorView.lineWrapping,
    hideComp.of(hideMarks.of(useUI.getState().settings.livePreview)),
    livePreview(),
    overlayField,
    EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', lang: 'zh-CN' }),
    keymap.of(defaultKeymap),
    EditorView.updateListener.of((u) => {
      if (destroyed) return
      if (u.docChanged && !u.transactions.some((tr) => tr.annotation(syncAnnot))) {
        const doc = useDoc.getState()
        const total = doc.data.text.length
        let changes: ChangeSet
        if (kind === 'main' && base === 0) changes = u.changes
        else {
          const specs: ChangeSpec[] = []
          u.changes.iterChanges((fa, ta, _fb, _tb, ins) => specs.push({ from: fa + base, to: ta + base, insert: ins }))
          changes = ChangeSet.of(specs, total)
        }
        const group = u.transactions.map(groupFor).find(Boolean) ?? null
        doc.applyChanges(changes, id, { userEdit: true, group: group ? id + ':' + group : null })
      }
      if (u.selectionSet || u.focusChanged || u.docChanged) {
        const sel = u.state.selection.main
        if (u.view.hasFocus) {
          useSel.setState({
            sel: sel.empty ? null : { viewId: id, from: sel.from + base, to: sel.to + base },
            cursor: sel.head + base,
          })
        } else if (u.focusChanged) {
          const cur = useSel.getState().sel
          if (cur?.viewId === id) {
            // 失焦稍后再清除，给工具条点击留出时间
            setTimeout(() => {
              // 焦点转移到浮动工具条（如标签搜索框）时保留选区
              if (document.activeElement?.closest('.sel-toolbar')) return
              if (!destroyed && !view.hasFocus && useSel.getState().sel?.viewId === id) useSel.setState({ sel: null })
            }, 200)
          }
        }
      }
      if (u.focusChanged) opts.onFocusChange?.(u.view.hasFocus)
      if (u.geometryChanged || u.viewportChanged || u.heightChanged) registry.requestLayout()
    }),
  ]
  if (kind === 'main') extensions.push(search({ top: true }), keymap.of(searchKeymap), highlightSelectionMatches())
  if (opts.placeholder) extensions.push(placeholderExt(opts.placeholder))

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: initial, extensions }),
  })

  const syncText = (fromHistory: boolean) => {
    const [from, to] = opts.range()
    base = from
    const want = useDoc.getState().data.text.slice(from, to)
    const cur = view.state.doc.toString()
    const mc = minimalChange(cur, want)
    if (!mc) return
    const focused = view.hasFocus
    view.dispatch({
      changes: mc,
      annotations: [syncAnnot.of(true), Transaction.addToHistory.of(false)],
      selection: focused && fromHistory ? { anchor: mc.from + mc.insert.length } : undefined,
      scrollIntoView: focused && fromHistory,
    })
  }

  let overlayQueued = false
  const scheduleOverlay = () => {
    if (overlayQueued) return
    overlayQueued = true
    requestAnimationFrame(() => {
      overlayQueued = false
      if (destroyed) return
      view.dispatch({ effects: setOverlay.of(computeOverlay(base, view.state.doc.length)) })
    })
  }

  const unsubDoc = useDoc.subscribe((s, prev) => {
    if (destroyed) return
    const ev = s.event
    if (ev && ev !== prev.event && ev.textChanged && ev.origin !== id) {
      if (kind === 'card' && ev.touched && ev.origin !== 'history') {
        const [from, to] = opts.range()
        if (ev.touched[1] < from - 1 || ev.touched[0] > to + 1) {
          base = from
        } else syncText(false)
      } else syncText(ev.origin === 'history')
    } else if (ev && ev !== prev.event && ev.origin === id) {
      base = opts.range()[0]
    }
    if (s.data !== prev.data) scheduleOverlay()
  })

  const unsubUI = useUI.subscribe((s, prev) => {
    if (destroyed) return
    if (s.settings.livePreview !== prev.settings.livePreview) {
      view.dispatch({ effects: hideComp.reconfigure(hideMarks.of(s.settings.livePreview)) })
    }
    if (
      s.hoverTag !== prev.hoverTag ||
      s.hoverNote !== prev.hoverNote ||
      s.activeNote !== prev.activeNote ||
      s.focusTag !== prev.focusTag ||
      s.linkNote !== prev.linkNote ||
      s.rail !== prev.rail ||
      s.activeUnit !== prev.activeUnit ||
      s.hiddenCats !== prev.hiddenCats ||
      s.settings.showEdits !== prev.settings.showEdits ||
      s.settings.railOpen !== prev.settings.railOpen
    )
      scheduleOverlay()
  })

  registry.add({ id, kind, view, base: () => base, sectionId: opts.sectionId })
  scheduleOverlay()

  return {
    view,
    resync() {
      syncText(false)
      scheduleOverlay()
    },
    destroy() {
      destroyed = true
      unsubDoc()
      unsubUI()
      registry.remove(id)
      if (useSel.getState().sel?.viewId === id) useSel.setState({ sel: null })
      view.destroy()
    },
  }
}

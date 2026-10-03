import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useDoc } from '../store/docStore'
import { useUI } from '../store/uiStore'
import { useSel } from '../editor/setup'
import { posBox, registry } from '../editor/registry'
import { tagInfo } from '../core/derive'
import { splitSentences } from '../core/sentences'
import { uid } from '../core/uid'
import { MainEditor } from './MainEditor'
import { CardsView } from './cards/CardsView'
import { NotesRail } from './rail/NotesRail'
import { StructureRail } from './rail/StructureRail'
import { TagPicker } from './rail/TagPicker'
import { Outline } from './Outline'
import { Resizer } from './Resizer'
import { Menu } from './Menu'
import { IconLayers, IconLink, IconNote, IconTag, IconTrash, IconPlus } from './icons'
import { ALT, MOD } from '../core/platform'

export const usePopover = create<{ tagId: string | null; x: number; y: number }>()(() => ({ tagId: null, x: 0, y: 0 }))

/** 为选区新建标签 + 注释，并聚焦注释输入框 */
export function addNoteForSelection(from: number, to: number) {
  const doc = useDoc.getState()
  const tagId = doc.addTag(from, to)
  if (!tagId) return
  const ui = useUI.getState()
  if (ui.linkNote) {
    doc.linkTag(ui.linkNote, tagId)
    return
  }
  const existing = tagInfo(useDoc.getState().data).notesByTag.get(tagId)
  const noteId = existing?.[0]?.id ?? useDoc.getState().addNote([tagId])
  useUI.setState({ activeNote: noteId, focusNoteInput: noteId, rail: 'notes' })
  if (!ui.settings.railOpen) ui.setSettings({ railOpen: true })
  collapseSelection()
}

export function addTagForSelection(from: number, to: number) {
  const id = useDoc.getState().addTag(from, to)
  if (!id) return
  const ui = useUI.getState()
  if (ui.linkNote) useDoc.getState().linkTag(ui.linkNote, id)
  const n = tagInfo(useDoc.getState().data).numbers.get(id)
  ui.toast(`已添加标签 ${n}${ui.linkNote ? '，并关联到当前注释' : ''}`)
  collapseSelection()
}

function collapseSelection() {
  const f = registry.focused()
  if (f) {
    const head = f.view.state.selection.main.to
    f.view.dispatch({ selection: { anchor: head } })
  }
  useSel.setState({ sel: null })
}

function SelectionToolbar() {
  const sel = useSel((s) => s.sel)
  const linkNote = useUI((s) => s.linkNote)
  const rail = useUI((s) => s.rail)
  const railOpen = useUI((s) => s.settings.railOpen)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const structureMode = rail === 'structure' && railOpen

  // 焦点在工具条内（如搜索框）时，点击别处即关闭
  useEffect(() => {
    if (!sel) return
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if (document.activeElement && ref.current?.contains(document.activeElement)) useSel.setState({ sel: null })
    }
    window.addEventListener('mousedown', down, true)
    return () => window.removeEventListener('mousedown', down, true)
  }, [sel])

  useLayoutEffect(() => {
    setPicking(null)
    if (!sel) return setPos(null)
    const a = posBox(sel.from, 1)
    const b = posBox(sel.to, -1)
    if (!a || !b) return setPos(null)
    const page = registry.page()
    const w = ref.current?.offsetWidth ?? 220
    const maxLeft = (page?.clientWidth ?? 1000) - w - 8
    const left = Math.max(8, Math.min(maxLeft, (a.top === b.top ? (a.left + b.right) / 2 : b.right) - w / 2))
    // 结构标注时工具条较高，放在选区下方，避免遮住所选句子
    let below = structureMode && !linkNote
    if (below && page) {
      // 下方空间不够时改放上方
      const h = ref.current?.offsetHeight || 340
      const pr = page.getBoundingClientRect()
      const sr = registry.scroller()?.getBoundingClientRect()
      if (sr && pr.top + Math.max(a.bottom, b.bottom) + h + 16 > sr.bottom && pr.top + Math.min(a.top, b.top) - h - 16 > sr.top)
        below = false
    }
    const h = ref.current?.offsetHeight || 40
    const top = below ? Math.max(a.bottom, b.bottom) + 10 : Math.min(a.top, b.top) - (structureMode && !linkNote ? h + 10 : 46)
    setPos({ top: !below && top < 4 ? Math.max(a.bottom, b.bottom) + 8 : top, left })
  }, [sel, structureMode, linkNote])

  if (!sel || !pos) return null
  const notes = useDoc.getState().data.notes

  const startUnit = (tag: string) => {
    // 把选区扩展到完整的句子
    const text = useDoc.getState().data.text
    const ss = splitSentences(text).filter((s) => s.to > sel.from && s.from < sel.to)
    const from = ss.length ? Math.min(sel.from, ss[0].from) : sel.from
    const to = ss.length ? Math.max(sel.to, ss[ss.length - 1].to) : sel.to
    const id = uid('u')
    const doc = useDoc.getState()
    if (!doc.data.analysis) doc.setAnalysis({ units: [], createdAt: Date.now(), model: '手动' })
    useDoc.getState().addUnits([{ id, from, to, tags: [tag] }])
    setPicking(id)
    useUI.setState({ activeUnit: id })
  }

  const pickingUnit = picking ? useDoc.getState().data.analysis?.units.find((u) => u.id === picking) : null

  return (
    <div
      ref={ref}
      className="sel-toolbar"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {linkNote ? (
        <button className="tb-btn is-primary" onClick={() => addTagForSelection(sel.from, sel.to)}>
          <IconLink size={14} /> 加入当前注释
        </button>
      ) : structureMode ? (
        <>
          <span className="tb-label">
            <IconLayers size={14} /> 结构标注
          </span>
        </>
      ) : (
        <>
          <button className="tb-btn" onClick={() => addTagForSelection(sel.from, sel.to)} title="只打一个数字标签">
            <IconTag size={14} /> 标签
          </button>
          <button className="tb-btn is-primary" onClick={() => addNoteForSelection(sel.from, sel.to)} title={`添加注释（${MOD}${ALT}M）`}>
            <IconNote size={14} /> 注释
          </button>
          {notes.length > 0 && (
            <Menu
              className="tb-btn"
              align="left"
              title="关联到已有注释"
              trigger={
                <>
                  <IconLink size={14} /> 关联到…
                </>
              }
              items={() => {
                const info = tagInfo(useDoc.getState().data)
                return useDoc
                  .getState()
                  .data.notes.slice(-12)
                  .reverse()
                  .map((n) => ({
                    label: (
                      <span className="color-row">
                        <span className="color-dot" style={{ background: `var(--nc-${n.color})` }} />
                        <span className="menu-note">
                          {n.tagIds.map((t) => info.numbers.get(t)).filter(Boolean).join('·')}{' '}
                          {n.text.trim().slice(0, 18) || '（空注释）'}
                        </span>
                      </span>
                    ),
                    onSelect: () => {
                      const id = useDoc.getState().addTag(sel.from, sel.to)
                      if (id) useDoc.getState().linkTag(n.id, id)
                      useUI.setState({ activeNote: n.id })
                      collapseSelection()
                    },
                  }))
              }}
            />
          )}
        </>
      )}
      {structureMode && !linkNote && (
        <div className="tb-picker">
          <TagPicker
            autoFocus={false}
            value={pickingUnit?.tags ?? []}
            onToggle={(t) => {
              if (!pickingUnit) return startUnit(t)
              const tags = pickingUnit.tags.includes(t) ? pickingUnit.tags.filter((x) => x !== t) : pickingUnit.tags.concat(t)
              if (tags.length) useDoc.getState().updateUnit(pickingUnit.id, { tags })
              else {
                useDoc.getState().removeUnit(pickingUnit.id)
                setPicking(null)
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

function TagPopover() {
  const { tagId, x, y } = usePopover()
  const data = useDoc((s) => s.data)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tagId) return
    const close = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if ((e.target as HTMLElement).closest?.('[data-tag-badge]')) return
      usePopover.setState({ tagId: null })
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && usePopover.setState({ tagId: null })
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', key)
    }
  }, [tagId])
  if (!tagId) return null
  const tag = data.tags.find((t) => t.id === tagId)
  if (!tag) return null
  const info = tagInfo(data)
  const linked = info.notesByTag.get(tagId) ?? []
  const quote = data.text.slice(tag.from, tag.to).replace(/\s+/g, ' ')
  const others = data.notes.filter((n) => !n.tagIds.includes(tagId))
  const close = () => usePopover.setState({ tagId: null })
  return (
    <div ref={ref} className="tag-pop" style={{ top: y, left: x }} onMouseDown={(e) => e.preventDefault()}>
      <div className="tag-pop-head">
        <span className="tag-pop-n">{info.numbers.get(tagId)}</span>
        <span className="tag-pop-quote">「{quote.length > 48 ? quote.slice(0, 48) + '…' : quote}」</span>
      </div>
      {linked.length > 0 && (
        <div className="tag-pop-notes">
          {linked.map((n) => (
            <button
              key={n.id}
              className="tag-pop-note"
              style={{ '--nc': `var(--nc-${n.color})` } as React.CSSProperties}
              onClick={() => {
                useUI.setState({ activeNote: n.id, rail: 'notes' })
                close()
              }}
            >
              <i />
              {n.text.trim().slice(0, 40) || '（空注释）'}
            </button>
          ))}
        </div>
      )}
      <div className="tag-pop-actions">
        <button
          className="tb-btn is-primary"
          onClick={() => {
            const id = useDoc.getState().addNote([tagId])
            useUI.setState({ activeNote: id, focusNoteInput: id, rail: 'notes' })
            if (!useUI.getState().settings.railOpen) useUI.getState().setSettings({ railOpen: true })
            close()
          }}
        >
          <IconPlus size={13} /> 新注释
        </button>
        {others.length > 0 && (
          <Menu
            className="tb-btn"
            align="left"
            trigger={
              <>
                <IconLink size={13} /> 关联到…
              </>
            }
            items={() =>
              others
                .slice(-12)
                .reverse()
                .map((n) => ({
                  label: (
                    <span className="color-row">
                      <span className="color-dot" style={{ background: `var(--nc-${n.color})` }} />
                      <span className="menu-note">{n.text.trim().slice(0, 22) || '（空注释）'}</span>
                    </span>
                  ),
                  onSelect: () => {
                    useDoc.getState().linkTag(n.id, tagId)
                    useUI.setState({ activeNote: n.id })
                    close()
                  },
                }))
            }
          />
        )}
        <span className="spacer" />
        <button
          className="icon-btn"
          title="删除标签"
          onClick={() => {
            useDoc.getState().removeTag(tagId)
            close()
            useUI.getState().toast('已删除标签', { action: { label: '撤销', run: () => useDoc.getState().undo() } })
          }}
        >
          <IconTrash size={14} />
        </button>
      </div>
    </div>
  )
}

export function Workspace() {
  const mode = useUI((s) => s.mode)
  const rail = useUI((s) => s.rail)
  const settings = useUI((s) => s.settings)
  const linkNote = useUI((s) => s.linkNote)
  const scroller = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    registry.setPage(page.current, scroller.current)
    return () => registry.setPage(null, null)
  }, [])

  useEffect(() => {
    registry.requestLayout()
  }, [mode, settings.railOpen, settings.width, settings.fontSize, settings.lineHeight, settings.outlineOpen, rail])

  // 委托：标签徽标的悬停与点击
  const onMouseOver = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tag-badge],.wt-tag[data-tag]')
    const id = el ? (el.dataset.tagBadge ?? el.dataset.tag ?? null) : null
    if (useUI.getState().hoverTag !== id) useUI.setState({ hoverTag: id })
  }
  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const badge = target.closest<HTMLElement>('[data-tag-badge]')
    if (badge) {
      e.preventDefault()
      const id = badge.dataset.tagBadge!
      const ln = useUI.getState().linkNote
      if (ln) {
        useDoc.getState().toggleLink(ln, id)
        return
      }
      const pr = page.current!.getBoundingClientRect()
      const r = badge.getBoundingClientRect()
      usePopover.setState({ tagId: id, x: Math.max(8, Math.min(r.left - pr.left - 10, pr.width - 330)), y: r.bottom - pr.top + 8 })
      const notes = tagInfo(useDoc.getState().data).notesByTag.get(id)
      if (notes?.[0]) useUI.setState({ activeNote: notes[0].id })
      return
    }
    const tagText = target.closest<HTMLElement>('.wt-tag[data-tag]')
    if (tagText && useUI.getState().linkNote) {
      useDoc.getState().toggleLink(useUI.getState().linkNote!, tagText.dataset.tag!)
      return
    }
    const unit = target.closest<HTMLElement>('[data-unit]')
    if (unit && useUI.getState().rail === 'structure') useUI.setState({ activeUnit: unit.dataset.unit! })
    const link = target.closest<HTMLElement>('.cm-md-link[data-href]')
    if (link && (e.metaKey || e.ctrlKey)) window.open(link.dataset.href, '_blank', 'noopener')
    // 点击正文空白处：取消注释激活状态
    if (!tagText && !target.closest('.note') && useUI.getState().activeNote && target.closest('.text-col')) {
      useUI.setState({ activeNote: null })
    }
  }

  return (
    <div className={'workspace' + (linkNote ? ' is-linking' : '')}>
      <div className={'outline-wrap' + (settings.outlineOpen ? '' : ' is-closed')} aria-hidden={!settings.outlineOpen}>
        <Outline />
        <Resizer k="outlineWidth" dir={1} className="is-outline" />
      </div>
      <div className="scroller" ref={scroller}>
        <div
          ref={page}
          className={'page' + (settings.railOpen ? ' has-rail' : '') + ' mode-' + mode}
          onMouseOver={onMouseOver}
          onMouseLeave={() => useUI.setState({ hoverTag: null })}
          onClick={onClick}
        >
          <div className="text-col">
            <div className="mode-fade" key={mode}>
              {mode === 'editor' ? <MainEditor /> : <CardsView />}
            </div>
          </div>
          {settings.railOpen && <div className="gutter" />}
          {settings.railOpen && (
            <aside className="rail">
              <Resizer k="railWidth" dir={-1} className="is-rail" />
              <div className="rail-fade" key={rail}>
                {rail === 'notes' ? <NotesRail /> : <StructureRail />}
              </div>
            </aside>
          )}
          <SelectionToolbar />
          <TagPopover />
        </div>
      </div>
    </div>
  )
}

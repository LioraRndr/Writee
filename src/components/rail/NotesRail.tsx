import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDoc } from '../../store/docStore'
import { useUI } from '../../store/uiStore'
import { registry } from '../../editor/registry'
import { tagInfo } from '../../core/derive'
import { NOTE_COLORS, NOTE_COLOR_LABEL, type Note } from '../../core/types'
import { computeDots, curve, placeStack, GUTTER, type Dot, type Placed } from './layout'
import { reveal } from '../reveal'
import { usePlacementClass } from '../hooks'
import { Menu } from '../Menu'
import { IconCheck, IconClose, IconCopy, IconLink, IconMore, IconSearch, IconTrash, IconPlus } from '../icons'

const HEADER_H = 52

export function NotesRail() {
  const data = useDoc((s) => s.data)
  const hoverNote = useUI((s) => s.hoverNote)
  const activeNote = useUI((s) => s.activeNote)
  const hoverTag = useUI((s) => s.hoverTag)
  const focusTag = useUI((s) => s.focusTag)
  const linkNote = useUI((s) => s.linkNote)
  const selected = useUI((s) => s.selectedNotes)
  const mode = useUI((s) => s.mode)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const railRef = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<string, number>())
  const [layout, setLayout] = useState<{
    dots: Map<string, Dot>
    notes: Map<string, Placed>
    railLeft: number
    railTop: number
    pageW: number
    pageH: number
  } | null>(null)
  const [dragLine, setDragLine] = useState<{ noteId: string; x: number; y: number } | null>(null)

  const info = tagInfo(data)
  const visibleNotes = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.notes.filter((n) => {
      if (filter === 'open' && n.resolved && n.id !== activeNote) return false
      if (!q) return true
      if (n.text.toLowerCase().includes(q)) return true
      return n.tagIds.some((id) => {
        const t = data.tags.find((x) => x.id === id)
        return t ? data.text.slice(t.from, t.to).toLowerCase().includes(q) : false
      })
    })
  }, [data, query, filter, activeNote])

  const compute = useCallback(() => {
    const page = registry.page()
    const rail = railRef.current
    if (!page || !rail) return
    const pr = page.getBoundingClientRect()
    const rr = rail.getBoundingClientRect()
    const railLeft = rr.left - pr.left
    const railTop = rr.top - pr.top
    const d = useDoc.getState().data
    const dots = computeDots(
      d.tags.map((t) => ({ id: t.id, pos: t.to, side: -1 as const, badgeSelector: `[data-tag-badge="${t.id}"]` })),
      railLeft - GUTTER,
    )
    const items = visibleNotes.map((n) => {
      const ys = n.tagIds.map((id) => dots.get(id)?.y).filter((y): y is number => y !== undefined)
      return {
        id: n.id,
        anchor: ys.length ? Math.min(...ys) - 20 : Number.MAX_SAFE_INTEGER / 2,
        height: heights.current.get(n.id) ?? 96,
      }
    })
    // 无标签的注释排在最后
    const anchored = items.filter((i) => i.anchor < Number.MAX_SAFE_INTEGER / 4)
    const loose = items.filter((i) => i.anchor >= Number.MAX_SAFE_INTEGER / 4)
    const placed = placeStack(anchored, { gap: 10, minTop: railTop + HEADER_H + 8, activeId: useUI.getState().activeNote })
    let y = railTop + HEADER_H + 8
    for (const p of placed.values()) y = Math.max(y, p.top + p.height + 10)
    for (const l of loose) {
      placed.set(l.id, { id: l.id, top: y, height: l.height })
      y += l.height + 10
    }
    setLayout({ dots, notes: placed, railLeft, railTop, pageW: pr.width, pageH: page.scrollHeight })
  }, [visibleNotes])

  useEffect(() => {
    const off = registry.onLayout(compute)
    registry.requestLayout()
    const onResize = () => registry.requestLayout()
    window.addEventListener('resize', onResize)
    document.fonts?.addEventListener?.('loadingdone', onResize)
    return () => {
      off()
      window.removeEventListener('resize', onResize)
      document.fonts?.removeEventListener?.('loadingdone', onResize)
    }
  }, [compute])

  useEffect(() => {
    registry.requestLayout()
  }, [data, activeNote, mode, visibleNotes])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const ro = new ResizeObserver((entries) => {
      let changed = false
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.note
        if (!id) continue
        const h = Math.round((e.target as HTMLElement).offsetHeight)
        if (heights.current.get(id) !== h) {
          heights.current.set(id, h)
          changed = true
        }
      }
      if (changed) registry.requestLayout()
    })
    rail.querySelectorAll('[data-note]').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [visibleNotes])

  // 拖拽连线：从注释左侧的端口拖到正文中的标签上
  const startPortDrag = (e: React.PointerEvent, noteId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const page = registry.page()
    if (!page) return
    const move = (ev: PointerEvent) => {
      const pr = page.getBoundingClientRect()
      setDragLine({ noteId, x: ev.clientX - pr.left, y: ev.clientY - pr.top })
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const tagEl = el?.closest<HTMLElement>('[data-tag-badge],[data-tag],[data-dot]')
      const tid = tagEl?.dataset.tagBadge ?? tagEl?.dataset.tag ?? tagEl?.dataset.dot ?? null
      if (useUI.getState().hoverTag !== tid) useUI.setState({ hoverTag: tid })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragLine(null)
      useUI.setState({ hoverTag: null })
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const tagEl = el?.closest<HTMLElement>('[data-tag-badge],[data-tag],[data-dot]')
      const tid = tagEl?.dataset.tagBadge ?? tagEl?.dataset.tag ?? tagEl?.dataset.dot
      if (tid) {
        useDoc.getState().toggleLink(noteId, tid)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const highlightNote = hoverNote ?? activeNote
  const unlinkedTags = data.tags.filter((t) => !info.notesByTag.has(t.id))
  const railMinH = layout ? Math.max(...[...layout.notes.values()].map((p) => p.top - layout.railTop + p.height + 60), 0) : 0

  return (
    <div className="rail-inner" ref={railRef} style={{ minHeight: railMinH }}>
      <div className="rail-head">
        {selected.length > 0 ? (
          <div className="rail-batch">
            <span>已选 {selected.length} 条</span>
            <span className="spacer" />
            <button className="chip-btn is-accent" onClick={() => useUI.setState({ dialog: 'copy' })}>
              <IconCopy size={14} /> 复制给 AI
            </button>
            <button
              className="icon-btn"
              title="删除所选注释"
              onClick={() => {
                const ids = useUI.getState().selectedNotes
                useDoc.getState().removeNotes(ids)
                useUI.setState({ selectedNotes: [] })
                useUI.getState().toast(`已删除 ${ids.length} 条注释`, {
                  action: { label: '撤销', run: () => useDoc.getState().undo() },
                })
              }}
            >
              <IconTrash size={15} />
            </button>
            <button className="icon-btn" title="取消选择" onClick={() => useUI.setState({ selectedNotes: [] })}>
              <IconClose size={15} />
            </button>
          </div>
        ) : (
          <div className="rail-search">
            <IconSearch size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`搜索 ${data.notes.length} 条注释`} />
            <Menu
              title="筛选与批量操作"
              trigger={<IconMore size={15} />}
              items={[
                { label: '只看未解决', checked: filter === 'open', onSelect: () => setFilter('open') },
                { label: '显示全部（含已解决）', checked: filter === 'all', onSelect: () => setFilter('all') },
                { divider: true, label: '' },
                {
                  label: '全选可见注释',
                  onSelect: () => useUI.setState({ selectedNotes: visibleNotes.map((n) => n.id) }),
                },
                { label: '复制全部注释给 AI…', onSelect: () => useUI.setState({ dialog: 'copy', selectedNotes: [] }) },
              ]}
            />
          </div>
        )}
        {linkNote && (
          <div className="rail-linkbar">
            <IconLink size={14} />
            <span>点击正文中的标签来关联/取消，或选中文字新建标签</span>
            <button className="chip-btn" onClick={() => useUI.setState({ linkNote: null })}>
              完成
            </button>
          </div>
        )}
      </div>

      {data.notes.length === 0 && (
        <div className="rail-empty">
          <p>
            选中正文里的文字，点 <b>注释</b> 就能添加一条注释；也可以只点 <b>标签</b> 先打一个数字标签，稍后再写注释。
          </p>
          <p className="muted">一条注释可以连接多个标签：拖动注释左侧的小圆点到正文中的标签上即可连线。</p>
          {unlinkedTags.length > 0 && <p className="muted">当前有 {unlinkedTags.length} 个标签尚未添加注释。</p>}
        </div>
      )}

      {visibleNotes.map((n) => (
        <NoteCard
          key={n.id}
          note={n}
          top={layout?.notes.has(n.id) ? layout.notes.get(n.id)!.top - layout.railTop : -9999}
          numbers={info.numbers}
          selected={selected.includes(n.id)}
          active={activeNote === n.id}
          linking={linkNote === n.id}
          dim={!!highlightNote && highlightNote !== n.id}
          hoverTag={hoverTag ?? focusTag}
          onPortDown={(e) => startPortDrag(e, n.id)}
        />
      ))}

      {layout && (
        <svg
          className="links"
          style={{ left: -layout.railLeft, top: -layout.railTop, width: layout.pageW, height: Math.max(layout.pageH, railMinH + layout.railTop) }}
          width={layout.pageW}
          height={Math.max(layout.pageH, railMinH + layout.railTop)}
        >
          {/* 连线 */}
          {visibleNotes.map((n) => {
            const p = layout.notes.get(n.id)
            if (!p) return null
            const tx = layout.railLeft + 1
            const ty = p.top + 20
            const hot = highlightNote === n.id
            return n.tagIds.map((tid) => {
              const d = layout.dots.get(tid)
              if (!d) return null
              const tagHot = (hoverTag ?? focusTag) === tid
              return (
                <path
                  key={n.id + tid}
                  pathLength={1}
                  d={curve(d.x + 4, d.y, tx, ty)}
                  className={'link' + (hot || tagHot ? ' is-hot' : highlightNote ? ' is-dim' : '')}
                  style={{ stroke: `var(--nc-${n.color})` }}
                />
              )
            })
          })}
          {/* 悬停时：从正文徽标到槽中圆点的引导线 */}
          {[...layout.dots.values()].map((d) => {
            const notes = info.notesByTag.get(d.id) ?? []
            const hot =
              (hoverTag ?? focusTag) === d.id || (highlightNote && notes.some((n) => n.id === highlightNote))
            if (!hot || d.bx === null) return null
            return <line key={'g' + d.id} className="guide" x1={d.bx + 2} y1={d.y} x2={d.x - 5} y2={d.y} />
          })}
          {dragLine &&
            (() => {
              const p = layout.notes.get(dragLine.noteId)
              if (!p) return null
              return (
                <path
                  className="link is-hot is-drag"
                  d={curve(dragLine.x, dragLine.y, layout.railLeft + 1, p.top + 20)}
                  style={{ stroke: `var(--nc-${data.notes.find((n) => n.id === dragLine.noteId)?.color})` }}
                />
              )
            })()}
          {/* 槽中的圆点 */}
          {[...layout.dots.values()].map((d) => {
            const notes = info.notesByTag.get(d.id) ?? []
            const color = notes[0]?.color
            const hot =
              (hoverTag ?? focusTag) === d.id || (highlightNote && notes.some((n) => n.id === highlightNote))
            return (
              <g
                key={'d' + d.id}
                className={'dot' + (hot ? ' is-hot' : '') + (color ? '' : ' is-bare')}
                data-dot={d.id}
                style={color ? ({ '--tc': `var(--nc-${color})` } as React.CSSProperties) : undefined}
                onMouseEnter={() => useUI.setState({ hoverTag: d.id })}
                onMouseLeave={() => useUI.setState({ hoverTag: null })}
                onClick={() => {
                  const ln = useUI.getState().linkNote
                  if (ln) return useDoc.getState().toggleLink(ln, d.id)
                  const t = useDoc.getState().data.tags.find((x) => x.id === d.id)
                  if (t) reveal(t.from, undefined, t.id)
                  if (notes[0]) useUI.setState({ activeNote: notes[0].id })
                }}
              >
                <circle cx={d.x} cy={d.y} r={8.5} />
                <text x={d.x} y={d.y + 3.6} textAnchor="middle">
                  {info.numbers.get(d.id)}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

const NoteCard = memo(function NoteCard({
  note: n,
  top,
  numbers,
  selected,
  active,
  linking,
  dim,
  hoverTag,
  onPortDown,
}: {
  note: Note
  top: number
  numbers: Map<string, number>
  selected: boolean
  active: boolean
  linking: boolean
  dim: boolean
  hoverTag: string | null
  onPortDown: (e: React.PointerEvent) => void
}) {
  const ta = useRef<HTMLTextAreaElement>(null)
  // 只订阅本注释所连标签的原文（按文中顺序），避免逐键重渲染
  const quotesKey = useDoc((s) =>
    s.data.tags
      .filter((t) => n.tagIds.includes(t.id))
      .map((t) => `${t.id}\u0001${s.data.text.slice(t.from, t.to)}`)
      .join('\u0002'),
  )
  const tags = useMemo(
    () =>
      quotesKey
        .split('\u0002')
        .filter(Boolean)
        .map((x) => {
          const [id, q] = x.split('\u0001')
          return { id, q }
        }),
    [quotesKey],
  )
  const autoFocus = useUI((s) => s.activeNote === n.id && s.focusNoteInput === n.id)
  const goTag = (id: string) => {
    const t = useDoc.getState().data.tags.find((x) => x.id === id)
    if (t) reveal(t.from, undefined, t.id)
  }

  const placement = usePlacementClass(top > -9000)

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }, [n.text])

  // 卡片定位（可见）之后再聚焦输入框
  const visible = top > -9000
  useEffect(() => {
    if (autoFocus && visible && ta.current) {
      ta.current.focus()
      ta.current.setSelectionRange(ta.current.value.length, ta.current.value.length)
      useUI.setState({ focusNoteInput: null })
    }
  }, [autoFocus, visible])

  const sortedTags = tags

  const quote = (id: string) => {
    const t = tags.find((x) => x.id === id)
    if (!t) return ''
    const q = t.q.replace(/\s+/g, ' ')
    return q.length > 40 ? q.slice(0, 40) + '…' : q
  }

  return (
    <div
      className={
        'note' +
        (active ? ' is-active' : '') +
        (dim ? ' is-dim' : '') +
        (selected ? ' is-selected' : '') +
        (n.resolved ? ' is-resolved' : '') +
        (linking ? ' is-linking' : '') +
        placement
      }
      data-note={n.id}
      style={{ top, '--nc': `var(--nc-${n.color})` } as React.CSSProperties}
      onMouseEnter={() => useUI.setState({ hoverNote: n.id })}
      onMouseLeave={() => useUI.setState({ hoverNote: null })}
      onMouseDown={() => {
        if (useUI.getState().activeNote !== n.id) useUI.setState({ activeNote: n.id })
      }}
    >
      <span className="note-port" title="拖到正文中的标签上以连线" onPointerDown={onPortDown} />
      <div className="note-head">
        <button
          className={'note-check' + (selected ? ' is-on' : '')}
          title="选择（用于批量复制）"
          onClick={(e) => {
            e.stopPropagation()
            useUI.getState().toggleNoteSelected(n.id)
          }}
        >
          {selected && <IconCheck size={11} />}
        </button>
        <div className="note-tags">
          {sortedTags.length === 0 && <span className="muted small" title="原文可能已改写；点击 + 重新关联文字">待重新定位</span>}
          {sortedTags.map((t) => (
            <span
              key={t.id}
              className={'tag-chip' + (hoverTag === t.id ? ' is-hot' : '')}
              title={'「' + quote(t.id) + '」'}
              onMouseEnter={() => useUI.setState({ hoverTag: t.id })}
              onMouseLeave={() => useUI.setState({ hoverTag: null })}
            >
              <button className="tag-chip-n" onClick={() => goTag(t.id)}>
                {numbers.get(t.id)}
              </button>
              <button
                className="tag-chip-x"
                title="取消连接"
                onClick={(e) => {
                  e.stopPropagation()
                  useDoc.getState().unlinkTag(n.id, t.id)
                  useUI.setState({ hoverTag: null })
                }}
              >
                <IconClose size={9} />
              </button>
            </span>
          ))}
          <button
            className={'tag-chip is-add' + (linking ? ' is-on' : '')}
            title="关联更多标签"
            onClick={(e) => {
              e.stopPropagation()
              useUI.setState({ linkNote: linking ? null : n.id, activeNote: n.id })
            }}
          >
            {linking ? <IconCheck size={11} /> : <IconPlus size={11} />}
          </button>
        </div>
        <span className="note-time">{timeAgo(n.updated)}</span>
        <Menu
          title="更多"
          trigger={<IconMore size={14} />}
          items={[
            ...NOTE_COLORS.map((c) => ({
              label: (
                <span className="color-row">
                  <span className="color-dot" style={{ background: `var(--nc-${c})` }} /> {NOTE_COLOR_LABEL[c]}
                </span>
              ),
              checked: n.color === c,
              onSelect: () => useDoc.getState().updateNote(n.id, { color: c }),
            })),
            { divider: true, label: '' },
            {
              label: n.resolved ? '标记为未解决' : '标记为已解决',
              onSelect: () => useDoc.getState().updateNote(n.id, { resolved: !n.resolved }),
            },
            {
              label: '复制这条给 AI…',
              onSelect: () => useUI.setState({ selectedNotes: [n.id], dialog: 'copy' }),
            },
            {
              label: '删除注释',
              danger: true,
              onSelect: () => {
                useDoc.getState().removeNote(n.id)
                useUI.getState().toast('已删除注释', { action: { label: '撤销', run: () => useDoc.getState().undo() } })
              },
            },
          ]}
        />
      </div>
      <textarea
        ref={ta}
        className="note-text"
        value={n.text}
        placeholder="写下注释…"
        rows={1}
        onChange={(e) => useDoc.getState().updateNote(n.id, { text: e.target.value })}
        onFocus={() => useUI.setState({ activeNote: n.id })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
        }}
      />
      {active && sortedTags.length > 0 && (
        <div className="note-quotes">
          {sortedTags.map((t) => (
            <button key={t.id} className="note-quote" onClick={() => goTag(t.id)}>
              <span className="note-quote-n">{numbers.get(t.id)}</span>
              {quote(t.id)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

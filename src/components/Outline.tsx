import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useDoc } from '../store/docStore'
import { useUI } from '../store/uiStore'
import { useSel } from '../editor/setup'
import { cardDepth, sectionPath } from '../core/sections'
import { revealSection } from './reveal'
import { startTreeDrag } from './cards/dnd'
import { useWordCount } from './hooks'
import { measure, playFlip, type Snapshot } from './motion'

interface Row {
  id: string
  text: string
  level: number
  depth: number
  tags: number
  folded: boolean
}

export function Outline() {
  const tree = useDoc((s) => s.tree)
  const tags = useDoc((s) => s.data.tags)
  const cursor = useSel((s) => s.cursor)
  const collapsed = useUI((s) => s.collapsed)
  const mode = useUI((s) => s.mode)
  const listRef = useRef<HTMLDivElement>(null)
  const words = useWordCount()

  const current = useMemo(() => {
    if (cursor === null) return null
    const path = sectionPath(tree, cursor)
    return path[path.length - 1]?.id ?? null
  }, [tree, cursor])

  const rows = useMemo<Row[]>(() => {
    const items = tree.flat.filter((s) => s !== tree.title)
    const starts = tags.map((t) => t.from).sort((a, b) => a - b)
    const countIn = (from: number, to: number) => {
      let lo = 0
      let hi = starts.length
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (starts[m] < from) lo = m + 1
        else hi = m
      }
      let n = 0
      for (let i = lo; i < starts.length && starts[i] < to; i++) n++
      return n
    }
    const collapsedSet = new Set(collapsed)
    return items.map((s) => {
      let folded = false
      if (mode === 'cards' && collapsedSet.size) {
        for (let p = s.parent; p; p = p.parent) if (collapsedSet.has(p.id)) folded = true
      }
      return {
        id: s.id,
        text: s.heading?.text || '（无标题）',
        level: s.level,
        depth: cardDepth(tree, s),
        tags: countIn(s.from, s.to),
        folded,
      }
    })
  }, [tree, tags, collapsed, mode])

  // 顺序或层级变化时做 FLIP 动画（在渲染阶段记录旧位置）
  const orderKey = rows.map((r) => r.id + ':' + r.depth).join(',')
  const prevKey = useRef(orderKey)
  const snap = useRef<Snapshot | null>(null)
  if (prevKey.current !== orderKey) {
    prevKey.current = orderKey
    snap.current = measure(listRef.current, 'data-drag-item')
  }
  useLayoutEffect(() => {
    if (!snap.current) return
    playFlip(listRef.current, 'data-drag-item', snap.current, { enter: true })
    snap.current = null
  }, [orderKey])

  return (
    <nav className="outline">
      <div className="outline-head">
        <span className="outline-title">大纲</span>
        <span className="muted small">{words.toLocaleString()} 字</span>
      </div>
      {tree.title && (
        <button
          className={'outline-doc-title' + (current === tree.title.id ? ' is-current' : '')}
          onClick={() => revealSection(tree.title!.id)}
        >
          {tree.title.heading?.text || '（无标题）'}
        </button>
      )}
      <div className="outline-list" ref={listRef}>
        {rows.map((r) => (
          <OutlineRow key={r.id} row={r} current={current === r.id} listRef={listRef} />
        ))}
        {!rows.length && <p className="outline-empty">没有小标题。输入 “## ” 开头的一行即可创建。</p>}
      </div>
      <div className="outline-foot muted small">拖动标题可调整顺序，左右拖动改变层级</div>
    </nav>
  )
}

const OutlineRow = memo(
  function OutlineRow({
    row: r,
    current,
    listRef,
  }: {
    row: Row
    current: boolean
    listRef: React.RefObject<HTMLDivElement | null>
  }) {
    return (
      <div
        className={'outline-item' + (current ? ' is-current' : '') + (r.folded ? ' is-folded' : '')}
        data-drag-item={r.id}
        data-depth={r.depth}
        style={{ '--depth': r.depth } as React.CSSProperties}
      >
        <button
          className="outline-row"
          data-drag-head
          onClick={() => revealSection(r.id)}
          onPointerDown={(e) => {
            if (e.button !== 0 || !listRef.current) return
            startTreeDrag(e, r.id, { container: listRef.current, scroller: listRef.current, indent: 14 })
          }}
          title={r.text}
        >
          <span className={'outline-level l' + r.level}>H{r.level}</span>
          <span className="outline-text">{r.text}</span>
          {r.tags > 0 && <span className="outline-tags">{r.tags}</span>}
        </button>
      </div>
    )
  },
  (a, b) =>
    a.current === b.current &&
    a.row.text === b.row.text &&
    a.row.level === b.row.level &&
    a.row.depth === b.row.depth &&
    a.row.tags === b.row.tags &&
    a.row.folded === b.row.folded,
)

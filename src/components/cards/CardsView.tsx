import { ALT, SHIFT } from '../../core/platform'
import { useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { useDoc } from '../../store/docStore'
import { useUI } from '../../store/uiStore'
import { cardDepth, structureKey, type Section } from '../../core/sections'
import { registry } from '../../editor/registry'
import { CardEditor } from './CardEditor'
import { cardFocus } from './focus'
import { startTreeDrag } from './dnd'
import { animateOut, flash, measure, playFlip, type Snapshot } from '../motion'
import { Menu } from '../Menu'
import {
  IconChevron,
  IconDown,
  IconDuplicate,
  IconGrip,
  IconIndent,
  IconMore,
  IconOutdent,
  IconPlus,
  IconTrash,
  IconUnwrap,
  IconUp,
  IconCollapse,
  IconExpand,
} from '../icons'

const INDENT = 22

export function CardsView() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const keyRef = useRef(structureKey(useDoc.getState().tree))
  const pending = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const snap = useRef<Snapshot | null>(null)
  useUI((s) => s.collapsed)

  useEffect(() => {
    const unsub = useDoc.subscribe((s, p) => {
      if (s.tree === p.tree) return
      const k = structureKey(s.tree)
      if (k === keyRef.current) return
      const f = cardFocus.get()
      if (f && s.event?.origin === f) {
        pending.current = true
        return
      }
      keyRef.current = k
      pending.current = false
      // 结构变化前记录位置，渲染后做 FLIP 动画
      snap.current = measure(root.current, 'data-card')
      force()
    })
    const off = cardFocus.on((id) => {
      if (!id && pending.current) {
        keyRef.current = structureKey(useDoc.getState().tree)
        pending.current = false
        snap.current = measure(root.current, 'data-card')
        force()
      }
    })
    // 折叠/展开：同时对被切换的卡片做高度动画
    const offUI = useUI.subscribe((s, p) => {
      if (s.collapsed === p.collapsed) return
      const a = new Set(s.collapsed)
      const b = new Set(p.collapsed)
      const toggled = new Set([...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x))))
      snap.current = measure(root.current, 'data-card', toggled)
    })
    return () => {
      unsub()
      off()
      offUI()
    }
  }, [])

  useLayoutEffect(() => {
    if (snap.current) {
      playFlip(root.current, 'data-card', snap.current, { enter: true })
      snap.current = null
    }
    registry.requestLayout()
  })

  const tree = useDoc.getState().tree
  const collapseTo = (level: number | null) => {
    const ids: string[] = []
    for (const s of tree.flat) {
      if (s === tree.title) continue
      if (level !== null && cardDepth(tree, s) >= level - 1 && s.children.length) ids.push(s.id)
    }
    useUI.setState({ collapsed: ids })
  }

  return (
    <div className="cards" ref={root}>
      <div className="cards-toolbar">
        <span className="cards-toolbar-label">卡片 · {tree.flat.length - (tree.title ? 1 : 0)}</span>
        <span className="spacer" />
        <button className="chip-btn" onClick={() => collapseTo(1)} title="只显示顶层卡片">
          <IconCollapse size={14} /> 折叠到一级
        </button>
        <button className="chip-btn" onClick={() => collapseTo(2)} title="显示到第二层">
          二级
        </button>
        <button className="chip-btn" onClick={() => collapseTo(null)} title="全部展开">
          <IconExpand size={14} /> 全部展开
        </button>
      </div>
      {tree.title && (
        <div className="title-block">
          <CardEditor sectionId={tree.title.id} />
        </div>
      )}
      {tree.preamble && (
        <div className="card card-preamble" data-card="__preamble">
          <div className="card-meta">
            <span className="level-chip is-muted">{tree.flat.length ? '引言' : '正文'}</span>
          </div>
          <CardEditor sectionId="__preamble" placeholder="写点什么…" />
        </div>
      )}
      {tree.roots.map((s) => (
        <Card key={s.id} section={s} depth={0} root={root} />
      ))}
      {tree.flat.length === 0 && (
        <p className="cards-hint">
          这篇文章还没有小标题。卡片按标题切分——在正文中输入 <code>## 标题</code> 即可生成卡片。
        </p>
      )}
      <button
        className="card-add-end"
        onClick={() => {
          const pos = useDoc.getState().insertSection({ atEnd: true })
          if (pos !== null) focusNewHeading(pos)
        }}
      >
        <IconPlus size={15} /> 添加卡片
      </button>
    </div>
  )
}

function focusNewHeading(pos: number) {
  requestAnimationFrame(() => {
    const t = useDoc.getState().data.text
    const lineEnd = t.indexOf('\n', pos)
    const end = lineEnd < 0 ? t.length : lineEnd
    const hashes = /^#+\s*/.exec(t.slice(pos, end))?.[0].length ?? 0
    useUI.setState({ focusCard: { pos, select: [pos + hashes, end], seq: Date.now() } })
  })
}

function Card({ section: s, depth, root }: { section: Section; depth: number; root: React.RefObject<HTMLDivElement | null> }) {
  const collapsed = useUI((st) => st.collapsed.includes(s.id))
  const el = useRef<HTMLElement>(null)
  const id = s.id

  useEffect(() => {
    if (!collapsed || !el.current) return
    const entry = {
      id,
      from: () => useDoc.getState().tree.byId.get(id)?.from ?? -1,
      to: () => useDoc.getState().tree.byId.get(id)?.to ?? -1,
      el: el.current,
    }
    registry.addCollapsed(entry)
    return () => registry.removeCollapsed(id)
  }, [collapsed, id])

  const doc = () => useDoc.getState()
  const toggle = () => useUI.getState().toggleCollapsed(id)

  const moveKeepingFocus = (dir: 'up' | 'down' | 'left' | 'right') => {
    const focused = registry.focused()
    let offset: number | null = null
    if (focused && focused.sectionId === id) offset = focused.view.state.selection.main.head
    const ok = doc().shiftSection(id, dir)
    if (!ok) {
      useUI.getState().toast(dir === 'up' || dir === 'down' ? '已经到头了' : '无法再调整层级')
      return
    }
    const ns = doc().tree.byId.get(id)
    requestAnimationFrame(() => {
      if (ns && offset !== null) useUI.setState({ focusCard: { pos: ns.from + offset, seq: Date.now() } })
      flash(document.querySelector(`[data-card="${id}"]`))
    })
  }

  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (!e.altKey || !e.shiftKey) return
    const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }
    const dir = map[e.key]
    if (!dir) return
    // 只处理本卡片自己的编辑器（不处理子卡片冒泡上来的事件）
    const owner = (e.target as HTMLElement).closest('[data-card]')
    if (owner !== el.current) return
    e.preventDefault()
    e.stopPropagation()
    moveKeepingFocus(dir)
  }

  const del = () => {
    const name = s.heading?.text || '无标题'
    animateOut(el.current, () => {
      doc().deleteSection(id)
      useUI.getState().toast(`已删除「${name}」`, { action: { label: '撤销', run: () => doc().undo() } })
    })
  }

  const preview = collapsed ? collapsedPreview(s) : null
  const childCount = countDescendants(s)

  return (
    <section
      ref={el}
      className={'card d' + Math.min(depth, 4) + (collapsed ? ' is-collapsed' : '')}
      data-drag-item={id}
      data-depth={depth}
      data-card={id}
      onKeyDownCapture={onKeyDownCapture}
    >
      <div className="card-meta" data-drag-head>
        <button
          className="card-grip"
          title="拖动以调整顺序与层级（左右移动改变层级）"
          onPointerDown={(e) =>
            root.current &&
            startTreeDrag(e, id, { container: root.current, scroller: registry.scroller(), indent: INDENT })
          }
        >
          <IconGrip size={14} />
        </button>
        <button className={'card-fold' + (collapsed ? '' : ' is-open')} onClick={toggle} title={collapsed ? '展开' : '折叠'}>
          <IconChevron size={13} />
        </button>
        <Menu
          className="level-chip"
          align="left"
          title="更改标题层级（连同子卡片）"
          trigger={<>H{s.level}</>}
          items={() =>
            [1, 2, 3, 4, 5, 6].map((lv) => ({
              label: '#'.repeat(lv) + '  ' + lv + ' 级标题',
              checked: lv === s.level,
              onSelect: () => doc().renameHeadingLevel(id, lv),
            }))
          }
        />
        {childCount > 0 && <span className="card-count">{childCount} 张子卡片</span>}
        <span className="spacer" />
        <div className="card-actions">
          <button className="icon-btn" title={`上移（${ALT}${SHIFT}↑）`} onClick={() => moveKeepingFocus('up')}>
            <IconUp size={14} />
          </button>
          <button className="icon-btn" title={`下移（${ALT}${SHIFT}↓）`} onClick={() => moveKeepingFocus('down')}>
            <IconDown size={14} />
          </button>
          <button className="icon-btn" title={`升级：移出父卡片（${ALT}${SHIFT}←）`} onClick={() => moveKeepingFocus('left')}>
            <IconOutdent size={14} />
          </button>
          <button className="icon-btn" title={`降级：并入上一张卡片（${ALT}${SHIFT}→）`} onClick={() => moveKeepingFocus('right')}>
            <IconIndent size={14} />
          </button>
          <Menu
            title="更多"
            trigger={<IconMore size={15} />}
            items={[
              {
                label: '在下方添加同级卡片',
                icon: <IconPlus size={14} />,
                onSelect: () => {
                  const pos = doc().insertSection({ after: id })
                  if (pos !== null) focusNewHeading(pos)
                },
              },
              {
                label: '添加子卡片',
                icon: <IconPlus size={14} />,
                onSelect: () => {
                  if (collapsed) toggle()
                  const pos = doc().insertSection({ childOf: id })
                  if (pos !== null) focusNewHeading(pos)
                },
              },
              { label: '复制一份', icon: <IconDuplicate size={14} />, onSelect: () => doc().duplicateSection(id) },
              { divider: true, label: '' },
              {
                label: '去掉标题（正文并入上文）',
                icon: <IconUnwrap size={14} />,
                onSelect: () => doc().unwrapSection(id),
              },
              { label: '删除卡片（含子卡片）', icon: <IconTrash size={14} />, danger: true, onSelect: del },
            ]}
          />
        </div>
      </div>
      {collapsed ? (
        <button className="card-collapsed" onClick={toggle}>
          <span className={'card-collapsed-title h' + s.level}>{s.heading?.text || '（无标题）'}</span>
          {preview && <span className="card-collapsed-preview">{preview}</span>}
        </button>
      ) : (
        <>
          <CardEditor sectionId={id} />
          {s.children.length > 0 && (
            <div className="card-children">
              {s.children.map((c) => (
                <Card key={c.id} section={c} depth={depth + 1} root={root} />
              ))}
            </div>
          )}
        </>
      )}
      <button
        className="card-add-below"
        title="在下方添加同级卡片"
        onClick={() => {
          const pos = doc().insertSection({ after: id })
          if (pos !== null) focusNewHeading(pos)
        }}
      >
        <IconPlus size={12} />
      </button>
    </section>
  )
}

function countDescendants(s: Section): number {
  let n = s.children.length
  for (const c of s.children) n += countDescendants(c)
  return n
}

function collapsedPreview(s: Section) {
  const text = useDoc.getState().data.text
  const body = text
    .slice(s.heading ? s.heading.lineEnd : s.from, s.to)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return body.length > 80 ? body.slice(0, 80) + '…' : body
}

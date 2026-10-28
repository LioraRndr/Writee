import { useEffect, useRef, useState } from 'react'
import { useDoc, type FileStatus } from '../store/docStore'
import { useUI } from '../store/uiStore'
import { activateTab, closeOtherTabs, closeTab, closeTabsToRight, goHome, moveTab, useTabs, type TabInfo } from '../store/session'
import { ALT } from '../core/platform'
import { ContextMenu, type MenuItem } from './Menu'
import { IconClose, IconFile, IconPlus, IconSidebar } from './icons'

const STATUS_HINT: Partial<Record<FileStatus, string>> = {
  dirty: '未保存',
  saving: '保存中',
  error: '保存失败',
  conflict: '文件冲突',
  nopermission: '需要授权写入',
}

function statusTone(st: FileStatus | undefined) {
  if (st === 'dirty' || st === 'saving') return 'is-dirty'
  if (st === 'error' || st === 'conflict') return 'is-error'
  if (st === 'nopermission') return 'is-warn'
  return ''
}

/** 文件名去掉常见 Markdown 扩展名，标签页更紧凑；完整名称放在提示里 */
const shortName = (name: string) => name.replace(/\.(md|markdown|mdown)$/i, '') || name

/**
 * 标签页栏：默认横向放在顶栏下方；vertical 时放进左侧栏，与大纲切换。
 * 支持点击切换、中键 / × 关闭、拖动排序、右键菜单。
 */
export function TabStrip({ vertical = false }: { vertical?: boolean }) {
  const tabs = useTabs((s) => s.tabs)
  const active = useTabs((s) => s.active)
  const activeStatus = useDoc((s) => s.fileStatus)
  const setSettings = useUI((s) => s.setSettings)
  const strip = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null)

  // 当前标签页始终滚动到可见范围
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('.tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs.length])

  const place = (to: 'top' | 'left') =>
    setSettings(to === 'left' ? { tabsPosition: 'left', leftPanel: 'tabs', outlineOpen: true } : { tabsPosition: 'top', leftPanel: 'outline' })

  const menuItems = (id: string): MenuItem[] => {
    const i = tabs.findIndex((t) => t.id === id)
    return [
      { label: '关闭', onSelect: () => void closeTab(id) },
      { label: '关闭其他标签页', disabled: tabs.length < 2, onSelect: () => void closeOtherTabs(id) },
      { label: vertical ? '关闭下方标签页' : '关闭右侧标签页', disabled: i >= tabs.length - 1, onSelect: () => void closeTabsToRight(id) },
      { divider: true, label: '' },
      vertical
        ? { label: '标签页移到顶部', onSelect: () => place('top') }
        : { label: '标签页移到左侧栏', onSelect: () => place('left') },
    ]
  }

  const dropIndex = (e: React.DragEvent, index: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const after = vertical ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2
    return index + (after ? 1 : 0)
  }

  return (
    <div className={'tabstrip' + (vertical ? ' is-vertical' : '')}>
      {vertical && (
        <div className="tabstrip-head">
          <span className="muted small">拖动排序 · {ALT}1–9 切换</span>
          <button className="chip-btn" title="标签页移到顶部" onClick={() => place('top')}>
            移到顶部
          </button>
        </div>
      )}
      <div
        ref={strip}
        className="tabstrip-list"
        role="tablist"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        onWheel={(e) => {
          // 横向标签栏：竖向滚轮也能左右滚动
          if (vertical || !strip.current || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
          strip.current.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((t, i) => (
          <Tab
            key={t.id}
            tab={t}
            index={i}
            active={t.id === active}
            status={t.id === active ? activeStatus : t.status}
            dropBefore={drag?.over === i}
            dropAfter={drag?.over === tabs.length && i === tabs.length - 1}
            onMenu={(x, y) => setMenu({ x, y, id: t.id })}
            onDragStart={() => setDrag({ id: t.id, over: null })}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              const over = dropIndex(e, i)
              if (over !== drag.over) setDrag({ ...drag, over })
            }}
            onDrop={(e) => {
              if (!drag) return
              e.preventDefault()
              moveTab(drag.id, dropIndex(e, i))
              setDrag(null)
            }}
            onDragEnd={() => setDrag(null)}
          />
        ))}
        <button className="tab-new" title="打开其他文档" onClick={() => void goHome()}>
          <IconPlus size={14} />
          {vertical && <span>打开其他文档</span>}
        </button>
      </div>
      {!vertical && (
        <button className="icon-btn tabstrip-place" title="标签页移到左侧栏（与大纲切换）" onClick={() => place('left')}>
          <IconSidebar size={15} />
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />}
    </div>
  )
}

function Tab({
  tab,
  index,
  active,
  status,
  dropBefore,
  dropAfter,
  onMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  tab: TabInfo
  index: number
  active: boolean
  status: FileStatus | undefined
  dropBefore: boolean
  dropAfter: boolean
  onMenu: (x: number, y: number) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const tone = statusTone(status)
  const hint = status ? STATUS_HINT[status] : undefined
  return (
    <div
      className={'tab' + (active ? ' is-active' : '') + (dropBefore ? ' is-drop-before' : '') + (dropAfter ? ' is-drop-after' : '')}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      data-tab={tab.id}
      title={tab.name + (hint ? ` · ${hint}` : '') + (index < 9 ? `（${ALT}${index + 1}）` : '')}
      draggable
      onClick={() => void activateTab(tab.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void activateTab(tab.id)
        }
      }}
      onMouseDown={(e) => {
        // 中键关闭
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button === 1) void closeTab(tab.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', tab.name)
        onDragStart()
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <span className={'tab-icon ' + tone}>
        <IconFile size={13} />
      </span>
      <span className="tab-name">{shortName(tab.name)}</span>
      <button
        className={'tab-close ' + tone}
        title="关闭"
        aria-label={'关闭 ' + tab.name}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void closeTab(tab.id)
        }}
      >
        <IconClose size={12} />
      </button>
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: ReactNode
  hint?: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect?: () => void
  divider?: boolean
}

export function Menu({
  trigger,
  items,
  className,
  title,
  align = 'right',
}: {
  trigger: ReactNode
  items: MenuItem[] | (() => MenuItem[])
  className?: string
  title?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return
    const r = btn.current.getBoundingClientRect()
    const pw = pop.current.offsetWidth
    const ph = pop.current.offsetHeight
    let left = align === 'right' ? r.right - pw : r.left
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left))
    let top = r.bottom + 6
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 6
    setPos({ top, left })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const list = open ? (typeof items === 'function' ? items() : items) : []
  return (
    <>
      <button
        ref={btn}
        className={'icon-btn ' + (className ?? '') + (open ? ' is-on' : '')}
        title={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setPos(null)
          setOpen((o) => !o)
        }}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <MenuItems items={list} onClose={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </>
  )
}

function MenuItems({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="menu-divider" />
        ) : (
          <button
            key={i}
            className={'menu-item' + (it.danger ? ' is-danger' : '') + (it.checked ? ' is-checked' : '')}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onSelect?.()
            }}
          >
            <span className="menu-icon">{it.icon}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </>
  )
}

/** 右键菜单：在指针位置弹出，样式与普通菜单一致 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!pop.current) return
    const pw = pop.current.offsetWidth
    const ph = pop.current.offsetHeight
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - pw - 8, x)),
      top: y + ph > window.innerHeight - 8 ? Math.max(8, y - ph) : y,
    })
  }, [x, y])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={pop}
      className="menu"
      role="menu"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItems items={items} onClose={onClose} />
    </div>,
    document.body,
  )
}

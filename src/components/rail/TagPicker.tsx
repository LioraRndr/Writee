import { useMemo, useState } from 'react'
import { CATEGORIES } from '../../analysis/taxonomy'

export function TagPicker({
  value,
  onToggle,
  onClose,
  autoFocus = true,
}: {
  value: string[]
  onToggle: (id: string) => void
  onClose?: () => void
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const cats = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return CATEGORIES
    return CATEGORIES.map((c) => ({
      ...c,
      tags: c.tags.filter((t) => t.label.includes(k) || t.id.includes(k) || t.desc.includes(k) || c.label.includes(k)),
    })).filter((c) => c.tags.length)
  }, [q])
  return (
    <div
      className="tag-picker"
      onMouseDown={(e) => {
        e.stopPropagation()
        // 点击标签按钮时不抢走编辑器焦点；搜索框除外
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      <input
        className="tag-picker-search"
        autoFocus={autoFocus}
        placeholder="搜索标签：如 对比、论据、排比…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
      />
      <div className="tag-picker-body">
        {cats.map((c) => (
          <div key={c.id} className="tag-picker-cat" style={{ '--uc': `var(--cat-${c.id})` } as React.CSSProperties}>
            <div className="tag-picker-cat-label">{c.label}</div>
            <div className="tag-picker-tags">
              {c.tags.map((t) => (
                <button
                  key={t.id}
                  className={'utag' + (value.includes(t.id) ? ' is-on' : '')}
                  title={t.desc}
                  onClick={() => onToggle(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

import { StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

export interface OverlayTag {
  id: string
  from: number
  to: number
  n: number
  color: string | null
  state: '' | 'hover' | 'active' | 'dim' | 'linking'
}

export interface OverlayUnit {
  id: string
  from: number
  to: number
  cat: string
  label: string
  active: boolean
  dim: boolean
}

export interface OverlaySpec {
  tags: OverlayTag[]
  units: OverlayUnit[]
  edits: { from: number; to: number }[]
}

export const setOverlay = StateEffect.define<OverlaySpec>()

class BadgeWidget extends WidgetType {
  constructor(readonly tag: OverlayTag) {
    super()
  }
  eq(o: BadgeWidget) {
    const a = this.tag
    const b = o.tag
    return a.id === b.id && a.n === b.n && a.color === b.color && a.state === b.state
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'wt-badge' + (this.tag.state ? ' is-' + this.tag.state : '') + (this.tag.color ? '' : ' is-bare')
    s.dataset.tagBadge = this.tag.id
    if (this.tag.color) s.style.setProperty('--tc', `var(--nc-${this.tag.color})`)
    s.textContent = String(this.tag.n)
    s.title = this.tag.color ? '标签 ' + this.tag.n : '标签 ' + this.tag.n + '（未添加注释）'
    return s
  }
  ignoreEvent() {
    return true
  }
}

class UnitStartWidget extends WidgetType {
  constructor(readonly unit: OverlayUnit) {
    super()
  }
  eq(o: UnitStartWidget) {
    return o.unit.id === this.unit.id && o.unit.cat === this.unit.cat && o.unit.active === this.unit.active
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'wt-unit-start' + (this.unit.active ? ' is-active' : '')
    s.dataset.unitStart = this.unit.id
    s.style.setProperty('--uc', `var(--cat-${this.unit.cat})`)
    return s
  }
  ignoreEvent() {
    return true
  }
}

class EditPointWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'wt-edit-point'
    s.title = '此处有删除'
    return s
  }
}

function build(spec: OverlaySpec, len: number): DecorationSet {
  const decos: Range<Decoration>[] = []
  const clip = (p: number) => Math.max(0, Math.min(len, p))
  for (const u of spec.units) {
    const from = clip(u.from)
    const to = clip(u.to)
    if (to <= from) continue
    decos.push(
      Decoration.mark({
        class: 'wt-unit' + (u.active ? ' is-active' : '') + (u.dim ? ' is-dim' : ''),
        attributes: { 'data-unit': u.id, style: `--uc: var(--cat-${u.cat})` },
      }).range(from, to),
    )
    decos.push(Decoration.widget({ widget: new UnitStartWidget(u), side: -1 }).range(from))
  }
  for (const e of spec.edits) {
    const from = clip(e.from)
    const to = clip(e.to)
    if (to > from) decos.push(Decoration.mark({ class: 'wt-edited' }).range(from, to))
    else decos.push(Decoration.widget({ widget: new EditPointWidget(), side: 1 }).range(from))
  }
  for (const t of spec.tags) {
    const from = clip(t.from)
    const to = clip(t.to)
    if (to <= from) continue
    decos.push(
      Decoration.mark({
        class: 'wt-tag' + (t.state ? ' is-' + t.state : '') + (t.color ? '' : ' is-bare'),
        attributes: { 'data-tag': t.id, style: t.color ? `--tc: var(--nc-${t.color})` : '' },
      }).range(from, to),
    )
    decos.push(Decoration.widget({ widget: new BadgeWidget(t), side: 1 }).range(to))
  }
  return Decoration.set(decos, true)
}

export const overlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    let next = tr.docChanged ? v.map(tr.changes) : v
    for (const e of tr.effects) if (e.is(setOverlay)) next = build(e.value, tr.state.doc.length)
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

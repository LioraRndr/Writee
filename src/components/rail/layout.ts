import { posBox, registry } from '../../editor/registry'

export interface Dot {
  id: string
  x: number
  y: number
  /** 正文中徽标的位置（用于悬停时的引导线） */
  bx: number | null
}

export const GUTTER = 52
const DOT_COL = 15

/** 计算每个锚点（标签或结构单元）在页面坐标中的位置，并在槽中错开排列 */
export function computeDots(
  anchors: { id: string; pos: number; side?: 1 | -1; badgeSelector?: string }[],
  gutterLeft: number,
): Map<string, Dot> {
  const page = registry.page()
  const out = new Map<string, Dot>()
  if (!page) return out
  const pr = page.getBoundingClientRect()
  const raw: { id: string; y: number; bx: number | null }[] = []
  for (const a of anchors) {
    let y: number | null = null
    let bx: number | null = null
    if (a.badgeSelector) {
      const el = page.querySelector<HTMLElement>(a.badgeSelector)
      if (el && el.offsetParent) {
        const r = el.getBoundingClientRect()
        y = (r.top + r.bottom) / 2 - pr.top
        bx = r.right - pr.left
      }
    }
    if (y === null) {
      const b = posBox(a.pos, a.side ?? -1)
      if (!b) continue
      y = (b.top + b.bottom) / 2
      bx = b.approx ? null : b.right
    }
    raw.push({ id: a.id, y, bx })
  }
  raw.sort((a, b) => a.y - b.y)
  const lastInCol: number[] = []
  for (const r of raw) {
    let col = 0
    while (col < 2 && lastInCol[col] !== undefined && r.y - lastInCol[col] < 17) col++
    lastInCol[col] = r.y
    out.set(r.id, { id: r.id, x: gutterLeft + 12 + col * DOT_COL, y: r.y, bx: r.bx })
  }
  return out
}

export interface Placed {
  id: string
  top: number
  height: number
}

/** 让卡片尽量贴近各自的锚点，同时互不重叠；active 卡片优先贴齐 */
export function placeStack(
  items: { id: string; anchor: number; height: number }[],
  opts: { gap: number; minTop: number; activeId?: string | null },
): Map<string, Placed> {
  const sorted = items.slice().sort((a, b) => a.anchor - b.anchor)
  const out = new Map<string, Placed>()
  const tops: number[] = sorted.map((it) => Math.max(opts.minTop, it.anchor))
  const ai = opts.activeId ? sorted.findIndex((x) => x.id === opts.activeId) : -1
  if (ai >= 0) {
    for (let i = ai + 1; i < sorted.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + sorted[i - 1].height + opts.gap)
    for (let i = ai - 1; i >= 0; i--) tops[i] = Math.min(tops[i], tops[i + 1] - sorted[i].height - opts.gap)
    // 向上挤出边界时，整体再向下推
    if (tops[0] < opts.minTop) {
      tops[0] = opts.minTop
      for (let i = 1; i < sorted.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + sorted[i - 1].height + opts.gap)
    }
  } else {
    for (let i = 1; i < sorted.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + sorted[i - 1].height + opts.gap)
  }
  sorted.forEach((it, i) => out.set(it.id, { id: it.id, top: tops[i], height: it.height }))
  return out
}

export function curve(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(24, (x2 - x1) * 0.55)
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

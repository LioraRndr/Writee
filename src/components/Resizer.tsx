import { SIZE_LIMITS, useUI, type Settings } from '../store/uiStore'
import { registry } from '../editor/registry'

type SizeKey = 'outlineWidth' | 'railWidth'

const CSS_VAR: Record<SizeKey, string> = { outlineWidth: '--outline-w', railWidth: '--rail' }

/**
 * 侧栏宽度拖拽手柄。拖动时直接改 CSS 变量（不触发 React 重渲染），松手后写入设置。
 * dir = 1：向右拖变宽（左侧栏）；dir = -1：向左拖变宽（右侧栏）。双击恢复默认。
 */
export function Resizer({ k, dir, className }: { k: SizeKey; dir: 1 | -1; className?: string }) {
  const lim = SIZE_LIMITS[k]
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const start = useUI.getState().settings[k]
    let w = start
    document.body.classList.add('is-resizing')
    el.classList.add('is-active')
    const root = document.documentElement
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.max(lim.min, Math.min(lim.max, start + (ev.clientX - startX) * dir)))
      root.style.setProperty(CSS_VAR[k], w + 'px')
      registry.requestLayout()
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      document.body.classList.remove('is-resizing')
      el.classList.remove('is-active')
      useUI.getState().setSettings({ [k]: w } as Partial<Settings>)
      registry.requestLayout()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  return (
    <div
      className={'resizer ' + (className ?? '')}
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        useUI.getState().setSettings({ [k]: lim.def } as Partial<Settings>)
        registry.requestLayout()
      }}
    />
  )
}

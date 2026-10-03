/** 动效工具：FLIP 重排动画、进出场、平滑滚动。系统开启“减少动态效果”时全部跳过。 */

export const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)'

export function reducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface Snapshot {
  rects: Map<string, { top: number; left: number; height: number }>
  /** 需要同时做高度动画的元素（如折叠/展开的卡片） */
  heightIds?: Set<string>
}

/** 记录容器内带 attr 属性的元素相对容器的位置（滚动不影响） */
export function measure(container: HTMLElement | null, attr: string, heightIds?: Set<string>): Snapshot | null {
  if (!container || reducedMotion()) return null
  const cr = container.getBoundingClientRect()
  const rects = new Map<string, { top: number; left: number; height: number }>()
  container.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
    const r = el.getBoundingClientRect()
    rects.set(el.getAttribute(attr)!, { top: r.top - cr.top, left: r.left - cr.left, height: r.height })
  })
  return { rects, heightIds }
}

/**
 * 播放 FLIP：元素从旧位置平滑移动到新位置；新出现的元素淡入。
 * 嵌套元素只补偿相对父元素的位移，避免重复叠加。
 */
export function playFlip(container: HTMLElement | null, attr: string, snap: Snapshot | null, opts: { enter?: boolean } = {}) {
  if (!container || !snap) return
  const cr = container.getBoundingClientRect()
  const els = [...container.querySelectorAll<HTMLElement>(`[${attr}]`)]
  const delta = new Map<HTMLElement, number>()
  for (const el of els) {
    const id = el.getAttribute(attr)!
    const old = snap.rects.get(id)
    const r = el.getBoundingClientRect()
    if (!old) {
      if (opts.enter)
        el.animate([{ opacity: 0, transform: 'translateY(-6px) scale(0.985)' }, { opacity: 1, transform: 'none' }], {
          duration: 280,
          easing: EASE,
        })
      continue
    }
    const dy = old.top - (r.top - cr.top)
    const dx = old.left - (r.left - cr.left)
    let parentDy = 0
    for (let p = el.parentElement; p && p !== container; p = p.parentElement) {
      if (p.hasAttribute(attr) && delta.has(p)) {
        parentDy = delta.get(p)!
        break
      }
    }
    delta.set(el, dy)
    const rel = dy - parentDy
    if (Math.abs(rel) > 1 || Math.abs(dx) > 1) {
      el.animate([{ transform: `translate(${dx}px, ${rel}px)` }, { transform: 'none' }], { duration: 300, easing: EASE })
    }
    if (snap.heightIds?.has(id) && Math.abs(old.height - r.height) > 2) {
      const prev = el.style.overflow
      el.style.overflow = 'clip'
      el.animate([{ height: old.height + 'px' }, { height: r.height + 'px' }], { duration: 300, easing: EASE }).finished.then(
        () => (el.style.overflow = prev),
        () => (el.style.overflow = prev),
      )
    }
  }
}

/** 元素收起淡出后再执行回调（用于删除卡片等） */
export function animateOut(el: HTMLElement | null, done: () => void) {
  if (!el || reducedMotion()) return done()
  const cs = getComputedStyle(el)
  el.style.overflow = 'clip'
  const a = el.animate(
    [
      { opacity: 1, height: el.offsetHeight + 'px', marginTop: cs.marginTop, marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
      { opacity: 0, height: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' },
    ],
    { duration: 220, easing: EASE, fill: 'forwards' },
  )
  a.finished.then(done, done)
}

/** 短暂高亮一个元素 */
export function flash(el: Element | null) {
  if (!el) return
  el.classList.remove('is-flash')
  void (el as HTMLElement).offsetWidth
  el.classList.add('is-flash')
}

let scrollAnim = 0

/** 平滑滚动到指定 scrollTop；距离过远时直接跳转 */
export function smoothScroll(scroller: HTMLElement, top: number, after?: () => void) {
  cancelAnimationFrame(scrollAnim)
  const start = scroller.scrollTop
  const max = scroller.scrollHeight - scroller.clientHeight
  const target = Math.max(0, Math.min(max, top))
  const dist = target - start
  if (reducedMotion() || Math.abs(dist) < 2 || Math.abs(dist) > scroller.clientHeight * 4) {
    scroller.scrollTop = target
    after?.()
    return
  }
  const dur = Math.min(520, 220 + Math.abs(dist) * 0.12)
  const t0 = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / dur)
    const e = 1 - Math.pow(1 - t, 3)
    scroller.scrollTop = start + dist * e
    if (t < 1) scrollAnim = requestAnimationFrame(step)
    else after?.()
  }
  scrollAnim = requestAnimationFrame(step)
}

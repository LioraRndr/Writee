import { reducedMotion } from '../motion'

/**
 * 卡片折叠/展开的交叉过渡：
 * 在 React 移除旧内容之前，把它克隆成不占布局的幽灵层，与新内容做模糊交叉过渡。
 * 标题在折叠前后位置与字形完全一致，所以幽灵层里的标题隐藏，真实标题全程不参与动画。
 * 新内容的淡入由 CSS 根据 data-fold 属性完成（属性不受 React 管理，不会被重渲染覆盖）。
 */

const ghosts = new WeakMap<HTMLElement, HTMLElement>()
const timers = new WeakMap<HTMLElement, number>()

/** 幽灵层淡出时长；新内容淡入见 cards.css 的 card-fold-in */
export const FOLD_GHOST_MS = 200
/** 新内容的 CSS 动画在此之前都已开始 */
const FOLD_SETTLE_MS = 120

function inView(el: HTMLElement, scroller: HTMLElement | null) {
  const r = el.getBoundingClientRect()
  const top = scroller ? scroller.getBoundingClientRect().top : 0
  const bottom = scroller ? scroller.getBoundingClientRect().bottom : innerHeight
  return r.bottom > top - 200 && r.top < bottom + 200
}

/** 去掉克隆里所有会被其他逻辑识别的属性（卡片 id、标签徽标、焦点等） */
function sanitize(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    for (const a of [...el.attributes]) {
      if (a.name.startsWith('data-') || a.name === 'id' || a.name === 'contenteditable' || a.name === 'tabindex') el.removeAttribute(a.name)
    }
  }
  root.querySelectorAll('.cm-cursorLayer, .cm-selectionLayer, .cm-tooltip, .card-add-below').forEach((e) => e.remove())
  root.querySelectorAll('.cm-focused').forEach((e) => e.classList.remove('cm-focused'))
  return root
}

export function clearFold(card: HTMLElement) {
  window.clearTimeout(timers.get(card))
  timers.delete(card)
  ghosts.get(card)?.remove()
  ghosts.delete(card)
  delete card.dataset.fold
}

/** 必须在折叠状态变化之后、React 重新渲染之前调用（此时 DOM 仍是旧内容） */
export function beginFold(card: HTMLElement, opening: boolean, scroller: HTMLElement | null) {
  clearFold(card)
  if (reducedMotion() || !inView(card, scroller)) return
  card.dataset.fold = opening ? 'opening' : 'closing'
  const parts = [...card.children].filter((c) =>
    opening ? c.matches('.card-collapsed') : c.matches('.card-editor, .card-children'),
  ) as HTMLElement[]
  if (parts.length) {
    const ghost = document.createElement('div')
    ghost.className = 'card-fold-ghost'
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    ghost.style.top = parts[0].offsetTop + 'px'
    ghost.style.left = parts[0].offsetLeft + 'px'
    ghost.style.width = parts[0].offsetWidth + 'px'
    for (const p of parts) ghost.appendChild(sanitize(p.cloneNode(true) as HTMLElement))
    // 标题由真实元素原位显示，幽灵层只保留正文 / 摘要
    const title = opening
      ? ghost.querySelector<HTMLElement>('.card-collapsed-title')
      : ghost.querySelector<HTMLElement>('.cm-content > :first-child')
    if (title) title.style.visibility = 'hidden'
    card.appendChild(ghost)
    ghosts.set(card, ghost)
    const fade = ghost.animate(
      [
        { opacity: 1, filter: 'blur(0)' },
        { opacity: 0, filter: 'blur(4px)' },
      ],
      { duration: FOLD_GHOST_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    )
    const drop = () => {
      ghost.remove()
      if (ghosts.get(card) === ghost) ghosts.delete(card)
    }
    fade.finished.then(drop, drop)
  }
  // 新内容的淡入是 CSS 动画：等它们全部结束再移除标记，掉帧时也不会被提前打断
  const settle = () => {
    const running = card
      .getAnimations({ subtree: true })
      .filter((a) => (a as CSSAnimation).animationName === 'card-fold-in' && a.playState !== 'finished')
    if (!running.length) return clearFold(card)
    const done = () => {
      if (timers.get(card) === token) clearFold(card)
    }
    void Promise.all(running.map((a) => a.finished)).then(done, done)
  }
  const token = window.setTimeout(settle, FOLD_SETTLE_MS)
  timers.set(card, token)
}

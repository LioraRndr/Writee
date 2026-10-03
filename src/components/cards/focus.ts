/** 记录当前获得焦点的卡片编辑器；卡片视图在其输入期间推迟结构重排 */
let focused: string | null = null
const listeners = new Set<(id: string | null) => void>()

export const cardFocus = {
  get: () => focused,
  set(id: string | null) {
    if (focused === id) return
    focused = id
    for (const fn of listeners) fn(id)
  },
  on(fn: (id: string | null) => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

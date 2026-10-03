import { useEffect, useLayoutEffect, useState } from 'react'
import { useDoc } from '../store/docStore'
import { countWords } from '../core/derive'

/** 字数统计：停顿后再计算，避免长文逐键重算 */
export function useWordCount(delay = 400) {
  const [n, setN] = useState(() => countWords(useDoc.getState().data.text))
  useEffect(() => {
    let timer = 0
    let last = useDoc.getState().data.text
    setN(countWords(last))
    const unsub = useDoc.subscribe((s) => {
      if (s.data.text === last) return
      last = s.data.text
      clearTimeout(timer)
      timer = window.setTimeout(() => setN(countWords(last)), delay)
    })
    return () => {
      unsub()
      clearTimeout(timer)
    }
  }, [delay])
  return n
}

/**
 * 绝对定位卡片（注释、结构标签）的入场状态：
 * 未定位时隐藏；首次定位后的一帧关闭 top 过渡，避免从屏幕外“飞入”。
 */
export function usePlacementClass(placed: boolean) {
  const [settled, setSettled] = useState(placed)
  useLayoutEffect(() => {
    if (!placed || settled) return
    const r = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(r)
  }, [placed, settled])
  return !placed ? ' is-unplaced' : !settled ? ' is-settling' : ''
}

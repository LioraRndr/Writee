import { ChangeSet, type ChangeSpec } from '@codemirror/state'
import type { PosMapper } from './mapping'
import { parseHeadings } from './sections'

/** 生成：把 [from, to) 内所有标题的层级整体平移 delta 的变更集 */
export function levelShiftChanges(text: string, from: number, to: number, delta: number): ChangeSet {
  const specs: ChangeSpec[] = []
  if (delta !== 0) {
    for (const h of parseHeadings(text)) {
      if (h.from < from || h.from >= to) continue
      const hashAt = text.indexOf('#', h.from)
      const level = Math.max(1, Math.min(6, h.level + delta))
      const d = level - h.level
      if (d > 0) specs.push({ from: hashAt, insert: '#'.repeat(d) })
      else if (d < 0) specs.push({ from: hashAt, to: hashAt - d })
    }
  }
  return ChangeSet.of(specs, text.length)
}

export interface MoveResult {
  text: string
  map: PosMapper
  /** 移动后块的起点 */
  newFrom: number
}

/** 把 [from, to) 的文本块移动到 at（at 必须不在块内部） */
export function moveBlock(text: string, from: number, to: number, at: number): MoveResult {
  const raw = text.slice(from, to)
  const body = raw.replace(/\s+$/, '')
  const removedLen = to - from
  const rest = text.slice(0, from) + text.slice(to)
  const at2 = at >= to ? at - removedLen : at
  const atEnd = at2 >= rest.length
  let prefix = ''
  if (at2 > 0) {
    if (atEnd) prefix = rest.endsWith('\n\n') ? '' : rest.endsWith('\n') ? '\n' : '\n\n'
    else if (rest[at2 - 1] !== '\n') prefix = '\n\n'
  }
  const suffix = atEnd ? '\n' : '\n\n'
  const insert = prefix + body + suffix
  const newText = rest.slice(0, at2) + insert + rest.slice(at2)
  const blockStart = at2 + prefix.length
  const map: PosMapper = (p, assoc) => {
    if (p >= from && p < to) return blockStart + Math.min(p - from, body.length)
    const q = p < from ? p : p - removedLen
    if (q < at2) return q
    if (q > at2) return q + insert.length
    return assoc < 0 ? q : q + insert.length
  }
  return { text: newText, map, newFrom: blockStart }
}

export function applyChangesToString(text: string, changes: ChangeSet): string {
  let out = ''
  let pos = 0
  changes.iterChanges((fromA, toA, _fb, _tb, inserted) => {
    out += text.slice(pos, fromA) + inserted.toString()
    pos = toA
  })
  return out + text.slice(pos)
}

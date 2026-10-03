import { ChangeSet, type ChangeSpec } from '@codemirror/state'
import DiffMatchPatch from 'diff-match-patch'
import type { DocData, EditRange } from './types'

export type PosMapper = (pos: number, assoc: -1 | 1) => number

export function mapperFromChanges(cs: ChangeSet): PosMapper {
  return (pos, assoc) => cs.mapPos(Math.min(pos, cs.length), assoc)
}

/** 用 diff 生成从 oldText 到 newText 的变更集（用于外部修改、撤销等整体替换场景） */
export function diffChanges(oldText: string, newText: string): ChangeSet {
  if (oldText === newText) return ChangeSet.empty(oldText.length)
  // 先剥离公共前后缀，diff 只作用于中间部分，速度更快
  let start = 0
  const minLen = Math.min(oldText.length, newText.length)
  while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++
  let endA = oldText.length
  let endB = newText.length
  while (endA > start && endB > start && oldText.charCodeAt(endA - 1) === newText.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  const a = oldText.slice(start, endA)
  const b = newText.slice(start, endB)
  const specs: ChangeSpec[] = []
  if (!a || !b) {
    specs.push({ from: start, to: endA, insert: b })
  } else {
    const dmp = new DiffMatchPatch()
    dmp.Diff_Timeout = 0.5
    const diffs = dmp.diff_main(a, b)
    dmp.diff_cleanupSemantic(diffs)
    let pos = start
    for (const [op, t] of diffs) {
      if (op === 0) pos += t.length
      else if (op === -1) {
        specs.push({ from: pos, to: pos + t.length })
        pos += t.length
      } else specs.push({ from: pos, insert: t })
    }
  }
  return ChangeSet.of(specs, oldText.length)
}

/** 最小替换（公共前后缀之外的部分），用于把外部文本同步进编辑器视图 */
export function minimalChange(oldText: string, newText: string): { from: number; to: number; insert: string } | null {
  if (oldText === newText) return null
  let start = 0
  const minLen = Math.min(oldText.length, newText.length)
  while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++
  let endA = oldText.length
  let endB = newText.length
  while (endA > start && endB > start && oldText.charCodeAt(endA - 1) === newText.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  return { from: start, to: endA, insert: newText.slice(start, endB) }
}

export function mergeRanges(ranges: EditRange[]): EditRange[] {
  if (ranges.length < 2) return ranges.slice()
  const sorted = ranges.slice().sort((a, b) => a.from - b.from || a.to - b.to)
  const out: EditRange[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i]
    const last = out[out.length - 1]
    if (r.from <= last.to) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
}

/** 把所有带位置的数据映射到新文本 */
export function mapData(data: DocData, newText: string, map: PosMapper): DocData {
  const len = newText.length
  const clamp = (p: number) => Math.max(0, Math.min(len, p))
  const removedTags = new Set<string>()
  const tags = []
  for (const t of data.tags) {
    const from = clamp(map(t.from, 1))
    const to = clamp(map(t.to, -1))
    if (to > from) tags.push(from === t.from && to === t.to ? t : { ...t, from, to })
    else removedTags.add(t.id)
  }
  const notes = removedTags.size
    ? data.notes.map((n) =>
        n.tagIds.some((id) => removedTags.has(id)) ? { ...n, tagIds: n.tagIds.filter((id) => !removedTags.has(id)) } : n,
      )
    : data.notes
  const edits = mergeRanges(
    data.edits.map((e) => {
      const from = clamp(map(e.from, -1))
      const to = Math.max(from, clamp(map(e.to, 1)))
      return { from, to }
    }),
  )
  let analysis = data.analysis
  if (analysis) {
    const units = []
    for (const u of analysis.units) {
      const from = clamp(map(u.from, 1))
      const to = clamp(map(u.to, -1))
      if (to > from) units.push(from === u.from && to === u.to ? u : { ...u, from, to })
    }
    analysis = { ...analysis, units }
  }
  const anchors = data.anchors.map((a) => ({ id: a.id, pos: clamp(map(a.pos, 1)) }))
  return { text: newText, tags, notes, edits, analysis, anchors }
}

/** 把一次用户输入产生的变更区域记为手动修改 */
export function recordEdits(edits: EditRange[], changes: ChangeSet): EditRange[] {
  const added: EditRange[] = []
  changes.iterChanges((_fa, _ta, fromB, toB) => added.push({ from: fromB, to: toB }))
  if (!added.length) return edits
  return mergeRanges(edits.concat(added))
}

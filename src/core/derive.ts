import type { DocData, Note } from './types'
import { tagNumbers } from '../store/docStore'

export interface TagInfo {
  numbers: Map<string, number>
  notesByTag: Map<string, Note[]>
}

let lastTags: unknown = null
let lastNotes: unknown = null
let cached: TagInfo | null = null

/** 标签编号与“标签 → 注释”索引（按 data 引用缓存） */
export function tagInfo(data: DocData): TagInfo {
  if (cached && lastTags === data.tags && lastNotes === data.notes) return cached
  const numbers = tagNumbers(data.tags)
  const notesByTag = new Map<string, Note[]>()
  for (const n of data.notes) {
    for (const id of n.tagIds) {
      const arr = notesByTag.get(id)
      if (arr) arr.push(n)
      else notesByTag.set(id, [n])
    }
  }
  lastTags = data.tags
  lastNotes = data.notes
  cached = { numbers, notesByTag }
  return cached
}

/** 统计字数：中日韩字符逐字计数，西文按词计数 */
export function countWords(text: string) {
  const body = text.replace(/```[\s\S]*?```/g, '').replace(/[#>*_`~\-|[\]()!]/g, ' ')
  const cjk = body.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g)?.length ?? 0
  const latin = body.replace(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
  return cjk + latin
}

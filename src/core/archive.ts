import { createStore, get, set, del } from 'idb-keyval'
import type { DocArchive, DocIndexEntry } from './types'

const store = createStore('writee', 'archives')
const INDEX = 'index'

export async function loadIndex(): Promise<DocIndexEntry[]> {
  return ((await get<DocIndexEntry[]>(INDEX, store)) ?? []).sort((a, b) => b.updated - a.updated)
}

let indexChain: Promise<unknown> = Promise.resolve()

async function updateIndex(fn: (list: DocIndexEntry[]) => DocIndexEntry[]) {
  indexChain = indexChain.then(async () => {
    const list = (await get<DocIndexEntry[]>(INDEX, store)) ?? []
    await set(INDEX, fn(list), store)
  })
  return indexChain
}

export async function loadArchive(id: string): Promise<DocArchive | undefined> {
  return get<DocArchive>('doc:' + id, store)
}

export async function saveArchive(a: DocArchive) {
  await set('doc:' + a.id, a, store)
  const text = a.data.text
  const entry: DocIndexEntry = {
    id: a.id,
    name: a.name,
    updated: a.updated,
    chars: text.length,
    tags: a.data.tags.length,
    notes: a.data.notes.length,
    hasHandle: !!a.handle,
    excerpt: text
      .replace(/^---[\s\S]*?---\n/, '')
      .replace(/[#>*_`-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90),
  }
  await updateIndex((list) => [entry, ...list.filter((e) => e.id !== a.id)])
}

export async function deleteArchive(id: string) {
  await del('doc:' + id, store)
  await updateIndex((list) => list.filter((e) => e.id !== id))
}

/** 用文件句柄找到对应的存档（同一个文件再次打开时恢复注释） */
export async function findArchiveByHandle(h: FileSystemFileHandle): Promise<DocArchive | undefined> {
  const list = await loadIndex()
  for (const e of list) {
    if (!e.hasHandle) continue
    const a = await loadArchive(e.id)
    if (!a?.handle) continue
    try {
      if (await a.handle.isSameEntry(h)) return a
    } catch {
      /* 句柄失效 */
    }
  }
  return undefined
}

/** 没有句柄时（拖入文件 / 不支持 FSA 的浏览器）按文件名 + 内容相似度匹配 */
export async function findArchiveByName(name: string, text: string): Promise<DocArchive | undefined> {
  const list = await loadIndex()
  for (const e of list) {
    if (e.name !== name) continue
    const a = await loadArchive(e.id)
    if (!a) continue
    if (similarity(a.data.text, text) > 0.6) return a
  }
  return undefined
}

function similarity(a: string, b: string) {
  if (a === b) return 1
  if (!a || !b) return 0
  const all = new Set<string>()
  for (let i = 0; i < b.length - 2; i++) all.add(b.slice(i, i + 3))
  let hit = 0
  let total = 0
  for (let i = 0; i < a.length - 2; i += 3) {
    total++
    if (all.has(a.slice(i, i + 3))) hit++
  }
  return total ? hit / total : 0
}

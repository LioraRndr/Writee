import { createStore, get, set, del } from 'idb-keyval'
import type { DocArchive, DocIndexEntry, FileLocation, WorkspaceRoot } from './types'
import { uid } from './uid'

const store = createStore('writee', 'archives')
const INDEX = 'index'

export async function loadRoots(): Promise<WorkspaceRoot[]> {
  return (await get<WorkspaceRoot[]>('roots', store)) ?? []
}

export async function saveRoot(handle: FileSystemDirectoryHandle): Promise<WorkspaceRoot> {
  const roots = await loadRoots()
  for (const root of roots) {
    let same = false
    try { same = await root.handle.isSameEntry(handle) } catch { /* 旧目录可能已删除 */ }
    if (same) {
      root.handle = handle
      await set('roots', roots, store)
      return root
    }
  }
  const root = { id: uid('root'), handle }
  await set('roots', [...roots, root], store)
  return root
}

/** 重叠授权目录也可识别；保留存档原本采用的目录身份。 */
export async function locateFile(handle: FileSystemFileHandle): Promise<FileLocation[]> {
  const locations: FileLocation[] = []
  for (const root of await loadRoots()) {
    try {
      const path = await root.handle.resolve(handle)
      if (path?.length) locations.push({ rootId: root.id, path })
    } catch {
      // 失效或未授权的目录不参与匹配。
    }
  }
  return locations
}

export async function findArchiveByLocation(locations: FileLocation[]): Promise<DocArchive | undefined> {
  for (const entry of await loadIndex()) {
    const archive = await loadArchive(entry.id)
    const saved = archive?.location
    if (saved && locations.some((l) =>
      l.rootId === saved.rootId && JSON.stringify(l.path) === JSON.stringify(saved.path),
    )) return archive
  }
}

export async function locationRoot(location: FileLocation) {
  const root = (await loadRoots()).find((r) => r.id === location.rootId)
  if (!root) throw new Error('工作目录未找到，请重新关联文件')
  return root.handle
}

/** 每次从目录重取文件；绝不创建缺失文件或回退到旧句柄写入。 */
export async function handleAtLocation(location: FileLocation): Promise<FileSystemFileHandle> {
  let dir = await locationRoot(location)
  if (!location.path.length) throw new Error('文件路径为空')
  for (const segment of location.path.slice(0, -1)) dir = await dir.getDirectoryHandle(segment)
  return dir.getFileHandle(location.path[location.path.length - 1])
}

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

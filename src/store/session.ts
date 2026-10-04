import { create } from 'zustand'
import { useDoc } from './docStore'
import { useUI } from './uiStore'
import type { DocArchive, DocData, DocIndexEntry, FileLocation } from '../core/types'
import { deleteArchive, findArchiveByHandle, findArchiveByName, findArchiveByLocation, handleAtLocation, locateFile, locationRoot, loadArchive, loadIndex, saveArchive, saveRoot } from '../core/archive'
import {
  downloadText,
  fsaSupported,
  hasPermission,
  normalizeNewlines,
  pickMarkdownFile,
  pickSaveFile,
  readFileInput,
  readHandle,
  requestPermission,
  statHandle,
  writeHandle,
} from '../core/fileAccess'
import { uid } from '../core/uid'
import { SAMPLE_DOC, SAMPLE_NAME } from '../sample'

interface Conflict {
  diskText: string
  modified: number
}

interface SessionState {
  recent: DocIndexEntry[]
  conflict: Conflict | null
  loading: boolean
}

export const useSession = create<SessionState>()(() => ({ recent: [], conflict: null, loading: false }))

/** 当前文档与磁盘同步的状态 */
let sess: { id: string; diskText: string; diskModified: number | undefined; created: number; location?: FileLocation } | null = null

export function currentLocation() {
  return sess?.location
}

/** 授权后把仍能识别的旧存档迁移到稳定路径，不靠同名猜测。 */
export async function registerWorkspace(handle: FileSystemDirectoryHandle) {
  if (!(await requestPermission(handle, 'readwrite'))) throw new Error('未获得工作目录权限')
  await persistNow()
  const root = await saveRoot(handle)
  for (const entry of await loadIndex()) {
    const a = await loadArchive(entry.id)
    if (!a?.handle || a.location) continue
    let path: string[] | null = null
    try { path = await handle.resolve(a.handle) } catch { /* 已失效的旧文件需手动关联 */ }
    if (!path?.length) continue
    const location = { rootId: root.id, path }
    if (await findArchiveByLocation([location])) continue
    // 当前文档可能仍在编辑，使用实时状态保存，避免覆盖刚写下的注释。
    if (sess?.id === a.id) {
      sess.location = location
      await persistNow()
    } else await saveArchive({ ...a, location })
  }
  await refreshRecent()
  return root
}

/** 用户明确选择目标文件后，迁移当前存档；已有目标存档不静默覆盖。 */
export async function relinkCurrent(handle: FileSystemFileHandle) {
  const id = sess?.id
  if (!id || id === 'sample') throw new Error('请先打开要恢复的旧存档')
  const locations = await locateFile(handle)
  if (!locations.length) throw new Error('请先授权包含此文件的工作目录')
  const existing = await findArchiveByLocation(locations) ?? await findArchiveByHandle(handle)
  if (existing && existing.id !== id) throw new Error('目标文件已有另一份存档。请先从最近的文档移除不需要的目标存档，再重新关联；原文件不会被删除。')
  if (!(await requestPermission(handle, 'readwrite'))) throw new Error('未获得文件写入权限')
  const disk = await readHandle(handle)
  if (sess?.id !== id) return
  await persistNow()
  const archive = await loadArchive(id)
  if (!archive || sess?.id !== id) return
  useUI.setState({ dialog: null })
  await openArchiveData(archive, id, handle.name, handle, disk.text, disk.modified, locations[0])
}

async function sessionHandle(current: NonNullable<typeof sess>, fallback: FileSystemFileHandle) {
  const handle = current.location ? await handleAtLocation(current.location) : fallback
  const meta = useDoc.getState().meta
  if (sess === current && meta?.id === current.id && meta.handle !== handle) {
    useDoc.setState({ meta: { ...meta, handle } })
  }
  return handle
}

const emptyData = (text: string): DocData => ({ text, tags: [], notes: [], edits: [], analysis: null, anchors: [] })

export async function refreshRecent() {
  useSession.setState({ recent: await loadIndex() })
}

function restoreUI(a: DocArchive | undefined) {
  useUI.setState({
    mode: a?.ui.mode ?? 'editor',
    collapsed: a?.ui.collapsed ?? [],
    activeNote: null,
    hoverNote: null,
    hoverTag: null,
    selectedNotes: [],
    linkNote: null,
    activeUnit: null,
    focusCard: null,
  })
}

async function openArchiveData(
  a: DocArchive | undefined,
  id: string,
  name: string,
  handle: FileSystemFileHandle | null,
  diskText: string,
  modified: number | undefined,
  location: FileLocation | undefined,
) {
  clearTimeout(writeTimer)
  useSession.setState({ conflict: null })
  sess = { id, diskText, diskModified: modified, created: a?.created ?? Date.now(), location }
  restoreUI(a)
  const doc = useDoc.getState()
  if (!a) {
    doc.open({ id, name, handle, created: sess.created }, emptyData(diskText))
  } else {
    doc.open({ id, name, handle, created: a.created }, a.data)
    if (handle && diskText !== a.diskText) {
      if (a.data.text === a.diskText) {
        // 文件在外部被修改过（例如交给 AI 改写），而编辑器里没有未写入的修改：载入并对齐注释
        useDoc.getState().replaceText(diskText, 'disk')
        useUI.getState().toast('文件在外部被修改过，已载入新版本，注释已自动对齐')
      } else {
        // 冲突未处理前保存共同基线，刷新后仍须提示，不能把旧稿当成待写回的新稿。
        sess.diskText = a.diskText
        sess.diskModified = a.diskModified
        useSession.setState({ conflict: { diskText, modified: modified ?? 0 } })
        useDoc.getState().setFileStatus('conflict')
        useUI.setState({ dialog: 'conflict' })
      }
    } else if (handle && a.data.text !== diskText) {
      useDoc.getState().setFileStatus('dirty')
      scheduleWrite()
    }
  }
  if (handle && !(await hasPermission(handle, 'readwrite')) && !useSession.getState().conflict) {
    useDoc.getState().setFileStatus('nopermission')
  }
  await persistNow()
}

export async function openFromHandle(handle: FileSystemFileHandle) {
  useSession.setState({ loading: true })
  try {
    // 尽早请求写入权限（此时仍处在用户手势中）
    await requestPermission(handle, 'readwrite')
    if (!(await hasPermission(handle, 'read'))) {
      if (!(await requestPermission(handle, 'read'))) throw new Error('没有读取该文件的权限')
    }
    const { text, modified } = await readHandle(handle)
    await persistNow()
    const locations = await locateFile(handle)
    const pathArchive = await findArchiveByLocation(locations)
    const a = pathArchive ?? await findArchiveByHandle(handle)
    const location = pathArchive?.location ?? locations[0]
    await openArchiveData(a, a?.id ?? uid('d'), handle.name, handle, text, modified, location)
  } catch (e) {
    useUI.getState().toast('打开失败：' + (e instanceof Error ? e.message : String(e)), { tone: 'error' })
  } finally {
    useSession.setState({ loading: false })
  }
}

export async function openFromFile(file: File) {
  const text = normalizeNewlines(await file.text())
  const a = await findArchiveByName(file.name, text)
  if (a) {
    sess = { id: a.id, diskText: text, diskModified: undefined, created: a.created }
    restoreUI(a)
    useDoc.getState().open({ id: a.id, name: file.name, handle: null, created: a.created }, a.data)
    if (a.data.text !== text) useDoc.getState().replaceText(text, 'disk')
  } else {
    const id = uid('d')
    sess = { id, diskText: text, diskModified: undefined, created: Date.now() }
    restoreUI(undefined)
    useDoc.getState().open({ id, name: file.name, handle: null, created: sess.created }, emptyData(text))
  }
  await persistNow()
  if (!fsaSupported) useUI.getState().toast('当前浏览器不支持直接写回文件：修改会保存在存档中，可随时下载 .md', { ms: 6000 })
}

export async function openDialog() {
  if (!fsaSupported) {
    const f = await readFileInput()
    if (f) await openFromFile(f)
    return
  }
  const h = await pickMarkdownFile()
  if (h) await openFromHandle(h)
}

export async function openRecent(id: string) {
  await persistNow()
  const a = await loadArchive(id)
  if (!a) {
    useUI.getState().toast('找不到这份存档', { tone: 'error' })
    await refreshRecent()
    return
  }
  if (a.handle || a.location) {
    try {
      const permissionHandle = a.location ? await locationRoot(a.location) : a.handle!
      const ok = await requestPermission(permissionHandle, 'readwrite')
      const handle = a.location ? await handleAtLocation(a.location) : a.handle!
      const { text, modified } = await readHandle(handle)
      await openArchiveData(a, a.id, handle.name, handle, text, modified, a.location)
      if (!ok && !useSession.getState().conflict) useDoc.getState().setFileStatus('nopermission')
      return
    } catch {
      useUI.getState().toast('原文件无法访问（可能已移动或删除），已打开存档中的版本', { tone: 'error', ms: 6000 })
    }
  }
  clearTimeout(writeTimer)
  useSession.setState({ conflict: null })
  sess = { id: a.id, diskText: a.diskText, diskModified: undefined, created: a.created, location: a.location }
  restoreUI(a)
  useDoc.getState().open({ id: a.id, name: a.name, handle: null, created: a.created }, a.data)
  await persistNow()
}

export async function openSample() {
  const a = await loadArchive('sample')
  sess = { id: 'sample', diskText: SAMPLE_DOC, diskModified: undefined, created: a?.created ?? Date.now() }
  restoreUI(a)
  useDoc.getState().open({ id: 'sample', name: SAMPLE_NAME, handle: null, created: sess.created }, a?.data ?? emptyData(SAMPLE_DOC))
  await persistNow()
}

export async function newDocument() {
  const initial = '# 未命名\n\n'
  if (fsaSupported) {
    const h = await pickSaveFile('未命名.md')
    if (!h) return
    await writeHandle(h, initial)
    await openFromHandle(h)
    return
  }
  const id = uid('d')
  sess = { id, diskText: initial, diskModified: undefined, created: Date.now() }
  restoreUI(undefined)
  useDoc.getState().open({ id, name: '未命名.md', handle: null, created: sess.created }, emptyData(initial))
  await persistNow()
}

/** 内存中的文档另存为本地文件，之后的修改会直接写回该文件 */
export async function saveAs() {
  const doc = useDoc.getState()
  if (!doc.meta) return
  if (!fsaSupported) {
    downloadText(doc.meta.name.endsWith('.md') ? doc.meta.name : doc.meta.name + '.md', doc.data.text)
    return
  }
  const h = await pickSaveFile(doc.meta.name.endsWith('.md') ? doc.meta.name : doc.meta.name + '.md')
  if (!h) return
  const modified = await writeHandle(h, doc.data.text)
  // 另存后成为新的独立文档存档（保留注释）
  const id = doc.meta.id === 'sample' ? uid('d') : doc.meta.id
  sess = { id, diskText: doc.data.text, diskModified: modified, created: doc.meta.created, location: (await locateFile(h))[0] }
  useDoc.setState({ meta: { ...doc.meta, id, name: h.name, handle: h } })
  useDoc.getState().markSaved(Date.now())
  await persistNow()
  useUI.getState().toast('已保存到 ' + h.name + '，之后的修改会自动写回该文件')
}

export function downloadCurrent() {
  const doc = useDoc.getState()
  if (!doc.meta) return
  downloadText(doc.meta.name.endsWith('.md') ? doc.meta.name : doc.meta.name + '.md', doc.data.text)
}

export async function grantWrite() {
  const h = useDoc.getState().meta?.handle
  if (!h) return
  const target = sess?.location ? await locationRoot(sess.location) : h
  if (await requestPermission(target, 'readwrite')) {
    useDoc.getState().setFileStatus(useDoc.getState().data.text === sess?.diskText ? 'saved' : 'dirty')
    scheduleWrite(0)
  } else useUI.getState().toast('未获得写入权限', { tone: 'error' })
}

export function closeDoc() {
  clearTimeout(writeTimer)
  void persistNow()
  sess = null
  useDoc.getState().close()
  useSession.setState({ conflict: null })
  void refreshRecent()
}

export async function forgetArchive(id: string) {
  await deleteArchive(id)
  await refreshRecent()
}

// ---------- 自动保存 ----------

let archiveTimer = 0
let writeTimer = 0
let writing = false

function buildArchive(): DocArchive | null {
  const doc = useDoc.getState()
  if (!doc.meta || !sess) return null
  const ui = useUI.getState()
  return {
    id: sess.id,
    name: doc.meta.name,
    handle: doc.meta.handle ?? undefined,
    location: sess.location,
    data: doc.data,
    diskText: sess.diskText,
    diskModified: sess.diskModified,
    ui: { mode: ui.mode, collapsed: ui.collapsed },
    created: sess.created,
    updated: Date.now(),
  }
}

export async function persistNow() {
  clearTimeout(archiveTimer)
  const a = buildArchive()
  if (!a) return
  try {
    await saveArchive(a)
  } catch (e) {
    console.error('存档失败', e)
  }
}

function scheduleArchive(ms = 500) {
  clearTimeout(archiveTimer)
  archiveTimer = window.setTimeout(() => void persistNow(), ms)
}

export function scheduleWrite(ms = 700) {
  clearTimeout(writeTimer)
  writeTimer = window.setTimeout(() => void writeNow(), ms)
}

export async function writeNow() {
  clearTimeout(writeTimer)
  const doc = useDoc.getState()
  const fallback = doc.meta?.handle
  const current = sess
  if (!fallback || !current || writing) return
  if (doc.fileStatus === 'conflict') return
  const text = doc.data.text
  if (text === current.diskText) {
    if (doc.fileStatus !== 'saved') useDoc.getState().markSaved(Date.now())
    return
  }
  writing = true
  try {
    const h = await sessionHandle(current, fallback)
    if (sess !== current) return
    if (!(await hasPermission(h, 'readwrite'))) {
      if (sess === current) useDoc.getState().setFileStatus('nopermission')
      return
    }
    // 写入前确认文件没有在外部被改动，避免覆盖
    // 路径绑定的文件可能在相同时间戳下被替换，始终核对正文。
    const disk = await readHandle(h)
    if (sess !== current) return
    if (disk.text !== current.diskText) {
      useSession.setState({ conflict: { diskText: disk.text, modified: disk.modified } })
      useDoc.getState().setFileStatus('conflict')
      useUI.setState({ dialog: 'conflict' })
      return
    }
    useDoc.getState().setFileStatus('saving')
    const modified = await writeHandle(h, text)
    current.diskText = text
    current.diskModified = modified
    if (sess !== current) return
    useDoc.getState().markSaved(Date.now())
    scheduleArchive(100)
    if (useDoc.getState().data.text !== text) {
      useDoc.getState().setFileStatus('dirty')
      scheduleWrite(300)
    }
  } catch (e) {
    if (sess === current) useDoc.getState().setFileStatus('error', e instanceof Error ? e.message : String(e))
  } finally {
    writing = false
  }
}

/** 检查文件是否在外部被修改 */
let checking = false
export async function checkDisk() {
  const doc = useDoc.getState()
  const fallback = doc.meta?.handle
  const current = sess
  if (!fallback || !current || writing || checking || doc.fileStatus === 'conflict') return
  checking = true
  try {
    const h = await sessionHandle(current, fallback)
    if (!(await hasPermission(h, 'read'))) return
    const m = await statHandle(h)
    if (!current.location && m === current.diskModified) return
    const disk = await readHandle(h)
    if (sess !== current || writing || useDoc.getState().fileStatus === 'conflict') return
    if (disk.text === current.diskText) {
      current.diskModified = disk.modified
      return
    }
    if (useDoc.getState().data.text === current.diskText) {
      current.diskText = disk.text
      current.diskModified = disk.modified
      useDoc.getState().replaceText(disk.text, 'disk')
      useDoc.getState().markSaved(Date.now())
      useUI.getState().toast('已载入文件的外部修改，注释已自动对齐', {
        action: { label: '撤销', run: () => useDoc.getState().undo() },
      })
    } else {
      useSession.setState({ conflict: { diskText: disk.text, modified: disk.modified } })
      useDoc.getState().setFileStatus('conflict')
      useUI.setState({ dialog: 'conflict' })
    }
  } catch {
    // 外部替换期间文件可能短暂消失，保留存档，下一次轮询继续尝试。
  } finally {
    checking = false
  }
}

export function resolveConflict(choice: 'disk' | 'mine') {
  const c = useSession.getState().conflict
  if (!c || !sess) return
  useSession.setState({ conflict: null })
  if (choice === 'disk') {
    sess.diskText = c.diskText
    sess.diskModified = c.modified
    useDoc.getState().replaceText(c.diskText, 'disk')
    useDoc.getState().markSaved(Date.now())
  } else {
    sess.diskModified = c.modified
    sess.diskText = c.diskText
    useDoc.getState().setFileStatus('dirty')
    void writeNow()
  }
  useUI.setState({ dialog: null })
}

let started = false
export function startSession() {
  if (started) return
  started = true
  void refreshRecent()
  useDoc.subscribe((s, p) => {
    if (!s.meta) return
    if (s.data !== p.data) scheduleArchive()
    if (s.data.text !== p.data.text && s.meta.handle) scheduleWrite()
  })
  useUI.subscribe((s, p) => {
    if (s.mode !== p.mode || s.collapsed !== p.collapsed) scheduleArchive()
  })
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void checkDisk()
  }, 2000)
  window.addEventListener('focus', () => void checkDisk())
  window.addEventListener('beforeunload', () => {
    void persistNow()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void persistNow()
      void writeNow()
    }
  })
}

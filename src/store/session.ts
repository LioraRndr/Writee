import { create } from 'zustand'
import { useDoc } from './docStore'
import { useUI } from './uiStore'
import type { DocArchive, DocData, DocIndexEntry } from '../core/types'
import { deleteArchive, findArchiveByHandle, findArchiveByName, loadArchive, loadIndex, saveArchive } from '../core/archive'
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
let sess: { id: string; diskText: string; diskModified: number | undefined; created: number } | null = null

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
) {
  sess = { id, diskText, diskModified: modified, created: a?.created ?? Date.now() }
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
        useSession.setState({ conflict: { diskText, modified: modified ?? 0 } })
        useDoc.getState().setFileStatus('conflict')
        useUI.setState({ dialog: 'conflict' })
      }
    } else if (handle && a.data.text !== diskText) {
      useDoc.getState().setFileStatus('dirty')
      scheduleWrite()
    }
  }
  if (handle && !(await hasPermission(handle, 'readwrite'))) useDoc.getState().setFileStatus('nopermission')
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
    const a = await findArchiveByHandle(handle)
    await openArchiveData(a, a?.id ?? uid('d'), handle.name, handle, text, modified)
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
  const a = await loadArchive(id)
  if (!a) {
    useUI.getState().toast('找不到这份存档', { tone: 'error' })
    await refreshRecent()
    return
  }
  if (a.handle) {
    const ok = await requestPermission(a.handle, 'readwrite')
    try {
      const { text, modified } = await readHandle(a.handle)
      await openArchiveData(a, a.id, a.handle.name, a.handle, text, modified)
      if (!ok) useDoc.getState().setFileStatus('nopermission')
      return
    } catch {
      useUI.getState().toast('原文件无法访问（可能已移动或删除），已打开存档中的版本', { tone: 'error', ms: 6000 })
    }
  }
  sess = { id: a.id, diskText: a.diskText, diskModified: undefined, created: a.created }
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
  sess = { id, diskText: doc.data.text, diskModified: modified, created: doc.meta.created }
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
  if (await requestPermission(h, 'readwrite')) {
    useDoc.getState().setFileStatus(useDoc.getState().data.text === sess?.diskText ? 'saved' : 'dirty')
    scheduleWrite(0)
  } else useUI.getState().toast('未获得写入权限', { tone: 'error' })
}

export function closeDoc() {
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
  const h = doc.meta?.handle
  if (!h || !sess || writing) return
  if (doc.fileStatus === 'conflict') return
  if (!(await hasPermission(h, 'readwrite'))) {
    useDoc.getState().setFileStatus('nopermission')
    return
  }
  const text = doc.data.text
  if (text === sess.diskText) {
    if (doc.fileStatus !== 'saved') useDoc.getState().markSaved(Date.now())
    return
  }
  writing = true
  try {
    // 写入前确认文件没有在外部被改动，避免覆盖
    const m = await statHandle(h)
    if (sess.diskModified !== undefined && m !== sess.diskModified) {
      const disk = await readHandle(h)
      if (disk.text !== sess.diskText) {
        useSession.setState({ conflict: { diskText: disk.text, modified: disk.modified } })
        useDoc.getState().setFileStatus('conflict')
        useUI.setState({ dialog: 'conflict' })
        return
      }
    }
    useDoc.getState().setFileStatus('saving')
    const modified = await writeHandle(h, text)
    sess.diskText = text
    sess.diskModified = modified
    useDoc.getState().markSaved(Date.now())
    scheduleArchive(100)
    if (useDoc.getState().data.text !== text) {
      useDoc.getState().setFileStatus('dirty')
      scheduleWrite(300)
    }
  } catch (e) {
    useDoc.getState().setFileStatus('error', e instanceof Error ? e.message : String(e))
  } finally {
    writing = false
  }
}

/** 检查文件是否在外部被修改 */
export async function checkDisk() {
  const doc = useDoc.getState()
  const h = doc.meta?.handle
  if (!h || !sess || writing || doc.fileStatus === 'conflict') return
  if (!(await hasPermission(h, 'read'))) return
  let m: number
  try {
    m = await statHandle(h)
  } catch {
    return
  }
  if (m === sess.diskModified) return
  const disk = await readHandle(h)
  if (disk.text === sess.diskText) {
    sess.diskModified = disk.modified
    return
  }
  if (useDoc.getState().data.text === sess.diskText) {
    sess.diskText = disk.text
    sess.diskModified = disk.modified
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

import { create } from 'zustand'
import { useDoc, type DocSnapshot, type FileStatus } from './docStore'
import { useUI } from './uiStore'
import type { DocArchive, DocData, DocIndexEntry, FileHandle, FileLocation } from '../core/types'
import { isLocalFile, launchedFile, localFileAction, localSystemSupported } from '../core/localFile'
import { linkKind } from '../core/links'
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
import { registry } from '../editor/registry'
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

interface Sess {
  id: string
  diskText: string
  diskModified: number | undefined
  created: number
  location?: FileLocation
}

/** 当前文档与磁盘同步的状态 */
let sess: Sess | null = null

export function currentLocation() {
  return sess?.location
}

// ---------- 标签页 ----------

export interface TabInfo {
  id: string
  name: string
  /** 后台标签页最后的文件状态；当前标签页实时读取 useDoc */
  status?: FileStatus
}

interface TabsState {
  tabs: TabInfo[]
  /** 当前显示的标签页；null 表示文档列表（首页） */
  active: string | null
}

/** 后台标签页：内存里保留文本、撤销历史与磁盘基线，切回时无需重新读取 */
interface Parked {
  doc: DocSnapshot
  sess: Sess
  conflict: Conflict | null
  ui: { mode: 'editor' | 'cards'; collapsed: string[] }
  scrollTop: number
}

const TABS_KEY = 'writee.tabs'

function loadTabs(): TabsState {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null')
    if (Array.isArray(raw?.tabs)) {
      const tabs = raw.tabs
        .filter((t: unknown): t is TabInfo => typeof (t as TabInfo)?.id === 'string')
        .map((t: TabInfo) => ({ id: t.id, name: String(t.name ?? '') }))
      // 重新打开应用时只恢复标签页列表，点选时再载入（文件权限需要用户手势）
      return { tabs, active: null }
    }
  } catch {
    /* ignore */
  }
  return { tabs: [], active: null }
}

export const useTabs = create<TabsState>()(() => loadTabs())

useTabs.subscribe((s, p) => {
  if (s.tabs === p.tabs) return
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: s.tabs.map((t) => ({ id: t.id, name: t.name })) }))
  } catch {
    /* ignore */
  }
})

const parked = new Map<string, Parked>()

/** 切换标签页后由 Workspace 恢复的滚动位置（按文档 id，开发模式下组件会挂载两次，读取后不立即清除） */
let pendingScroll: { id: string; top: number } | null = null
export function pendingScrollFor(id: string) {
  return pendingScroll?.id === id ? pendingScroll.top : null
}
export function clearPendingScroll(id: string) {
  if (pendingScroll?.id === id) pendingScroll = null
}

/** 打开、切换、关闭依次执行，避免快速点击时两份文档交错载入 */
let queue: Promise<unknown> = Promise.resolve()
function serial<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return (...args: A): Promise<R> => {
    const run = queue.then(() => fn(...args))
    queue = run.catch(() => undefined)
    return run
  }
}

/** 恢复期间不触发自动写回 / 存档调度 */
let quiet = false

function upsertTab(id: string, name: string) {
  const { tabs, active } = useTabs.getState()
  const i = tabs.findIndex((t) => t.id === id)
  let next: TabInfo[]
  if (i >= 0) next = tabs.map((t) => (t.id === id ? { ...t, name, status: undefined } : t))
  else {
    // 新标签页插在当前标签页之后
    const at = active ? tabs.findIndex((t) => t.id === active) + 1 : tabs.length
    next = tabs.slice()
    next.splice(at > 0 ? at : tabs.length, 0, { id, name })
  }
  useTabs.setState({ tabs: next, active: id })
}

function setTabStatus(id: string, status: FileStatus | undefined) {
  const { tabs } = useTabs.getState()
  if (!tabs.some((t) => t.id === id && t.status !== status)) return
  useTabs.setState({ tabs: tabs.map((t) => (t.id === id ? { ...t, status } : t)) })
}

/** 把当前文档停放到后台：先写回文件与存档，再保留内存快照 */
async function park() {
  const doc = useDoc.getState()
  if (!doc.meta || !sess) return
  clearTimeout(writeTimer)
  if (doc.meta.handle && doc.fileStatus !== 'conflict' && doc.data.text !== sess.diskText) await writeNow()
  await persistNow()
  const cur = useDoc.getState()
  if (!cur.meta || !sess || sess.id !== cur.meta.id) return
  const ui = useUI.getState()
  parked.set(cur.meta.id, {
    doc: {
      meta: cur.meta,
      data: cur.data,
      past: cur.past,
      future: cur.future,
      fileStatus: cur.fileStatus,
      fileError: cur.fileError,
      lastSaved: cur.lastSaved,
    },
    sess,
    conflict: useSession.getState().conflict,
    ui: { mode: ui.mode, collapsed: ui.collapsed },
    scrollTop: registry.scroller()?.scrollTop ?? 0,
  })
  setTabStatus(cur.meta.id, cur.fileStatus)
}

function unpark(p: Parked) {
  const id = p.doc.meta.id
  parked.delete(id)
  clearTimeout(writeTimer)
  sess = p.sess
  pendingScroll = { id, top: p.scrollTop }
  useSession.setState({ conflict: p.conflict })
  restoreUI(p.ui)
  quiet = true
  try {
    useDoc.getState().restore(p.doc)
  } finally {
    quiet = false
  }
  const d = useDoc.getState()
  if (d.meta?.handle && d.fileStatus !== 'conflict' && d.data.text !== p.sess.diskText) scheduleWrite(300)
  // 在后台期间文件可能被外部修改
  void checkDisk()
}

/**
 * 显示文档 id：已在前台则只检查磁盘；在后台则切回；否则停放当前文档后用 install 载入新文档。
 * 载入后该文档成为当前标签页（没有标签页时新建）。
 */
async function present(id: string, install: () => Promise<void>) {
  if (useDoc.getState().meta?.id === id && sess?.id === id) {
    upsertTab(id, useDoc.getState().meta!.name)
    void checkDisk()
    return
  }
  await park()
  const p = parked.get(id)
  if (p) unpark(p)
  else await install()
  const meta = useDoc.getState().meta
  if (meta) upsertTab(meta.id, meta.name)
}

/** 关闭当前文档但保留它的后台快照（用于“+”回到文档列表） */
async function parkAndHome() {
  await park()
  sess = null
  clearTimeout(writeTimer)
  useSession.setState({ conflict: null })
  useDoc.getState().close()
  useTabs.setState({ active: null })
  void refreshRecent()
}

export const goHome = serial(parkAndHome)

export const activateTab = serial(async (id: string) => {
  if (useDoc.getState().meta?.id === id) return
  const p = parked.get(id)
  if (p) {
    await park()
    unpark(p)
    useTabs.setState({ active: id })
    return
  }
  await openRecentImpl(id)
})

async function closeTabImpl(id: string) {
  const { tabs } = useTabs.getState()
  const index = tabs.findIndex((t) => t.id === id)
  const rest = tabs.filter((t) => t.id !== id)
  if (useDoc.getState().meta?.id === id) {
    clearTimeout(writeTimer)
    const doc = useDoc.getState()
    if (sess && doc.meta?.handle && doc.fileStatus !== 'conflict' && doc.data.text !== sess.diskText) await writeNow()
    await persistNow()
    sess = null
    useSession.setState({ conflict: null })
    useDoc.getState().close()
    useTabs.setState({ tabs: rest, active: null })
    // 关闭当前标签页后切到相邻的一个；没有了就回到文档列表
    const neighbor = rest[Math.min(index, rest.length - 1)]
    if (neighbor) {
      const p = parked.get(neighbor.id)
      if (p) {
        unpark(p)
        useTabs.setState({ active: neighbor.id })
      } else await openRecentImpl(neighbor.id)
    } else void refreshRecent()
    return
  }
  parked.delete(id)
  useTabs.setState({ tabs: rest })
}

export const closeTab = serial(closeTabImpl)

export const closeOtherTabs = serial(async (keep: string) => {
  for (const t of useTabs.getState().tabs) if (t.id !== keep) await closeTabImpl(t.id)
})

export const closeTabsToRight = serial(async (id: string) => {
  const tabs = useTabs.getState().tabs
  const i = tabs.findIndex((t) => t.id === id)
  for (const t of tabs.slice(i + 1)) await closeTabImpl(t.id)
})

export function moveTab(id: string, to: number) {
  const tabs = useTabs.getState().tabs.slice()
  const from = tabs.findIndex((t) => t.id === id)
  if (from < 0) return
  const [tab] = tabs.splice(from, 1)
  tabs.splice(Math.max(0, Math.min(tabs.length, to > from ? to - 1 : to)), 0, tab)
  useTabs.setState({ tabs })
}

// ---------- 工作目录 ----------

/** 授权后把仍能识别的旧存档迁移到稳定路径，不靠同名猜测。 */
export async function registerWorkspace(handle: FileSystemDirectoryHandle) {
  if (!(await requestPermission(handle, 'readwrite'))) throw new Error('未获得工作目录权限')
  await persistNow()
  const root = await saveRoot(handle)
  for (const entry of await loadIndex()) {
    const a = await loadArchive(entry.id)
    if (!a?.handle || a.location || isLocalFile(a.handle)) continue
    let path: string[] | null = null
    try { path = await handle.resolve(a.handle) } catch { /* 已失效的旧文件需手动关联 */ }
    if (!path?.length) continue
    const location = { rootId: root.id, path }
    if (await findArchiveByLocation([location])) continue
    // 当前文档可能仍在编辑，使用实时状态保存，避免覆盖刚写下的注释。
    if (sess?.id === a.id) {
      sess.location = location
      await persistNow()
    } else {
      // 后台标签页切回时会按自己的会话写存档，同步更新，免得把新路径覆盖掉
      const p = parked.get(a.id)
      if (p) p.sess.location = location
      await saveArchive({ ...a, location })
    }
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
  upsertTab(id, handle.name)
}

async function sessionHandle(current: Sess, fallback: FileHandle) {
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

function restoreUI(ui: DocArchive['ui'] | undefined) {
  useUI.setState({
    mode: ui?.mode ?? 'editor',
    collapsed: ui?.collapsed ?? [],
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
  handle: FileHandle | null,
  diskText: string,
  modified: number | undefined,
  location: FileLocation | undefined,
) {
  clearTimeout(writeTimer)
  useSession.setState({ conflict: null })
  sess = { id, diskText, diskModified: modified, created: a?.created ?? Date.now(), location }
  restoreUI(a?.ui)
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

async function openFromHandleImpl(handle: FileHandle) {
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
    const id = a?.id ?? uid('d')
    await present(id, () => openArchiveData(a, id, handle.name, handle, text, modified, location))
  } catch (e) {
    useUI.getState().toast('打开失败：' + (e instanceof Error ? e.message : String(e)), { tone: 'error' })
  } finally {
    useSession.setState({ loading: false })
  }
}

export const openFromHandle = serial(openFromHandleImpl)

export const openFromFile = serial(async (file: File) => {
  const text = normalizeNewlines(await file.text())
  const a = await findArchiveByName(file.name, text)
  const id = a?.id ?? uid('d')
  await present(id, async () => {
    if (a) {
      sess = { id: a.id, diskText: text, diskModified: undefined, created: a.created }
      restoreUI(a.ui)
      useDoc.getState().open({ id: a.id, name: file.name, handle: null, created: a.created }, a.data)
      if (a.data.text !== text) useDoc.getState().replaceText(text, 'disk')
    } else {
      sess = { id, diskText: text, diskModified: undefined, created: Date.now() }
      restoreUI(undefined)
      useDoc.getState().open({ id, name: file.name, handle: null, created: sess.created }, emptyData(text))
    }
    await persistNow()
  })
  if (!fsaSupported) useUI.getState().toast('当前浏览器不支持直接写回文件：修改会保存在存档中，可随时下载 .md', { ms: 6000 })
})

export async function openDialog() {
  if (!fsaSupported) {
    const f = await readFileInput()
    if (f) await openFromFile(f)
    return
  }
  const h = await pickMarkdownFile()
  if (h) await openFromHandle(h)
}

async function openRecentImpl(id: string) {
  if (useDoc.getState().meta?.id === id || parked.has(id)) {
    await present(id, async () => undefined)
    return
  }
  await persistNow()
  const a = await loadArchive(id)
  if (!a) {
    useUI.getState().toast('找不到这份存档', { tone: 'error' })
    useTabs.setState({ tabs: useTabs.getState().tabs.filter((t) => t.id !== id) })
    await refreshRecent()
    return
  }
  await present(id, async () => {
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
    restoreUI(a.ui)
    useDoc.getState().open({ id: a.id, name: a.name, handle: null, created: a.created }, a.data)
    await persistNow()
  })
}

export const openRecent = serial(openRecentImpl)

export const openSample = serial(async () => {
  await present('sample', async () => {
    const a = await loadArchive('sample')
    sess = { id: 'sample', diskText: SAMPLE_DOC, diskModified: undefined, created: a?.created ?? Date.now() }
    restoreUI(a?.ui)
    useDoc.getState().open({ id: 'sample', name: SAMPLE_NAME, handle: null, created: sess.created }, a?.data ?? emptyData(SAMPLE_DOC))
    await persistNow()
  })
})

const openUntitled = serial(async (initial: string) => {
  const id = uid('d')
  await present(id, async () => {
    sess = { id, diskText: initial, diskModified: undefined, created: Date.now() }
    restoreUI(undefined)
    useDoc.getState().open({ id, name: '未命名.md', handle: null, created: sess.created }, emptyData(initial))
    await persistNow()
  })
})

export async function newDocument() {
  const initial = '# 未命名\n\n'
  if (fsaSupported) {
    const h = await pickSaveFile('未命名.md')
    if (!h) return
    await writeHandle(h, initial)
    await openFromHandle(h)
    return
  }
  await openUntitled(initial)
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
  const oldId = doc.meta.id
  const id = oldId === 'sample' ? uid('d') : oldId
  sess = { id, diskText: doc.data.text, diskModified: modified, created: doc.meta.created, location: (await locateFile(h))[0] }
  useDoc.setState({ meta: { ...doc.meta, id, name: h.name, handle: h } })
  useDoc.getState().markSaved(Date.now())
  // 标签页跟随新的存档 id 与文件名
  useTabs.setState({ tabs: useTabs.getState().tabs.map((t) => (t.id === oldId ? { id, name: h.name } : t)), active: id })
  await persistNow()
  useUI.getState().toast('已保存到 ' + h.name + '，之后的修改会自动写回该文件')
}

export function downloadCurrent() {
  const doc = useDoc.getState()
  if (!doc.meta) return
  downloadText(doc.meta.name.endsWith('.md') ? doc.meta.name : doc.meta.name + '.md', doc.data.text)
}

export async function openDocumentLink(target: string) {
  const kind = linkKind(target)
  if (kind === 'unsafe') {
    useUI.getState().toast('不支持此链接协议', { tone: 'error' })
    return
  }
  try {
    const handle = useDoc.getState().meta?.handle
    if (handle && isLocalFile(handle) && localSystemSupported) await localFileAction(handle, 'open', target)
    else if (kind === 'external') window.open(target, '_blank', 'noopener,noreferrer')
    else throw new Error('本地链接需通过本机 Writee 启动器打开当前文档后使用')
  } catch (error) {
    useUI.getState().toast('打开失败：' + (error instanceof Error ? error.message : String(error)), { tone: 'error', ms: 6000 })
  }
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

/** 关闭当前标签页 */
export function closeDoc() {
  const id = useDoc.getState().meta?.id
  if (id) void closeTab(id)
}

export async function forgetArchive(id: string) {
  // 存档删除后不能再由打开的标签页写回
  parked.delete(id)
  useTabs.setState({ tabs: useTabs.getState().tabs.filter((t) => t.id !== id) })
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
    if (!current.location && !isLocalFile(h) && m === current.diskModified) return
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
  void refreshRecent().then(() => {
    // 去掉存档已被删除的标签页
    const ids = new Set(useSession.getState().recent.map((r) => r.id))
    const tabs = useTabs.getState().tabs
    if (tabs.some((t) => !ids.has(t.id))) useTabs.setState({ tabs: tabs.filter((t) => ids.has(t.id) || parked.has(t.id) || useDoc.getState().meta?.id === t.id) })
  })
  void launchedFile().then((handle) => {
    if (handle) return openFromHandle(handle)
  }).catch((e) => useUI.getState().toast('打开失败：' + e.message, { tone: 'error', ms: 8000 }))
  useDoc.subscribe((s, p) => {
    if (!s.meta || quiet) return
    if (s.data !== p.data) scheduleArchive()
    if (s.data.text !== p.data.text && s.meta.handle) scheduleWrite()
  })
  useUI.subscribe((s, p) => {
    if (quiet) return
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

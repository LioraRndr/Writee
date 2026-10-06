import { create } from 'zustand'
import { ChangeSet } from '@codemirror/state'
import type { Analysis, DocData, Note, NoteColor, Tag, Unit } from '../core/types'
import { NOTE_COLORS } from '../core/types'
import { diffChanges, mapData, mapperFromChanges, mergeRanges, recordEdits, type PosMapper } from '../core/mapping'
import { buildSections, cardParent, siblingsOf, type Section, type SectionTree } from '../core/sections'
import { applyChangesToString, levelShiftChanges, moveBlock } from '../core/cardOps'
import { uid } from '../core/uid'

export interface DocEvent {
  rev: number
  /** 发起变更的视图 id；'store' 表示由程序发起 */
  origin: string
  textChanged: boolean
  /** 新文本中受影响的范围；null 表示需要整体刷新 */
  touched: [number, number] | null
  map: PosMapper | null
}

export type FileStatus = 'memory' | 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'nopermission' | 'readonly'

export interface DocMeta {
  id: string
  name: string
  handle: FileSystemFileHandle | null
  created: number
}

interface HistoryEntry {
  data: DocData
  group: string | null
  time: number
  /** 该组第一次变更的时间：连续输入最多合并 GROUP_MAX 毫秒 */
  start: number
}

export interface DocState {
  meta: DocMeta | null
  data: DocData
  tree: SectionTree
  rev: number
  event: DocEvent | null
  past: HistoryEntry[]
  future: HistoryEntry[]
  fileStatus: FileStatus
  fileError: string | null
  lastSaved: number | null

  open(meta: DocMeta, data: DocData): void
  close(): void
  setFileStatus(s: FileStatus, err?: string | null): void
  markSaved(time: number): void

  applyChanges(changes: ChangeSet, origin: string, opts?: ApplyOpts): void
  applyTransform(newText: string, map: PosMapper, origin: string, opts?: ApplyOpts): void
  replaceText(newText: string, origin: string, opts?: ApplyOpts): void
  undo(): boolean
  redo(): boolean

  addTag(from: number, to: number): string | null
  removeTag(id: string): void
  addNote(tagIds: string[], text?: string, color?: NoteColor): string
  updateNote(id: string, patch: Partial<Pick<Note, 'text' | 'color' | 'resolved'>>): void
  removeNote(id: string): void
  removeNotes(ids: string[]): void
  linkTag(noteId: string, tagId: string): void
  unlinkTag(noteId: string, tagId: string): void
  toggleLink(noteId: string, tagId: string): void

  setAnalysis(a: Analysis | null): void
  addUnits(units: Unit[]): void
  updateUnit(id: string, patch: Partial<Omit<Unit, 'id'>>): void
  removeUnit(id: string): void
  clearEdits(): void

  moveSection(id: string, parentId: string | null, index: number): boolean
  shiftSection(id: string, dir: 'up' | 'down' | 'left' | 'right'): boolean
  deleteSection(id: string): void
  insertSection(where: { after?: string; childOf?: string; atEnd?: boolean }, title?: string): number | null
  duplicateSection(id: string): void
  unwrapSection(id: string): void
  renameHeadingLevel(id: string, level: number): void
}

export interface ApplyOpts {
  /** 是否记为手动修改（显示在“修改痕迹”中，并在复制提示词时提醒 AI） */
  userEdit?: boolean
  /** 历史分组：同组且间隔很短的变更合并为一次撤销 */
  group?: string | null
}

const emptyData = (): DocData => ({ text: '', tags: [], notes: [], edits: [], analysis: null, anchors: [] })

const HISTORY_LIMIT = 300
const GROUP_WINDOW = 1200
const GROUP_MAX = 6000

function rebuild(data: DocData) {
  const { tree, anchors } = buildSections(data.text, data.anchors)
  return { data: { ...data, anchors }, tree }
}

export const useDoc = create<DocState>()((set, get) => {
  let rev = 0

  const pushHistory = (group: string | null) => {
    const s = get()
    const last = s.past[s.past.length - 1]
    const now = Date.now()
    if (group && last && last.group === group && now - last.time < GROUP_WINDOW && now - last.start < GROUP_MAX) {
      last.time = now
      return { past: s.past, future: [] as HistoryEntry[] }
    }
    const past = s.past.concat({ data: s.data, group, time: now, start: now })
    if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
    return { past, future: [] as HistoryEntry[] }
  }

  /** 只修改元数据（不改文本） */
  const commitMeta = (data: DocData, group: string | null = null) => {
    const h = pushHistory(group)
    set({ ...h, data, rev: ++rev })
  }

  const commitText = (
    newData: DocData,
    origin: string,
    touched: [number, number] | null,
    map: PosMapper | null,
    group: string | null,
  ) => {
    const h = pushHistory(group)
    const r = rebuild(newData)
    const status = get().fileStatus
    set({
      ...h,
      ...r,
      rev: ++rev,
      event: { rev, origin, textChanged: true, touched, map },
      fileStatus: status === 'memory' || status === 'readonly' || status === 'nopermission' ? status : 'dirty',
    })
  }

  const nextColor = (): NoteColor => {
    const used = get().data.notes.map((n) => n.color)
    for (const c of NOTE_COLORS) if (!used.includes(c)) return c
    return NOTE_COLORS[get().data.notes.length % NOTE_COLORS.length]
  }

  const getSection = (id: string): Section | undefined => get().tree.byId.get(id)

  return {
    meta: null,
    data: emptyData(),
    tree: buildSections('', []).tree,
    rev: 0,
    event: null,
    past: [],
    future: [],
    fileStatus: 'memory',
    fileError: null,
    lastSaved: null,

    open(meta, data) {
      const r = rebuild(data)
      set({
        meta,
        ...r,
        rev: ++rev,
        event: { rev, origin: 'load', textChanged: true, touched: null, map: null },
        past: [],
        future: [],
        fileError: null,
        fileStatus: meta.handle ? 'saved' : 'memory',
      })
    },

    close() {
      set({ meta: null, data: emptyData(), tree: buildSections('', []).tree, past: [], future: [], rev: ++rev, event: null })
    },

    setFileStatus(fileStatus, err = null) {
      set({ fileStatus, fileError: err })
    },

    markSaved(time) {
      set({ lastSaved: time, fileStatus: 'saved', fileError: null })
    },

    applyChanges(changes, origin, opts = {}) {
      if (changes.empty) return
      const s = get()
      const text = applyChangesToString(s.data.text, changes)
      const map = mapperFromChanges(changes)
      let data = mapData(s.data, text, map)
      if (opts.userEdit) data = { ...data, edits: recordEdits(data.edits, changes) }
      let lo = Infinity
      let hi = -Infinity
      changes.iterChangedRanges((_fa, _ta, fb, tb) => {
        lo = Math.min(lo, fb)
        hi = Math.max(hi, tb)
      })
      commitText(data, origin, [lo, hi], map, opts.group ?? null)
    },

    applyTransform(newText, map, origin, opts = {}) {
      const s = get()
      const data = mapData(s.data, newText, map)
      commitText(data, origin, null, map, opts.group ?? null)
    },

    replaceText(newText, origin, opts = {}) {
      const s = get()
      if (newText === s.data.text) return
      const changes = diffChanges(s.data.text, newText)
      const map = mapperFromChanges(changes)
      let data = mapData(s.data, newText, map)
      if (opts.userEdit) data = { ...data, edits: recordEdits(data.edits, changes) }
      commitText(data, origin, null, map, opts.group ?? null)
    },

    undo() {
      const s = get()
      const prev = s.past[s.past.length - 1]
      if (!prev) return false
      const r = rebuild(prev.data)
      const textChanged = prev.data.text !== s.data.text
      set({
        past: s.past.slice(0, -1),
        future: s.future.concat({ data: s.data, group: null, time: Date.now(), start: Date.now() }),
        ...r,
        rev: ++rev,
        event: textChanged ? { rev, origin: 'history', textChanged: true, touched: null, map: null } : s.event,
        fileStatus: textChanged && s.fileStatus === 'saved' ? 'dirty' : s.fileStatus,
      })
      return true
    },

    redo() {
      const s = get()
      const next = s.future[s.future.length - 1]
      if (!next) return false
      const r = rebuild(next.data)
      const textChanged = next.data.text !== s.data.text
      set({
        future: s.future.slice(0, -1),
        past: s.past.concat({ data: s.data, group: null, time: Date.now(), start: Date.now() }),
        ...r,
        rev: ++rev,
        event: textChanged ? { rev, origin: 'history', textChanged: true, touched: null, map: null } : s.event,
        fileStatus: textChanged && s.fileStatus === 'saved' ? 'dirty' : s.fileStatus,
      })
      return true
    },

    addTag(from, to) {
      const s = get()
      if (to <= from) return null
      const text = s.data.text
      // 去掉首尾空白
      while (from < to && /\s/.test(text[from])) from++
      while (to > from && /\s/.test(text[to - 1])) to--
      if (to <= from) return null
      const dup = s.data.tags.find((t) => t.from === from && t.to === to)
      if (dup) return dup.id
      const tag: Tag = { id: uid('t'), from, to, created: Date.now() }
      commitMeta({ ...s.data, tags: s.data.tags.concat(tag).sort((a, b) => a.from - b.from || a.to - b.to) })
      return tag.id
    },

    removeTag(id) {
      const s = get()
      commitMeta({
        ...s.data,
        tags: s.data.tags.filter((t) => t.id !== id),
        notes: s.data.notes.map((n) => (n.tagIds.includes(id) ? { ...n, tagIds: n.tagIds.filter((x) => x !== id) } : n)),
      })
    },

    addNote(tagIds, text = '', color) {
      const s = get()
      const now = Date.now()
      const note: Note = { id: uid('n'), text, tagIds: [...new Set(tagIds)], color: color ?? nextColor(), created: now, updated: now }
      commitMeta({ ...s.data, notes: s.data.notes.concat(note) })
      return note.id
    },

    updateNote(id, patch) {
      const s = get()
      const group = patch.text !== undefined ? 'note-text:' + id : null
      commitMeta(
        { ...s.data, notes: s.data.notes.map((n) => (n.id === id ? { ...n, ...patch, updated: Date.now() } : n)) },
        group,
      )
    },

    removeNote(id) {
      get().removeNotes([id])
    },

    removeNotes(ids) {
      const s = get()
      const set_ = new Set(ids)
      const notes = s.data.notes.filter((n) => !set_.has(n.id))
      if (notes.length === s.data.notes.length) return
      const removedTags = new Set(s.data.notes.filter((n) => set_.has(n.id)).flatMap((n) => n.tagIds))
      const linkedTags = new Set(notes.flatMap((n) => n.tagIds))
      // 只清理被删注释留下的标签，共用标签和独立创建的标签继续保留
      const tags = s.data.tags.filter((t) => !removedTags.has(t.id) || linkedTags.has(t.id))
      commitMeta({ ...s.data, notes, tags })
    },

    linkTag(noteId, tagId) {
      const s = get()
      commitMeta({
        ...s.data,
        notes: s.data.notes.map((n) =>
          n.id === noteId && !n.tagIds.includes(tagId) ? { ...n, tagIds: n.tagIds.concat(tagId), updated: Date.now() } : n,
        ),
      })
    },

    unlinkTag(noteId, tagId) {
      const s = get()
      commitMeta({
        ...s.data,
        notes: s.data.notes.map((n) =>
          n.id === noteId ? { ...n, tagIds: n.tagIds.filter((x) => x !== tagId), updated: Date.now() } : n,
        ),
      })
    },

    toggleLink(noteId, tagId) {
      const n = get().data.notes.find((x) => x.id === noteId)
      if (!n) return
      if (n.tagIds.includes(tagId)) get().unlinkTag(noteId, tagId)
      else get().linkTag(noteId, tagId)
    },

    setAnalysis(a) {
      const s = get()
      commitMeta({ ...s.data, analysis: a })
    },

    addUnits(units) {
      const s = get()
      const base: Analysis = s.data.analysis ?? { units: [], createdAt: Date.now() }
      const merged = base.units.concat(units).sort((a, b) => a.from - b.from)
      commitMeta({ ...s.data, analysis: { ...base, units: merged } }, 'units-stream')
    },

    updateUnit(id, patch) {
      const s = get()
      const a = s.data.analysis
      if (!a) return
      commitMeta({ ...s.data, analysis: { ...a, units: a.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) } })
    },

    removeUnit(id) {
      const s = get()
      const a = s.data.analysis
      if (!a) return
      commitMeta({ ...s.data, analysis: { ...a, units: a.units.filter((u) => u.id !== id) } })
    },

    clearEdits() {
      const s = get()
      commitMeta({ ...s.data, edits: [] })
    },

    moveSection(id, parentId, index) {
      const s0 = get()
      const tree = s0.tree
      const sec = getSection(id)
      if (!sec) return false
      const parent = parentId ? getSection(parentId) ?? null : null
      if (parent && parent.from >= sec.from && parent.to <= sec.to) return false
      const list = (parent ? parent.children : tree.roots).filter((x) => x.id !== id)
      index = Math.max(0, Math.min(index, list.length))
      // 目标层级：与新兄弟一致；没有兄弟时为父级 + 1
      let targetLevel: number
      if (list.length) targetLevel = list[Math.min(index, list.length - 1)].level
      else if (parent) targetLevel = parent.level + 1
      else if (tree.title) targetLevel = tree.title.level + 1
      else targetLevel = sec.level
      targetLevel = Math.max(1, Math.min(6, targetLevel))
      let at: number
      if (index < list.length) at = list[index].from
      else if (parent) at = parent.to
      else at = tree.title ? tree.title.to : s0.data.text.length

      const curParent = cardParent(tree, sec)
      const curList = siblingsOf(tree, sec)
      const curIndex = curList.indexOf(sec)
      const sameSpot = (curParent?.id ?? null) === (parent?.id ?? null) && curIndex === index
      if (sameSpot && targetLevel === sec.level) return false

      const delta = targetLevel - sec.level
      let text = s0.data.text
      let from = sec.from
      let to = sec.to
      const maps: PosMapper[] = []
      if (delta !== 0) {
        const cs = levelShiftChanges(text, from, to, delta)
        const m = mapperFromChanges(cs)
        maps.push(m)
        text = applyChangesToString(text, cs)
        from = m(from, -1)
        to = m(to, 1)
        at = m(at, 1)
      }
      let finalText = text
      if (!(at >= from && at <= to)) {
        const r = moveBlock(text, from, to, at)
        maps.push(r.map)
        finalText = r.text
      }
      const composed: PosMapper = (p, assoc) => maps.reduce((acc, m) => m(acc, assoc), p)
      // 记录：被移动小节的标题行作为“修改过”的位置
      get().applyTransform(finalText, composed, 'store', { group: null })
      const after = get()
      const moved = after.tree.byId.get(id)
      if (moved?.heading) {
        set({
          data: { ...after.data, edits: mergeRanges(after.data.edits.concat({ from: moved.heading.from, to: moved.heading.lineEnd })) },
        })
      }
      return true
    },

    shiftSection(id, dir) {
      const tree = get().tree
      const sec = getSection(id)
      if (!sec) return false
      const parent = cardParent(tree, sec)
      const list = siblingsOf(tree, sec)
      const i = list.indexOf(sec)
      if (dir === 'up') {
        if (i > 0) return get().moveSection(id, parent?.id ?? null, i - 1)
        return false
      }
      if (dir === 'down') {
        if (i < list.length - 1) return get().moveSection(id, parent?.id ?? null, i + 1)
        return false
      }
      if (dir === 'right') {
        if (i <= 0) return false
        const prev = list[i - 1]
        return get().moveSection(id, prev.id, prev.children.length)
      }
      // left：成为父级之后的兄弟
      if (!parent) return false
      const gp = cardParent(tree, parent)
      const plist = siblingsOf(tree, parent)
      return get().moveSection(id, gp?.id ?? null, plist.indexOf(parent) + 1)
    },

    deleteSection(id) {
      const sec = getSection(id)
      if (!sec) return
      const text = get().data.text
      let from = sec.from
      const to = sec.to
      // 删除位于文末的小节时，顺带去掉前面多余的空行
      if (to >= text.length) while (from > 0 && text[from - 1] === '\n' && text[from - 2] === '\n') from--
      get().applyChanges(ChangeSet.of([{ from, to }], text.length), 'store', { userEdit: true })
    },

    insertSection(where, title = '新小节') {
      const s = get()
      const text = s.data.text
      let at: number
      let level: number
      if (where.after) {
        const sec = getSection(where.after)
        if (!sec) return null
        at = sec.to
        level = sec.level
      } else if (where.childOf) {
        const sec = getSection(where.childOf)
        if (!sec) return null
        at = sec.to
        level = sec.children[0]?.level ?? Math.min(6, sec.level + 1)
      } else {
        at = text.length
        const roots = s.tree.roots
        level = roots[0]?.level ?? (s.tree.title ? s.tree.title.level + 1 : 2)
      }
      let prefix = ''
      if (at > 0) {
        if (at >= text.length) prefix = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
        else if (text[at - 1] !== '\n') prefix = '\n\n'
      }
      const heading = '#'.repeat(level) + ' ' + title
      const insert = prefix + heading + (at >= text.length ? '\n' : '\n\n')
      get().applyChanges(ChangeSet.of([{ from: at, insert }], text.length), 'store', { userEdit: true })
      return at + prefix.length
    },

    duplicateSection(id) {
      const sec = getSection(id)
      if (!sec) return
      const text = get().data.text
      const body = text.slice(sec.from, sec.to).replace(/\s+$/, '')
      const at = sec.to
      let prefix = ''
      if (at >= text.length) prefix = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
      const insert = prefix + body + (at >= text.length ? '\n' : '\n\n')
      get().applyChanges(ChangeSet.of([{ from: at, insert }], text.length), 'store', { userEdit: true })
    },

    unwrapSection(id) {
      const sec = getSection(id)
      if (!sec?.heading) return
      const text = get().data.text
      let to = sec.heading.lineEnd
      if (text[to] === '\n') to++
      while (text[to] === '\n') to++
      get().applyChanges(ChangeSet.of([{ from: sec.heading.from, to }], text.length), 'store', { userEdit: true })
    },

    renameHeadingLevel(id, level) {
      const sec = getSection(id)
      if (!sec) return
      const text = get().data.text
      const cs = levelShiftChanges(text, sec.from, sec.to, level - sec.level)
      get().applyChanges(cs, 'store', { userEdit: true })
    },
  }
})

export function tagNumbers(tags: Tag[]): Map<string, number> {
  const m = new Map<string, number>()
  tags
    .slice()
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .forEach((t, i) => m.set(t.id, i + 1))
  return m
}

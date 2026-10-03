export type NoteColor = 'cinnabar' | 'ochre' | 'jade' | 'indigo' | 'violet' | 'stone'

export const NOTE_COLORS: NoteColor[] = ['cinnabar', 'ochre', 'jade', 'indigo', 'violet', 'stone']

export const NOTE_COLOR_LABEL: Record<NoteColor, string> = {
  cinnabar: '朱',
  ochre: '赭',
  jade: '青',
  indigo: '靛',
  violet: '紫',
  stone: '墨',
}

/** 正文中的一个数字标签：一段被框选的文字 */
export interface Tag {
  id: string
  from: number
  to: number
  created: number
}

/** 一条注释，可连接多个标签 */
export interface Note {
  id: string
  text: string
  tagIds: string[]
  color: NoteColor
  resolved?: boolean
  created: number
  updated: number
}

/** 在本编辑器中手动修改过的区域（from === to 表示此处有删除） */
export interface EditRange {
  from: number
  to: number
}

/** 结构分析的一个单元：一句或多句 */
export interface Unit {
  id: string
  from: number
  to: number
  tags: string[]
  role?: string
  note?: string
}

export interface AnalysisSummary {
  thesis?: string
  structure?: string
  comment?: string
}

export interface Analysis {
  units: Unit[]
  summary?: AnalysisSummary
  model?: string
  createdAt: number
}

/** 标题锚点：让卡片在编辑过程中保持稳定的 id */
export interface HeadingAnchor {
  id: string
  pos: number
}

export interface DocData {
  text: string
  tags: Tag[]
  notes: Note[]
  edits: EditRange[]
  analysis: Analysis | null
  anchors: HeadingAnchor[]
}

export interface DocUIState {
  mode: 'editor' | 'cards'
  collapsed: string[]
}

/** IndexedDB 中每篇文档的存档 */
export interface DocArchive {
  id: string
  name: string
  handle?: FileSystemFileHandle
  data: DocData
  /** 上次与磁盘同步时的文本 */
  diskText: string
  diskModified?: number
  ui: DocUIState
  created: number
  updated: number
}

export interface DocIndexEntry {
  id: string
  name: string
  updated: number
  chars: number
  tags: number
  notes: number
  hasHandle: boolean
  excerpt: string
}

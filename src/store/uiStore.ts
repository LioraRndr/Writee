import { create } from 'zustand'

export type ThemeId = 'xuan' | 'su' | 'celadon' | 'dusk' | 'ink'
export type RailTab = 'notes' | 'structure'

export interface Settings {
  theme: ThemeId
  fontSize: number
  lineHeight: number
  width: number
  livePreview: boolean
  showEdits: boolean
  outlineOpen: boolean
  railOpen: boolean
  /** 左侧大纲宽度（px） */
  outlineWidth: number
  /** 右侧注释 / 结构栏宽度（px） */
  railWidth: number
}

export const THEMES: { id: ThemeId; name: string; desc: string; swatch: [string, string, string] }[] = [
  { id: 'xuan', name: '宣纸', desc: '暖白纸色 · 朱砂', swatch: ['#f5f0e6', '#2a2622', '#a8432a'] },
  { id: 'su', name: '素白', desc: '清爽白底 · 靛青', swatch: ['#fafaf8', '#1d1f23', '#3d5a98'] },
  { id: 'celadon', name: '青瓷', desc: '淡青釉色 · 松石', swatch: ['#ecf1eb', '#1f2a26', '#2f6f62'] },
  { id: 'dusk', name: '暮山', desc: '暖调夜色 · 琥珀', swatch: ['#1d1b19', '#e8e0d2', '#d39b5a'] },
  { id: 'ink', name: '墨夜', desc: '冷调夜色 · 月白', swatch: ['#14161a', '#dde1e7', '#8bb0e6'] },
]

const DEFAULTS: Settings = {
  theme: 'xuan',
  fontSize: 18,
  lineHeight: 1.95,
  width: 720,
  livePreview: true,
  showEdits: false,
  outlineOpen: true,
  railOpen: true,
  outlineWidth: 252,
  railWidth: 304,
}

export const SIZE_LIMITS = {
  outlineWidth: { min: 180, max: 460, def: 252 },
  railWidth: { min: 240, max: 560, def: 304 },
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('writee.settings')
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULTS
}

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
  tone?: 'info' | 'error'
  leaving?: boolean
}

export interface UIState {
  settings: Settings
  mode: 'editor' | 'cards'
  rail: RailTab
  hoverTag: string | null
  hoverNote: string | null
  activeNote: string | null
  /** 新建注释后需要聚焦其输入框 */
  focusNoteInput: string | null
  focusTag: string | null
  selectedNotes: string[]
  linkNote: string | null
  activeUnit: string | null
  hiddenCats: string[]
  collapsed: string[]
  dialog: null | 'copy' | 'settings' | 'ai' | 'analysisImport' | 'conflict' | 'format'
  toasts: Toast[]
  /** 当前光标所在的标题 id（用于大纲高亮） */
  currentSection: string | null
  /** 请求滚动到指定位置（由视图消费） */
  reveal: { pos: number; seq: number; select?: [number, number]; align?: 'start' | 'center' } | null
  /** 请求聚焦某个卡片的编辑器 */
  focusCard: { pos: number; select?: [number, number]; seq: number } | null

  setSettings(p: Partial<Settings>): void
  set<K extends keyof UIState>(k: K, v: UIState[K]): void
  toggleNoteSelected(id: string): void
  toggleCollapsed(id: string): void
  toast(text: string, opts?: { action?: Toast['action']; tone?: Toast['tone']; ms?: number }): void
  dismissToast(id: number): void
  revealPos(pos: number, select?: [number, number], align?: 'start' | 'center'): void
}

let toastSeq = 0
let revealSeq = 0

export const useUI = create<UIState>()((set, get) => ({
  settings: loadSettings(),
  mode: 'editor',
  rail: 'notes',
  hoverTag: null,
  hoverNote: null,
  activeNote: null,
  focusNoteInput: null,
  focusTag: null,
  selectedNotes: [],
  linkNote: null,
  activeUnit: null,
  hiddenCats: [],
  collapsed: [],
  dialog: null,
  toasts: [],
  currentSection: null,
  reveal: null,
  focusCard: null,

  setSettings(p) {
    const settings = { ...get().settings, ...p }
    localStorage.setItem('writee.settings', JSON.stringify(settings))
    set({ settings })
  },
  set(k, v) {
    set({ [k]: v } as Partial<UIState>)
  },
  toggleNoteSelected(id) {
    const cur = get().selectedNotes
    set({ selectedNotes: cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id) })
  },
  toggleCollapsed(id) {
    const cur = get().collapsed
    set({ collapsed: cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id) })
  },
  toast(text, opts = {}) {
    const id = ++toastSeq
    set({ toasts: get().toasts.concat({ id, text, action: opts.action, tone: opts.tone }) })
    setTimeout(() => get().dismissToast(id), opts.ms ?? (opts.action ? 6000 : 2600))
  },
  dismissToast(id) {
    if (!get().toasts.some((t) => t.id === id && !t.leaving)) return
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 200)
  },
  revealPos(pos, select, align = 'start') {
    set({ reveal: { pos, select, align, seq: ++revealSeq } })
  },
}))

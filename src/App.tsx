import { useEffect, useRef, useState } from 'react'
import { useDoc } from './store/docStore'
import { useUI } from './store/uiStore'
import { activateTab, openDialog, openFromFile, openFromHandle, saveAs, startSession, useTabs, writeNow } from './store/session'
import { useSel } from './editor/setup'
import { isMac } from './core/platform'
import { TopBar } from './components/TopBar'
import { Welcome } from './components/Welcome'
import { Workspace, addNoteForSelection } from './components/Workspace'
import { StatusBar } from './components/StatusBar'
import { TabStrip } from './components/TabStrip'
import { Toasts } from './components/Toasts'
import { CopyDialog } from './components/dialogs/CopyDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { AIDialog } from './components/dialogs/AIDialog'
import { WorkspaceDialog } from './components/dialogs/WorkspaceDialog'
import { ConflictDialog, FormatDialog, ImportAnalysisDialog } from './components/dialogs/MiscDialogs'

function isEditable(el: Element | null) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

export default function App() {
  const meta = useDoc((s) => s.meta)
  const settings = useUI((s) => s.settings)
  const dialog = useUI((s) => s.dialog)
  const hasTabs = useTabs((s) => s.tabs.length > 0)
  const [dragOver, setDragOver] = useState(false)
  // 标签页默认在顶部；放到左侧栏时，回到文档列表（没有左侧栏）仍在顶部显示
  const topTabs = hasTabs && (settings.tabsPosition === 'top' || !meta)

  useEffect(() => {
    startSession()
  }, [])

  // 切换配色时短暂开启全局颜色过渡
  const lastTheme = useRef(settings.theme)
  useEffect(() => {
    if (lastTheme.current === settings.theme) return
    lastTheme.current = settings.theme
    const root = document.documentElement
    root.classList.add('theme-switching')
    const t = setTimeout(() => root.classList.remove('theme-switching'), 420)
    return () => clearTimeout(t)
  }, [settings.theme])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.style.setProperty('--fs', settings.fontSize + 'px')
    root.style.setProperty('--lh', String(settings.lineHeight))
    root.style.setProperty('--col', settings.width + 'px')
    root.style.setProperty('--outline-w', settings.outlineWidth + 'px')
    root.style.setProperty('--rail', settings.railWidth + 'px')
  }, [settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'o' && !e.shiftKey) {
        e.preventDefault()
        void openDialog()
        return
      }
      // Alt+1…9：切换到第 N 个标签页（Alt+9 为最后一个）；macOS 文本框里 ⌥+数字用于输入符号，不拦截
      if (e.altKey && !mod && !e.shiftKey && /^Digit[1-9]$/.test(e.code) && !(isMac && isEditable(document.activeElement))) {
        const tabs = useTabs.getState().tabs
        const n = Number(e.code.slice(5))
        const tab = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1]
        if (tab) {
          e.preventDefault()
          void activateTab(tab.id)
        }
        return
      }
      if (!useDoc.getState().meta) return
      if (mod && k === 's') {
        e.preventDefault()
        if (useDoc.getState().meta?.handle) void writeNow()
        else void saveAs()
        return
      }
      if (mod && k === 'e' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        useUI.setState({ mode: useUI.getState().mode === 'editor' ? 'cards' : 'editor' })
        return
      }
      if (mod && e.key === '\\') {
        e.preventDefault()
        const s = useUI.getState().settings
        const open = !s.outlineOpen
        useUI.getState().setSettings({ outlineOpen: open, ...(open && window.matchMedia('(max-width: 900px)').matches ? { railOpen: false } : {}) })
        return
      }
      if (mod && e.altKey && (k === 'm' || e.code === 'KeyM')) {
        const sel = useSel.getState().sel
        if (sel) {
          e.preventDefault()
          addNoteForSelection(sel.from, sel.to)
        }
        return
      }
      if (mod && e.shiftKey && (k === 'c' || e.code === 'KeyC') && !isEditable(document.activeElement)) {
        if (useDoc.getState().data.notes.length) {
          e.preventDefault()
          useUI.setState({ dialog: 'copy' })
        }
        return
      }
      if (e.key === 'Escape') {
        const ui = useUI.getState()
        if (ui.linkNote) useUI.setState({ linkNote: null })
        else if (ui.activeNote && !isEditable(document.activeElement)) useUI.setState({ activeNote: null })
        else if (ui.activeUnit) useUI.setState({ activeUnit: null })
        return
      }
      // 不在文本框内时，⌘Z 也作用于文档（编辑器已处理过的按键不再重复撤销：处理过程中焦点可能已移到表格单元格）
      if (mod && k === 'z' && !e.defaultPrevented && !isEditable(document.activeElement)) {
        e.preventDefault()
        if (e.shiftKey) useDoc.getState().redo()
        else useDoc.getState().undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const item = e.dataTransfer.items?.[0]
    if (item && 'getAsFileSystemHandle' in item) {
      const h = await (item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle | null> }).getAsFileSystemHandle()
      if (h && h.kind === 'file') {
        await openFromHandle(h as FileSystemFileHandle)
        return
      }
    }
    const f = e.dataTransfer.files?.[0]
    if (f) await openFromFile(f)
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <TopBar />
      {topTabs && <TabStrip />}
      {meta ? (
        <>
          <Workspace key={meta.id} />
          <StatusBar />
        </>
      ) : (
        <Welcome />
      )}
      {dialog === 'copy' && <CopyDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'ai' && <AIDialog />}
      {dialog === 'workspace' && <WorkspaceDialog />}
      {dialog === 'analysisImport' && <ImportAnalysisDialog />}
      {dialog === 'format' && <FormatDialog />}
      {dialog === 'conflict' && <ConflictDialog />}
      {dragOver && <div className="drop-overlay">松开以打开 Markdown 文件</div>}
      <Toasts />
    </div>
  )
}

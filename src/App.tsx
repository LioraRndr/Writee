import { useEffect, useRef, useState } from 'react'
import { useDoc } from './store/docStore'
import { useUI } from './store/uiStore'
import { openDialog, openFromFile, openFromHandle, saveAs, startSession, writeNow } from './store/session'
import { useSel } from './editor/setup'
import { TopBar } from './components/TopBar'
import { Welcome } from './components/Welcome'
import { Workspace, addNoteForSelection } from './components/Workspace'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { CopyDialog } from './components/dialogs/CopyDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { AIDialog } from './components/dialogs/AIDialog'
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
  const [dragOver, setDragOver] = useState(false)

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
        useUI.getState().setSettings({ outlineOpen: !s.outlineOpen })
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
      // 不在文本框内时，⌘Z 也作用于文档
      if (mod && k === 'z' && !isEditable(document.activeElement)) {
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
      {dialog === 'analysisImport' && <ImportAnalysisDialog />}
      {dialog === 'format' && <FormatDialog />}
      {dialog === 'conflict' && <ConflictDialog />}
      {dragOver && <div className="drop-overlay">松开以打开 Markdown 文件</div>}
      <Toasts />
    </div>
  )
}

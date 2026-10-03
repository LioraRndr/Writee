import { useDoc } from '../store/docStore'
import { useUI } from '../store/uiStore'
import { useWordCount } from './hooks'
import { ALT, MOD, SHIFT } from '../core/platform'

export function StatusBar() {
  const tags = useDoc((s) => s.data.tags.length)
  const notes = useDoc((s) => s.data.notes.length)
  const edits = useDoc((s) => s.data.edits.length)
  const sections = useDoc((s) => s.tree.flat.length)
  const showEdits = useUI((s) => s.settings.showEdits)
  const linkNote = useUI((s) => s.linkNote)
  const words = useWordCount()
  return (
    <footer className="statusbar">
      <span>{words.toLocaleString()} 字</span>
      <span>{sections} 个小标题</span>
      <span>
        {tags} 个标签 · {notes} 条注释
      </span>
      {edits > 0 && (
        <button
          className={'status-btn' + (showEdits ? ' is-on' : '')}
          onClick={() => useUI.getState().setSettings({ showEdits: !showEdits })}
          title="显示/隐藏在本编辑器中手动修改过的地方"
        >
          手动修改 {edits} 处
        </button>
      )}
      <span className="spacer" />
      {linkNote && <span className="status-link">关联模式 · Esc 退出</span>}
      <span className="muted">
        {MOD}
        {ALT}M 注释 · {MOD}E 切换卡片 · {ALT}
        {SHIFT}↑↓ 移动卡片
      </span>
    </footer>
  )
}

import { Modal } from './Modal'
import { THEMES, useUI } from '../../store/uiStore'
import { useDoc } from '../../store/docStore'

export function SettingsDialog() {
  const s = useUI((st) => st.settings)
  const set = useUI((st) => st.setSettings)
  const edits = useDoc((st) => st.data.edits.length)
  const close = () => useUI.setState({ dialog: null })
  return (
    <Modal title="外观与偏好" onClose={close} width={620}>
      <div className="field-label">配色</div>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={'theme-card' + (s.theme === t.id ? ' is-on' : '')} onClick={() => set({ theme: t.id })}>
            <span className="theme-swatch" style={{ background: t.swatch[0], color: t.swatch[1] }}>
              <span className="theme-swatch-text">文</span>
              <span className="theme-swatch-accent" style={{ background: t.swatch[2] }} />
            </span>
            <b>{t.name}</b>
            <small>{t.desc}</small>
          </button>
        ))}
      </div>

      <div className="settings-rows">
        <label className="setting-row">
          <span>字号</span>
          <input type="range" min={15} max={23} step={0.5} value={s.fontSize} onChange={(e) => set({ fontSize: +e.target.value })} />
          <span className="setting-val">{s.fontSize}px</span>
        </label>
        <label className="setting-row">
          <span>行距</span>
          <input type="range" min={1.6} max={2.3} step={0.05} value={s.lineHeight} onChange={(e) => set({ lineHeight: +e.target.value })} />
          <span className="setting-val">{s.lineHeight.toFixed(2)}</span>
        </label>
        <label className="setting-row">
          <span>版心宽度</span>
          <input type="range" min={560} max={960} step={20} value={s.width} onChange={(e) => set({ width: +e.target.value })} />
          <span className="setting-val">{s.width}px</span>
        </label>
        <label className="setting-row check">
          <input type="checkbox" checked={s.livePreview} onChange={(e) => set({ livePreview: e.target.checked })} />
          <span>
            实时预览
            <small>隐藏 Markdown 标记，光标所在处再显示；关闭后为源码模式</small>
          </span>
        </label>
        <label className="setting-row check">
          <input type="checkbox" checked={s.showEdits} onChange={(e) => set({ showEdits: e.target.checked })} />
          <span>
            显示修改痕迹
            <small>用虚线标出在本编辑器中手动修改过的文字（当前 {edits} 处）</small>
          </span>
        </label>
      </div>
      {edits > 0 && (
        <div className="settings-note">
          <span className="muted small">
            修改痕迹用于在复制注释时提醒 AI“不要替换成原来的文字”。把文章交给 AI 改完、确认新版本后，可以清除痕迹，以新版本为基准。
          </span>
          <button
            className="btn"
            onClick={() => {
              useDoc.getState().clearEdits()
              useUI.getState().toast('已清除修改痕迹', { action: { label: '撤销', run: () => useDoc.getState().undo() } })
            }}
          >
            清除修改痕迹
          </button>
        </div>
      )}
    </Modal>
  )
}

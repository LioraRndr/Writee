import { useEffect } from 'react'
import { useSession, refreshRecent, openDialog, openRecent, openSample, newDocument, forgetArchive } from '../store/session'
import { fsaSupported } from '../core/fileAccess'
import { Menu } from './Menu'
import { IconFile, IconFolder, IconMore, IconPlus, IconSpark } from './icons'

function fmtDate(t: number) {
  const d = new Date(t)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return '今天 ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function Welcome() {
  const recent = useSession((s) => s.recent)
  const loading = useSession((s) => s.loading)
  useEffect(() => {
    void refreshRecent()
  }, [])
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1 className="welcome-title">
          <span className="brand-lg">Writee</span>
          <span className="welcome-sub">慢下来，好好写。</span>
        </h1>
        <p className="welcome-lede">
          打开一篇本地 Markdown 文章：在原文件上实时编辑，按标题切成卡片调整结构，框选文字写下注释，再一键整理给 AI。
        </p>
        <div className="welcome-actions">
          <button className="btn is-primary lg" onClick={() => void openDialog()} disabled={loading}>
            <IconFolder size={17} /> 打开 Markdown 文件
          </button>
          <button className="btn lg" onClick={() => void newDocument()}>
            <IconPlus size={17} /> 新建
          </button>
          <button className="btn lg is-ghost" onClick={() => void openSample()}>
            <IconSpark size={16} /> 看看示例
          </button>
        </div>
        <p className="welcome-hint muted small">
          {fsaSupported
            ? '也可以把 .md 文件直接拖进窗口。修改会自动写回原文件；注释与分析保存在浏览器的存档里，不会写入文件。'
            : '当前浏览器不支持直接写回本地文件（建议使用 Chrome 或 Edge）。你仍可打开文件编辑，修改保存在浏览器存档中，可随时下载。'}
        </p>

        {recent.length > 0 && (
          <div className="recent">
            <div className="recent-head">最近的文档</div>
            {recent.map((r) => (
              <div key={r.id} className="recent-item">
                <button className="recent-main" onClick={() => void openRecent(r.id)}>
                  <IconFile size={16} />
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-excerpt">{r.excerpt}</span>
                  <span className="recent-meta">
                    {r.notes > 0 && <span>{r.notes} 条注释</span>}
                    <span>{fmtDate(r.updated)}</span>
                  </span>
                </button>
                <Menu
                  trigger={<IconMore size={15} />}
                  items={[
                    {
                      label: '删除存档（不影响原文件）',
                      danger: true,
                      onSelect: () => void forgetArchive(r.id),
                    },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { MOD, SHIFT } from '../core/platform'
import { useDoc } from '../store/docStore'
import { useUI } from '../store/uiStore'
import { closeDoc, downloadCurrent, grantWrite, newDocument, openDialog, saveAs, writeNow } from '../store/session'
import { copyText, fsaSupported } from '../core/fileAccess'
import { isLocalFile, localFileAction, localFilePath, localSystemSupported } from '../core/localFile'
import type { LocalFileHandle } from '../core/types'
import { Menu } from './Menu'
import { useMediaQuery } from './hooks'
import {
  IconCards,
  IconCopy,
  IconFile,
  IconFolder,
  IconLayers,
  IconLink,
  IconMore,
  IconNote,
  IconPen,
  IconRail,
  IconSettings,
  IconSidebar,
  IconUndo,
  IconSpark,
} from './icons'

function fmtTime(t: number | null) {
  if (!t) return ''
  const d = new Date(t)
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
}

export function FileStatus() {
  const st = useDoc((s) => s.fileStatus)
  const err = useDoc((s) => s.fileError)
  const last = useDoc((s) => s.lastSaved)
  switch (st) {
    case 'saved':
      return <span className="fstatus is-ok" title="已写回原文件">已保存{last ? ' · ' + fmtTime(last) : ''}</span>
    case 'dirty':
      return <span className="fstatus">未保存</span>
    case 'saving':
      return <span className="fstatus">保存中…</span>
    case 'memory':
      return (
        <button className="fstatus is-warn" onClick={() => void saveAs()} title="内容保存在浏览器存档中；点击另存为本地文件">
          {fsaSupported ? '仅存档 · 另存为文件' : '仅存档 · 下载'}
        </button>
      )
    case 'nopermission':
      return (
        <button className="fstatus is-warn" onClick={() => void grantWrite()}>
          需要授权写入 · 点此授权
        </button>
      )
    case 'conflict':
      return (
        <button className="fstatus is-error" onClick={() => useUI.setState({ dialog: 'conflict' })}>
          文件冲突 · 处理
        </button>
      )
    case 'error':
      return (
        <button className="fstatus is-error" title={err ?? ''} onClick={() => void writeNow()}>
          保存失败 · 重试
        </button>
      )
    default:
      return null
  }
}

async function runFileAction(handle: LocalFileHandle, action: 'copy' | 'open' | 'reveal') {
  try {
    if (action === 'copy') {
      const filePath = await localFilePath(handle)
      if (!(await copyText(filePath))) throw new Error('剪贴板不可用')
      useUI.getState().toast('已复制文件路径')
      return
    }
    const filePath = action === 'open' ? await localFilePath(handle) : undefined
    await localFileAction(handle, action, filePath)
    useUI.getState().toast(action === 'open' ? '已交给系统默认程序' : '已在文件夹中显示')
  } catch (error) {
    useUI.getState().toast('操作失败：' + (error instanceof Error ? error.message : String(error)), { tone: 'error', ms: 6000 })
  }
}

export function TopBar() {
  const meta = useDoc((s) => s.meta)
  const mode = useUI((s) => s.mode)
  const rail = useUI((s) => s.rail)
  const settings = useUI((s) => s.settings)
  const selected = useUI((s) => s.selectedNotes.length)
  const notes = useDoc((s) => s.data.notes.length)
  const canUndo = useDoc((s) => s.past.length > 0)
  const setSettings = useUI((s) => s.setSettings)
  const local = meta?.handle && isLocalFile(meta.handle) && localSystemSupported ? meta.handle : null
  const compact = useMediaQuery('(max-width: 680px)')
  const overlay = useMediaQuery('(max-width: 900px)')
  const toggleOutline = () => {
    const open = !settings.outlineOpen
    setSettings({ outlineOpen: open, ...(overlay && open ? { railOpen: false } : {}) })
  }
  const toggleRailVisible = () => {
    const open = !settings.railOpen
    setSettings({ railOpen: open, ...(overlay && open ? { outlineOpen: false } : {}) })
  }
  const selectRail = (next: 'notes' | 'structure') => {
    if (rail === next && settings.railOpen) {
      setSettings({ railOpen: false })
      return
    }
    useUI.setState({ rail: next })
    setSettings({ railOpen: true, ...(overlay ? { outlineOpen: false } : {}) })
  }

  return (
    <header className={'topbar' + (compact ? ' is-compact' : '')}>
      <div className="topbar-left">
        {meta && (
        <button
          className={'icon-btn' + (settings.outlineOpen ? ' is-on' : '')}
          title={`大纲（${MOD}\\）`}
          onClick={toggleOutline}
        >
          <IconSidebar size={17} />
        </button>
        )}
        <span className="brand">Writee</span>
        {meta && (
          <Menu
            className="file-btn"
            align="left"
            title="文件"
            trigger={
              <>
                <IconFile size={14} />
                <span className="file-name">{meta.name}</span>
              </>
            }
            items={[
              { label: '打开…', hint: MOD + 'O', onSelect: () => void openDialog() },
              { label: '工作目录…', onSelect: () => useUI.setState({ dialog: 'workspace' }) },
              { label: '新建…', onSelect: () => void newDocument() },
              { divider: true, label: '' },
              {
                label: meta.handle ? '立即保存' : fsaSupported ? '另存为本地文件…' : '下载 .md',
                hint: MOD + 'S',
                onSelect: () => void (meta.handle ? writeNow() : saveAs()),
              },
              { label: '另存为…', onSelect: () => void saveAs() },
              { label: '下载副本（.md）', onSelect: downloadCurrent },
              { divider: true, label: '' },
              {
                label: '复制文件路径',
                icon: <IconCopy size={14} />,
                hint: local ? undefined : '本机入口',
                disabled: !local,
                onSelect: () => void runFileAction(local!, 'copy'),
              },
              {
                label: '在文件夹中显示',
                icon: <IconFolder size={14} />,
                hint: local ? undefined : '本机入口',
                disabled: !local,
                onSelect: () => void runFileAction(local!, 'reveal'),
              },
              {
                label: '用系统默认方式打开',
                icon: <IconLink size={14} />,
                hint: local ? undefined : '本机入口',
                disabled: !local,
                onSelect: () => void runFileAction(local!, 'open'),
              },
              { divider: true, label: '' },
              { label: '关闭标签页', onSelect: closeDoc },
            ]}
          />
        )}
        {meta && <FileStatus />}
      </div>

      {meta && (
        <div className="topbar-center">
          <div className="seg">
            <button className={mode === 'editor' ? 'is-on' : ''} onClick={() => useUI.setState({ mode: 'editor' })} title={`编辑（${MOD}E 切换）`}>
              <IconPen size={14} /> 编辑
            </button>
            <button className={mode === 'cards' ? 'is-on' : ''} onClick={() => useUI.setState({ mode: 'cards' })} title={`卡片（${MOD}E 切换）`}>
              <IconCards size={14} /> 卡片
            </button>
          </div>
        </div>
      )}

      {meta && (
        <div className="topbar-right">
          <button className="icon-btn" title={`撤销（${MOD}Z）`} disabled={!canUndo} onClick={() => useDoc.getState().undo()}>
            <IconUndo size={16} />
          </button>
          <div className="seg small">
            <button
              className={rail === 'notes' && settings.railOpen ? 'is-on' : ''}
              onClick={() => selectRail('notes')}
              title="注释侧栏"
            >
              <IconNote size={14} /> <span className="topbar-action-label">注释</span>{notes ? <span className="count">{notes}</span> : null}
            </button>
            <button
              className={rail === 'structure' && settings.railOpen ? 'is-on' : ''}
              onClick={() => selectRail('structure')}
              title="结构分析侧栏"
            >
              <IconLayers size={14} /> <span className="topbar-action-label">结构</span>
            </button>
          </div>
          <button
            className="btn is-accent small"
            disabled={!notes}
            onClick={() => useUI.setState({ dialog: 'copy' })}
            title={`把注释整理成提示词，复制给 AI（${MOD}${SHIFT}C）`}
          >
            <IconCopy size={14} /> <span className="topbar-action-label">复制注释</span>{selected ? ` (${selected})` : ''}
          </button>
          {compact ? (
            <Menu
              title="更多"
              trigger={<IconMore size={16} />}
              items={[
                { label: 'AI 设置', icon: <IconSpark size={14} />, onSelect: () => useUI.setState({ dialog: 'ai' }) },
                { label: '外观与偏好', icon: <IconSettings size={14} />, onSelect: () => useUI.setState({ dialog: 'settings' }) },
                {
                  label: settings.railOpen ? '隐藏侧栏' : '显示侧栏',
                  icon: <IconRail size={14} />,
                  onSelect: toggleRailVisible,
                },
              ]}
            />
          ) : (
            <>
              <button className="icon-btn" title="AI 设置" onClick={() => useUI.setState({ dialog: 'ai' })}>
                <IconSpark size={16} />
              </button>
              <button className="icon-btn" title="外观与偏好" onClick={() => useUI.setState({ dialog: 'settings' })}>
                <IconSettings size={16} />
              </button>
              <button
                className={'icon-btn' + (settings.railOpen ? ' is-on' : '')}
                title="显示/隐藏侧栏"
                onClick={toggleRailVisible}
              >
                <IconRail size={17} />
              </button>
            </>
          )}
        </div>
      )}
    </header>
  )
}

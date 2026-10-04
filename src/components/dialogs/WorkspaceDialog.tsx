import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useUI } from '../../store/uiStore'
import { useDoc } from '../../store/docStore'
import { currentLocation, registerWorkspace, relinkCurrent } from '../../store/session'
import { loadRoots } from '../../core/archive'
import { pickMarkdownFile } from '../../core/fileAccess'
import type { WorkspaceRoot } from '../../core/types'

export function WorkspaceDialog() {
  const [roots, setRoots] = useState<WorkspaceRoot[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const meta = useDoc((s) => s.meta)
  const location = currentLocation()
  const supported = 'showDirectoryPicker' in window
  useEffect(() => { void loadRoots().then(setRoots).catch((e) => setError(String(e))) }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setRoots(await loadRoots())
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="工作目录" subtitle="同一路径的文章持续使用同一份笔记" onClose={() => useUI.setState({ dialog: null })}>
      <p>授权文章所在目录后，照常打开或拖入 Markdown 文件。Agent 修改或替换该路径的文件后，笔记仍保留在原存档中。</p>
      <button className="btn is-primary" disabled={busy || !supported} onClick={() => void run(async () => {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
        await registerWorkspace(handle)
      })}>授权工作目录…</button>
      {!supported && <p className="muted small">工作目录需要桌面版 Chrome 或 Edge，并通过 localhost 或 HTTPS 访问。</p>}
      {roots.length > 0 && <ul>
        {roots.map((root) => <li key={root.id}>
          <span>{root.handle.name} </span>
          <button className="chip-btn" disabled={busy} onClick={() => void run(async () => {
            await registerWorkspace(root.handle)
          })}>重新授权</button>
        </li>)}
      </ul>}
      {meta && meta.id !== 'sample' && <>
        <p className="small">当前文档：{meta.name}<br />
          {location
            ? `已关联：${roots.find((r) => r.id === location.rootId)?.handle.name ?? '工作目录'}/${location.path.join('/')}`
            : '尚未关联工作目录。授权包含此文件的目录后会自动关联；旧文件已失效时，可选择新的文件位置。'}
        </p>
        <button className="btn" disabled={busy || !supported || !roots.length} onClick={() => void run(async () => {
          const handle = await pickMarkdownFile()
          if (handle) await relinkCurrent(handle)
        })}>选择文件，关联当前存档…</button>
        <p className="muted small">用于恢复旧笔记，或关联移动、改名后的文件。保留当前存档的笔记，载入所选文件的内容；有未写回的编辑时会提示处理冲突。</p>
      </>}
      <p className="muted small">目录关联和笔记保存在当前浏览器中。路径被用于另一篇文章时，请先从“最近的文档”删除旧存档。目录移动后需重新关联。</p>
      {error && <p className="error-text" role="alert">{error}</p>}
    </Modal>
  )
}

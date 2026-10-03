import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useDoc } from '../../store/docStore'
import { useUI } from '../../store/uiStore'
import { tagInfo } from '../../core/derive'
import { buildNotesPrompt, INSTRUCTION_PRESETS, type CopyOptions, type CopyScope } from '../../core/notesPrompt'
import { copyText } from '../../core/fileAccess'
import { IconCheck, IconCopy } from '../icons'

const OPTS_KEY = 'writee.copyopts'

function loadOpts(): CopyOptions {
  try {
    const raw = localStorage.getItem(OPTS_KEY)
    if (raw) return { scope: 'paragraphs', instruction: '', listEdits: true, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { scope: 'paragraphs', instruction: '', listEdits: true }
}

const SCOPES: { id: CopyScope; label: string; desc: string }[] = [
  { id: 'paragraphs', label: '相关段落', desc: '只带上批注所在的段落及其标题路径' },
  { id: 'full', label: '全文', desc: '附上整篇文章，适合让 AI 通盘修改' },
  { id: 'quotes', label: '仅引文', desc: '不附原文，只列出被批注的文字' },
]

export function CopyDialog() {
  const data = useDoc((s) => s.data)
  const tree = useDoc((s) => s.tree)
  const name = useDoc((s) => s.meta?.name ?? '未命名')
  const preselected = useUI((s) => s.selectedNotes)
  const [ids, setIds] = useState<string[]>(() =>
    preselected.length ? preselected : data.notes.filter((n) => !n.resolved).map((n) => n.id),
  )
  const [opts, setOpts] = useState<CopyOptions>(loadOpts)
  const [copied, setCopied] = useState(false)
  const info = tagInfo(data)

  const update = (p: Partial<CopyOptions>) => {
    const next = { ...opts, ...p }
    setOpts(next)
    localStorage.setItem(OPTS_KEY, JSON.stringify(next))
  }

  const sortedNotes = useMemo(() => {
    const first = (tagIds: string[]) =>
      Math.min(...tagIds.map((id) => data.tags.find((t) => t.id === id)?.from ?? Infinity), Infinity)
    return data.notes.slice().sort((a, b) => first(a.tagIds) - first(b.tagIds))
  }, [data])

  const prompt = useMemo(() => buildNotesPrompt(data, tree, name, ids, opts), [data, tree, name, ids, opts])
  const close = () => useUI.setState({ dialog: null })

  const doCopy = async () => {
    await copyText(prompt)
    setCopied(true)
    useUI.getState().toast(`已复制 ${ids.length} 条注释，可以直接粘贴给 AI`)
    setTimeout(close, 500)
  }

  return (
    <Modal
      title="复制注释给 AI"
      subtitle="把注释与对应原文整理成一段简洁的提示词"
      onClose={close}
      width={880}
      footer={
        <>
          <span className="muted small">
            {ids.length} 条注释 · {prompt.length} 字
            {data.edits.length > 0 && ' · 含“我做了一些修改”的提醒'}
          </span>
          <span className="spacer" />
          <button className="btn" onClick={close}>
            取消
          </button>
          <button className="btn is-primary" disabled={!ids.length} onClick={doCopy}>
            {copied ? <IconCheck size={15} /> : <IconCopy size={15} />} 复制
          </button>
        </>
      }
    >
      <div className="copy-grid">
        <div className="copy-side">
          <div className="field-label">
            选择注释
            <span className="spacer" />
            <button className="link-btn" onClick={() => setIds(data.notes.map((n) => n.id))}>
              全选
            </button>
            <button className="link-btn" onClick={() => setIds([])}>
              清空
            </button>
          </div>
          <div className="copy-notes">
            {sortedNotes.map((n) => {
              const on = ids.includes(n.id)
              return (
                <label key={n.id} className={'copy-note' + (on ? ' is-on' : '')} style={{ '--nc': `var(--nc-${n.color})` } as React.CSSProperties}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setIds(on ? ids.filter((x) => x !== n.id) : ids.concat(n.id))}
                  />
                  <span className="copy-note-tags">
                    {n.tagIds.map((t) => info.numbers.get(t)).filter(Boolean).sort((a, b) => a! - b!).join(' · ') || '—'}
                  </span>
                  <span className="copy-note-text">{n.text.trim() || '（空）'}</span>
                </label>
              )
            })}
            {!sortedNotes.length && <p className="muted small">还没有注释。</p>}
          </div>

          <div className="field-label">上下文</div>
          <div className="seg-col">
            {SCOPES.map((s) => (
              <label key={s.id} className={'radio-card' + (opts.scope === s.id ? ' is-on' : '')}>
                <input type="radio" checked={opts.scope === s.id} onChange={() => update({ scope: s.id })} />
                <span>
                  <b>{s.label}</b>
                  <small>{s.desc}</small>
                </span>
              </label>
            ))}
          </div>

          <div className="field-label">附加指令</div>
          <div className="chip-row">
            {INSTRUCTION_PRESETS.map((p) => (
              <button
                key={p.label}
                className={'chip-btn' + (opts.instruction === p.text ? ' is-on' : '')}
                onClick={() => update({ instruction: p.text })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <textarea
            className="input"
            rows={2}
            value={opts.instruction}
            placeholder="可选：写给 AI 的一句话要求"
            onChange={(e) => update({ instruction: e.target.value })}
          />
          {data.edits.length > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={opts.listEdits} onChange={(e) => update({ listEdits: e.target.checked })} />
              列出我手动改过的句子（提醒 AI 不要改回原文）
            </label>
          )}
        </div>
        <div className="copy-preview">
          <div className="field-label">预览</div>
          <pre>{prompt}</pre>
        </div>
      </div>
    </Modal>
  )
}

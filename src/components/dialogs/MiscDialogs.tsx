import { useState } from 'react'
import { Modal } from './Modal'
import { useUI } from '../../store/uiStore'
import { useDoc } from '../../store/docStore'
import { useSession, resolveConflict } from '../../store/session'
import { importAnalysis, FORMAT_ID } from '../../analysis/format'
import { CATEGORIES } from '../../analysis/taxonomy'
import { readFileInput } from '../../core/fileAccess'
import { MOD } from '../../core/platform'

export function ImportAnalysisDialog() {
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const close = () => useUI.setState({ dialog: null })
  const doImport = () => {
    try {
      const a = importAnalysis(raw, useDoc.getState().data.text)
      useDoc.getState().setAnalysis(a)
      useUI.setState({ dialog: null, rail: 'structure' })
      useUI.getState().toast(`已导入 ${a.units.length} 个分析单元`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Modal
      title="导入分析结果"
      subtitle={`粘贴 AI 的回复（JSON Lines），或 ${FORMAT_ID} 格式的 .json 文件内容`}
      onClose={close}
      width={680}
      footer={
        <>
          <button
            className="btn"
            onClick={async () => {
              const f = await readFileInput('.json,.jsonl,.txt')
              if (f) setRaw(await f.text())
            }}
          >
            选择文件…
          </button>
          <span className="spacer" />
          <button className="btn" onClick={close}>
            取消
          </button>
          <button className="btn is-primary" disabled={!raw.trim()} onClick={doImport}>
            导入
          </button>
        </>
      }
    >
      <textarea
        className="input mono"
        rows={14}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value)
          setErr(null)
        }}
        placeholder={'{"s":[1,1],"q":"慢下来，才能写","t":["struct.title-point"],"r":"标题点明主旨"}\n{"s":[2,3],"q":"在这个人人都","t":["arg.background","arg.thesis"],"r":"由现象引出论点"}\n…'}
      />
      {err && <p className="error-text">{err}</p>}
    </Modal>
  )
}

export function FormatDialog() {
  const close = () => useUI.setState({ dialog: null })
  return (
    <Modal title="结构分析文件格式" subtitle={FORMAT_ID} onClose={close} width={760}>
      <p className="small">
        分析以“句”为基本单位：Writee 按 。！？… 以及英文句点切句，标题、列表项各自成句。一个分析单元可以覆盖一句或相邻的几句，并带有 1–4 个标签，第一个为主标签。
      </p>
      <pre className="code-block">{`{
  "format": "${FORMAT_ID}",
  "source": { "title": "文章名", "sentences": 128, "chars": 5321 },
  "generatedBy": "claude-opus-5-5",
  "createdAt": "2026-10-03T08:00:00.000Z",
  "summary": {
    "thesis": "中心论点",
    "structure": "总—分—总……",
    "comment": "整体评价与修改建议"
  },
  "units": [
    {
      "sentences": [3, 4],          // 句子序号区间（从 1 开始，闭区间）
      "text": "单元开头的原文",       // 用于文章改动后重新定位
      "tags": ["arg.claim", "method.contrast", "rhet.parallelism"],
      "role": "第二个分论点",
      "note": "对比不够鲜明，可补充反例"
    }
  ]
}`}</pre>
      <p className="small muted">AI 流式输出时使用紧凑的 JSON Lines：{'{"s":[3,4],"q":"开头原文","t":[…],"r":"作用","n":"建议"}'}，最后一行为 {'{"summary":{…}}'}。</p>
      <div className="field-label">标签体系</div>
      <div className="taxonomy">
        {CATEGORIES.map((c) => (
          <div key={c.id} className="taxonomy-cat" style={{ '--uc': `var(--cat-${c.id})` } as React.CSSProperties}>
            <div className="taxonomy-head">
              <i /> {c.label} <code>{c.id}</code>
            </div>
            <div className="taxonomy-tags">
              {c.tags.map((t) => (
                <span key={t.id} title={t.desc}>
                  {t.label}
                  <code>{t.id.split('.')[1]}</code>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function ConflictDialog() {
  const conflict = useSession((s) => s.conflict)
  const close = () => useUI.setState({ dialog: null })
  if (!conflict) return null
  return (
    <Modal
      title="文件在外部被修改了"
      subtitle="磁盘上的文件和编辑器中的内容都发生了变化。"
      onClose={close}
      width={520}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={() => resolveConflict('mine')}>
            保留编辑器版本（覆盖文件）
          </button>
          <button className="btn is-primary" onClick={() => resolveConflict('disk')}>
            载入磁盘版本
          </button>
        </>
      }
    >
      <p className="small">
        载入磁盘版本时，注释与分析会按文字变化自动对齐；编辑器中的改动可以用 撤销（{MOD}Z）找回。
      </p>
    </Modal>
  )
}

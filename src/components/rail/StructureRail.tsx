import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDoc } from '../../store/docStore'
import { useUI } from '../../store/uiStore'
import { registry } from '../../editor/registry'
import { CATEGORIES, primaryCat, tagLabel, tagCat } from '../../analysis/taxonomy'
import { useRun, startAnalysis, cancelAnalysis, buildManualPrompt } from '../../analysis/run'
import { exportAnalysis } from '../../analysis/format'
import { computeDots, curve, placeStack, GUTTER, type Dot, type Placed } from './layout'
import { TagPicker } from './TagPicker'
import { Menu } from '../Menu'
import { usePlacementClass } from '../hooks'
import { reveal } from '../reveal'
import { copyText, downloadText } from '../../core/fileAccess'
import { IconClose, IconMore, IconSpark, IconTrash, IconPlus } from '../icons'

export function StructureRail() {
  const analysis = useDoc((s) => s.data.analysis)
  const activeUnit = useUI((s) => s.activeUnit)
  const hiddenCats = useUI((s) => s.hiddenCats)
  const mode = useUI((s) => s.mode)
  const run = useRun()
  const railRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const extraRef = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<string, number>())
  const [layout, setLayout] = useState<{
    dots: Map<string, Dot>
    items: Map<string, Placed>
    railLeft: number
    railTop: number
    pageW: number
    pageH: number
  } | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)

  const units = useMemo(() => analysis?.units ?? [], [analysis])
  const visible = useMemo(
    () => units.filter((u) => !hiddenCats.length || u.tags.some((t) => !hiddenCats.includes(tagCat(t)))),
    [units, hiddenCats],
  )

  const compute = useCallback(() => {
    const page = registry.page()
    const rail = railRef.current
    if (!page || !rail) return
    const pr = page.getBoundingClientRect()
    const rr = rail.getBoundingClientRect()
    const railLeft = rr.left - pr.left
    const railTop = rr.top - pr.top
    const extra = extraRef.current
    const bottom = extra ? extra.getBoundingClientRect().bottom - pr.top : railTop + (headRef.current?.offsetHeight ?? 60)
    const dots = computeDots(
      visible.map((u) => ({ id: u.id, pos: u.from, side: 1 as const, badgeSelector: `[data-unit-start="${u.id}"]` })),
      railLeft - GUTTER,
    )
    const items = visible
      .filter((u) => dots.has(u.id))
      .map((u) => ({ id: u.id, anchor: dots.get(u.id)!.y - 13, height: heights.current.get(u.id) ?? 28 }))
    const placed = placeStack(items, { gap: 4, minTop: bottom + 8, activeId: useUI.getState().activeUnit })
    setLayout({ dots, items: placed, railLeft, railTop, pageW: pr.width, pageH: page.scrollHeight })
  }, [visible])

  useEffect(() => {
    const off = registry.onLayout(compute)
    registry.requestLayout()
    const onResize = () => registry.requestLayout()
    window.addEventListener('resize', onResize)
    return () => {
      off()
      window.removeEventListener('resize', onResize)
    }
  }, [compute])

  useEffect(() => {
    registry.requestLayout()
  }, [analysis, activeUnit, mode, summaryOpen, run.phase])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const ro = new ResizeObserver((entries) => {
      let changed = false
      for (const e of entries) {
        const el = e.target as HTMLElement
        if (el.dataset.unitLabel) {
          const h = Math.round(el.offsetHeight)
          if (heights.current.get(el.dataset.unitLabel) !== h) {
            heights.current.set(el.dataset.unitLabel, h)
            changed = true
          }
        } else changed = true
      }
      if (changed) registry.requestLayout()
    })
    rail.querySelectorAll('[data-unit-label]').forEach((el) => ro.observe(el))
    if (headRef.current) ro.observe(headRef.current)
    if (extraRef.current) ro.observe(extraRef.current)
    return () => ro.disconnect()
  }, [visible, activeUnit])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of units) for (const t of u.tags) m.set(tagCat(t), (m.get(tagCat(t)) ?? 0) + 1)
    return m
  }, [units])

  const startAI = () => void startAnalysis()

  const railMinH = layout
    ? Math.max(0, ...[...layout.items.values()].map((p) => p.top - layout.railTop + p.height + 60))
    : 0

  return (
    <div className="rail-inner structure" ref={railRef} style={{ minHeight: railMinH }}>
      <div className="rail-head" ref={headRef}>
        <div className="struct-bar">
          <span className="struct-title" title={analysis?.model ? '分析模型：' + analysis.model : undefined}>
            结构分析
          </span>
          {units.length > 0 && <span className="muted small nowrap">{units.length} 个单元</span>}
          <span className="spacer" />
          {run.running ? (
            <button className="chip-btn" onClick={cancelAnalysis}>
              停止
            </button>
          ) : (
            <button className="chip-btn is-accent" onClick={startAI} title="用 AI 对全文做结构标注">
              <IconSpark size={14} /> {units.length ? '重新分析' : 'AI 分析'}
            </button>
          )}
          <Menu
            title="更多"
            trigger={<IconMore size={15} />}
            items={[
              { label: 'AI 设置（BYOK）…', onSelect: () => useUI.setState({ dialog: 'ai' }) },
              { divider: true, label: '' },
              {
                label: '复制分析提示词（交给任意 AI）',
                onSelect: async () => {
                  await copyText(buildManualPrompt())
                  useUI.getState().toast('已复制。把 AI 的回复通过“导入分析结果”粘贴回来即可')
                },
              },
              { label: '导入分析结果…', onSelect: () => useUI.setState({ dialog: 'analysisImport' }) },
              {
                label: '导出分析文件（.json）',
                disabled: !units.length,
                onSelect: () => {
                  const { data, meta } = useDoc.getState()
                  if (!data.analysis) return
                  const f = exportAnalysis(data.analysis, data.text, meta?.name ?? '未命名')
                  downloadText((meta?.name ?? 'article').replace(/\.md$/i, '') + '.structure.json', JSON.stringify(f, null, 2))
                },
              },
              { label: '格式说明与标签体系', onSelect: () => useUI.setState({ dialog: 'format' }) },
              { divider: true, label: '' },
              {
                label: '清除分析结果',
                danger: true,
                disabled: !analysis,
                onSelect: () => {
                  useDoc.getState().setAnalysis(null)
                  useUI.getState().toast('已清除分析', { action: { label: '撤销', run: () => useDoc.getState().undo() } })
                },
              },
            ]}
          />
        </div>
        {run.running && (
          <div className="struct-progress">
            <div className="struct-progress-bar">
              <span style={{ width: `${Math.min(100, (run.units / Math.max(1, run.total / 2.2)) * 100)}%` }} />
            </div>
            <div className="small muted">
              {run.phase === 'thinking' ? 'AI 正在通读全文…' : `已标注 ${run.units} 个单元 · 共 ${run.total} 句`}
            </div>
            {run.thinking && run.phase === 'thinking' && <div className="struct-thinking">{run.thinking.slice(-140)}</div>}
          </div>
        )}
      </div>
      <div className="rail-extra" ref={extraRef}>
        {analysis?.summary && (
          <div className={'struct-summary' + (summaryOpen ? '' : ' is-closed')}>
            <button className="struct-summary-toggle" onClick={() => setSummaryOpen((o) => !o)}>
              <span>总评</span>
              {!summaryOpen && <span className="struct-summary-peek">{analysis.summary.thesis ?? analysis.summary.structure}</span>}
              <span className="struct-summary-sign">{summaryOpen ? '收起' : '展开'}</span>
            </button>
            {summaryOpen && (
              <dl>
                {analysis.summary.thesis && (
                  <>
                    <dt>中心论点</dt>
                    <dd>{analysis.summary.thesis}</dd>
                  </>
                )}
                {analysis.summary.structure && (
                  <>
                    <dt>结构</dt>
                    <dd>{analysis.summary.structure}</dd>
                  </>
                )}
                {analysis.summary.comment && (
                  <>
                    <dt>建议</dt>
                    <dd>{analysis.summary.comment}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
        )}
        {units.length > 0 && (
          <div className="legend">
            {CATEGORIES.filter((c) => counts.get(c.id)).map((c) => {
              const off = hiddenCats.includes(c.id)
              return (
                <button
                  key={c.id}
                  className={'legend-item' + (off ? ' is-off' : '')}
                  style={{ '--uc': `var(--cat-${c.id})` } as React.CSSProperties}
                  title={off ? '点击显示' : '点击隐藏（Alt+点击：只看这一类）'}
                  onClick={(e) => {
                    const all = CATEGORIES.map((x) => x.id)
                    if (e.altKey) useUI.setState({ hiddenCats: all.filter((x) => x !== c.id) })
                    else
                      useUI.setState({
                        hiddenCats: off ? hiddenCats.filter((x) => x !== c.id) : hiddenCats.concat(c.id),
                      })
                  }}
                >
                  <i />
                  {c.label}
                  <span className="legend-n">{counts.get(c.id)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {!units.length && !run.running && (
        <div className="rail-empty">
          <p>以句子为单位，标注每一句（或几句）在文中的作用：论点、论据、论证方法、结构功能、修辞与写作手法，以及值得修改的问题。</p>
          <p className="muted">
            点上方 <b>AI 分析</b> 用自己的 API Key 一键标注；也可以“复制分析提示词”交给任意 AI，再把结果导入。选中文字后也能手动标注。
          </p>
        </div>
      )}

      {visible.map((u) => {
        const p = layout?.items.get(u.id)
        return (
          <UnitLabel
            key={u.id}
            id={u.id}
            tags={u.tags}
            from={u.from}
            top={p ? p.top - (layout?.railTop ?? 0) : null}
            active={activeUnit === u.id}
          />
        )
      })}

      {layout && (
        <svg
          className="links"
          style={{
            left: -layout.railLeft,
            top: -layout.railTop,
            width: layout.pageW,
            height: Math.max(layout.pageH, railMinH + layout.railTop),
          }}
          width={layout.pageW}
          height={Math.max(layout.pageH, railMinH + layout.railTop)}
        >
          {visible.map((u) => {
            const d = layout.dots.get(u.id)
            const p = layout.items.get(u.id)
            if (!d || !p) return null
            const cat = primaryCat(u.tags)
            return (
              <path
                key={u.id}
                pathLength={1}
                d={curve(d.x - 6, d.y, layout.railLeft + 1, p.top + 13)}
                className={'link unit' + (activeUnit === u.id ? ' is-hot' : activeUnit ? ' is-dim' : '')}
                style={{ stroke: `var(--cat-${cat})` }}
              />
            )
          })}
        </svg>
      )}
    </div>
  )
}

function UnitLabel({
  id,
  tags,
  from,
  top,
  active,
}: {
  id: string
  tags: string[]
  from: number
  top: number | null
  active: boolean
}) {
  const placement = usePlacementClass(top !== null)
  const cat = primaryCat(tags)
  return (
    <div
      data-unit-label={id}
      className={'ulabel' + (active ? ' is-active' : '') + placement}
      style={{ top: top ?? -9999, '--uc': `var(--cat-${cat})` } as React.CSSProperties}
      onClick={() => {
        useUI.setState({ activeUnit: id })
        reveal(from)
      }}
    >
      <div className="ulabel-tags">
        {tags.map((t) => (
          <span key={t} className="utag-s" style={{ '--uc': `var(--cat-${tagCat(t)})` } as React.CSSProperties}>
            {tagLabel(t)}
          </span>
        ))}
      </div>
      {active && <UnitDetail id={id} />}
    </div>
  )
}

function UnitDetail({ id }: { id: string }) {
  const u = useDoc((s) => s.data.analysis?.units.find((x) => x.id === id))
  const text = useDoc((s) => s.data.text)
  const [picking, setPicking] = useState(false)
  if (!u) return null
  const quote = text.slice(u.from, u.to).replace(/\s+/g, ' ')
  return (
    <div className="unit-detail" onClick={(e) => e.stopPropagation()}>
      {u.role && <div className="unit-role">{u.role}</div>}
      {u.note && <div className="unit-note">{u.note}</div>}
      <div className="unit-quote">「{quote.length > 60 ? quote.slice(0, 60) + '…' : quote}」</div>
      <div className="unit-edit">
        {u.tags.map((t) => (
          <span key={t} className="utag is-on" style={{ '--uc': `var(--cat-${tagCat(t)})` } as React.CSSProperties}>
            {tagLabel(t)}
            <button
              title="移除这个标签"
              onClick={() => {
                const tags = u.tags.filter((x) => x !== t)
                if (tags.length) useDoc.getState().updateUnit(u.id, { tags })
                else useDoc.getState().removeUnit(u.id)
              }}
            >
              <IconClose size={9} />
            </button>
          </span>
        ))}
        <button className="utag is-add" onClick={() => setPicking((p) => !p)}>
          <IconPlus size={11} /> 标签
        </button>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="删除此单元"
          onClick={() => {
            useDoc.getState().removeUnit(u.id)
            useUI.setState({ activeUnit: null })
          }}
        >
          <IconTrash size={14} />
        </button>
      </div>
      {picking && (
        <TagPicker
          value={u.tags}
          onClose={() => setPicking(false)}
          onToggle={(t) => {
            const tags = u.tags.includes(t) ? u.tags.filter((x) => x !== t) : u.tags.concat(t)
            if (tags.length) useDoc.getState().updateUnit(u.id, { tags })
          }}
        />
      )}
    </div>
  )
}

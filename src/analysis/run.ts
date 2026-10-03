import { create } from 'zustand'
import { useDoc } from '../store/docStore'
import { splitSentences } from '../core/sentences'
import { diffChanges, mapperFromChanges } from '../core/mapping'
import { uid } from '../core/uid'
import type { Unit } from '../core/types'
import { ANALYSIS_SYSTEM, analysisUserPrompt } from './prompt'
import { activeEndpoint, loadAIConfig, streamCompletion, isConfigured, AIError } from './ai'
import { useUI } from '../store/uiStore'
import { locateUnit, parseLine } from './format'

export interface RunState {
  running: boolean
  phase: 'idle' | 'thinking' | 'writing' | 'done' | 'error'
  units: number
  total: number
  thinking: string
  error: string | null
  /** 输出因达到最大 tokens 被截断 */
  truncated: boolean
  abort: AbortController | null
}

export const useRun = create<RunState>()(() => ({
  running: false,
  phase: 'idle',
  units: 0,
  total: 0,
  thinking: '',
  error: null,
  truncated: false,
  abort: null,
}))

export function buildManualPrompt() {
  const { data, meta } = useDoc.getState()
  const sentences = splitSentences(data.text)
  return ANALYSIS_SYSTEM + '\n\n---\n\n' + analysisUserPrompt(meta?.name ?? '未命名', sentences)
}

export function cancelAnalysis() {
  useRun.getState().abort?.abort()
}

export async function runAnalysis(): Promise<boolean> {
  const cfg = loadAIConfig()
  if (!isConfigured(cfg)) throw new AIError('请先在“AI 设置”里填写 API Key')
  const doc = useDoc.getState()
  const startText = doc.data.text
  const sentences = splitSentences(startText)
  if (!sentences.length) throw new AIError('文章是空的')
  const user = analysisUserPrompt(doc.meta?.name ?? '未命名', sentences)
  const abort = new AbortController()
  const model = activeEndpoint(cfg).model.trim()
  useRun.setState({
    running: true,
    phase: 'thinking',
    units: 0,
    total: sentences.length,
    thinking: '',
    error: null,
    truncated: false,
    abort,
  })
  // 旧的分析结果进入撤销历史，然后清空
  useDoc.getState().setAnalysis({ units: [], createdAt: Date.now(), model })

  let buf = ''
  let pending: Unit[] = []
  let flushTimer = 0
  let covered = 0

  const toCurrent = (from: number, to: number) => {
    const cur = useDoc.getState().data.text
    if (cur === startText) return { from, to }
    const map = mapperFromChanges(diffChanges(startText, cur))
    return { from: map(from, 1), to: map(to, -1) }
  }

  const flush = () => {
    flushTimer = 0
    if (!pending.length) return
    const add = pending
    pending = []
    useDoc.setState((s) => {
      const a = s.data.analysis ?? { units: [], createdAt: Date.now(), model }
      return { data: { ...s.data, analysis: { ...a, units: a.units.concat(add).sort((x, y) => x.from - y.from) } } }
    })
  }

  const handleLine = (line: string) => {
    const p = parseLine(line)
    if (!p) return
    if (p.summary) {
      flush()
      useDoc.setState((s) => {
        const a = s.data.analysis ?? { units: [], createdAt: Date.now(), model }
        return { data: { ...s.data, analysis: { ...a, summary: p.summary } } }
      })
      return
    }
    if (p.unit) {
      const loc = locateUnit(sentences, startText, p.unit.range, p.unit.quote)
      if (!loc) return
      const r = toCurrent(loc.from, loc.to)
      if (r.to <= r.from) return
      pending.push({ id: uid('u'), from: r.from, to: r.to, tags: p.unit.tags, role: p.unit.role, note: p.unit.note })
      covered = Math.max(covered, p.unit.range[p.unit.range.length - 1] ?? covered)
      useRun.setState({ units: useRun.getState().units + 1, phase: 'writing' })
      if (!flushTimer) flushTimer = window.setTimeout(flush, 120)
    }
  }

  try {
    const result = await streamCompletion(
      cfg,
      ANALYSIS_SYSTEM,
      user,
      {
        onText(delta) {
          if (useRun.getState().phase === 'thinking') useRun.setState({ phase: 'writing' })
          buf += delta
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            handleLine(buf.slice(0, nl))
            buf = buf.slice(nl + 1)
          }
        },
        onThinking(delta) {
          const t = (useRun.getState().thinking + delta).slice(-400)
          useRun.setState({ thinking: t })
        },
      },
      abort.signal,
    )
    handleLine(buf)
    flush()
    useRun.setState({ running: false, phase: 'done', abort: null, truncated: result.truncated })
    return true
  } catch (e) {
    handleLine(buf)
    flush()
    const msg = e instanceof Error ? e.message : String(e)
    useRun.setState({ running: false, phase: 'error', error: msg, abort: null })
    return false
  }
}

/** 从界面发起分析：未配置时打开设置；结束后给出提示 */
export async function startAnalysis() {
  const ui = useUI.getState()
  if (!isConfigured(loadAIConfig())) {
    useUI.setState({ dialog: 'ai' })
    return
  }
  useUI.setState({ rail: 'structure' })
  if (!ui.settings.railOpen) ui.setSettings({ railOpen: true })
  let ok = false
  try {
    ok = await runAnalysis()
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : String(e), { tone: 'error', ms: 8000 })
    return
  }
  const st = useRun.getState()
  if (ok && st.truncated)
    ui.toast(`输出被截断（已标注 ${st.units} 个单元）：可在 AI 设置 → 高级 里调大“最大输出 tokens”后重新分析`, {
      tone: 'error',
      ms: 10000,
      action: { label: 'AI 设置', run: () => useUI.setState({ dialog: 'ai' }) },
    })
  else if (ok) ui.toast(`分析完成：${st.units} 个单元`)
  else if (st.error && st.error !== '已取消') ui.toast(st.error, { tone: 'error', ms: 10000 })
}

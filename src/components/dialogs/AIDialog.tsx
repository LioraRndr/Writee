import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useUI } from '../../store/uiStore'
import {
  ANTHROPIC_MODEL_HINTS,
  PRESETS,
  activeEndpoint,
  isConfigured,
  isOfficialAnthropic,
  listModels,
  loadAIConfig,
  proxyAvailable,
  saveAIConfig,
  supportsEffort,
  testConnection,
  type AIConfig,
  type ApiFormat,
  type Endpoint,
} from '../../analysis/ai'
import { startAnalysis } from '../../analysis/run'

const FORMAT_INFO: Record<ApiFormat, { label: string; hint: string; basePh: string; keyPh: string }> = {
  openai: {
    label: 'OpenAI 兼容',
    hint: '请求 {Base URL}/chat/completions。适用于 OpenAI、DeepSeek、OpenRouter、通义、Kimi、智谱、Ollama 及各类中转服务。',
    basePh: 'https://api.openai.com/v1',
    keyPh: 'sk-…',
  },
  anthropic: {
    label: 'Anthropic 兼容',
    hint: '请求 {Base URL}/v1/messages（与 ANTHROPIC_BASE_URL 的写法相同）。适用于 Anthropic 官方及提供 Anthropic 接口的第三方服务。',
    basePh: 'https://api.anthropic.com',
    keyPh: 'sk-ant-…',
  },
}

export function AIDialog() {
  const [cfg, setCfg] = useState<AIConfig>(loadAIConfig)
  const [proxyOK, setProxyOK] = useState<boolean | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<'test' | 'models' | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [advanced, setAdvanced] = useState(() => {
    const e = activeEndpoint(loadAIConfig())
    return !!(e.extra.trim() || e.maxTokens || e.auth !== 'auto')
  })
  const close = () => useUI.setState({ dialog: null })
  const fmt = cfg.format
  const ep = activeEndpoint(cfg)
  const info = FORMAT_INFO[fmt]
  const official = fmt === 'anthropic' && isOfficialAnthropic(ep.base)

  const upEp = (p: Partial<Endpoint>) => {
    setStatus(null)
    setCfg((c) => ({ ...c, [c.format]: { ...c[c.format], ...p } }))
  }

  useEffect(() => {
    void proxyAvailable().then(setProxyOK)
  }, [])

  useEffect(() => {
    setModels([])
    setStatus(null)
  }, [fmt, ep.base])

  const modelHints = models.length ? models : official ? ANTHROPIC_MODEL_HINTS : []

  const save = () => {
    saveAIConfig(cfg)
    useUI.getState().toast('AI 设置已保存在本机浏览器中')
  }

  const doTest = async () => {
    setBusy('test')
    setStatus(null)
    try {
      setStatus({ ok: true, text: await testConnection(cfg) })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const doList = async () => {
    setBusy('models')
    setStatus(null)
    try {
      const list = await listModels(cfg)
      setModels(list)
      setStatus({ ok: true, text: list.length ? `获取到 ${list.length} 个模型，可在“模型”输入框中选择` : '服务没有返回模型' })
    } catch (e) {
      setStatus({ ok: false, text: (e instanceof Error ? e.message : String(e)) + ' —— 也可以直接手动填写模型名。' })
    } finally {
      setBusy(null)
    }
  }

  const saveAndRun = () => {
    saveAIConfig(cfg)
    useUI.setState({ dialog: null })
    void startAnalysis()
  }

  const ready = isConfigured(cfg)

  return (
    <Modal
      title="AI 设置（BYOK）"
      subtitle="使用你自己的 API Key，可接任意 OpenAI / Anthropic 兼容服务。配置只保存在本机浏览器，请求直接从浏览器发往服务商。"
      onClose={close}
      width={660}
      footer={
        <>
          <button className="btn" disabled={!ready || !!busy} onClick={doTest}>
            {busy === 'test' ? '测试中…' : '测试连接'}
          </button>
          <span className="spacer" />
          <button className="btn" onClick={() => (save(), close())}>
            保存
          </button>
          <button className="btn is-primary" disabled={!ready} onClick={saveAndRun}>
            保存并分析当前文章
          </button>
        </>
      }
    >
      <div className="form-row">
        <span>接口格式</span>
        <div>
          <div className="seg">
            {(['openai', 'anthropic'] as const).map((f) => (
              <button key={f} className={fmt === f ? 'is-on' : ''} onClick={() => setCfg((c) => ({ ...c, format: f }))}>
                {FORMAT_INFO[f].label}
              </button>
            ))}
          </div>
          <p className="form-hint">{info.hint}</p>
        </div>
      </div>

      <div className="form">
        <div className="form-row">
          <span>快速填写</span>
          <div className="chip-row">
            {PRESETS[fmt].map((p) => (
              <button
                key={p.name}
                className={'chip-btn' + (ep.base.replace(/\/+$/, '') === p.base ? ' is-on' : '')}
                onClick={() => upEp({ base: p.base, ...(p.model ? { model: p.model } : {}) })}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <label className="form-row">
          <span>Base URL</span>
          <input className="input" value={ep.base} placeholder={info.basePh} onChange={(e) => upEp({ base: e.target.value })} />
        </label>
        <label className="form-row">
          <span>API Key</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={info.keyPh}
            value={ep.key}
            onChange={(e) => upEp({ key: e.target.value })}
          />
        </label>
        <div className="form-row">
          <span>模型</span>
          <div className="input-with-btn">
            <input
              className="input"
              list="writee-model-list"
              value={ep.model}
              placeholder={official ? 'claude-opus-5-5' : '填写服务商提供的模型名'}
              onChange={(e) => upEp({ model: e.target.value })}
            />
            <datalist id="writee-model-list">
              {modelHints.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button className="btn" disabled={!ep.base.trim() || !ep.key.trim() || !!busy} onClick={doList}>
              {busy === 'models' ? '获取中…' : '获取列表'}
            </button>
          </div>
        </div>
        {supportsEffort(ep) && (
          <div className="form-row">
            <span>思考深度</span>
            <div className="seg small">
              {(['low', 'medium', 'high'] as const).map((x) => (
                <button key={x} className={ep.effort === x ? 'is-on' : ''} onClick={() => upEp({ effort: x })}>
                  {{ low: '快速', medium: '标准', high: '深入' }[x]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {status && <p className={'form-status' + (status.ok ? ' is-ok' : ' is-error')}>{status.text}</p>}

      <button className="link-btn advanced-toggle" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? '▾' : '▸'} 高级
      </button>
      {advanced && (
        <div className="form">
          <label className="form-row">
            <span>最大输出</span>
            <div>
              <input
                className="input"
                type="number"
                min={256}
                step={1024}
                value={ep.maxTokens ?? ''}
                placeholder={fmt === 'openai' ? '留空：不发送，使用服务默认值' : official ? '留空：64000' : '留空：8192'}
                onChange={(e) => upEp({ maxTokens: e.target.value ? Math.max(1, Math.round(+e.target.value)) : null })}
              />
              <p className="form-hint">长文分析输出较多；若提示“输出被截断”，调大这里（需在模型允许的范围内）。</p>
            </div>
          </label>
          {fmt === 'anthropic' && (
            <div className="form-row">
              <span>认证方式</span>
              <div>
                <div className="seg small">
                  {(
                    [
                      ['auto', '自动'],
                      ['x-api-key', 'x-api-key'],
                      ['bearer', 'Bearer'],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} className={ep.auth === v ? 'is-on' : ''} onClick={() => upEp({ auth: v })}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="form-hint">自动：官方用 x-api-key；第三方同时发送 x-api-key 与 Authorization: Bearer。</p>
              </div>
            </div>
          )}
          <label className="form-row">
            <span>额外参数</span>
            <div>
              <textarea
                className="input mono"
                rows={3}
                value={ep.extra}
                placeholder={fmt === 'openai' ? '{"temperature": 0.3}' : '{"temperature": 0.3}'}
                onChange={(e) => upEp({ extra: e.target.value })}
              />
              <p className="form-hint">JSON 对象，原样合并进请求体，用于服务商特有的参数。</p>
            </div>
          </label>
        </div>
      )}

      <label className="check-row">
        <input
          type="checkbox"
          checked={cfg.useProxy}
          disabled={!proxyOK}
          onChange={(e) => setCfg((c) => ({ ...c, useProxy: e.target.checked }))}
        />
        <span>
          通过本地代理转发
          <small className="muted">
            {proxyOK
              ? '　服务不允许浏览器直接访问（跨域报错）时开启，请求经本机的 Writee 服务器转发。'
              : '　（未检测到本地代理：用 npm run dev / npm run preview 启动时可用）'}
          </small>
        </span>
      </label>
    </Modal>
  )
}

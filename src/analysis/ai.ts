/**
 * AI 接入（BYOK）：两种通用接口格式，均可接第三方服务
 * - OpenAI 兼容：POST {base}/chat/completions（Bearer 认证）
 * - Anthropic 兼容：经官方 SDK 调用 {base}/v1/messages（与 ANTHROPIC_BASE_URL 的约定一致）
 *
 * 只有当 Base URL 是官方 api.anthropic.com 时，才附加官方专属参数
 * （自适应思考、effort、服务端兜底 fallbacks、提示词缓存），避免第三方服务因未知参数报错。
 */
import type AnthropicSDK from '@anthropic-ai/sdk'

type AnthropicCtor = typeof AnthropicSDK

export type ApiFormat = 'openai' | 'anthropic'
export type AuthMode = 'auto' | 'x-api-key' | 'bearer'

export interface Endpoint {
  base: string
  key: string
  model: string
  /** 最大输出 tokens；null = 自动（Anthropic：官方 64000 / 第三方 8192；OpenAI：不发送） */
  maxTokens: number | null
  /** 额外请求参数（JSON 对象），合并进请求体 */
  extra: string
  /** Anthropic 认证方式；auto = 官方用 x-api-key，第三方同时发送 x-api-key 与 Bearer */
  auth: AuthMode
  /** 思考深度（仅官方 Anthropic 且模型支持时生效） */
  effort: 'low' | 'medium' | 'high'
}

export interface AIConfig {
  format: ApiFormat
  openai: Endpoint
  anthropic: Endpoint
  /** 通过本地开发服务器转发请求（解决部分服务不允许浏览器跨域的问题） */
  useProxy: boolean
}

export interface Preset {
  name: string
  base: string
  model?: string
}

export const PRESETS: Record<ApiFormat, Preset[]> = {
  openai: [
    { name: 'OpenAI', base: 'https://api.openai.com/v1' },
    { name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1' },
    { name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { name: 'Kimi', base: 'https://api.moonshot.cn/v1' },
    { name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4' },
    { name: '硅基流动', base: 'https://api.siliconflow.cn/v1' },
    { name: 'Ollama（本地）', base: 'http://localhost:11434/v1' },
  ],
  anthropic: [
    { name: 'Anthropic 官方', base: 'https://api.anthropic.com', model: 'claude-opus-5-5' },
    { name: 'DeepSeek', base: 'https://api.deepseek.com/anthropic' },
    { name: 'Kimi', base: 'https://api.moonshot.cn/anthropic' },
    { name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/anthropic' },
  ],
}

/** 官方 Anthropic 的模型建议（模型名可随意填写，这里只做补全提示） */
export const ANTHROPIC_MODEL_HINTS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1']

const endpoint = (p: Partial<Endpoint>): Endpoint => ({
  base: '',
  key: '',
  model: '',
  maxTokens: null,
  extra: '',
  auth: 'auto',
  effort: 'medium',
  ...p,
})

const DEFAULT: AIConfig = {
  format: 'anthropic',
  openai: endpoint({ base: 'https://api.openai.com/v1' }),
  anthropic: endpoint({ base: 'https://api.anthropic.com', model: 'claude-opus-5-5' }),
  useProxy: false,
}

const KEY = 'writee.ai'

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULT)
    const j = JSON.parse(raw)
    if (j.openai && j.anthropic) {
      return {
        format: j.format === 'openai' ? 'openai' : 'anthropic',
        openai: endpoint(j.openai),
        anthropic: endpoint(j.anthropic),
        useProxy: !!j.useProxy,
      }
    }
    // 旧版配置迁移
    return {
      format: j.provider === 'openai' ? 'openai' : 'anthropic',
      openai: endpoint({ base: j.openaiBase ?? DEFAULT.openai.base, key: j.openaiKey ?? '', model: j.openaiModel ?? '' }),
      anthropic: endpoint({
        base: DEFAULT.anthropic.base,
        key: j.anthropicKey ?? '',
        model: j.anthropicModel ?? DEFAULT.anthropic.model,
        effort: j.effort ?? 'medium',
      }),
      useProxy: !!j.useProxy,
    }
  } catch {
    return structuredClone(DEFAULT)
  }
}

export function saveAIConfig(c: AIConfig) {
  localStorage.setItem(KEY, JSON.stringify(c))
}

export function activeEndpoint(c: AIConfig): Endpoint {
  return c.format === 'openai' ? c.openai : c.anthropic
}

export function isConfigured(c: AIConfig) {
  const e = activeEndpoint(c)
  return !!(e.base.trim() && e.key.trim() && e.model.trim())
}

export function isOfficialAnthropic(base: string) {
  try {
    return new URL(base.trim()).host === 'api.anthropic.com'
  } catch {
    return false
  }
}

/** 官方 Anthropic 且模型支持自适应思考 / effort */
export function supportsEffort(e: Endpoint) {
  return isOfficialAnthropic(e.base) && ADAPTIVE_MODELS.test(e.model.trim())
}

/** SDK 会自动拼接 /v1/messages，这里去掉用户可能多填的尾巴 */
export function normalizeAnthropicBase(base: string) {
  return base
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/messages$/, '')
    .replace(/\/v1$/, '')
}

export function normalizeOpenAIBase(base: string) {
  return base
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
}

/** 把 http(s)://host/path 转成本地代理地址 /__proxy/<scheme>/<host>/<path> */
export function proxify(url: string) {
  const u = new URL(url)
  return `${location.origin}/__proxy/${u.protocol.replace(':', '')}/${u.host}${u.pathname.replace(/\/$/, '')}`
}

export async function proxyAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/__proxy/health')
    return r.ok && (await r.text()) === 'ok'
  } catch {
    return false
  }
}

export interface StreamCallbacks {
  onText(delta: string): void
  onThinking?(delta: string): void
}

export interface StreamResult {
  stopReason?: string
  model?: string
  /** 输出因达到最大 tokens 被截断 */
  truncated: boolean
}

export class AIError extends Error {}

const ADAPTIVE_MODELS = /^claude-(opus-5|sonnet-5|fable-5|opus-4-[678]|sonnet-4-6)/
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5$|sonnet-5-5|fable-5-1)/

function parseExtra(e: Endpoint): Record<string, unknown> {
  const s = e.extra.trim()
  if (!s) return {}
  let v: unknown
  try {
    v = JSON.parse(s)
  } catch {
    throw new AIError('“额外请求参数”不是合法的 JSON')
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AIError('“额外请求参数”必须是 JSON 对象，如 {"temperature": 0.3}')
  return v as Record<string, unknown>
}

function describeAnthropicError(Anthropic: AnthropicCtor, err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'API Key 无效或认证方式不对（401）。第三方服务可在“高级”里切换认证方式。'
  if (err instanceof Anthropic.PermissionDeniedError) return '此 Key 无权访问该模型（403）。'
  if (err instanceof Anthropic.NotFoundError) return '接口或模型不存在（404）。请检查 Base URL 与模型名。'
  if (err instanceof Anthropic.RateLimitError) return '请求过于频繁或额度不足（429），请稍后再试。'
  if (err instanceof Anthropic.BadRequestError) return '请求被拒绝（400）：' + err.message
  if (err instanceof Anthropic.APIConnectionError)
    return '无法连接到该服务。可能是网络问题，或该服务不允许浏览器直接跨域访问——可开启“通过本地代理转发”。'
  if (err instanceof Anthropic.APIError) return `API 错误 ${err.status ?? ''}：${err.message}`
  return err instanceof Error ? err.message : String(err)
}

async function anthropicClient(cfg: AIConfig) {
  // SDK 体积较大，只在真正发起请求时加载
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const e = cfg.anthropic
  const base = normalizeAnthropicBase(e.base)
  const official = isOfficialAnthropic(base)
  const key = e.key.trim()
  const mode: AuthMode = e.auth === 'auto' ? (official ? 'x-api-key' : 'auto') : e.auth
  const client = new Anthropic({
    apiKey: mode === 'bearer' ? null : key,
    authToken: mode === 'x-api-key' ? null : key,
    baseURL: cfg.useProxy ? proxify(base) : base,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  })
  return { Anthropic, client, official, e }
}

function anthropicParams(official: boolean, e: Endpoint, system: string, user: string, maxTokens?: number) {
  const model = e.model.trim()
  const params: Record<string, unknown> = {
    model,
    max_tokens: maxTokens ?? e.maxTokens ?? (official ? 64000 : 8192),
    system: official ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system,
    messages: [{ role: 'user', content: user }],
  }
  let betas: string[] | null = null
  if (official && ADAPTIVE_MODELS.test(model)) {
    params.thinking = { type: 'adaptive', display: 'summarized' }
    params.output_config = { effort: e.effort }
  }
  if (official && FALLBACK_MODELS.test(model)) {
    // 安全分类器拒绝时，由服务端自动换到推荐的备用模型继续
    betas = ['server-side-fallback-2026-07-01']
    params.fallbacks = 'default'
  }
  Object.assign(params, parseExtra(e))
  return { params, betas }
}

async function streamAnthropic(cfg: AIConfig, system: string, user: string, cb: StreamCallbacks, signal: AbortSignal): Promise<StreamResult> {
  const { Anthropic, client, official, e } = await anthropicClient(cfg)
  const { params, betas } = anthropicParams(official, e, system, user)
  try {
    // 第三方服务不走 beta 端点（会附带 ?beta=true）
    const stream = betas
      ? client.beta.messages.stream(
          { ...params, betas } as unknown as AnthropicSDK.Beta.Messages.MessageCreateParamsStreaming,
          { signal },
        )
      : client.messages.stream(params as unknown as AnthropicSDK.Messages.MessageStreamParams, { signal })
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') cb.onText(event.delta.text)
        else if (event.delta.type === 'thinking_delta') cb.onThinking?.(event.delta.thinking)
      }
    }
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') throw new AIError('模型拒绝了这次请求（refusal）。可以换个模型再试。')
    return { stopReason: final.stop_reason ?? undefined, model: final.model, truncated: final.stop_reason === 'max_tokens' }
  } catch (err) {
    if (signal.aborted) throw new AIError('已取消')
    if (err instanceof AIError) throw err
    throw new AIError(describeAnthropicError(Anthropic, err))
  }
}

function openaiUrl(cfg: AIConfig, path: string) {
  const base = normalizeOpenAIBase(cfg.openai.base)
  return (cfg.useProxy ? proxify(base) : base) + path
}

function openaiBody(e: Endpoint, system: string, user: string, stream: boolean) {
  const body: Record<string, unknown> = {
    model: e.model.trim(),
    stream,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }
  if (e.maxTokens) body.max_tokens = e.maxTokens
  return Object.assign(body, parseExtra(e))
}

async function openaiFetch(cfg: AIConfig, path: string, init: RequestInit) {
  try {
    return await fetch(openaiUrl(cfg, path), {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openai.key.trim()}`, ...(init.headers ?? {}) },
    })
  } catch {
    if (init.signal?.aborted) throw new AIError('已取消')
    throw new AIError('无法连接到该服务。可能是网络问题，或该服务不允许浏览器直接跨域访问——可开启“通过本地代理转发”。')
  }
}

async function failText(res: Response) {
  const body = await res.text().catch(() => '')
  const hint = res.status === 401 ? '（API Key 无效）' : res.status === 404 ? '（接口或模型不存在，检查 Base URL 与模型名）' : ''
  return `请求失败 ${res.status}${hint}：${body.slice(0, 300)}`
}

async function streamOpenAI(cfg: AIConfig, system: string, user: string, cb: StreamCallbacks, signal: AbortSignal): Promise<StreamResult> {
  const res = await openaiFetch(cfg, '/chat/completions', {
    method: 'POST',
    signal,
    body: JSON.stringify(openaiBody(cfg.openai, system, user, true)),
  })
  if (!res.ok || !res.body) throw new AIError(await failText(res))
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let finish: string | undefined
  let model: string | undefined
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      if (signal.aborted) throw new AIError('已取消')
      throw new AIError('连接中断')
    }
    if (chunk.done) break
    buf += dec.decode(chunk.value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload)
        if (j.error) throw new AIError('服务返回错误：' + (j.error.message ?? JSON.stringify(j.error)))
        model = j.model ?? model
        const d = j.choices?.[0]?.delta
        const reasoning = d?.reasoning_content ?? d?.reasoning
        if (typeof reasoning === 'string' && reasoning) cb.onThinking?.(reasoning)
        if (d?.content) cb.onText(d.content)
        if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason
      } catch (e) {
        if (e instanceof AIError) throw e
        /* 忽略无法解析的片段 */
      }
    }
  }
  return { stopReason: finish, model: model ?? cfg.openai.model, truncated: finish === 'length' }
}

export function streamCompletion(cfg: AIConfig, system: string, user: string, cb: StreamCallbacks, signal: AbortSignal) {
  return cfg.format === 'anthropic'
    ? streamAnthropic(cfg, system, user, cb, signal)
    : streamOpenAI(cfg, system, user, cb, signal)
}

/** 发一条极短的请求，检查 Base URL / Key / 模型是否可用 */
export async function testConnection(cfg: AIConfig): Promise<string> {
  if (cfg.format === 'anthropic') {
    const { Anthropic, client, official, e } = await anthropicClient(cfg)
    const { params, betas } = anthropicParams(official, e, '你是连通性测试。', '只回复两个字：收到', 256)
    try {
      const msg = betas
        ? await client.beta.messages.create({ ...params, betas } as unknown as AnthropicSDK.Beta.Messages.MessageCreateParamsNonStreaming)
        : await client.messages.create(params as unknown as AnthropicSDK.Messages.MessageCreateParamsNonStreaming)
      return `连接成功 · ${msg.model}`
    } catch (err) {
      if (err instanceof AIError) throw err
      throw new AIError(describeAnthropicError(Anthropic, err))
    }
  }
  const res = await openaiFetch(cfg, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify(openaiBody(cfg.openai, '你是连通性测试。', '只回复两个字：收到', false)),
  })
  if (!res.ok) throw new AIError(await failText(res))
  const j = await res.json().catch(() => ({}))
  return `连接成功 · ${j.model ?? cfg.openai.model}`
}

/** 读取服务端的模型列表（不是所有服务都支持） */
export async function listModels(cfg: AIConfig): Promise<string[]> {
  if (cfg.format === 'anthropic') {
    const { Anthropic, client } = await anthropicClient(cfg)
    try {
      const ids: string[] = []
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id)
      return ids
    } catch (err) {
      throw new AIError('无法获取模型列表：' + describeAnthropicError(Anthropic, err))
    }
  }
  const res = await openaiFetch(cfg, '/models', { method: 'GET' })
  if (!res.ok) throw new AIError('无法获取模型列表：' + (await failText(res)))
  const j = await res.json().catch(() => ({}))
  const list: unknown[] = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : []
  return list
    .map((m) => (typeof m === 'string' ? m : ((m as { id?: string; name?: string }).id ?? (m as { name?: string }).name)))
    .filter((x): x is string => !!x)
    .sort()
}

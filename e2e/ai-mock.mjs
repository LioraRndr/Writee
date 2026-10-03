// AI 接入：拦截网络请求模拟服务端，验证三种情形的请求格式与流式解析
// 1. Anthropic 官方：带官方专属参数（自适应思考、effort、fallbacks、缓存）
// 2. Anthropic 兼容第三方：不带官方专属参数，不走 beta 端点，同时发送两种认证头
// 3. OpenAI 兼容：/chat/completions，合并额外参数
import { assert, assertEq, openSample } from './helpers.mjs'

export const name = 'AI 接入（模拟服务端）'

const LINES = [
  '{"s":[1,1],"q":"慢下来","t":["struct.title-point","arg.thesis"],"r":"标题即论点"}',
  '{"s":[2,2],"q":"在这个人人","t":["arg.background","craft.hook"],"r":"以时代现象开篇"}',
  '{"summary":{"thesis":"慢下来才能写好","structure":"总—分—总","comment":"补充案例"}}',
]
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const sse = (evs) => evs.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
const anthropicBody = (model, stop = 'end_turn') =>
  sse([
    { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...(LINES.join('\n') + '\n').match(/[\s\S]{1,29}/g).map((t) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 9 } },
    { type: 'message_stop' },
  ])

async function analyze(page, cfg) {
  await page.evaluate((cfg) => localStorage.setItem('writee.ai', JSON.stringify(cfg)), cfg)
  await page.evaluate(() => window.__writee.useUI.setState({ rail: 'structure', settings: { ...window.__writee.useUI.getState().settings, railOpen: true } }))
  await page.waitForTimeout(200)
  await page.locator('.struct-bar .chip-btn.is-accent').click()
  await page.waitForFunction(() => window.__writee.useDoc.getState().data.analysis?.summary, null, { timeout: 8000 })
  return page.evaluate(() => window.__writee.useDoc.getState().data.analysis.units.length)
}

const ep = (p) => ({ base: '', key: '', model: '', maxTokens: null, extra: '', auth: 'auto', effort: 'medium', ...p })

export default async function ({ page }) {
  const caps = []
  const capture = (route) => {
    const r = route.request()
    const c = { url: r.url(), method: r.method(), h: r.headers(), body: r.postData() ? JSON.parse(r.postData()) : null }
    caps.push(c)
    return c
  }
  await page.route('https://api.anthropic.com/**', (route) => {
    const c = capture(route)
    if (c.method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: anthropicBody(c.body.model) })
  })
  await page.route('https://relay.example.com/**', (route) => {
    const c = capture(route)
    if (c.method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: anthropicBody('relay-model', 'max_tokens') })
  })
  await page.route('https://oai.example.com/**', (route) => {
    const c = capture(route)
    if (c.method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const text = LINES.join('\n') + '\n'
    const body =
      `data: ${JSON.stringify({ model: 'm-1', choices: [{ delta: { reasoning_content: '想一想' } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body })
  })

  await openSample(page)

  // 1. 官方 Anthropic
  let n = await analyze(page, {
    format: 'anthropic',
    useProxy: false,
    openai: ep({}),
    anthropic: ep({ base: 'https://api.anthropic.com', key: 'sk-ant-test', model: 'claude-opus-5-5' }),
  })
  assertEq(n, 2, '官方：解析出的单元数')
  let c = caps.filter((x) => x.url.includes('api.anthropic.com') && x.body?.stream).pop()
  assertEq(c.h['anthropic-beta'], 'server-side-fallback-2026-07-01', '官方：fallbacks beta 头')
  assertEq(c.h['anthropic-dangerous-direct-browser-access'], 'true', '官方：浏览器直连头')
  assertEq(c.h['x-api-key'], 'sk-ant-test', '官方：x-api-key')
  assert(!c.h.authorization, '官方：不应发送 Bearer')
  assertEq(c.body.thinking, { type: 'adaptive', display: 'summarized' }, '官方：自适应思考')
  assertEq(c.body.output_config, { effort: 'medium' }, '官方：effort')
  assertEq(c.body.fallbacks, 'default', '官方：fallbacks')
  assertEq(c.body.max_tokens, 64000, '官方：默认最大输出')
  assertEq(c.body.system[0].cache_control, { type: 'ephemeral' }, '官方：提示词缓存')

  // 2. Anthropic 兼容第三方（Base URL 多写了 /v1 也应兼容）
  await page.evaluate(() => window.__writee.useUI.setState({ toasts: [] }))
  n = await analyze(page, {
    format: 'anthropic',
    useProxy: false,
    openai: ep({}),
    anthropic: ep({ base: 'https://relay.example.com/v1/', key: 'relay-key', model: 'relay-a' }),
  })
  assertEq(n, 2, '第三方：解析出的单元数')
  c = caps.filter((x) => x.url.includes('relay') && x.body?.stream).pop()
  assertEq(c.url, 'https://relay.example.com/v1/messages', '第三方：请求地址（不带 ?beta=true）')
  assertEq(c.h['x-api-key'], 'relay-key', '第三方：x-api-key')
  assertEq(c.h.authorization, 'Bearer relay-key', '第三方：同时发送 Bearer')
  assert(!c.h['anthropic-beta'], '第三方：不应带 beta 头')
  assertEq(Object.keys(c.body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'system'], '第三方：只发送标准参数')
  assertEq(c.body.max_tokens, 8192, '第三方：默认最大输出')
  await page.waitForTimeout(300)
  const toasts = await page.locator('.toast').allTextContents()
  assert(toasts.some((t) => t.includes('输出被截断')), '达到 max_tokens 时提示截断')

  // 3. OpenAI 兼容
  n = await analyze(page, {
    format: 'openai',
    useProxy: false,
    anthropic: ep({}),
    openai: ep({ base: 'https://oai.example.com/v1/', key: 'k', model: 'm-1', maxTokens: 4000, extra: '{"temperature":0.2}' }),
  })
  assertEq(n, 2, 'OpenAI：解析出的单元数')
  c = caps.filter((x) => x.url.includes('oai') && x.body?.stream).pop()
  assertEq(c.url, 'https://oai.example.com/v1/chat/completions', 'OpenAI：请求地址')
  assertEq(c.h.authorization, 'Bearer k', 'OpenAI：Bearer 认证')
  assertEq([c.body.model, c.body.max_tokens, c.body.temperature], ['m-1', 4000, 0.2], 'OpenAI：模型、最大输出与额外参数')
}

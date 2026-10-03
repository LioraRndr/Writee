import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 本地转发代理：/__proxy/<scheme>/<host>/<path> → <scheme>://<host>/<path>
 * 用于某些不允许浏览器跨域访问的 AI 服务（仅在 dev / preview 服务器中可用）。
 */
function aiProxy(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''
    if (!url.startsWith('/__proxy/')) return next()
    if (url === '/__proxy/health') {
      res.end('ok')
      return
    }
    const m = /^\/__proxy\/(https?)\/(.+)$/.exec(url)
    if (!m) {
      res.statusCode = 400
      res.end('bad proxy url')
      return
    }
    const target = m[1] + '://' + m[2]
    try {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (!v || ['host', 'origin', 'referer', 'connection', 'content-length', 'accept-encoding'].includes(k)) continue
        if (k.startsWith('sec-')) continue
        headers[k] = Array.isArray(v) ? v.join(',') : v
      }
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks),
      })
      res.statusCode = upstream.status
      upstream.headers.forEach((v, k) => {
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) return
        res.setHeader(k, v)
      })
      if (!upstream.body) return res.end()
      const reader = upstream.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
    } catch (e) {
      res.statusCode = 502
      res.end('proxy error: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  return {
    name: 'writee-ai-proxy',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

export default defineConfig({
  plugins: [react(), aiProxy()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { chunkSizeWarningLimit: 1200 },
})

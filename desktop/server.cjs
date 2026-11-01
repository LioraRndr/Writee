const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { localFiles } = require('../scripts/local-files.cjs')

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self' https: http:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 4096) throw new Error('请求内容过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function startDesktopServer({ root, origin, launchQueue, showFileDialog }) {
  const host = new URL(origin).host
  const files = localFiles({ origin, host, launchQueue })
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/__desktop_dialog/') {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.headers.host !== host || req.headers.origin !== origin || req.headers['x-writee-dialog'] !== '1'
          || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
          res.writeHead(403).end(JSON.stringify({ error: '桌面对话框请求被拒绝' }))
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405).end(JSON.stringify({ error: '不支持的请求方式' }))
          return
        }
        const body = await readBody(req)
        const handle = await showFileDialog(body.action, body.suggestedName)
        res.end(JSON.stringify({ handle }))
        return
      }
      let handled = false
      await files(req, res, () => { handled = true })
      if (!handled || res.writableEnded) return
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405).end()
        return
      }
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname)
      if (pathname.includes('\0')) {
        res.writeHead(400).end()
        return
      }
      const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!target.startsWith(root + path.sep)) {
        res.writeHead(403).end()
        return
      }
      const stat = await fs.promises.stat(target)
      if (!stat.isFile()) {
        res.writeHead(404).end()
        return
      }
      res.setHeader('Content-Type', types[path.extname(target).toLowerCase()] ?? 'application/octet-stream')
      res.setHeader('Content-Length', stat.size)
      res.setHeader('Content-Security-Policy', csp)
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      if (req.method === 'HEAD') return res.end()
      const stream = fs.createReadStream(target)
      stream.on('error', () => res.destroy())
      stream.pipe(res)
    } catch (error) {
      if (res.headersSent) return res.destroy()
      const status = error.code === 'ENOENT' ? 404 : 400
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(error.code === 'ENOENT' ? 'Not found' : error.message)
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(new URL(origin).port), '127.0.0.1', () => resolve(server))
  })
}

module.exports = { startDesktopServer }

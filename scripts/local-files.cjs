// 仅供本机启动器授权的文件使用；能力令牌不放进项目或同步盘。
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const { spawn } = require('node:child_process')
const { fileURLToPath } = require('node:url')

const directory = path.join(os.tmpdir(), 'writee-local-files-ed94e1e9-0d44-467a-a738-445a929ca50d')
const digest = (value) => createHash('sha256').update(value).digest('hex')
const limit = 20 * 1024 * 1024
const queues = new Map()

function decode(bytes) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('文件不是 UTF-8 编码，请先确认原文件编码；未写入任何内容') }
  if (text.includes('\0') || text.includes('鑠版堪') || text.includes('濮煎')) {
    throw new Error('检测到二进制内容或乱码，请先检查文件编码；未写入任何内容')
  }
  return text
}

function registerFile(filePath) {
  const file = fs.realpathSync(path.resolve(filePath))
  if (!/\.(md|markdown|mdown)$/i.test(file)) throw new Error('仅支持 .md、.markdown、.mdown 文件')
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > limit) throw new Error('文件无效或超过 20 MB')
  decode(fs.readFileSync(file))
  const key = digest(process.platform === 'win32' ? file.toLowerCase() : file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const entry = path.join(directory, key + '.json')
  try {
    fs.writeFileSync(entry, JSON.stringify({ file, token: randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 })
  } catch (error) { if (error.code !== 'EEXIST') throw error }
  const { token } = JSON.parse(fs.readFileSync(entry, 'utf8'))
  return { key, token }
}

async function snapshot(file) {
  const real = await fsp.realpath(file)
  if (real !== file) throw new Error('文件路径已指向其他位置，请重新双击打开')
  const stat = await fsp.stat(file)
  if (!stat.isFile() || stat.size > limit) throw new Error('文件无效或超过 20 MB')
  const bytes = await fsp.readFile(file)
  return { bytes, text: decode(bytes), modified: stat.mtimeMs, revision: digest(bytes) }
}

async function readJson(req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('请求内容过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function resolveSystemTarget(currentFile, target) {
  if (typeof target !== 'string' || !target.trim() || target.length > 4096) throw new Error('链接目标无效')
  let value = target.trim()
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1)
  if (/^(https?:|mailto:)/i.test(value)) {
    const url = new URL(value)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new Error('不支持此链接协议')
    return value
  }
  if (/^file:/i.test(value)) value = fileURLToPath(value)
  else {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) throw new Error('不支持此链接协议')
    try { value = decodeURIComponent(value) } catch { throw new Error('链接路径编码无效') }
  }
  try { return fs.realpathSync(path.resolve(path.dirname(currentFile), value)) }
  catch { throw new Error('链接目标不存在或无法访问') }
}

function openWithSystem(target, reveal) {
  return new Promise((resolve, reject) => {
    let command
    let args
    if (process.platform === 'win32') {
      command = reveal ? 'explorer.exe' : 'rundll32.exe'
      args = reveal ? ['/select,', target] : ['url.dll,FileProtocolHandler', target]
    } else if (process.platform === 'darwin') {
      command = 'open'
      args = reveal ? ['-R', target] : [target]
    } else {
      command = 'xdg-open'
      args = [reveal ? path.dirname(target) : target]
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

// 只注册在 localhost 开发服务，不包含在静态部署中。
function localFiles(options = {}) {
  const openWith = options.openWith ?? openWithSystem
  return async (req, res, next) => {
    if (!req.url?.startsWith('/__local_file/')) return next()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    const fail = (status, message) => { res.statusCode = status; res.end(JSON.stringify({ error: message })) }
    const key = req.url.slice('/__local_file/'.length)
    const origin = 'http://localhost:5173'
    // 自定义头使跨站请求必须预检；此接口不提供 CORS 授权。
    if (req.headers.host !== 'localhost:5173' || (req.headers.origin && req.headers.origin !== origin)
      || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
      || !/^[a-f0-9]{64}$/.test(key)) return fail(403, '本地文件请求被拒绝')
    if (!['GET', 'PUT', 'POST'].includes(req.method)) return fail(405, '不支持的请求方式')
    try {
      const saved = JSON.parse(await fsp.readFile(path.join(directory, key + '.json'), 'utf8'))
      const token = req.headers['x-writee-token']
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
        || !timingSafeEqual(Buffer.from(token), Buffer.from(saved.token))) return fail(403, '文件授权无效，请重新双击打开')
      // 同一文件的多窗口写入串行核对版本，避免旧稿覆盖新稿。
      const previous = queues.get(key) ?? Promise.resolve()
      const operation = previous.catch(() => {}).then(async () => {
        const disk = await snapshot(saved.file)
        if (req.method === 'POST') {
          const body = await readJson(req, 8192)
          if (body.action === 'reveal') await openWith(saved.file, true)
          else if (body.action === 'open') await openWith(resolveSystemTarget(saved.file, body.target), false)
          else throw new Error('不支持的本机操作')
          return res.end(JSON.stringify({ ok: true }))
        }
        if (req.method === 'PUT') {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > limit * 2) throw new Error('写入内容过大')
            chunks.push(chunk)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (typeof body.text !== 'string') throw new Error('写入内容无效')
          if (body.revision !== disk.revision) return fail(409, '文件已被外部修改，请先处理冲突')
          const bom = disk.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? '\ufeff' : ''
          const eol = disk.text.includes('\r\n') && !disk.text.replace(/\r\n/g, '').includes('\n') ? '\r\n' : '\n'
          const bytes = Buffer.from(bom + body.text.replace(/\r\n?/g, '\n').replace(/\n/g, eol), 'utf8')
          if (bytes.length > limit) throw new Error('文件超过 20 MB')
          // r+ 不创建缺失文件；在同一打开文件上再次核对，保持编码和换行约定。
          const handle = await fsp.open(saved.file, 'r+')
          try {
            if (digest(await handle.readFile()) !== disk.revision) return fail(409, '文件已被外部修改，请先处理冲突')
            let offset = 0
            while (offset < bytes.length) {
              const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset)
              if (!bytesWritten) throw new Error('文件写入未完成，请重试')
              offset += bytesWritten
            }
            await handle.truncate(bytes.length)
            await handle.sync()
          } finally { await handle.close() }
          const result = await snapshot(saved.file)
          if (result.revision !== digest(bytes)) throw new Error('写入期间文件被外部替换，请检查冲突后重试')
          return res.end(JSON.stringify({ modified: result.modified, revision: result.revision }))
        }
        res.end(JSON.stringify({ name: path.basename(saved.file), path: saved.file, text: disk.text, modified: disk.modified, revision: disk.revision }))
      })
      queues.set(key, operation)
      try { await operation } finally { if (queues.get(key) === operation) queues.delete(key) }
    } catch (error) {
      fail(400, error.code === 'ENOENT' ? '文件或授权已失效，请重新双击打开；缺失文件不会自动重建' : error.message)
    }
  }
}

module.exports = { localFiles, registerFile }

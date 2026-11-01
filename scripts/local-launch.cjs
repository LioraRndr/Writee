// macOS 启动请求队列：只保存能力引用，正文仍经本机文件接口读取。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomBytes, timingSafeEqual } = require('node:crypto')

const defaultDirectory = path.join(os.tmpdir(), 'writee-local-launch-ed94e1e9-0d44-467a-a738-445a929ca50d')
const requestPattern = /^[a-f0-9]{32}$/
const capabilityPattern = /^[a-f0-9]{64}$/

function validRequest(request) {
  return request && typeof request === 'object'
    && requestPattern.test(request.requestId)
    && capabilityPattern.test(request.key)
    && capabilityPattern.test(request.token)
}

function sameSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length
    && timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function createLaunchQueue(directory = defaultDirectory) {
  function ensureDirectory() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  function files() {
    ensureDirectory()
    return fs.readdirSync(directory).filter(name => /^[0-9]{20}-[a-f0-9]{32}\.json$/.test(name)).sort()
  }

  function enqueue({ key, token }) {
    if (!capabilityPattern.test(key) || !capabilityPattern.test(token)) throw new Error('本地文件授权无效')
    ensureDirectory()
    const request = { requestId: randomBytes(16).toString('hex'), key, token }
    const name = `${process.hrtime.bigint().toString().padStart(20, '0')}-${request.requestId}.json`
    const target = path.join(directory, name)
    const temporary = path.join(directory, `.${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
    try {
      const handle = fs.openSync(temporary, 'wx', 0o600)
      try {
        fs.writeFileSync(handle, JSON.stringify(request), 'utf8')
        fs.fsyncSync(handle)
      } finally { fs.closeSync(handle) }
      fs.renameSync(temporary, target)
    } finally {
      try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return request
  }

  function take() {
    for (const name of files()) {
      try {
        const request = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
        if (validRequest(request) && name.endsWith(`-${request.requestId}.json`)) return request
      } catch {
        // 忽略其他进程尚未写完或已替换的无效项，继续检查后续请求。
      }
    }
    return null
  }

  function confirm(request) {
    if (!validRequest(request)) throw new Error('启动请求无效')
    const name = files().find(name => name.endsWith(`-${request.requestId}.json`))
    if (!name) return true
    const target = path.join(directory, name)
    const saved = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (!sameSecret(saved.key, request.key) || !sameSecret(saved.token, request.token)) return false
    fs.unlinkSync(target)
    return true
  }

  return { enqueue, take, confirm }
}

const defaultQueue = createLaunchQueue()

module.exports = {
  createLaunchQueue,
  enqueueLaunch: defaultQueue.enqueue,
  takeLaunchedFile: defaultQueue.take,
  confirmLaunchedFile: defaultQueue.confirm,
}

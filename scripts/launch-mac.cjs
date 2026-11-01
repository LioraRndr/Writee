// macOS 本机启动器。独立于 Windows 启动流程；固定 localhost 来源以保留存档。
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

const root = path.resolve(__dirname, '..')
const runtime = path.join(root, '.mac-runtime')
const base = 'http://localhost:5173'
const marker = JSON.parse(fs.readFileSync(path.join(root, 'public/writee-launch.json'), 'utf8'))
const manifest = require('./mac-assets.json')
const fingerprint = createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex')
const stamp = path.join(runtime, 'installed.json')
const vite = path.join(root, 'node_modules/vite/bin/vite.js')
const background = process.argv.includes('--background')
const files = process.argv.slice(2).filter((arg, index, args) => index > 0 && args[index - 1] === '--file')

function execute(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`命令执行失败（${result.status}）：${path.basename(executable)} ${args.join(' ')}`)
}

function assetHash(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

function hasDependencies() {
  try { return fs.existsSync(vite) && JSON.parse(fs.readFileSync(stamp, 'utf8')).fingerprint === fingerprint }
  catch { return false }
}

async function isWritee() {
  try {
    const response = await fetch(`${base}/writee-launch.json`, { signal: AbortSignal.timeout(800) })
    const actual = await response.json()
    return response.ok && actual.app === marker.app && actual.id === marker.id
  } catch { return false }
}

function openChrome() {
  const { registerFile } = require('./local-files.cjs')
  const { enqueueLaunch } = require('./local-launch.cjs')
  for (const file of files) enqueueLaunch(registerFile(file))
  const script = `
tell application "Google Chrome"
  repeat with chromeWindow in windows
    repeat with tabIndex from 1 to count of tabs of chromeWindow
      set tabURL to URL of tab tabIndex of chromeWindow
      if tabURL is equal to "${base}" or tabURL starts with "${base}/" then
        set active tab index of chromeWindow to tabIndex
        set index of chromeWindow to 1
        activate
        return "found"
      end if
    end repeat
  end repeat
  return "missing"
end tell`
  const result = spawnSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`无法激活 Chrome：${result.stderr.trim() || result.status}`)
  if (result.stdout.trim() === 'found') return
  execute('/usr/bin/open', ['-a', 'Google Chrome', base])
}

async function main() {
  process.chdir(root)
  console.log(`Writee · macOS\nNode.js ${process.version}\n项目：${root}`)
  if (process.argv.includes('--check')) {
    console.log(`依赖：${hasDependencies() ? '已安装并验证' : '尚未安装'}\n地址：${base}\n上游提交：${manifest.commit}`)
    return
  }
  if (await isWritee()) {
    console.log('Writee 已经运行，正在打开 Chrome。')
    openChrome()
    return
  }
  fs.mkdirSync(runtime, { recursive: true })
  for (const asset of manifest.assets) {
    const target = path.join(root, asset.path)
    if (fs.existsSync(target) && assetHash(fs.readFileSync(target)) === asset.sha) continue
    console.log(`下载原始资源：${asset.path}`)
    const temporary = target + '.download'
    execute('/usr/bin/curl', ['--fail', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '90', '--output', temporary, `https://raw.githubusercontent.com/LioraRndr/Writee/${manifest.commit}/${asset.path}`])
    if (assetHash(fs.readFileSync(temporary)) !== asset.sha) throw new Error(`下载资源校验失败：${asset.path}`)
    fs.renameSync(temporary, target)
  }
  if (!hasDependencies()) {
    console.log('\n首次启动：安装项目锁定的依赖并验证，请保持联网。')
    const npm = path.resolve(path.dirname(fs.realpathSync(process.execPath)), '../lib/node_modules/npm/bin/npm-cli.js')
    if (!fs.existsSync(npm)) throw new Error('当前 Node.js 安装中未找到 npm，请安装完整的 Node.js LTS。')
    const npmArgs = [npm]
    execute(process.execPath, [...npmArgs, 'ci', '--cache', path.join(runtime, 'npm-cache'), '--no-audit', '--no-fund'])
    for (const task of ['typecheck', 'test', 'build']) execute(process.execPath, [...npmArgs, 'run', task])
    fs.writeFileSync(stamp, JSON.stringify({ fingerprint, node: process.version, validated: new Date().toISOString() }, null, 2))
  }
  console.log(`\n启动 ${base}\n${background ? '服务在后台运行。' : '请保留此终端窗口；结束写作后按 Control+C 停止服务。'}\n`)
  const log = background ? fs.openSync(path.join(runtime, 'server.log'), 'a') : null
  const server = spawn(process.execPath, [vite, '--host', 'localhost', '--port', '5173', '--strictPort'], {
    cwd: root, stdio: background ? ['ignore', log, log] : 'inherit', env: process.env, detached: background,
  })
  if (log !== null) fs.closeSync(log)
  let exited = false
  server.on('error', error => { console.error(error.message); process.exitCode = 1; exited = true })
  server.on('exit', (code, signal) => { exited = true; process.exitCode = signal === 'SIGINT' ? 0 : (code ?? 0) })
  const stop = () => { if (!exited) server.kill('SIGINT') }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  for (let attempt = 0; attempt < 100 && !exited; attempt++) {
    if (await isWritee()) {
      try { openChrome() } finally { if (background) server.unref() }
      return
    }
    await delay(300)
  }
  stop()
  throw new Error('服务未能启动。请查看上方日志；5173 端口可能已被其他程序占用。')
}

main().catch(error => { console.error(`\n启动失败：${error.message}`); process.exitCode = 1 })

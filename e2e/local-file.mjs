// 真实本机文件链路：启动器授权 → 浏览器编辑 → 自动写回 / 替换 / 存档恢复。
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { URL, assert, assertEq, shot } from './helpers.mjs'

const { registerFile } = createRequire(import.meta.url)('../scripts/local-files.cjs')
const { createLaunchQueue } = createRequire(import.meta.url)('../scripts/local-launch.cjs')
export const name = '本机文件打开与写回'

export default async function ({ page, errors }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'writee-e2e-'))
  const file = path.join(dir, '中文 路径 & 测试.md')
  const original = '\ufeff# 双击测试\r\n\r\n原有正文。\r\n'
  await fs.writeFile(file, original, 'utf8')
  const launchQueue = createLaunchQueue(path.join(dir, 'launch'))
  await page.route('**/__local_launch/', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(launchQueue.take()) })
    const body = request.postDataJSON()
    const ok = body.token === request.headers()['x-writee-token'] && launchQueue.confirm(body)
    await route.fulfill({ status: ok ? 200 : 403, contentType: 'application/json', body: JSON.stringify(ok ? { ok: true } : { error: '启动请求授权无效' }) })
  })
  const capability = registerFile(file)
  const target = `${URL}#local-file=${capability.key}&token=${capability.token}`
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const launcherOutput = execFileSync(process.execPath, ['scripts/launch-writee.cjs', '--no-browser', file], { encoding: 'utf8' })
    assert(launcherOutput.includes(target), '启动器完整接收中文、空格和特殊字符路径')
    if (process.platform === 'win32') {
      // 系统关联使用 VBS，独立验证其参数转发；测试期间不弹出额外应用窗口。
      const vbsFile = path.join(dir, '系统 关联 & 参数.md')
      await fs.writeFile(vbsFile, '# 系统打开\n', 'utf8')
      execFileSync('cscript.exe', ['//B', '//NoLogo', 'scripts/launch-writee.vbs', '--no-browser', vbsFile])
      const authorization = async (targetFile) => {
        const real = await fs.realpath(targetFile)
        const key = createHash('sha256').update(real.toLowerCase()).digest('hex')
        const saved = JSON.parse(await fs.readFile(path.join(os.tmpdir(), 'writee-local-files-ed94e1e9-0d44-467a-a738-445a929ca50d', key + '.json'), 'utf8'))
        assertEq(saved.file, real, 'Windows 启动入口实际授权了传入路径')
      }
      await authorization(vbsFile)
      const vbsCapability = registerFile(vbsFile)
      const result = await fetch(URL + '__local_file/' + vbsCapability.key, { headers: { 'X-Writee-Token': vbsCapability.token } })
      assertEq((await result.json()).text, '# 系统打开\n', 'VBS 转发文件路径并授权实际文件')
      const exe = path.resolve('scripts/bin/Writee.exe')
      if (await fs.stat(exe).catch(() => null)) {
        const exeFile = path.join(dir, '原生 入口 & 参数.md')
        await fs.writeFile(exeFile, '# 原生打开\n', 'utf8')
        execFileSync(exe, ['--no-browser', exeFile])
        await authorization(exeFile)
      }
    }
    await page.goto(target)
    await page.waitForFunction(() => window.__writee?.useDoc.getState().meta?.name === '中文 路径 & 测试.md')
    assertEq(await page.evaluate(() => window.__writee.useDoc.getState().data.text), '# 双击测试\n\n原有正文。\n', '真实文件正文载入')
    await page.locator('.cm-content').first().click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await page.keyboard.type('从编辑器输入。')
    await page.waitForFunction(() => window.__writee.useDoc.getState().fileStatus === 'saved')
    assertEq(await fs.readFile(file, 'utf8'), original + '从编辑器输入。', '真实编辑自动写回，保持 BOM + CRLF')
    await page.evaluate(async () => {
      const doc = window.__writee.useDoc.getState()
      const from = doc.data.text.indexOf('原有正文')
      doc.addNote([doc.addTag(from, from + 4)])
      await window.__writee.session.persistNow()
    })
    const archiveId = await page.evaluate(() => window.__writee.useDoc.getState().meta.id)
    // 保持时间戳的原路径替换也要重新读取。
    const before = await fs.stat(file)
    await fs.unlink(file)
    const external = '# 双击测试\n\n外部前缀。原有正文。\n'
    await fs.writeFile(file, external, 'utf8')
    await fs.utimes(file, before.atime, before.mtime)
    await page.evaluate(() => window.__writee.session.checkDisk())
    assertEq(await page.evaluate(() => window.__writee.useDoc.getState().data.text), external, '文件替换后载入新正文')
    assertEq(await page.evaluate(() => {
      const { data } = window.__writee.useDoc.getState()
      return data.text.slice(data.tags[0].from, data.tags[0].to)
    }), '原有正文', '替换后注释位置映射')
    await page.evaluate(() => window.__writee.session.persistNow())
    await page.reload()
    await page.waitForFunction(() => window.__writee?.useDoc.getState().meta)
    assertEq(await page.evaluate(() => window.__writee.useDoc.getState().meta.id), archiveId, '刷新恢复相同路径存档')
    assertEq(await page.evaluate(() => window.__writee.useDoc.getState().data.notes.length), 1, '刷新保留注释')
    await page.evaluate(async (id) => {
      window.__writee.session.closeDoc()
      await window.__writee.session.openRecent(id)
    }, archiveId)
    assertEq(await page.evaluate(() => window.__writee.useDoc.getState().meta.id), archiveId, '最近文档可恢复本机文件连接')

    await shot(page, 'local-file')
    // 双方都改时沿用原有冲突弹窗，不覆盖磁盘。
    await page.evaluate(() => {
      const doc = window.__writee.useDoc.getState()
      doc.replaceText(doc.data.text + '编辑器改动。', 'editor', true)
    })
    await fs.writeFile(file, external + '外部改动。', 'utf8')
    await page.evaluate(() => window.__writee.session.writeNow())
    assertEq(await page.evaluate(() => window.__writee.useDoc.getState().fileStatus), 'conflict', '同时修改阻止自动写回')
    assertEq(await fs.readFile(file, 'utf8'), external + '外部改动。', '磁盘新稿未被覆盖')
    await page.evaluate(() => window.__writee.session.resolveConflict('disk'))

    const assetDir = path.join(dir, '学习指南配图')
    await fs.mkdir(assetDir)
    await fs.writeFile(path.join(assetDir, '图 1.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto" viewBox="0 0 1100 520"><rect width="1100" height="520" fill="#dfeadf"/><text x="40" y="80">本地 SVG</text></svg>', 'utf8')
    await page.evaluate(() => window.__writee.useDoc.getState().replaceText('# 图片\n\n![图1](学习指南配图/图%201.svg)\n', 'editor', true))
    await page.waitForFunction(() => {
      const image = document.querySelector('.cm-md-image img')
      return image && image.complete && image.getBoundingClientRect().width > 200
    })
    const assetSource = await page.locator('.cm-md-image img').getAttribute('src')
    assert(assetSource.includes('/__local_asset/'), '相对路径 SVG 通过限权接口加载')
    const assetEndpoint = new globalThis.URL(assetSource, URL)
    assertEq((await fetch(assetEndpoint)).status, 200, '当前文档目录内图片可以读取')
    for (const target of ['../外部.svg', '/etc/passwd', 'https://example.com/x.svg']) {
      assetEndpoint.searchParams.set('path', target)
      assert((await fetch(assetEndpoint)).status >= 400, `拒绝目录外图片：${target}`)
    }
    await page.evaluate((text) => window.__writee.useDoc.getState().replaceText(text, 'editor', true), external)
    await shot(page, 'local-file')

    const systemActions = []
    await page.route('**/__local_file/*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      systemActions.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    const realFile = await fs.realpath(file)
    await page.locator('.file-btn').click()
    await page.getByText('复制文件路径', { exact: true }).click()
    await page.getByText('已复制文件路径', { exact: true }).waitFor()
    assertEq(await page.evaluate(() => navigator.clipboard.readText()), realFile, '文件菜单复制真实绝对路径')
    await page.locator('.file-btn').click()
    await page.getByText('在文件夹中显示', { exact: true }).click()
    await page.getByText('已在文件夹中显示', { exact: true }).waitFor()
    assertEq(systemActions[systemActions.length - 1], { action: 'reveal' }, '文件菜单定位当前文件')
    await page.locator('.file-btn').click()
    await page.getByText('用系统默认方式打开', { exact: true }).click()
    await page.getByText('已交给系统默认程序', { exact: true }).waitFor()
    assertEq(systemActions[systemActions.length - 1], { action: 'open', target: realFile }, '文件菜单系统默认打开')

    const linked = '# 链接\n\n[网页](https://example.com)\n\n[[./目标 & 文件.txt|目标文件]]\n'
    await page.evaluate((text) => window.__writee.useDoc.getState().replaceText(text, 'editor', true), linked)
    await page.waitForSelector('.cm-md-link[data-href]')
    const actionCount = systemActions.length
    await page.locator('.cm-md-link[data-href]').first().click()
    assertEq(systemActions.length, actionCount, '普通点击保持编辑，不打开链接')
    await page.locator('.cm-md-link[data-href]').first().click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
    await page.waitForTimeout(80)
    assertEq(systemActions[systemActions.length - 1], { action: 'open', target: 'https://example.com' }, 'Ctrl+点击网页交给系统默认浏览器')
    await page.locator('.cm-md-wikilink[data-href]').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
    await page.waitForTimeout(80)
    assertEq(systemActions[systemActions.length - 1], { action: 'open', target: './目标 & 文件.txt' }, 'Ctrl+点击 wiki 文件索引')

    const secondFile = path.join(dir, '第二个 文档.md')
    await fs.writeFile(secondFile, '# 第二个文档\n\nB 正文。\n', 'utf8')
    await page.goto('about:blank')
    launchQueue.enqueue(registerFile(secondFile))
    await page.goto(URL)
    await page.waitForFunction(() => window.__writee?.useDoc.getState().meta?.name === '第二个 文档.md')
    assertEq(page.context().pages().length, 1, '基础页面启动时消费队列，不新建浏览器页面')
    await page.evaluate(() => {
      const W = window.__writee
      window.__launchTransitions = []
      window.__launchUnsubscribe = W.useDoc.subscribe((state, previous) => {
        if (state.meta?.id !== previous.meta?.id) window.__launchTransitions.push(state.meta?.name ?? null)
      })
    })
    launchQueue.enqueue(registerFile(file))
    launchQueue.enqueue(registerFile(secondFile))
    launchQueue.enqueue(registerFile(file))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(() => window.__launchTransitions?.length === 3)
    assertEq(await page.evaluate(() => window.__writee.useDoc.getState().meta?.name), '中文 路径 & 测试.md', 'A、B、A 最后激活 A')
    await page.waitForFunction(async () => {
      const response = await fetch('/__local_launch/', { headers: { 'X-Writee-Launch': '1' }, cache: 'no-store' })
      return (await response.json()) === null
    })
    const launchTransitions = await page.evaluate(() => {
      window.__launchUnsubscribe()
      return window.__launchTransitions
    })
    assertEq(launchTransitions, ['中文 路径 & 测试.md', '第二个 文档.md', '中文 路径 & 测试.md'], '聚焦时串行处理 A、B、A')
    assertEq(await page.locator('.tab').count(), 2, '连续打开复用 Writee 内已有标签页')
    assertEq(await page.evaluate(() => window.__writee.useDoc.getState().meta.id), archiveId, '重新打开 A 激活原存档标签')
    assertEq(page.context().pages().length, 1, 'A、B、A 全程不新建浏览器标签或窗口')

    // 错误来源、无令牌与陈旧版本都不能写入；这部分用 fetch 避免产生预期浏览器报错。
    const endpoint = URL + '__local_file/' + capability.key
    const headers = { 'X-Writee-Token': capability.token, 'Content-Type': 'application/json' }
    const disk = await (await fetch(endpoint, { headers })).json()
    assertEq((await fetch(endpoint)).status, 403, '无授权无法读取文件')
    assertEq((await fetch(endpoint, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403, '跨站不能访问')
    assertEq((await fetch(endpoint, { method: 'PUT', headers, body: JSON.stringify({ text: '旧稿', revision: 'stale' }) })).status, 409, '陈旧版本禁止写回')
    await fs.unlink(file)
    assertEq((await fetch(endpoint, { method: 'PUT', headers, body: JSON.stringify({ text: '旧稿', revision: disk.revision }) })).status, 400, '缺失文件禁止重建')
    assert(!(await fs.stat(file).catch(() => null)), '文件没有被意外创建')
    const badFile = path.join(dir, '未知编码.md')
    const invalid = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
    await fs.writeFile(badFile, invalid)
    let rejected = false
    try { registerFile(badFile) } catch { rejected = true }
    assert(rejected, '拒绝非 UTF-8 文件')
    assertEq([...await fs.readFile(badFile)], [...invalid], '未知编码文件保持原字节')
    const nested = path.join(dir, '另一目录')
    await fs.mkdir(nested)
    await fs.writeFile(path.join(nested, path.basename(file)), '# 同名\n', 'utf8')
    assert(registerFile(path.join(nested, path.basename(file))).key !== capability.key, '不同路径同名文件隔离')
    assertEq(errors, [], '本地文件流程无页面异常')
  } finally {
    await page.evaluate(() => window.__writee?.session.closeDoc()).catch(() => {})
    // 清理只处理本测试创建并核对过的临时目录。
    assert(dir.startsWith(path.join(os.tmpdir(), 'writee-e2e-')), '清理范围在测试临时目录')
    await fs.rm(dir, { recursive: true, force: true })
  }
}

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright-core'
import { assert, assertEq } from './helpers.mjs'

const require = createRequire(import.meta.url)
const executablePath = process.env.WRITEE_DESKTOP_EXECUTABLE ?? require('electron')
const packaged = Boolean(process.env.WRITEE_DESKTOP_EXECUTABLE)
const launchArguments = (profile, file) => [...(packaged ? [] : ['.']), `--user-data-dir=${profile}`, file]
const root = path.resolve(new URL('..', import.meta.url).pathname)

export default async function desktopTest() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'writee-desktop-e2e-'))
  const profile = path.join(dir, 'profile')
  const fileA = path.join(dir, '桌面 A.md')
  const fileB = path.join(dir, '桌面 B.md')
  const fileC = path.join(dir, '桌面 另存.md')
  const filePdf = path.join(dir, '桌面 导出.pdf')
  const originalA = '# 桌面 A\n\n```mermaid\nflowchart LR\n  A[离线] --> B[图表]\n```\n\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="4" y="25">SVG</text></svg>\n\n原文。\n'
  await fs.writeFile(fileA, originalA, 'utf8')
  await fs.writeFile(fileB, '# 桌面 B\n\n第二篇。\n', 'utf8')
  if (process.env.SHOTS) await fs.mkdir(process.env.SHOTS, { recursive: true })
  const app = await electron.launch({
    executablePath,
    args: launchArguments(profile, fileA),
    cwd: packaged ? dir : root,
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 30000,
  })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.getByRole('tab', { name: /桌面 A/ }).waitFor({ timeout: 20000 })
    await page.locator('.cm-md-diagram.is-mermaid.is-ready').waitFor({ timeout: 20000 })
    await page.locator('.cm-md-diagram.is-svg.is-ready').waitFor({ timeout: 5000 })
    assertEq(await app.windows().length, 1, '冷启动只有一个桌面窗口')
    assertEq(await page.getByRole('tab').count(), 1, '冷启动只有一个 Writee 标签')
    assertEq(await page.evaluate(() => [typeof window.require, typeof window.process, typeof window.module]), ['undefined', 'undefined', 'undefined'], '渲染进程没有 Node 能力')

    await page.locator('.cm-content').first().click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await page.keyboard.type('桌面写回。')
    await page.waitForTimeout(200)
    await page.locator('.fstatus.is-ok').waitFor({ timeout: 5000 })
    await page.waitForFunction(() => document.querySelector('.fstatus.is-ok')?.textContent.includes('已保存'))
    const written = await fs.readFile(fileA, 'utf8')
    assert(written.includes('桌面写回。'), `编辑自动写回原始文件；当前内容：${JSON.stringify(written)}`)

    execFileSync(executablePath, launchArguments(profile, fileB), { cwd: packaged ? dir : root, timeout: 15000 })
    await page.getByRole('tab', { name: /桌面 B/ }).waitFor({ timeout: 10000 })
    await page.waitForFunction(() => document.querySelector('.tab.is-active')?.getAttribute('title').startsWith('桌面 B.md'))
    assertEq(await app.windows().length, 1, '第二次文件打开仍只有一个桌面窗口')
    assertEq(await page.getByRole('tab').count(), 2, '第二篇文件进入 Writee 内标签')

    execFileSync(executablePath, launchArguments(profile, fileA), { cwd: packaged ? dir : root, timeout: 15000 })
    await page.waitForFunction(() => document.querySelector('.tab.is-active')?.getAttribute('title').startsWith('桌面 A.md'), null, { timeout: 10000 })
    assertEq(await app.windows().length, 1, '重复打开 A 不创建桌面窗口')
    assertEq(await page.getByRole('tab').count(), 2, '重复打开 A 不创建重复标签')
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'desktop.png') })

    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, fileB)
    await page.locator('.file-btn').click()
    await page.getByText('打开…', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.tab.is-active')?.getAttribute('title').startsWith('桌面 B.md'))
    assertEq(await page.getByRole('tab').count(), 2, '原生打开对话框复用已有 Writee 标签')

    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, fileC)
    await page.locator('.file-btn').click()
    await page.getByText('另存为…', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.tab.is-active')?.getAttribute('title').startsWith('桌面 另存.md'))
    await page.waitForTimeout(200)
    const savedAs = await fs.readFile(fileC, 'utf8')
    assert(savedAs.includes('第二篇。'), '原生另存为创建并写入新文件')

    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, filePdf)
    await page.locator('.file-btn').click()
    await page.getByText('导出 PDF…', { exact: true }).click()
    await page.locator('.pdf-rendering').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
    await page.getByText('PDF 已导出', { exact: true }).waitFor({ timeout: 20000 })
    const pdf = await fs.readFile(filePdf)
    assert(pdf.subarray(0, 5).toString() === '%PDF-', '桌面导出生成真实 PDF 文件头')
    assert(pdf.length > 5000, `桌面 PDF 包含实际排版内容（${pdf.length} 字节）`)
    assertEq(await app.windows().length, 1, 'PDF 导出不创建额外桌面窗口')
    assertEq(errors, [], '桌面生产页面没有控制台异常')
  } finally {
    await app.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await desktopTest()
  console.log('✓ Electron 桌面端到端测试')
}

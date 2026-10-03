// 端到端测试公共工具。需要先启动开发服务器（npm run dev），测试依赖开发模式下的 window.__writee 调试钩子。
// 环境变量：
//   WRITEE_URL   被测地址，默认 http://localhost:5173/
//   CHROME_PATH  浏览器可执行文件路径；不设置则使用本机安装的 Chrome（channel: chrome）
//   SHOTS        若设置为目录，则在关键步骤保存截图
import { chromium } from 'playwright-core'

export const URL = process.env.WRITEE_URL ?? 'http://localhost:5173/'

export async function launch() {
  const opts = process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: process.env.BROWSER_CHANNEL ?? 'chrome' }
  const browser = await chromium.launch({ ...opts, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })
  return { browser, page, errors }
}

export async function openSample(page) {
  await page.goto(URL)
  await page.getByText('看看示例').click()
  await page.waitForFunction(() => window.__writee?.useDoc.getState().meta)
  await page.waitForTimeout(600)
}

/** 在编辑器中选中第一处 str（编辑模式与卡片模式通用） */
export async function selectText(page, str) {
  await page.evaluate((str) => {
    const { useDoc, registry } = window.__writee
    const i = useDoc.getState().data.text.indexOf(str)
    if (i < 0) throw new Error('找不到文字：' + str)
    const e = registry.forPos(i)
    e.view.focus()
    e.view.dispatch({ selection: { anchor: i - e.base(), head: i - e.base() + str.length }, scrollIntoView: true })
  }, str)
  await page.waitForTimeout(250)
}

export const headings = (page) =>
  page.evaluate(() => window.__writee.useDoc.getState().tree.flat.map((s) => '#'.repeat(s.level) + ' ' + s.heading.text))

export function assert(cond, msg) {
  if (!cond) throw new Error('断言失败：' + msg)
}

export function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`断言失败：${msg}\n  实际：${a}\n  期望：${b}`)
}

export async function shot(page, name) {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}

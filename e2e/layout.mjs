// 布局：侧栏拖拽调宽（持久化、双击复位）、大纲收起动画、结构标注工具条
import { assert, assertEq, openSample, selectText, shot } from './helpers.mjs'

export const name = '侧栏调宽与结构标注'

async function drag(page, selector, dx) {
  const b = await page.locator(selector).boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + 300)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + 300, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
}

export default async function ({ page }) {
  await openSample(page)
  const settings = () => page.evaluate(() => window.__writee.useUI.getState().settings)

  await drag(page, '.resizer.is-rail', -100)
  await drag(page, '.resizer.is-outline', 60)
  const s = await settings()
  assert(Math.abs(s.railWidth - 404) <= 3, '右侧栏变宽约 100px，实际 ' + s.railWidth)
  assert(Math.abs(s.outlineWidth - 312) <= 3, '大纲变宽约 60px，实际 ' + s.outlineWidth)
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('writee.settings')))
  assertEq([persisted.railWidth, persisted.outlineWidth], [s.railWidth, s.outlineWidth], '宽度已持久化')
  await shot(page, 'layout-resized')
  await page.locator('.resizer.is-rail').dblclick()
  await page.waitForTimeout(200)
  assertEq((await settings()).railWidth, 304, '双击恢复默认宽度')

  // 大纲收起有宽度过渡
  await page.locator('.topbar-left .icon-btn').first().click()
  await page.waitForTimeout(100)
  const mid = await page.evaluate(() => document.querySelector('.outline-wrap').getBoundingClientRect().width)
  await page.waitForTimeout(400)
  const end = await page.evaluate(() => document.querySelector('.outline-wrap').getBoundingClientRect().width)
  assert(mid > 5 && end <= 1, `大纲收起应有过渡（中途 ${mid}，结束 ${end}）`)
  await page.locator('.topbar-left .icon-btn').first().click()

  // 结构标注：选区自动扩展到整句；点标签时工具条不消失
  await page.getByRole('button', { name: '结构' }).click()
  await selectText(page, '许多 AI 生成')
  await page.locator('.sel-toolbar .utag', { hasText: '事实论据' }).click()
  await page.waitForTimeout(200)
  await page.locator('.sel-toolbar .utag', { hasText: '以偏概全' }).click()
  await page.waitForTimeout(300)
  const units = await page.evaluate(() => {
    const s = window.__writee.useDoc.getState()
    return s.data.analysis.units.map((u) => [s.data.text.slice(u.from, u.to), u.tags])
  })
  assertEq(units, [['许多 AI 生成的文章读起来行云流水，却经不起追问。', ['arg.evidence-fact', 'issue.overgeneral']]], '手动结构标注')
}

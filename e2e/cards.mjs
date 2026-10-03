// 卡片：按钮/快捷操作、鼠标拖拽排序与改层级、折叠与删除动画、撤销
import { assert, assertEq, headings, openSample, shot } from './helpers.mjs'

export const name = '卡片操作与拖拽'

export default async function ({ page }) {
  await openSample(page)
  const ops = await page.evaluate(() => {
    const d = () => window.__writee.useDoc.getState()
    const heads = () => d().tree.flat.map((s) => '#'.repeat(s.level) + ' ' + s.heading.text)
    const find = (t) => d().tree.flat.find((s) => s.heading.text.includes(t)).id
    const out = {}
    d().shiftSection(find('速度会抹平'), 'up')
    out.up = heads().slice(2, 4)
    d().shiftSection(find('修改是写作的主体'), 'left')
    out.left = heads()[5]
    d().shiftSection(find('修改是写作的主体'), 'right')
    out.right = heads()[5]
    d().undo()
    d().undo()
    d().undo()
    out.undone = heads()
    return out
  })
  assertEq(ops.up, ['### 2. 速度会抹平个性', '### 1. 流畅不等于有内容'], '上移')
  assertEq(ops.left, '## 修改是写作的主体', '升级为二级标题')
  assertEq(ops.right, '### 修改是写作的主体', '降级回三级标题')
  assertEq(ops.undone[2], '### 1. 流畅不等于有内容', '撤销恢复顺序')

  await page.getByRole('button', { name: '卡片' }).click()
  await page.waitForTimeout(900)

  // 拖拽“结语”到第一张卡片之前
  await page.evaluate(() => {
    const W = window.__writee
    W.useUI.setState({ collapsed: W.useDoc.getState().tree.flat.filter((s) => s.level === 2).map((s) => s.id) })
  })
  await page.waitForTimeout(500)
  const last = page.locator('[data-card]', { hasText: '结语' }).first()
  await last.locator('.card-meta').hover()
  const g = await last.locator('.card-grip').boundingBox()
  const first = await page.locator('[data-card]', { hasText: '一、快写作的陷阱' }).first().boundingBox()
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x + 20, g.y - 40, { steps: 5 })
  await page.mouse.move(g.x + 10, first.y + 8, { steps: 12 })
  await shot(page, 'cards-drag')
  await page.mouse.up()
  await page.waitForTimeout(80)
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
  assert(running > 0, '拖放后应有 FLIP 动画')
  await page.waitForTimeout(500)
  assertEq((await headings(page))[1], '## 结语', '拖拽到顶层第一位')

  // 拖出到顶层（改变层级）
  await page.evaluate(() => window.__writee.useUI.setState({ collapsed: [] }))
  await page.waitForTimeout(500)
  const sub = page.locator('[data-card]', { hasText: '修改是写作的主体' }).last()
  await sub.locator('.card-meta').first().hover()
  const g2 = await sub.locator('.card-grip').first().boundingBox()
  const next = await page.locator('[data-card]', { hasText: '三、让 AI' }).first().boundingBox()
  await page.mouse.move(g2.x + 5, g2.y + 5)
  await page.mouse.down()
  await page.mouse.move(g2.x - 30, g2.y + 60, { steps: 10 })
  await page.mouse.move(g2.x - 40, next.y + 6, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  assert((await headings(page)).includes('## 修改是写作的主体'), '拖出父卡片后应升为二级标题')

  // 折叠：应有高度动画
  await page.locator('[data-card]', { hasText: '一、快写作的陷阱' }).first().locator('.card-fold').first().click()
  await page.waitForTimeout(60)
  const heightAnim = await page.evaluate(() =>
    document.getAnimations().some((a) => a.effect?.getKeyframes?.().some((k) => 'height' in k)),
  )
  assert(heightAnim, '折叠应有高度动画')
  await page.waitForTimeout(400)

  // 删除：先播放退场动画，再真正删除；可撤销
  const c = page.locator('[data-card]', { hasText: '结语' }).last()
  await c.locator('.card-meta').first().hover()
  await c.locator('.card-actions .icon-btn[title="更多"]').click()
  await page.getByText('删除卡片（含子卡片）').click()
  await page.waitForTimeout(60)
  assert((await headings(page)).includes('## 结语'), '退场动画期间尚未删除')
  await page.waitForTimeout(400)
  assert(!(await headings(page)).includes('## 结语'), '动画结束后删除')
  await page.getByRole('button', { name: '撤销' }).last().click()
  await page.waitForTimeout(300)
  assert((await headings(page)).includes('## 结语'), '撤销删除')
}

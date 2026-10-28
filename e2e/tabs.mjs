// 多标签页：打开多篇、切换保留撤销历史 / 模式 / 滚动位置、关闭、排序、右键菜单、快捷键、左侧栏与刷新恢复
import { URL, assert, assertEq, openSample, shot } from './helpers.mjs'

export const name = '多标签页'

const tabNames = (page) => page.locator('.tab .tab-name').allTextContents()
const state = (page) =>
  page.evaluate(() => {
    const W = window.__writee
    const t = W.session.useTabs.getState()
    const d = W.useDoc.getState()
    return { tabs: t.tabs.map((x) => x.name), active: t.active, doc: d.meta?.name ?? null, past: d.past.length, mode: W.useUI.getState().mode }
  })

async function openText(page, name, text) {
  await page.evaluate(({ name, text }) => window.__writee.session.openFromFile(new File([text], name)), { name, text })
  await page.waitForTimeout(250)
}

export default async function ({ page }) {
  await openSample(page)
  assertEq(await page.locator('.tabstrip:not(.is-vertical) .tab').count(), 1, '打开文档即出现标签页')
  await openText(page, '甲.md', '# 甲\n\n## 一\n\n甲的正文。\n')
  await openText(page, '乙.md', '# 乙\n\n## 二\n\n乙的正文。\n')
  let s = await state(page)
  assertEq(s.tabs, ['示例：慢下来，才能写得更好.md', '甲.md', '乙.md'], '新标签页插在当前标签页之后')
  assertEq(s.doc, '乙.md', '新打开的文档成为当前标签页')
  assertEq(await tabNames(page), ['示例：慢下来，才能写得更好', '甲', '乙'], '标签名省略 .md')

  // 在乙中输入：切走再切回，正文与撤销历史都保留
  await page.evaluate(() => {
    const e = window.__writee.registry.forPos(0)
    const at = e.view.state.doc.toString().indexOf('乙的正文')
    e.view.dispatch({ changes: { from: at, insert: '新增：' }, userEvent: 'input.type' })
  })
  await page.waitForTimeout(100)
  await page.locator('.tab', { hasText: '示例' }).click()
  await page.waitForTimeout(250)
  assertEq((await state(page)).doc, '示例：慢下来，才能写得更好.md', '点击切换标签页')
  // 示例切到卡片模式并滚动
  await page.evaluate(() => window.__writee.useUI.setState({ mode: 'cards' }))
  await page.waitForTimeout(400)
  await page.evaluate(() => { document.querySelector('.scroller').scrollTop = 600 })
  await page.waitForTimeout(100)
  await page.locator('.tab', { hasText: '乙' }).click()
  await page.waitForTimeout(300)
  s = await state(page)
  assertEq([s.doc, s.mode], ['乙.md', 'editor'], '每个标签页保留自己的视图模式')
  assert(await page.evaluate(() => window.__writee.useDoc.getState().data.text.includes('新增：乙的正文')), '切回后保留未关闭期间的修改')
  assert(s.past > 0, '切回后撤销历史仍在')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(100)
  assert(!(await page.evaluate(() => window.__writee.useDoc.getState().data.text.includes('新增：'))), '切回后可以撤销之前的输入')
  await page.locator('.tab', { hasText: '示例' }).click()
  await page.waitForTimeout(500)
  s = await state(page)
  assertEq(s.mode, 'cards', '示例仍是卡片模式')
  const top = await page.evaluate(() => document.querySelector('.scroller').scrollTop)
  assert(Math.abs(top - 600) < 40, `切回后恢复滚动位置：${top}`)
  await shot(page, 'tabs-top')

  // 文件型标签页：切走时写回，后台期间的外部修改在切回时载入，关闭时写回
  const file = await page.evaluate(async () => {
    const W = window.__writee
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const root = await navigator.storage.getDirectory()
    const h = await root.getFileHandle('tab-file.md', { create: true })
    const w = await h.createWritable()
    await w.write('# 文件\n\n## 节\n\n原文。\n')
    await w.close()
    await W.session.openFromHandle(h)
    const out = { opened: W.useDoc.getState().meta.name, tabs: W.session.useTabs.getState().tabs.length }
    const e = W.registry.forPos(0)
    const at = e.view.state.doc.toString().indexOf('原文')
    e.view.dispatch({ changes: { from: at, insert: '改：' }, userEvent: 'input.type' })
    await W.session.activateTab('sample')
    out.diskAfterSwitch = await (await h.getFile()).text()
    out.status = W.session.useTabs.getState().tabs.find((t) => t.name === 'tab-file.md')?.status
    const w2 = await h.createWritable()
    await w2.write(out.diskAfterSwitch.replace('原文', '外部改过的原文'))
    await w2.close()
    const id = W.session.useTabs.getState().tabs.find((t) => t.name === 'tab-file.md').id
    await W.session.activateTab(id)
    await sleep(600)
    out.reloaded = W.useDoc.getState().data.text
    const e2 = W.registry.forPos(0)
    const end = e2.view.state.doc.length
    e2.view.dispatch({ changes: { from: end, insert: '关闭前追加。\n' }, userEvent: 'input.type' })
    await W.session.closeTab(id)
    out.diskAfterClose = await (await h.getFile()).text()
    out.afterClose = W.useDoc.getState().meta?.name
    await root.removeEntry('tab-file.md')
    return out
  })
  assertEq([file.opened, file.tabs], ['tab-file.md', 4], '文件以新标签页打开')
  assert(file.diskAfterSwitch.includes('改：原文'), `切换标签页前写回文件：${file.diskAfterSwitch}`)
  assertEq(file.status, 'saved', '后台标签页记录保存状态')
  assert(file.reloaded.includes('改：外部改过的原文'), `切回时载入后台期间的外部修改：${file.reloaded}`)
  assert(file.diskAfterClose.includes('关闭前追加。'), '关闭标签页前写回文件')
  assertEq(file.afterClose, '甲.md', '关闭后切到右侧相邻的标签页')
  await page.locator('.tab', { hasText: '示例' }).click()
  await page.waitForTimeout(400)
  await page.evaluate(() => { document.querySelector('.scroller').scrollTop = 600 })
  await page.waitForTimeout(100)
  await page.locator('.tab', { hasText: '乙' }).click()
  await page.waitForTimeout(300)
  await page.locator('.tab', { hasText: '示例' }).click()
  await page.waitForTimeout(500)

  // Alt+数字切换
  await page.keyboard.press('Alt+2')
  await page.waitForTimeout(250)
  assertEq((await state(page)).doc, '甲.md', 'Alt+2 切到第二个标签页')
  await page.keyboard.press('Alt+9')
  await page.waitForTimeout(250)
  assertEq((await state(page)).doc, '乙.md', 'Alt+9 切到最后一个标签页')

  // 拖动排序：把“乙”拖到最前
  const first = await page.locator('.tab').first().boundingBox()
  await page.locator('.tab', { hasText: '乙' }).dragTo(page.locator('.tab').first(), { targetPosition: { x: 8, y: first.height / 2 } })
  await page.waitForTimeout(150)
  assertEq((await state(page)).tabs[0], '乙.md', '拖动标签页调整顺序')

  // 右键菜单：关闭其他标签页
  await page.locator('.tab', { hasText: '乙' }).click({ button: 'right' })
  await page.locator('.menu-item', { hasText: '关闭其他标签页' }).click()
  await page.waitForTimeout(400)
  s = await state(page)
  assertEq([s.tabs, s.doc], [['乙.md'], '乙.md'], '关闭其他标签页')

  // “+”回到文档列表，从最近的文档再打开示例：新标签页
  await page.locator('.tab-new').click()
  await page.waitForTimeout(300)
  assert(await page.locator('.welcome').isVisible(), '“+”显示文档列表')
  assertEq(await page.locator('.tab').count(), 1, '文档列表上方仍显示已打开的标签页')
  await page.locator('.recent-main', { hasText: '示例' }).click()
  await page.waitForTimeout(400)
  s = await state(page)
  assertEq([s.tabs.length, s.doc], [2, '示例：慢下来，才能写得更好.md'], '从文档列表打开到新标签页')
  assertEq(s.mode, 'cards', '存档里的视图模式随文档恢复')

  // 关闭当前标签页：切到相邻标签页
  await page.locator('.tab.is-active .tab-close').click()
  await page.waitForTimeout(400)
  s = await state(page)
  assertEq([s.tabs, s.doc], [['乙.md'], '乙.md'], '关闭当前标签页后切到相邻标签页')

  // 移到左侧栏：与大纲切换
  await openSample(page)
  await page.locator('.tabstrip-place').click()
  await page.waitForTimeout(300)
  assertEq(await page.locator('.tabstrip:not(.is-vertical)').count(), 0, '移到左侧后顶部不再显示标签栏')
  assertEq(await page.locator('.outline-wrap .tabstrip.is-vertical .tab').count(), 2, '左侧栏显示标签页')
  await shot(page, 'tabs-left')
  await page.locator('.left-switch button', { hasText: '大纲' }).click()
  await page.waitForTimeout(200)
  assert(await page.locator('.outline-wrap .outline').isVisible(), '左侧栏可切回大纲')
  await page.locator('.left-switch button', { hasText: '标签页' }).click()
  await page.locator('.outline-wrap .tab', { hasText: '乙' }).click()
  await page.waitForTimeout(300)
  assertEq((await state(page)).doc, '乙.md', '左侧标签页可切换文档')
  await page.locator('.tabstrip-head .chip-btn').click()
  await page.waitForTimeout(200)
  assertEq(await page.locator('.tabstrip:not(.is-vertical) .tab').count(), 2, '移回顶部')

  // 刷新后恢复标签页列表，点击时再载入
  await page.waitForTimeout(700)
  await page.goto(URL)
  await page.waitForFunction(() => window.__writee)
  await page.waitForTimeout(400)
  assertEq(await tabNames(page), ['乙', '示例：慢下来，才能写得更好'], '刷新后恢复标签页')
  await page.locator('.tab', { hasText: '乙' }).click()
  await page.waitForTimeout(400)
  s = await state(page)
  assertEq(s.doc, '乙.md', '点击恢复的标签页载入文档')
  assert(!(await page.evaluate(() => window.__writee.useDoc.getState().data.text.includes('新增：'))), '载入的是撤销后的存档内容')
}

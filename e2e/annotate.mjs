// 注释：框选 → 标签 / 注释 → 多标签连接 → 连线与徽标 → 复制提示词
import { assert, assertEq, openSample, selectText, shot } from './helpers.mjs'

export const name = '注释与复制提示词'

export default async function ({ page }) {
  await openSample(page)

  await selectText(page, '写作反而变得更难了')
  await page.locator('.sel-toolbar .tb-btn.is-primary').click()
  await page.waitForTimeout(300)
  await page.keyboard.type('这个判断很抓人，但最好紧接着给一个具体例子。')

  await selectText(page, '撑起一个看似严谨的框架')
  await page.locator('.sel-toolbar .tb-btn', { hasText: '标签' }).click()
  await page.waitForTimeout(200)

  await selectText(page, '语言的棱角被磨平')
  await page.locator('.sel-toolbar .tb-btn.is-primary').click()
  await page.waitForTimeout(300)
  await page.keyboard.type('和上一段的观点有些重复。')

  // 把第 2 个标签连接到第 1 条注释（相当于拖动注释端口到标签上）
  await page.evaluate(() => {
    const s = window.__writee.useDoc.getState()
    const t2 = s.data.tags.slice().sort((a, b) => a.from - b.from)[1]
    s.linkTag(s.data.notes[0].id, t2.id)
  })
  await page.mouse.click(700, 300)
  await page.waitForTimeout(700)
  await shot(page, 'annotate')

  const state = await page.evaluate(() => {
    const s = window.__writee.useDoc.getState()
    return { tags: s.data.tags.length, notes: s.data.notes.map((n) => [n.text, n.tagIds.length]), edits: s.data.edits.length }
  })
  assertEq(state.tags, 3, '标签数量')
  assertEq(
    state.notes,
    [
      ['这个判断很抓人，但最好紧接着给一个具体例子。', 2],
      ['和上一段的观点有些重复。', 1],
    ],
    '注释内容与连接数（输入应进入注释框，而不是正文）',
  )
  assertEq(state.edits, 0, '注释操作不应记为正文修改')
  assertEq(await page.locator('[data-tag-badge]').count(), 3, '正文徽标数量')
  assertEq(await page.locator('svg.links .dot').count(), 3, '槽中圆点数量')
  assertEq(await page.locator('svg.links path.link').count(), 3, '连线数量（注释1→2条，注释2→1条）')

  const prompt = await page.evaluate(() => {
    const W = window.__writee
    const d = W.useDoc.getState()
    return W.buildNotesPrompt(d.data, d.tree, d.meta.name, d.data.notes.map((n) => n.id), {
      scope: 'paragraphs',
      instruction: '',
      listEdits: true,
    })
  })
  assert(prompt.includes('【1】写作反而变得更难了【/1】'), '提示词中应标出原文')
  assert(prompt.includes('→ 这个判断很抓人'), '提示词中应包含注释')
  assert(!prompt.includes('我做了一些修改'), '没有手动修改时不应提醒')

  // 手动修改后应出现提醒
  await page.evaluate(() => {
    const { useDoc, registry } = window.__writee
    const i = useDoc.getState().data.text.indexOf('写作反而变得更难了')
    const e = registry.forPos(i)
    e.view.dispatch({ changes: { from: i - e.base(), insert: '如今' }, userEvent: 'input.type' })
  })
  const prompt2 = await page.evaluate(() => {
    const W = window.__writee
    const d = W.useDoc.getState()
    return W.buildNotesPrompt(d.data, d.tree, d.meta.name, d.data.notes.map((n) => n.id), {
      scope: 'paragraphs',
      instruction: '',
      listEdits: true,
    })
  })
  assert(prompt2.includes('我做了一些修改，注意不要替换成原来的文字，必要的话可以修改。'), '手动修改后应提醒 AI')

  // 两条注释共用一个标签，另留一个独立标签，验证删除边界与整组撤销
  const fixture = await page.evaluate(() => {
    const s = window.__writee.useDoc.getState()
    s.linkTag(s.data.notes[1].id, s.data.tags[0].id)
    const at = s.data.text.indexOf('许多 AI 生成')
    const bare = s.addTag(at, at + 6)
    return { bare, first: s.data.notes[0].id, second: s.data.notes[1].id }
  })
  const snapshot = () => page.evaluate(() => {
    const { text, notes, tags, edits } = window.__writee.useDoc.getState().data
    return { text, notes, tags, edits }
  })
  const before = await snapshot()
  await page.locator(`[data-note="${fixture.first}"]`).getByTitle('更多', { exact: true }).click()
  await page.getByRole('button', { name: '删除注释', exact: true }).click()
  const afterSingle = await snapshot()
  assertEq(afterSingle.notes.map((n) => n.id), [fixture.second], '单条删除只移除目标注释')
  assertEq(afterSingle.tags.length, 3, '单条删除清理独占标签，保留共用和独立标签')
  assert(afterSingle.notes[0].tagIds.every((id) => afterSingle.tags.some((t) => t.id === id)), '剩余注释的标签仍有效')
  await page.locator('.toast').filter({ hasText: '已删除注释' }).getByRole('button', { name: '撤销', exact: true }).click()
  assertEq(await snapshot(), before, '单次撤销同时恢复注释与标签')

  await page.locator('.note-check').first().click()
  await page.locator('.note-check').nth(1).click()
  await page.getByTitle('删除所选注释', { exact: true }).click()
  assertEq((await snapshot()).notes, [], '批量删除所选注释')
  assertEq((await snapshot()).tags.map((t) => t.id), [fixture.bare], '批量删除清理对应标号，保留独立标签')
  await page.locator('.toast').filter({ hasText: '已删除 2 条注释' }).getByRole('button', { name: '撤销', exact: true }).click()
  assertEq(await snapshot(), before, '批量删除也只需一次撤销')

  // 实际剪贴板复制：默认保留注释；新选项兼容已有复制设置
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => localStorage.setItem('writee.copyopts', JSON.stringify({ scope: 'quotes', instruction: '', listEdits: true })))
  await page.getByRole('button', { name: '复制注释', exact: true }).click()
  const dialog = page.getByRole('dialog')
  assert(!(await dialog.getByLabel('复制后清除所选注释', { exact: true }).isChecked()), '旧设置下默认不清除注释')
  const preview = await dialog.locator('.copy-preview pre').textContent()
  await dialog.getByRole('button', { name: '复制', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assertEq((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), preview, '剪贴板内容与复制前预览一致')
  assertEq(await snapshot(), before, '不勾选清除时保留全部注释与标签')

  await page.getByRole('button', { name: /^复制注释/ }).click()
  await dialog.locator('.copy-note input').nth(1).uncheck()
  await dialog.getByLabel('复制后清除所选注释', { exact: true }).check()
  await shot(page, 'copy-clear-option')
  const selectedPreview = await dialog.locator('.copy-preview pre').textContent()
  assert(selectedPreview.includes('这个判断很抓人') && !selectedPreview.includes('和上一段的观点有些重复'), '复制只包含选中注释')

  // 模拟剪贴板与兼容回退都失败，不能丢失注释，也不能关闭弹窗
  await page.evaluate(() => {
    const clipboard = navigator.clipboard
    const exec = document.execCommand
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('测试复制失败') } } })
    document.execCommand = () => false
    window.__restoreCopyTest = () => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
      document.execCommand = exec
      delete window.__restoreCopyTest
    }
  })
  await dialog.getByRole('button', { name: '复制', exact: true }).click()
  await page.locator('.toast.is-error').filter({ hasText: '复制失败，注释已保留' }).waitFor()
  assertEq(await snapshot(), before, '复制失败时注释、标签与正文全部保留')
  assert(await dialog.isVisible(), '复制失败后仍可重试')
  await page.evaluate(() => window.__restoreCopyTest())
  await dialog.getByRole('button', { name: '复制', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assertEq((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), selectedPreview, '先成功复制再清除注释')
  assertEq(await snapshot(), afterSingle, '复制后只清除所选注释及其独占标号')
  assertEq(await page.evaluate(() => window.__writee.useUI.getState().selectedNotes), [], '清除后同步移除批量选择')
  await page.getByRole('button', { name: '撤销清除', exact: true }).click()
  assertEq(await snapshot(), before, '复制后的清除支持一次撤销')

  await page.waitForTimeout(650)
  await page.reload()
  await page.locator('.recent-main').first().click()
  await page.waitForFunction(() => window.__writee?.useDoc.getState().meta)
  assertEq(await snapshot(), before, '撤销结果已存档，刷新仍保留')
  await page.getByRole('button', { name: '复制注释', exact: true }).click()
  assert(await dialog.getByLabel('复制后清除所选注释', { exact: true }).isChecked(), '清除选项刷新后仍记住')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
}

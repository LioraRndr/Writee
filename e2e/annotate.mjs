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
}

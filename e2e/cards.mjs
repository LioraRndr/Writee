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

  // 三级标题展开：目标与祖先必须同步高度动画，不能产生嵌套回弹
  let nested = page.locator('[data-card]', { hasText: '1. 流畅不等于有内容' }).last()
  const nestedId = await nested.getAttribute('data-card')
  const parentId = await nested.evaluate((el) => el.parentElement.closest('[data-card]').dataset.card)
  await nested.locator('.card-fold').first().click()
  await page.waitForTimeout(400)
  assertEq(await nested.locator('.card-fold').first().getAttribute('aria-expanded'), 'false', '折叠按钮同步展开状态')
  await nested.locator('.card-fold').first().click()
  await page.waitForTimeout(60)
  await shot(page, 'cards-expand-mid')
  const nestedHeights = await page.evaluate(() => document.getAnimations().flatMap((a) => {
    const frames = a.effect?.getKeyframes?.() ?? []
    return frames.some((k) => 'height' in k) ? [{ id: a.effect.target.dataset.card, timing: a.effect.getTiming(), to: frames[frames.length - 1].height }] : []
  }))
  assert(nestedHeights.some((a) => a.id === nestedId) && nestedHeights.some((a) => a.id === parentId), '三级卡片及其祖先应同步高度动画')
  await page.waitForTimeout(520)
  const finalHeights = await page.evaluate(({ nestedId, parentId }) => ({
    nested: document.querySelector(`[data-card="${nestedId}"]`).getBoundingClientRect().height,
    parent: document.querySelector(`[data-card="${parentId}"]`).getBoundingClientRect().height,
  }), { nestedId, parentId })
  const nestedTarget = nestedHeights.find((a) => a.id === nestedId)
  const parentTarget = nestedHeights.find((a) => a.id === parentId)
  assert(Math.abs(parseFloat(nestedTarget.to) - finalHeights.nested) <= 2, `动画终点必须等于三级卡片最终自然高度：目标 ${nestedTarget.to}，实际 ${finalHeights.nested}`)
  assert(Math.abs(parseFloat(parentTarget.to) - finalHeights.parent) <= 2, `动画终点必须等于父卡片最终自然高度：目标 ${parentTarget.to}，实际 ${finalHeights.parent}`)
  const foldTiming = nestedHeights[0].timing
  assert(foldTiming.duration >= 240 && foldTiming.duration <= 460, `高度动画时长随变化量在 240–460ms：${foldTiming.duration}`)
  assert(nestedHeights.every((a) => a.timing.duration === foldTiming.duration && a.timing.easing === 'cubic-bezier(0.2, 0, 0, 1)'), '目标与祖先共用同一时长与非回弹曲线')
  await shot(page, 'cards-expand-final')
  assertEq(await nested.locator('.card-fold').first().getAttribute('aria-expanded'), 'true', '展开按钮同步展开状态')

  const parent = page.locator('[data-card]', { hasText: '一、快写作的陷阱' }).first()
  await parent.locator('.card-fold').first().click()
  await page.waitForTimeout(400)
  await parent.locator('.card-fold').first().click()
  await page.waitForTimeout(60)
  const scaledEntries = await page.evaluate(() => document.getAnimations().filter((a) =>
    (a.effect?.getKeyframes?.() ?? []).some((k) => typeof k.transform === 'string' && k.transform.includes('scale')),
  ).length)
  assertEq(scaledEntries, 0, '展开的新子卡不再叠加缩放回弹')

  nested = page.locator('[data-card]', { hasText: '1. 流畅不等于有内容' }).last()
  for (let i = 0; i < 3; i++) {
    await nested.locator('.card-fold').first().click()
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(500)
  assertEq(await nested.evaluate((el) => el.style.overflow), '', '快速连续展开后不留裁剪样式')

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

  // 折叠/展开标题必须共用字体度量；摘要与正文做模糊交叉过渡
  const visualDoc = '# 标题\n\n## “父标题”\n\n### “中文引号”\n\n正文第一句。正文第二句。第三句，用来形成摘要。\n'
  await page.evaluate((text) => {
    const W = window.__writee
    W.useUI.setState({ collapsed: [] })
    const focused = W.registry.focused()
    if (focused) focused.view.contentDOM.blur()
    W.useDoc.getState().replaceText(text, 'editor', true)
  }, visualDoc)
  await page.waitForTimeout(500)
  const titleCard = page.locator('[data-card]', { hasText: '“中文引号”' }).last()
  const measure = (locator) => locator.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rect = range.getBoundingClientRect()
    const style = getComputedStyle(el)
    const card = el.closest('[data-card]').getBoundingClientRect()
    return {
      fontFeature: style.fontFeatureSettings,
      fontVariant: style.fontVariantEastAsian,
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      paddingTop: parseFloat(style.paddingTop),
      width: rect.width,
      top: rect.top - card.top,
    }
  })
  const expandedTitle = await measure(titleCard.locator('.cm-h3').first())
  await titleCard.locator('.card-fold').first().click()
  await page.waitForTimeout(400)
  const collapsedTitle = await measure(titleCard.locator('.card-collapsed-title'))
  assertEq(collapsedTitle.fontFeature, expandedTitle.fontFeature, '折叠与展开标题的字体特性一致')
  assertEq(collapsedTitle.fontVariant, expandedTitle.fontVariant, '折叠与展开标题的东亚字体变体一致')
  assert(Math.abs(collapsedTitle.fontSize - expandedTitle.fontSize) <= 0.2, `标题字号一致：${collapsedTitle.fontSize} / ${expandedTitle.fontSize}`)
  assert(Math.abs(collapsedTitle.lineHeight - expandedTitle.lineHeight) <= 0.2, '标题行高一致')
  assert(Math.abs(collapsedTitle.paddingTop - expandedTitle.paddingTop) <= 0.2, '标题顶部间距一致')
  assert(Math.abs(collapsedTitle.width - expandedTitle.width) <= 0.75, `中文双引号标题宽度一致：${collapsedTitle.width} / ${expandedTitle.width}`)
  assert(Math.abs(collapsedTitle.top - expandedTitle.top) <= 1, `标题位置不微动：${collapsedTitle.top} / ${expandedTitle.top}`)

  // 展开：摘要幽灵层淡出，正文模糊淡入；标题始终不参与动画
  await titleCard.locator('.card-fold').first().click()
  await page.waitForTimeout(60)
  const ghost = titleCard.locator(':scope > .card-fold-ghost')
  assertEq(await ghost.count(), 1, '展开时保留即将淡出的摘要幽灵层')
  assert((await ghost.textContent()).includes('正文第一句'), '幽灵层保留摘要文字')
  assertEq(await ghost.locator('.card-collapsed-title').evaluate((el) => getComputedStyle(el).visibility), 'hidden', '幽灵层不重复绘制标题')
  assertEq(await ghost.evaluate((el) => el.querySelectorAll('[data-card],[data-tag-badge],[data-unit-start]').length), 0, '幽灵层不带可被识别的属性')
  const headLine = titleCard.locator('.card-editor .cm-content > .cm-line').first()
  const bodyLine = titleCard.locator('.card-editor .cm-content > .cm-line').last()
  const motionOf = (loc) => loc.evaluate((el) => ({ name: getComputedStyle(el).animationName, filter: getComputedStyle(el).filter, opacity: parseFloat(getComputedStyle(el).opacity) }))
  const headMid = await motionOf(headLine)
  assertEq([headMid.name, headMid.filter, headMid.opacity], ['none', 'none', 1], '展开时标题不模糊、不淡入')
  const bodyMid = await motionOf(bodyLine)
  assertEq(bodyMid.name, 'card-fold-in', '正文模糊淡入')
  assert(bodyMid.opacity < 0.98 && bodyMid.filter !== 'none', '过渡中正文尚未完全显现且带模糊')
  await shot(page, 'cards-preview-crossfade')
  await page.waitForTimeout(500)
  assertEq(await ghost.count(), 0, '过渡结束移除摘要幽灵层')
  assertEq(await titleCard.evaluate((el) => el.dataset.fold ?? null), null, '过渡结束移除过渡标记')
  const bodyEnd = await motionOf(bodyLine)
  assertEq([bodyEnd.opacity, bodyEnd.filter], [1, 'none'], '正文最终完全显现且无模糊')

  // 收缩：旧正文作为幽灵层留在原位淡出（不再先消失只剩空框），摘要淡入，标题不动
  await titleCard.locator('.card-fold').first().click()
  await page.waitForTimeout(60)
  assertEq(await ghost.count(), 1, '收缩时旧正文留作幽灵层')
  assert((await ghost.textContent()).includes('正文第二句'), '幽灵层是收缩前的正文')
  assertEq(await page.locator(`[data-card="${await titleCard.getAttribute('data-card')}"]`).count(), 1, '克隆内容不产生重复卡片')
  const collapsedMid = await motionOf(titleCard.locator('.card-collapsed-title'))
  assertEq([collapsedMid.name, collapsedMid.filter, collapsedMid.opacity], ['none', 'none', 1], '收缩时标题不模糊、不淡入')
  assertEq(await titleCard.locator('.card-collapsed-preview').evaluate((el) => getComputedStyle(el).animationName), 'card-fold-in', '收缩时摘要淡入')
  await page.waitForTimeout(500)
  assertEq(await ghost.count(), 0, '收缩结束移除幽灵层')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await titleCard.locator('.card-fold').first().click()
  await page.waitForTimeout(60)
  assertEq(await titleCard.locator('.card-fold-ghost').count(), 0, '减少动态效果时不创建幽灵层')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
}

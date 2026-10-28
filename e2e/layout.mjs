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

  // 检查主编辑器和卡片的原生光标，防止 CodeMirror 默认黑色覆盖主题
  for (const mode of ['编辑', '卡片']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    for (const theme of ['xuan', 'su', 'celadon', 'dusk', 'ink']) {
      await page.evaluate((theme) => window.__writee.useUI.getState().setSettings({ theme }), theme)
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme)
      const content = page.locator('.cm-content').first()
      await content.click()
      const colors = await content.evaluate((el) => {
        const expected = document.createElement('span')
        expected.style.color = 'var(--accent)'
        document.body.appendChild(expected)
        const result = { caret: getComputedStyle(el).caretColor, accent: getComputedStyle(expected).color }
        expected.remove()
        return result
      })
      assertEq(colors.caret, colors.accent, `${mode} / ${theme} 光标应采用主题强调色`)
      assert(colors.caret !== 'rgb(0, 0, 0)', `${mode} / ${theme} 光标不应为黑色`)
      if (theme === 'dusk' || theme === 'ink') await shot(page, `caret-${mode === '编辑' ? 'editor' : 'cards'}-${theme}`)
    }
  }

  // 小屏：顶栏不重叠，正文先可见；左侧栏挤压正文、右栏覆盖，同一时间只打开一个
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.evaluate(() => window.__writee.useUI.getState().setSettings({ outlineOpen: true, railOpen: true, theme: 'xuan' }))
  for (const width of [320, 480, 720, 900]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(250)
    if (width === 320) {
      assertEq(await page.evaluate(() => {
        const s = window.__writee.useUI.getState().settings
        return [s.outlineOpen, s.railOpen]
      }), [false, false], '进入小屏先收起两个侧栏，展示正文')
    } else {
      await page.evaluate(() => window.__writee.useUI.getState().setSettings({ outlineOpen: false, railOpen: false }))
      await page.waitForTimeout(50)
    }
    const result = await page.evaluate(() => {
      const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
      const buttons = [...document.querySelectorAll('.topbar button')].filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      const rects = buttons.map((el) => ({ el, rect: el.getBoundingClientRect() }))
      const overlaps = []
      const out = []
      rects.forEach((a, i) => {
        const name = a.el.title || a.el.textContent.trim().slice(0, 20)
        if (a.rect.left < -1 || a.rect.right > innerWidth + 1 || a.rect.top < -1) out.push(name)
        rects.slice(i + 1).forEach((b) => { if (overlap(a.rect, b.rect)) overlaps.push([name, b.el.title || b.el.textContent.trim().slice(0, 20)]) })
      })
      const scroller = document.querySelector('.scroller')
      const rail = document.querySelector('.rail')
      return {
        docWidth: document.documentElement.scrollWidth,
        scrollerWidth: scroller.scrollWidth,
        scrollerClient: scroller.clientWidth,
        overlaps,
        out,
        textWidth: document.querySelector('.text-col').getBoundingClientRect().width,
        topbarHeight: document.querySelector('.topbar').getBoundingClientRect().height,
        outlinePosition: getComputedStyle(document.querySelector('.outline-wrap')).position,
        railPosition: rail ? getComputedStyle(rail).position : 'closed',
        viewport: innerWidth,
      }
    })
    assert(result.docWidth <= width + 1 && result.scrollerWidth <= result.scrollerClient + 1, `${width}px 页面不应横向溢出：${JSON.stringify(result)}`)
    assertEq(result.overlaps, [], `${width}px 顶栏按钮不重叠`)
    assertEq(result.out, [], `${width}px 顶栏按钮不超出视口`)
    assert(result.textWidth >= Math.min(240, width - 32), `${width}px 正文应有可用宽度，实际 ${result.textWidth}`)
    assert(result.topbarHeight <= 140, `${width}px 顶栏不应过高`)
    assert(!['absolute', 'fixed'].includes(result.outlinePosition), `${width}px 左侧栏不应覆盖在正文上`)
    assert(['absolute', 'fixed', 'closed'].includes(result.railPosition), `${width}px 右栏覆盖显示`)

    await page.locator('.topbar-left .icon-btn').first().click()
    await page.waitForTimeout(400)
    const pushed = await page.evaluate(() => {
      const outline = document.querySelector('.outline-wrap').getBoundingClientRect()
      const scroller = document.querySelector('.scroller').getBoundingClientRect()
      return { outlineRight: outline.right, outlineWidth: outline.width, scrollerLeft: scroller.left, scrollerWidth: scroller.width, docWidth: document.documentElement.scrollWidth }
    })
    assert(pushed.outlineWidth > 100 && pushed.scrollerLeft >= pushed.outlineRight - 1, `${width}px 打开大纲时挤压右侧正文：${JSON.stringify(pushed)}`)
    assert(pushed.outlineWidth <= width * 0.46 + 1 && pushed.docWidth <= width + 1, `${width}px 大纲宽度封顶且页面不横向溢出：${JSON.stringify(pushed)}`)
    assertEq(await page.evaluate(() => window.__writee.useUI.getState().settings.outlineOpen), true, `${width}px 大纲已打开`)
    // 切换标签页（Workspace 重新挂载）不应把已打开的大纲收起
    await page.evaluate(() => window.__writee.session.openFromFile(new File(['# 另一篇\n\n## 节\n'], `layout-${innerWidth}.md`)))
    await page.waitForTimeout(250)
    assertEq(await page.evaluate(() => window.__writee.useUI.getState().settings.outlineOpen), true, `${width}px 新开标签页后大纲保持打开`)
    await page.locator('.tab', { hasText: '示例' }).click()
    await page.waitForTimeout(250)
    await page.locator('.topbar-right button[title="注释侧栏"]').click()
    await page.waitForTimeout(80)
    assertEq(await page.evaluate(() => {
      const s = window.__writee.useUI.getState().settings
      return [s.outlineOpen, s.railOpen]
    }), [false, true], `${width}px 打开右栏时关闭大纲`)
    assert(['absolute', 'fixed'].includes(await page.locator('.rail').evaluate((el) => getComputedStyle(el).position)), `${width}px 右栏覆盖显示`)
    await page.locator('.topbar-right button[title="注释侧栏"]').click()

    if (width <= 680) {
      await page.locator('.topbar-right button[title="更多"]').click()
      assert(await page.getByText('AI 设置', { exact: true }).isVisible(), `${width}px 更多菜单保留 AI 设置`)
      assert(await page.getByText('外观与偏好', { exact: true }).isVisible(), `${width}px 更多菜单保留外观设置`)
      await page.keyboard.press('Escape')
    }
    await shot(page, `responsive-${width}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

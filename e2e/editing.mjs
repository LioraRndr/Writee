// 公式与渲染表格：两种编辑模式、源码保持、直接编辑与撤销。
import { assert, assertEq, openSample, shot } from './helpers.mjs'

export const name = '公式与渲染表格'

const mathDoc = String.raw`# 公式测试

行内 $x^2$ 与 \(y_1\)。

$$
\frac{a}{b}
$$

` + '`$code$`\n\n```md\n$fence$\n```\n'

const tableDoc = String.raw`# 表格

## 数据

| 名称 | 数量 |
| :--- | ---: |
| 苹果 | 1 |
| 香蕉 | 2 |
| $x^2$ | 3 |`

async function replaceDoc(page, text) {
  await page.evaluate((text) => {
    const W = window.__writee
    const focused = W.registry.focused()
    if (focused) {
      focused.view.dispatch({ selection: { anchor: 0 } })
      focused.view.contentDOM.blur()
    }
    W.useDoc.getState().replaceText(text, 'editor', true)
  }, text)
}

async function clickAt(page, locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('元素没有可点击区域')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

const cell = (page, row, col) => page.locator(`.cm-md-table [data-cell="${row}:${col}"]`)
const docText = (page) => page.evaluate(() => window.__writee.useDoc.getState().data.text)

async function tableScenario(page, mode) {
  await page.getByRole('button', { name: mode, exact: true }).click()
  await replaceDoc(page, tableDoc)
  await page.waitForSelector('.cm-md-table [data-cell="1:0"]', { timeout: 1800 })
  assertEq(await page.locator('.cm-md-table .katex').count(), 1, `${mode}：表格内公式`)

  await page.evaluate(() => {
    const d = window.__writee.useDoc.getState()
    const i = d.data.text.indexOf('香蕉')
    d.addTag(i, i + 2)
  })
  await clickAt(page, cell(page, 1, 0))
  await cell(page, 1, 0).fill('苹果更多')
  await cell(page, 1, 0).press('Enter')
  await page.waitForTimeout(100)
  assert((await docText(page)).includes('| 苹果更多 | 1 |'), `${mode}：单元格提交写回；实际：${await docText(page)}`)
  const tagged = await page.evaluate(() => {
    const d = window.__writee.useDoc.getState().data
    const tag = d.tags[d.tags.length - 1]
    return d.text.slice(tag.from, tag.to)
  })
  assertEq(tagged, '香蕉', `${mode}：后续注释保持定位`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(100)
  assert((await docText(page)).includes('| 苹果 | 1 |'), `${mode}：一次撤销恢复单元格`)

  await clickAt(page, cell(page, 1, 0))
  await cell(page, 1, 0).fill('不保存')
  await cell(page, 1, 0).press('Escape')
  assert(!(await docText(page)).includes('不保存'), `${mode}：Escape 取消编辑`)
  await clickAt(page, cell(page, 1, 0))
  await cell(page, 1, 0).fill('梨')
  await cell(page, 1, 0).press('Tab')
  await page.waitForFunction(() => document.activeElement?.dataset.cell === '1:1', null, { timeout: 5000 })
  await cell(page, 1, 1).fill('5')
  await cell(page, 1, 1).press('Enter')
  assert((await docText(page)).includes('| 梨 | 5 |'), `${mode}：Tab 移格并提交`)

  await clickAt(page, cell(page, 1, 0))
  await cell(page, 1, 0).press('Escape')
  await cell(page, 1, 0).evaluate((el) => {
    const data = new DataTransfer()
    data.setData('text/plain', '桃\t3\n李\t4')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(100)
  assert((await docText(page)).includes('| 桃 | 3 |') && (await docText(page)).includes('| 李 | 4 |'), `${mode}：网格粘贴`)
  await page.locator('.cm-md-table button[title="在下方插入行"]').click()
  assertEq(await page.locator('.cm-md-table tbody tr').count(), 4, `${mode}：插入行`)
  await page.locator('.cm-md-table button[title="在右侧插入列"]').click()
  assertEq(await page.locator('.cm-md-table thead tr:last-child [data-cell]').count(), 3, `${mode}：插入列`)
  await clickAt(page, cell(page, 0, 0))
  await cell(page, 0, 0).press('Escape')
  await page.locator('.cm-md-table button[title="切换列对齐"]').click()
  assertEq(await page.locator('.cm-md-table th[data-col="0"]').evaluate((el) => el.style.textAlign), 'center', `${mode}：列对齐`)
  await clickAt(page, cell(page, 1, 0))
  await cell(page, 1, 0).press('Escape')
  await page.locator('.cm-md-table button[title="删除当前行"]').click()
  assertEq(await page.locator('.cm-md-table tbody tr').count(), 3, `${mode}：删除行`)
  await page.locator('.cm-md-table button[title="删除当前列"]').click()
  assertEq(await page.locator('.cm-md-table thead tr:last-child [data-cell]').count(), 2, `${mode}：删除列`)

  await replaceDoc(page, tableDoc)
  await page.locator('.cm-md-table [data-row-handle="1"]').dragTo(page.locator('.cm-md-table tbody tr[data-row="2"]'))
  await page.waitForTimeout(100)
  const rowText = await docText(page)
  assert(rowText.indexOf('香蕉') < rowText.indexOf('苹果'), `${mode}：拖动行`)
  await page.locator('.cm-md-table [data-col-handle="0"]').dragTo(page.locator('.cm-md-table th[data-col="1"] [data-cell]'))
  await page.waitForTimeout(100)
  assert((await docText(page)).includes('| 数量 | 名称 |'), `${mode}：拖动列`)

  await replaceDoc(page, tableDoc)
  await clickAt(page, cell(page, 1, 0))
  await cell(page, 1, 0).press('Escape')
  await cell(page, 1, 0).press('Shift+ArrowRight')
  await cell(page, 1, 0).press('Control+c')
  assertEq(await page.evaluate(() => navigator.clipboard.readText()), '苹果\t1', `${mode}：复制所选网格`)
  if (mode === '卡片') await shot(page, 'table-cards')
}

// 交互细节：编辑不改列宽、落点、失焦不抢焦点、Enter/Tab 流程、右键与行菜单、拖选、添加行、移出表格、原地更新
async function tableInteractions(page, mode) {
  await page.getByRole('button', { name: mode, exact: true }).click()
  await replaceDoc(page, tableDoc + '\n\n表后段落。')
  await page.waitForSelector('.cm-md-table [data-cell="1:0"]', { timeout: 1800 })
  const widths = () => page.evaluate(() => [...document.querySelectorAll('.cm-md-table thead th[data-col]')].map((th) => Math.round(th.getBoundingClientRect().width)))
  const active = () => page.evaluate(() => {
    const a = document.activeElement
    return { tag: a?.tagName, cell: a?.dataset?.cell ?? null, caret: a?.selectionStart ?? null, inTable: !!a?.closest('.cm-md-table'), cm: !!a?.classList.contains('cm-content') }
  })
  await page.evaluate(() => { window.__tableWrap = document.querySelector('.cm-md-table') })

  const before = await widths()
  const box = await cell(page, 1, 0).boundingBox()
  await page.mouse.click(box.x + 0.8 * 16 + 18, box.y + box.height / 2)
  assertEq(await widths(), before, `${mode}：进入编辑时列宽不变`)
  const a1 = await active()
  assertEq([a1.tag, a1.cell, a1.caret], ['TEXTAREA', '1:0', 1], `${mode}：光标落在点击位置`)
  await page.keyboard.type('X')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(80)
  assert((await docText(page)).includes('| 苹X果 | 1 |'), `${mode}：落点处插入并提交`)
  const a2 = await active()
  assertEq([a2.tag, a2.cell], ['TEXTAREA', '2:0'], `${mode}：Enter 继续编辑下一行同列`)
  assert(await page.evaluate(() => window.__tableWrap === document.querySelector('.cm-md-table') && window.__tableWrap.isConnected), `${mode}：提交后表格原地更新，不整块重建`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(80)
  assert((await docText(page)).includes('| 苹果 | 1 |'), `${mode}：未改动时 Ctrl+Z 撤销上一格提交`)
  assert((await active()).inTable, `${mode}：撤销后焦点仍在表格内`)

  // 点到表格外：提交但焦点留在正文
  await page.mouse.click(box.x + 40, box.y + box.height / 2)
  await page.keyboard.type('Y')
  const para = page.locator('.cm-line', { hasText: '表后段落' }).first()
  const pb = await para.boundingBox()
  await page.mouse.click(pb.x + 30, pb.y + pb.height / 2)
  await page.waitForTimeout(150)
  assert((await docText(page)).includes('Y'), `${mode}：失焦时提交`)
  const a3 = await active()
  assert(!a3.inTable && a3.cm, `${mode}：失焦提交不把焦点抢回表格：${JSON.stringify(a3)}`)
  await page.keyboard.press('Control+z')

  // Tab 走到最后一格再按 Tab：新增一行
  await page.waitForTimeout(80)
  assertEq(await page.locator('.cm-md-table').count(), 1, `${mode}：正文中撤销表格修改后表格保持渲染`)
  assert((await active()).inTable, `${mode}：撤销后选中变化所在的单元格：${JSON.stringify(await active())}`)
  const rows0 = await page.locator('.cm-md-table tbody tr').count()
  await clickAt(page, cell(page, 3, 1))
  await page.keyboard.press('Tab')
  await page.waitForTimeout(80)
  assertEq(await page.locator('.cm-md-table tbody tr').count(), rows0 + 1, `${mode}：最后一格 Tab 新增一行`)
  assertEq((await active()).cell, '4:0', `${mode}：新行第一格进入编辑`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(80)
  assertEq(await page.locator('.cm-md-table tbody tr').count(), rows0, `${mode}：撤销新增行`)

  // 右键菜单与行菜单
  await cell(page, 1, 1).click({ button: 'right' })
  await page.locator('.cm-table-menu-item', { hasText: '在下方插入行' }).click()
  assertEq(await page.locator('.cm-md-table tbody tr').count(), rows0 + 1, `${mode}：右键菜单插入行`)
  await page.locator('.cm-md-table tbody tr[data-row="2"]').hover()
  await page.locator('.cm-md-table [data-row-handle="2"]').click()
  await page.locator('.cm-table-menu-item', { hasText: '删除行' }).click()
  assertEq(await page.locator('.cm-md-table tbody tr').count(), rows0, `${mode}：行菜单删除行`)
  await page.locator('.cm-md-table th[data-col="1"]').hover()
  await page.locator('.cm-md-table [data-col-handle="1"]').click()
  await page.locator('.cm-table-menu-item', { hasText: '居中' }).click()
  assert((await docText(page)).includes('| :--- | :---: |'), `${mode}：列菜单设置居中`)

  // 拖选范围（鼠标 API 不会自动滚动，先把表格滚到视口中间）
  await cell(page, 1, 0).evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const p1 = await cell(page, 1, 0).boundingBox()
  const p2 = await cell(page, 2, 1).boundingBox()
  await page.mouse.move(p1.x + 8, p1.y + 8)
  await page.mouse.down()
  await page.mouse.move(p2.x + 12, p2.y + 10, { steps: 5 })
  await page.mouse.up()
  assertEq(await page.locator('.cm-md-table .cm-table-cell.is-selected').count(), 4, `${mode}：拖动选中 2×2 网格`)
  assertEq((await active()).tag, 'DIV', `${mode}：拖选不进入编辑`)

  // 悬停出现的添加行按钮
  await page.locator('.cm-md-table').hover()
  await page.locator('.cm-table-add-row').click()
  assertEq(await page.locator('.cm-md-table tbody tr').count(), rows0 + 1, `${mode}：末尾添加行`)
  assertEq((await active()).cell, `${rows0 + 1}:0`, `${mode}：新行直接编辑`)
  await page.keyboard.press('Escape')

  // 方向键移出表格回到正文，再按 ↑ 回到表格末行
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(80)
  assert((await active()).cm, `${mode}：最后一行按 ↓ 回到正文`)
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(80)
  assertEq(await page.locator('.cm-md-table').count(), 1, `${mode}：↑ 进入表格时不切回源码`)
  assertEq((await active()).cell, `${rows0 + 1}:0`, `${mode}：↑ 选中表格末行`)
}

// 宽表格与长公式不能把编辑器撑宽：正文留在卡片 / 版心以内，表格按内容收缩、放不下时在表格内滚动
async function wideContent(page, mode) {
  await page.getByRole('button', { name: mode, exact: true }).click()
  const cols = 12
  const row = (f) => '| ' + Array.from({ length: cols }, (_, i) => f(i)).join(' | ') + ' |'
  const doc = `# 宽内容\n\n## 卡\n\n### 子卡\n\n表格前的正文写得长一些，确认它始终在卡片或版心之内换行，不会被下面的宽表格撑出边界。\n\n${row((i) => '列名' + i)}\n${row(() => '---')}\n${row((i) => '数据' + i)}\n\n| 项目 | 第一种做法的详细说明 | 备注 |\n| --- | --- | --- |\n| 生成 | 直接让模型一次性写出完整稿件，再由作者逐段核对并补充自己的经历与判断 | 需要人工取舍 |\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n$$\n\\sum_{i=1}^{n} a_i + b_i + c_i + d_i + e_i + f_i + g_i + h_i + i_i + j_i + k_i + l_i + m_i + n_i + o_i + p_i + q_i + r_i + s_i\n$$\n\n表格后的正文也一样。\n`
  await replaceDoc(page, doc)
  await page.waitForSelector('.cm-md-table [data-cell="1:0"]', { timeout: 1800 })
  await page.waitForTimeout(300)
  const r = await page.evaluate(() => {
    const w = (el) => el.getBoundingClientRect().width
    const content = [...document.querySelectorAll('.cm-content')].filter((c) => c.querySelector('.cm-md-table')).pop()
    const box = content.closest('.card') ?? document.querySelector('.text-col')
    const boxRect = box.getBoundingClientRect()
    const tables = [...content.querySelectorAll('.cm-md-table')]
    const lines = [...content.querySelectorAll('.cm-line')].filter((l) => l.textContent.includes('正文'))
    const scroll = tables[0].querySelector('.cm-table-scroll')
    return {
      content: w(content),
      parent: w(content.closest('.cm-editor').parentElement),
      lineRight: Math.max(...lines.map((l) => l.getBoundingClientRect().right)),
      boxRight: boxRect.right,
      tables: tables.map(w),
      wideScrolls: scroll.scrollWidth > scroll.clientWidth + 1,
      pageOverflow: document.querySelector('.scroller').scrollWidth > document.querySelector('.scroller').clientWidth + 1,
    }
  })
  assert(r.content <= r.parent + 1, `${mode}：编辑器内容区不被宽表格撑宽：${JSON.stringify(r)}`)
  assert(r.lineRight <= r.boxRight + 1, `${mode}：正文不超出${mode === '卡片' ? '卡片' : '版心'}：${JSON.stringify(r)}`)
  assert(r.tables.every((t) => t <= r.content + 1), `${mode}：表格不超过内容宽度：${JSON.stringify(r)}`)
  assert(r.wideScrolls, `${mode}：列太多的表格在表格内横向滚动`)
  assert(r.tables[1] <= r.content + 1 && r.tables[1] > r.content * 0.6, `${mode}：长单元格在格内换行，表格占满可用宽度：${JSON.stringify(r)}`)
  assert(r.tables[2] < r.content * 0.5, `${mode}：窄表格按内容收缩，不铺满整行：${JSON.stringify(r)}`)
  assert(!r.pageOverflow, `${mode}：页面不横向溢出`)
  const shortCell = await page.locator('.cm-md-table').nth(1).locator('[data-cell="1:0"] .cm-table-value').evaluate((el) => el.getClientRects().length)
  assertEq(shortCell, 1, `${mode}：短单元格不被长单元格挤成多行`)
}

export default async function ({ page }) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSample(page)
  await replaceDoc(page, mathDoc)
  await page.waitForSelector('.cm-md-math .katex', { timeout: 1500 })
  assertEq(await page.locator('.cm-md-math.is-inline').count(), 2, '两个行内公式')
  assertEq(await page.locator('.cm-md-math.is-display').count(), 1, '一个块级公式')
  assertEq(await page.locator('.cm-md-codeblock .katex').count(), 0, '代码块不渲染公式')
  assertEq(await docText(page), mathDoc, '渲染不改变 Markdown')

  await clickAt(page, page.locator('.cm-md-math.is-inline').first())
  await page.waitForTimeout(150)
  assertEq(await page.locator('.cm-md-math.is-inline').count(), 1, '点击公式后该处回到源码')

  await page.getByRole('button', { name: '卡片', exact: true }).click()
  await page.waitForSelector('.cards .cm-md-math .katex', { timeout: 1500 })
  assertEq(await page.locator('.cards .cm-md-math.is-display').count(), 1, '卡片模式渲染块级公式')
  await page.waitForTimeout(400)
  await shot(page, 'math-cards')

  await tableScenario(page, '编辑')
  await tableScenario(page, '卡片')
  await tableInteractions(page, '编辑')
  await tableInteractions(page, '卡片')
  await wideContent(page, '编辑')
  await wideContent(page, '卡片')

  // 全角与半角标点必须可区分：正文不启用 pwid（本机装有思源宋体时会把“，”收窄成半角宽度）
  const east = await page.locator('.cm-content').first().evaluate((el) => [getComputedStyle(el).fontVariantEastAsian, getComputedStyle(el).fontFeatureSettings])
  assertEq(east[0], 'normal', '正文不使用 proportional-width')
  assert(east[1].includes('"pwid" 0'), `正文显式关闭 pwid：${east[1]}`)
}

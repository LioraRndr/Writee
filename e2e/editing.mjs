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
}

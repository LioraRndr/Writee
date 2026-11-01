import { openSample, assert, shot } from './helpers.mjs'

export const name = 'PDF 导出与排版预览'

export default async function pdfTest({ page }) {
  await openSample(page)
  await page.evaluate(() => {
    const text = `# PDF 导出测试\n\n正文包含行内公式 $E=mc^2$，以及 **加粗文字**。\n\n$$\\frac{a}{b}=c$$\n\n- [x] 已完成事项\n- [ ] 待办事项\n\n| 项目 | 结果 |\n| --- | --- |\n| 表格 | 正常 |\n\n## 图表\n\n\`\`\`mermaid\nflowchart LR\n  A[Markdown] --> B[PDF]\n\`\`\`\n\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" onload="alert(1)"><text x="5" y="25">安全 SVG</text></svg>\n\n<script>window.__pdfUnsafe = true</script>\n`
    window.__writee.useDoc.getState().replaceText(text, 'test')
  })
  await page.locator('.file-btn').click()
  await page.getByText('导出 PDF…', { exact: true }).click()
  await page.getByRole('dialog', { name: '导出 PDF' }).waitFor()
  await page.waitForTimeout(3000)
  assert(await page.locator('.pdf-diagram.is-ready').count() === 1, 'Mermaid 进入就绪状态：' + await page.locator('.pdf-diagram').evaluateAll((elements) => elements.map((element) => element.outerHTML).join('\n')))
  await page.locator('.pdf-rendering').waitFor({ state: 'detached' })

  assert(await page.locator('.pdf-content .katex').count() >= 2, '行内与块级公式进入预览')
  assertEqSafe(await page.locator('.pdf-content table').count(), 1, 'Markdown 表格进入预览')
  assertEqSafe(await page.locator('.pdf-task').count(), 2, '任务列表进入预览')
  assert(await page.locator('.pdf-content svg').count() >= 2, 'Mermaid 与独立 SVG 进入预览')
  assertEqSafe(await page.locator('.pdf-content script').count(), 0, '原始脚本不会进入导出文档')
  assertEqSafe(await page.locator('.pdf-content svg[onload]').count(), 0, 'SVG 事件属性被清理')
  assertEqSafe(await page.evaluate(() => window.__pdfUnsafe), undefined, '导出渲染没有执行原始 HTML 脚本')

  await page.getByRole('button', { name: /学术论文/ }).click()
  await page.locator('.pdf-toc').waitFor()
  assert(await page.locator('.pdf-toc li').count() >= 2, '目录按正文标题生成')
  assert(await page.locator('.pdf-running-header').isVisible(), '学术预设显示页眉')
  await page.locator('.pdf-field').filter({ hasText: '纸张' }).locator('select').selectOption('a5')
  await page.getByRole('button', { name: '横向', exact: true }).click()
  const pageCss = await page.locator('.pdf-export-backdrop > style').textContent()
  assert(pageCss.includes('size: A5 landscape'), '纸张与方向同步到打印规则')
  const width = await page.locator('[data-testid="pdf-preview-sheet"]').evaluate((element) => element.style.width)
  assertEqSafe(width, '210mm', 'A5 横向预览宽度')

  await page.getByRole('button', { name: '放大预览' }).click()
  assertEqSafe(await page.locator('.pdf-zoom-value').textContent(), '85%', '预览缩放可用')
  await shot(page, 'pdf-export')

  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true })
  assert(pdf.subarray(0, 5).toString() === '%PDF-', 'Chromium 打印生成真实 PDF 文件头')
  assert(pdf.length > 10000, `PDF 包含实际排版内容（${pdf.length} 字节）`)
  if (process.env.PDF_OUT) await (await import('node:fs/promises')).writeFile(process.env.PDF_OUT, pdf)

  await page.evaluate(() => {
    window.__pdfPrinted = 0
    window.print = () => { window.__pdfPrinted++ }
  })
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  await page.waitForFunction(() => window.__pdfPrinted === 1)
  assertEqSafe(await page.evaluate(() => document.body.classList.contains('is-printing-pdf')), false, '打印后恢复应用界面')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('writee.pdf')))
  assertEqSafe(saved.paper, 'a5', 'PDF 设置独立持久化')
  assertEqSafe(saved.orientation, 'landscape', '纸张方向被保存')
}

function assertEqSafe(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}：${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)
}

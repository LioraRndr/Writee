// 文件同步：用浏览器私有文件系统（OPFS）中的文件模拟本地文件
// 打开 → 编辑后自动写回 → 外部修改自动载入且注释对齐 → 关闭重开后存档恢复
import { URL, assert, assertEq } from './helpers.mjs'

export const name = '文件读写与外部修改同步'

export default async function ({ page }) {
  await page.goto(URL)
  await page.waitForFunction(() => window.__writee)
  const r = await page.evaluate(async () => {
    const W = window.__writee
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
    const root = await navigator.storage.getDirectory()
    const h = await root.getFileHandle('e2e-测试文章.md', { create: true })
    const w = await h.createWritable()
    await w.write('# 测试\n\n第一段文字，这里有一个重点。\n\n## 小节 A\n\nA 的内容。\n\n## 小节 B\n\nB 的内容。\n')
    await w.close()
    await W.session.openFromHandle(h)
    const d = () => W.useDoc.getState()
    const out = { status0: d().fileStatus }
    const i = d().data.text.indexOf('一个重点')
    d().addNote([d().addTag(i, i + 4)], '这里需要展开')
    const e = W.registry.forPos(0)
    const j = e.view.state.doc.toString().indexOf('A 的内容')
    e.view.dispatch({ changes: { from: j + 3, insert: '（新增一句话）' }, userEvent: 'input.type' })
    await sleep(1500)
    out.status1 = d().fileStatus
    out.disk1 = await (await h.getFile()).text()
    // 外部修改
    const w2 = await h.createWritable()
    await w2.write('> 外部插入的引言。\n\n' + out.disk1.replace('B 的内容', 'B 的内容（外部改写）'))
    await w2.close()
    await sleep(3000)
    const tg = d().data.tags[0]
    out.tagText = d().data.text.slice(tg.from, tg.to)
    out.external = d().data.text.includes('外部插入')
    out.edits = d().data.edits.map((x) => d().data.text.slice(x.from, x.to))
    W.session.closeDoc()
    await sleep(400)
    await W.session.openFromHandle(h)
    out.reopenNotes = d().data.notes.map((n) => n.text)
    out.reopenTag = d().data.text.slice(d().data.tags[0].from, d().data.tags[0].to)
    await root.removeEntry('e2e-测试文章.md')
    return out
  })
  assertEq(r.status0, 'saved', '打开后状态')
  assertEq(r.status1, 'saved', '编辑后自动写回')
  assert(r.disk1.includes('A 的（新增一句话）内容'), '磁盘内容已更新')
  assert(r.external, '外部修改已载入')
  assertEq(r.tagText, '一个重点', '外部修改后注释仍对齐原文')
  assertEq(r.edits, ['（新增一句话）'], '只有编辑器内的输入记为手动修改')
  assertEq(r.reopenNotes, ['这里需要展开'], '重开后注释从存档恢复')
  assertEq(r.reopenTag, '一个重点', '重开后标签位置正确')
}

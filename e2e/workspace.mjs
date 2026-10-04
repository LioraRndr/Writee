// 真实浏览器 + OPFS：仅系统选择框替换成返回真实目录/文件句柄。
import { URL, assert, assertEq } from './helpers.mjs'

export const name = '工作目录身份、替换文件与旧笔记恢复'

export default async function ({ page }) {
  await page.goto(URL)
  await page.waitForFunction(() => window.__writee)
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('写作目录', { create: true })
    const sub = await dir.getDirectoryHandle('文章', { create: true })
    const h = await sub.getFileHandle('草稿.md', { create: true })
    const w = await h.createWritable()
    await w.write('# 初稿\n\n这里有一个重点。\n')
    await w.close()
    await window.__writee.session.openFromHandle(h)
    const d = window.__writee.useDoc.getState()
    const i = d.data.text.indexOf('一个重点')
    d.addNote([d.addTag(i, i + 4)], '需要展开的笔记')
    await window.__writee.session.persistNow()
    window.showDirectoryPicker = async () => dir
  })
  const originalId = await page.evaluate(() => window.__writee.useDoc.getState().meta.id)
  await page.getByTitle('文件', { exact: true }).click()
  await page.getByText('工作目录…', { exact: true }).click()
  await page.getByRole('button', { name: '授权工作目录…', exact: true }).click()
  await page.getByText('已关联：写作目录/文章/草稿.md').waitFor()
  await page.getByTitle('关闭（Esc）').click()

  const result = await page.evaluate(async () => {
    const W = window.__writee
    const d = () => W.useDoc.getState()
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('写作目录')
    const sub = await dir.getDirectoryHandle('文章')
    const ids = []
    let invalidated = false
    for (let n = 1; n <= 3; n++) {
      const old = d().meta.handle
      await sub.removeEntry('草稿.md')
      await W.session.checkDisk() // 文件短暂缺失时不能清空笔记或创建文件。
      try { await old.getFile() } catch { invalidated = true }
      const fresh = await sub.getFileHandle('草稿.md', { create: true })
      const w = await fresh.createWritable()
      await w.write(`# 第 ${n} 版\n\n新的引言。\n\n这里有一个重点。\n`)
      await w.close()
      await W.session.checkDisk()
      ids.push(d().meta.id)
      // 重新选择新句柄也必须找回同一份存档。
      await W.session.openFromHandle(fresh)
      ids.push(d().meta.id)
    }
    const tag = d().data.tags[0]
    const out = { ids, invalidated, notes: d().data.notes.map((n) => n.text), tag: d().data.text.slice(tag.from, tag.to) }
    // 不同子目录中的同名文件不能串笔记。
    const other = await dir.getDirectoryHandle('其他文章', { create: true })
    const otherFile = await other.getFileHandle('草稿.md', { create: true })
    const writer = await otherFile.createWritable()
    await writer.write(d().data.text)
    await writer.close()
    await W.session.openFromHandle(otherFile)
    out.otherId = d().meta.id
    out.otherNotes = d().data.notes.length
    await W.session.openRecent(ids[0])
    // 双方修改：替换文件后保存必须报冲突。
    d().replaceText(d().data.text + '\n本地编辑\n', 'test', { userEdit: true })
    await sub.removeEntry('草稿.md')
    const replaced = await sub.getFileHandle('草稿.md', { create: true })
    const w = await replaced.createWritable()
    await w.write('# 完全重写\n\n另一篇新内容。\n')
    await w.close()
    await W.session.writeNow()
    out.conflict = d().fileStatus
    out.disk = await (await replaced.getFile()).text()
    W.session.resolveConflict('disk')
    out.orphanNotes = d().data.notes.map((n) => n.text)
    out.orphanLinks = d().data.notes[0].tagIds
    await W.session.persistNow()
    return out
  })
  assert(result.invalidated, '测试确实使旧句柄失效')
  assert(result.ids.every((id) => id === originalId), '三轮删除重建、重新打开均保留文档身份')
  assertEq(result.notes, ['需要展开的笔记'], '持续保留笔记')
  assertEq(result.tag, '一个重点', '保留未改写原文的注释位置')
  assert(result.otherId !== originalId && result.otherNotes === 0, '不同子目录同名文件相互独立')
  assertEq(result.conflict, 'conflict', '写入前发现外部替换')
  assertEq(result.disk, '# 完全重写\n\n另一篇新内容。\n', '没有覆盖外部新稿')
  assertEq(result.orphanNotes, ['需要展开的笔记'], '全文改写后笔记不丢失')
  assertEq(result.orphanLinks, [], '失效位置取消关联')
  await page.getByText('待重新定位', { exact: true }).waitFor()

  await page.reload()
  await page.waitForFunction(() => window.__writee)
  await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('写作目录')
    const sub = await dir.getDirectoryHandle('文章')
    await sub.removeEntry('草稿.md')
    const fresh = await sub.getFileHandle('草稿.md', { create: true })
    const w = await fresh.createWritable()
    await w.write('# 关闭期间又修改\n\n再次替换文件。\n')
    await w.close()
  })
  await page.getByRole('button', { name: /草稿.md.*1 条注释/ }).click()
  await page.waitForFunction((id) => window.__writee.useDoc.getState().meta?.id === id, originalId)
  assertEq(await page.evaluate(() => window.__writee.session.currentLocation().path), ['文章', '草稿.md'], '刷新后路径绑定从 IndexedDB 恢复')
  assert((await page.evaluate(() => window.__writee.useDoc.getState().data.text)).includes('关闭期间又修改'), '最近文档按路径读取关闭期间替换后的文件')

  // 移动后的明确重新关联：经过真实界面入口，文件选择框返回 OPFS 句柄。
  await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('写作目录')
    const moved = await dir.getFileHandle('改名后的稿件.md', { create: true })
    const w = await moved.createWritable()
    await w.write(window.__writee.useDoc.getState().data.text)
    await w.close()
    window.showOpenFilePicker = async () => [moved]
  })
  await page.getByTitle('文件', { exact: true }).click()
  await page.getByText('工作目录…', { exact: true }).click()
  await page.getByRole('button', { name: '选择文件，关联当前存档…', exact: true }).click()
  await page.waitForFunction(() => window.__writee.useDoc.getState().meta?.name === '改名后的稿件.md')
  assertEq(await page.evaluate(() => window.__writee.useDoc.getState().meta.id), originalId, '改名重新关联保留原存档 ID')
  assertEq(await page.evaluate(() => window.__writee.useDoc.getState().data.notes.length), 1, '重新关联保留笔记')

  const edge = await page.evaluate(async () => {
    const W = window.__writee
    const d = () => W.useDoc.getState()
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('写作目录')
    const sub = await dir.getDirectoryHandle('文章')
    // 重叠授权目录下的路径仍找回原存档。
    const h = await sub.getFileHandle('重叠.md', { create: true })
    await W.session.openFromHandle(h)
    const overlapId = d().meta.id
    await W.session.registerWorkspace(sub)
    await sub.removeEntry('重叠.md')
    const replaced = await sub.getFileHandle('重叠.md', { create: true })
    await W.session.openFromHandle(replaced)
    const out = { overlap: d().meta.id === overlapId }
    // 两个同名目录、相同相对路径，仍是两个独立文档。
    const parent = await root.getDirectoryHandle('另一个位置', { create: true })
    const sameName = await parent.getDirectoryHandle('写作目录', { create: true })
    await W.session.registerWorkspace(sameName)
    const other = await sameName.getFileHandle('改名后的稿件.md', { create: true })
    await W.session.openFromHandle(other)
    out.separateRoots = d().data.notes.length === 0
    out.otherId = d().meta.id
    // 拒绝把有存档的文件静默关联到另一存档。
    let refused = false
    try { await W.session.relinkCurrent(await dir.getFileHandle('改名后的稿件.md')) } catch { refused = true }
    out.refused = refused
    // 文件缺失时写回失败，不能重建已删除的文件。
    d().replaceText('本地尚未保存', 'test', { userEdit: true })
    await sameName.removeEntry('改名后的稿件.md')
    await W.session.writeNow()
    out.missingStatus = d().fileStatus
    try { await sameName.getFileHandle('改名后的稿件.md'); out.recreated = true } catch { out.recreated = false }
    // 重建后出现冲突，关闭重开仍保留冲突，不会覆盖新稿。
    const fresh = await sameName.getFileHandle('改名后的稿件.md', { create: true })
    const w = await fresh.createWritable()
    await w.write('外部新稿')
    await w.close()
    await W.session.persistNow()
    await W.session.openFromHandle(fresh)
    out.firstConflict = d().fileStatus
    await W.session.openRecent(d().meta.id)
    out.secondConflict = d().fileStatus
    await W.session.writeNow()
    out.safeDisk = await (await fresh.getFile()).text()
    return out
  })
  assert(edge.overlap, '重叠授权目录不改变原路径身份')
  assert(edge.separateRoots && edge.otherId !== originalId, '不同位置的同名工作目录不会串笔记')
  assert(edge.refused, '拒绝覆盖目标已有存档')
  assertEq(edge.missingStatus, 'error', '文件缺失时报告保存失败')
  assert(!edge.recreated, '不重建已删除的文件')
  assertEq(edge.firstConflict, 'conflict', '重新打开保留双方修改的冲突')
  assertEq(edge.secondConflict, 'conflict', '未处理冲突重新打开仍须确认')
  assertEq(edge.safeDisk, '外部新稿', '未处理冲突不会覆盖外部稿件')

  const legacy = await page.evaluate(async () => {
    const W = window.__writee
    W.session.resolveConflict('disk')
    const archive = await import('/src/core/archive.ts')
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('写作目录')
    const old = await dir.getFileHandle('历史文章.md', { create: true })
    const w = await old.createWritable()
    await w.write('原文中的重点')
    await w.close()
    await W.session.openFromHandle(old)
    const d = W.useDoc.getState()
    d.addNote([d.addTag(0, 2)], '从旧版恢复的笔记')
    const id = d.meta.id
    await W.session.persistNow()
    W.session.closeDoc()
    // 模拟升级前没有 location 的存档。
    const saved = await archive.loadArchive(id)
    delete saved.location
    await archive.saveArchive(saved)
    await dir.removeEntry('历史文章.md')
    const replacement = await dir.getFileHandle('历史文章-新位置.md', { create: true })
    const writer = await replacement.createWritable()
    await writer.write('全新的稿件内容')
    await writer.close()
    await W.session.openRecent(id)
    const fallback = W.useDoc.getState().meta.handle === null
    await W.session.relinkCurrent(replacement)
    return {
      fallback,
      sameId: W.useDoc.getState().meta.id === id,
      text: W.useDoc.getState().data.text,
      note: W.useDoc.getState().data.notes[0].text,
      path: W.session.currentLocation().path,
    }
  })
  assert(legacy.fallback, '旧版失效句柄仍可打开存档副本')
  assert(legacy.sameId, '手动恢复旧存档保持文档身份')
  assertEq(legacy.text, '全新的稿件内容', '旧存档恢复载入当前磁盘稿件')
  assertEq(legacy.note, '从旧版恢复的笔记', '旧存档恢复保留注释')
  assertEq(legacy.path, ['历史文章-新位置.md'], '恢复后后续使用稳定路径')
}

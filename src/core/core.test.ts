import { describe, expect, it } from 'vitest'
import { ChangeSet } from '@codemirror/state'
import { buildSections, parseHeadings } from './sections'
import { moveBlock, levelShiftChanges, applyChangesToString } from './cardOps'
import { diffChanges, mapData, mapperFromChanges } from './mapping'
import { splitSentences } from './sentences'
import { buildNotesPrompt, EDIT_REMINDER } from './notesPrompt'
import { importAnalysis } from '../analysis/format'
import type { DocData } from './types'

const doc = (text: string): DocData => ({ text, tags: [], notes: [], edits: [], analysis: null, anchors: [] })

describe('sections', () => {
  it('忽略代码块与 front matter 中的 #', () => {
    const text = '---\ntitle: x\n---\n# 标题\n\n```\n# 不是标题\n```\n\n## 小节\n'
    expect(parseHeadings(text).map((h) => h.text)).toEqual(['标题', '小节'])
  })

  it('唯一的 H1 作为标题，其余按层级嵌套（允许跳级）', () => {
    const text = '# 文章\n\n导语\n\n## A\n\n#### A.1\n\n## B\n\n### B.1\n'
    const { tree } = buildSections(text, [])
    expect(tree.title?.heading?.text).toBe('文章')
    expect(tree.roots.map((s) => s.heading?.text)).toEqual(['A', 'B'])
    expect(tree.roots[0].children[0].heading?.text).toBe('A.1')
    expect(tree.roots[1].children[0].heading?.text).toBe('B.1')
  })

  it('只用 ### 的文章：### 成为顶层卡片', () => {
    const { tree } = buildSections('### 一\n\n内容\n\n### 二\n\n#### 二点一\n', [])
    expect(tree.title).toBeNull()
    expect(tree.roots.map((s) => s.heading?.text)).toEqual(['一', '二'])
  })

  it('锚点映射后 id 保持稳定', () => {
    const text = '## A\n\na\n\n## B\n\nb\n'
    const first = buildSections(text, [])
    const idB = first.tree.flat[1].id
    const cs = ChangeSet.of([{ from: 5, insert: '新增内容\n' }], text.length)
    const next = applyChangesToString(text, cs)
    const m = mapperFromChanges(cs)
    const anchors = first.anchors.map((a) => ({ id: a.id, pos: m(a.pos, 1) }))
    expect(buildSections(next, anchors).tree.flat[1].id).toBe(idB)
  })
})

describe('card ops', () => {
  it('移动文本块并正确映射位置', () => {
    const text = '## A\n\naaa\n\n## B\n\nbbb\n\n## C\n\nccc\n'
    const from = text.indexOf('## C')
    const r = moveBlock(text, from, text.length, 0)
    expect(r.text.startsWith('## C\n\nccc\n\n## A')).toBe(true)
    const p = text.indexOf('ccc')
    expect(r.text.slice(r.map(p, 1), r.map(p, 1) + 3)).toBe('ccc')
    const q = text.indexOf('bbb')
    expect(r.text.slice(r.map(q, 1), r.map(q, 1) + 3)).toBe('bbb')
  })

  it('整体平移标题层级', () => {
    const text = '## A\n\n### A1\n\n## B\n'
    const cs = levelShiftChanges(text, 0, text.indexOf('## B'), 1)
    expect(applyChangesToString(text, cs)).toBe('### A\n\n#### A1\n\n## B\n')
  })
})

describe('mapping', () => {
  it('外部修改后注释重新对齐；被删光的标签移除', () => {
    const text = '第一句话。重点在这里。第三句。'
    const data: DocData = {
      ...doc(text),
      tags: [
        { id: 't1', from: text.indexOf('重点'), to: text.indexOf('重点') + 2, created: 0 },
        { id: 't2', from: text.indexOf('第三句'), to: text.indexOf('第三句') + 3, created: 0 },
      ],
      notes: [{ id: 'n1', text: '', tagIds: ['t1', 't2'], color: 'jade', created: 0, updated: 0 }],
    }
    const next = '开头新增。第一句话。重点在这里。'
    const m = mapperFromChanges(diffChanges(text, next))
    const out = mapData(data, next, m)
    expect(out.tags.length).toBe(1)
    expect(next.slice(out.tags[0].from, out.tags[0].to)).toBe('重点')
    expect(out.notes[0].tagIds).toEqual(['t1'])
  })
})

describe('sentences', () => {
  it('按中英文标点切句，保留引号，识别缩写', () => {
    const s = splitSentences('# 标题\n\n他说：“好。”然后走了！E. M. Forster wrote this. Next one?\n\n- 列表项一。\n')
    expect(s.map((x) => x.text)).toEqual(['标题', '他说：“好。”', '然后走了！', 'E. M. Forster wrote this.', 'Next one?', '列表项一。'])
    expect(s[0].kind).toBe('heading')
    expect(s[5].kind).toBe('list')
  })
})

describe('notes prompt', () => {
  it('用【n】标记原文，并在有手动修改时提醒', () => {
    const text = '## 小节\n\n这是第一句。这里需要改。\n\n另一段。\n'
    const i = text.indexOf('这里需要改')
    const data: DocData = {
      ...doc(text),
      tags: [{ id: 't1', from: i, to: i + 5, created: 0 }],
      notes: [{ id: 'n1', text: '改得更具体', tagIds: ['t1'], color: 'jade', created: 0, updated: 0 }],
      edits: [{ from: text.indexOf('第一句'), to: text.indexOf('第一句') + 3 }],
    }
    const { tree } = buildSections(text, [])
    const p = buildNotesPrompt(data, tree, 'a.md', ['n1'], { scope: 'paragraphs', instruction: '', listEdits: true })
    expect(p).toContain('【1】这里需要改【/1】')
    expect(p).toContain('（位于：小节）')
    expect(p).toContain('→ 改得更具体')
    expect(p).toContain(EDIT_REMINDER)
    expect(p).toContain('「这是第一句。」')
    expect(p).not.toContain('另一段')
  })
})

describe('analysis import', () => {
  it('序号错位时用开头原文重新定位', () => {
    const text = '# 题目\n\n## 1. 小标题\n\n正文第一句。正文第二句。\n'
    const raw = '{"s":[5,5],"q":"正文第一","t":["arg.claim"],"r":"测试"}\n{"summary":{"thesis":"t"}}'
    const a = importAnalysis(raw, text)
    expect(a.units.length).toBe(1)
    expect(text.slice(a.units[0].from, a.units[0].to)).toBe('正文第一句。')
    expect(a.summary?.thesis).toBe('t')
  })
})

describe('math ranges', () => {
  async function loadMath() {
    const modulePath = './math'
    return import(/* @vite-ignore */ modulePath)
  }

  it('识别美元与反斜杠定界的行内、块级公式', async () => {
    const { findMathRanges } = await loadMath()
    const text = String.raw`行内 $x^2$ 与 \(y_1\)。

$$\frac{a}{b}$$

\[
\sqrt{x}
\]`
    const ranges = findMathRanges(text)
    expect(ranges.map((r: { source: string }) => r.source)).toEqual(['x^2', 'y_1', String.raw`\frac{a}{b}`, '\n\\sqrt{x}\n'])
    expect(ranges.map((r: { display: boolean }) => r.display)).toEqual([false, false, true, true])
  })

  it('跳过转义美元、排除范围、未闭合公式与普通金额', async () => {
    const { findMathRanges } = await loadMath()
    const text = String.raw`\$x$ 与 $ok$、价格 $100 和 $200、$未闭合`
    const excluded = { from: text.indexOf('$ok$'), to: text.indexOf('$ok$') + 4 }
    expect(findMathRanges(text, [excluded])).toEqual([])
  })
})

describe('table model', () => {
  async function loadTable() {
    const modulePath = './table'
    return import(/* @vite-ignore */ modulePath)
  }

  it('解析并原样序列化转义竖线、对齐和单元格换行', async () => {
    const { parseTable, serializeTable } = await loadTable()
    const source = '| 名称 | 数值 | 备注 |\n| :--- | ---: | :---: |\n| A\\|B | 1 | 一<br>二 |'
    const model = parseTable(source)
    expect(model.rows[1]).toEqual(['A|B', '1', '一\n二'])
    expect(model.aligns).toEqual(['left', 'right', 'center'])
    expect(serializeTable(model)).toBe(source)
  })

  it('单元格与行列操作不可变并保留表头对齐', async () => {
    const { parseTable, updateCell, moveRow, moveColumn, insertRow, deleteRow, insertColumn, deleteColumn, setAlign, serializeTable } = await loadTable()
    const base = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
    const changed = updateCell(base, 1, 0, '新|值')
    expect(serializeTable(changed)).toContain('新\\|值')
    expect(base.rows[1][0]).toBe('1')
    expect(moveRow(base, 2, 1).rows.slice(1)).toEqual([['3', '4'], ['1', '2']])
    expect(moveColumn(base, 0, 1).rows[0]).toEqual(['B', 'A'])
    expect(insertRow(base, 1, ['x', 'y']).rows[1]).toEqual(['x', 'y'])
    expect(deleteRow(base, 1).rows).toEqual(base.rows.filter((_: string[], i: number) => i !== 1))
    expect(insertColumn(base, 1).rows.every((r: string[]) => r.length === 3)).toBe(true)
    expect(deleteColumn(insertColumn(base, 1), 1).rows).toEqual(base.rows)
    expect(setAlign(base, 1, 'right').aligns).toEqual(['', 'right'])
  })

  it('TSV 支持引号、制表符、CRLF 和字段内换行', async () => {
    const { parseTsv, toTsv } = await loadTable()
    const rows = [['甲', '乙'], ['含\t制表', '跨\n行']]
    expect(parseTsv('甲\t乙\r\n"含\t制表"\t"跨\n行"\r\n')).toEqual(rows)
    expect(parseTsv(toTsv(rows))).toEqual(rows)
  })

  it('网格粘贴自动扩展行列且不修改原模型', async () => {
    const { parseTable, pasteGrid } = await loadTable()
    const base = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |')
    const next = pasteGrid(base, 1, 1, [['x', 'y', 'z'], ['q', 'w', 'e']])
    expect(next.rows).toEqual([['A', 'B', '', ''], ['1', 'x', 'y', 'z'], ['', 'q', 'w', 'e']])
    expect(next.aligns).toEqual(['', '', '', ''])
    expect(base.rows).toEqual([['A', 'B'], ['1', '2']])
  })
})

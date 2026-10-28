import { EditorView, WidgetType } from '@codemirror/view'
import type { ChangeSpec } from '@codemirror/state'
import { copyText } from '../core/fileAccess'
import { diffChanges } from '../core/mapping'
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseTable,
  parseTsv,
  pasteGrid,
  serializeTable,
  setAlign,
  toTsv,
  updateCell,
  type TableAlign,
  type TableModel,
} from '../core/table'
import { useDoc } from '../store/docStore'
import { renderInline } from './inline'

interface CellPos {
  row: number
  col: number
}

/** 光标落点：数字为偏移，'end' 为末尾 */
type Caret = number | 'end'

interface FocusRequest {
  from: number
  anchor: CellPos
  cursor: CellPos
  edit: boolean
  caret?: Caret
  /** 失焦提交时只恢复选区，不把焦点抢回表格 */
  focus?: boolean
}

interface MenuItem {
  label: string
  run: () => void
  disabled?: boolean
  danger?: boolean
}

const focusRequests = new WeakMap<EditorView, FocusRequest>()
const controllers = new WeakMap<HTMLElement, TableController>()
const samePos = (a: CellPos, b: CellPos) => a.row === b.row && a.col === b.col
const sameModel = (a: TableModel, b: TableModel) => JSON.stringify(a) === JSON.stringify(b)
const nextAlignment: Record<TableAlign, TableAlign> = { '': 'left', left: 'center', center: 'right', right: '' }
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function button(cls: string, label: string, title: string, action?: string) {
  const b = el('button', cls, label)
  b.type = 'button'
  b.title = title
  if (action) b.dataset.action = action
  return b
}

/** 粗略估算一段文字的宽度（em）：全角字符 1em，其余约 0.55em */
function textEm(text: string) {
  let em = 0
  for (const ch of text) em += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 1 : 0.55
  return em
}

/**
 * 短内容（如“直接成稿”）整格不折行，长单元格变宽时不会把它挤成两行；
 * 长内容照常在格内换行，表格因此能按内容收缩到版心以内。
 */
const isShort = (raw: string) => !!raw && !raw.includes('\n') && textEm(raw) <= 6

/** 鼠标位置对应的文本偏移（只在渲染文字与源码一致时使用） */
function caretFromPoint(cell: HTMLElement, x: number, y: number, raw: string): Caret {
  const value = cell.querySelector('.cm-table-value')
  if (!value || value.textContent !== raw) return 'end'
  const doc = cell.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let offset = 0
  const pos = doc.caretPositionFromPoint?.(x, y)
  if (pos) {
    node = pos.offsetNode
    offset = pos.offset
  } else {
    const range = doc.caretRangeFromPoint?.(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  }
  if (!node || !value.contains(node)) return 'end'
  let total = 0
  const walk = doc.createTreeWalker(value, NodeFilter.SHOW_TEXT)
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    if (t === node) return total + offset
    total += (t as Text).data.length
  }
  return 'end'
}

/** 聚焦从 from 开始的渲染表格：edge 指定进入首行 / 末行，省略时回到上次的单元格 */
export function focusTableAt(view: EditorView, from: number, edge?: 'first' | 'last') {
  for (const node of view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table')) {
    const c = controllers.get(node)
    if (c?.from === from) {
      c.enter(edge)
      return true
    }
  }
  return false
}

export class TableWidget extends WidgetType {
  readonly model: TableModel

  constructor(readonly source: string, readonly from: number) {
    super()
    this.model = parseTable(source)
  }

  eq(o: TableWidget) {
    return o.source === this.source && o.from === this.from
  }

  toDOM(view: EditorView) {
    return new TableController(view, this).wrap
  }

  /** 同一张表格的内容或位置变化时原地更新，保留滚动位置与焦点，不整块重建 */
  updateDOM(dom: HTMLElement, view: EditorView, prev?: WidgetType) {
    const c = controllers.get(dom)
    if (!c || !(prev instanceof TableWidget) || (prev.from !== this.from && prev.source !== this.source)) return false
    c.update(this, view)
    return true
  }

  destroy(dom: HTMLElement) {
    controllers.get(dom)?.detach()
  }

  get estimatedHeight() {
    return 40 + this.model.rows.length * 38
  }

  ignoreEvent() {
    return true
  }
}

class TableController {
  readonly wrap = el('div', 'cm-md-table')
  private readonly toolbar = el('div', 'cm-table-toolbar')
  private readonly scroller = el('div', 'cm-table-scroll')
  private readonly status = el('span', 'cm-table-status')
  private menu: HTMLElement | null = null
  private model: TableModel
  private anchor: CellPos
  private cursor: CellPos
  private editing: CellPos | null = null
  private draft = ''
  private editWidth = 0
  private press: { pos: CellPos; caret: Caret; moved: boolean; shift: boolean } | null = null
  private drag: { kind: 'row' | 'col'; index: number } | null = null
  private focusSeq = 0
  /** 重建表格时旧编辑框被移除会触发 focusout，不能当成用户点到别处 */
  private rendering = false

  constructor(private view: EditorView, private widget: TableWidget) {
    this.model = widget.model
    this.anchor = { row: this.model.rows.length > 1 ? 1 : 0, col: 0 }
    this.cursor = { ...this.anchor }
    controllers.set(this.wrap, this)
    this.scroller.tabIndex = -1
    this.scroller.setAttribute('role', 'region')
    this.scroller.setAttribute('aria-label', '可编辑 Markdown 表格')
    const actions: Array<[string, string, string]> = [
      ['insert-row', '＋行', '在下方插入行'],
      ['insert-col', '＋列', '在右侧插入列'],
      ['delete-row', '－行', '删除当前行'],
      ['delete-col', '－列', '删除当前列'],
      ['align', '对齐', '切换列对齐'],
      ['copy-grid', '复制', '复制所选网格'],
      ['copy-markdown', 'MD', '复制 Markdown 表格'],
      ['source', '源码', '编辑 Markdown 源码'],
    ]
    for (const [action, label, title] of actions) this.toolbar.appendChild(button('', label, title, action))
    const addRow = button('cm-table-add-row', '＋', '在末尾添加一行', 'append-row')
    const addCol = button('cm-table-add-col', '＋', '在末尾添加一列', 'append-col')
    this.wrap.append(this.toolbar, this.scroller, addRow, addCol, this.status)
    this.bind()

    const pending = focusRequests.get(view)
    if (pending?.from === widget.from) {
      focusRequests.delete(view)
      // toDOM 时元素尚未挂到文档，下一帧再聚焦
      this.apply(pending, true)
    } else this.render()
  }

  update(widget: TableWidget, view: EditorView) {
    this.view = view
    this.widget = widget
    this.model = widget.model
    const pending = focusRequests.get(view)
    if (pending?.from === widget.from) {
      focusRequests.delete(view)
      this.apply(pending, false)
      return
    }
    // 外部变化（撤销、其他视图同步）：保留正在编辑的草稿、光标与焦点
    const input = this.input()
    const active = document.activeElement
    const typing = !!input && active === input
    const inCell = !typing && !!active?.matches('div.cm-table-cell') && this.wrap.contains(active)
    const sel = input ? [input.selectionStart, input.selectionEnd] : null
    this.anchor = this.clamp(this.anchor)
    this.cursor = this.clamp(this.cursor)
    if (this.editing) this.editing = this.clamp(this.editing)
    this.render()
    const next = this.input()
    if (typing && next && sel) {
      next.focus({ preventScroll: true })
      next.setSelectionRange(sel[0], sel[1])
    } else if (inCell) this.focusCell(this.cursor)
  }

  get from() {
    return this.widget.from
  }

  enter(edge?: 'first' | 'last') {
    if (edge === 'first') this.select({ row: 0, col: 0 })
    else if (edge === 'last') this.select({ row: this.model.rows.length - 1, col: 0 })
    else this.select(this.cursor)
  }

  detach() {
    this.closeMenu()
    this.endPress()
  }

  // ---------- 状态 ----------

  private get columns() {
    return this.model.rows[0]?.length ?? 1
  }

  private clamp(pos: CellPos): CellPos {
    return {
      row: Math.max(0, Math.min(this.model.rows.length - 1, pos.row)),
      col: Math.max(0, Math.min(this.columns - 1, pos.col)),
    }
  }

  private selected() {
    return {
      top: Math.min(this.anchor.row, this.cursor.row),
      bottom: Math.max(this.anchor.row, this.cursor.row),
      left: Math.min(this.anchor.col, this.cursor.col),
      right: Math.max(this.anchor.col, this.cursor.col),
    }
  }

  private inSelection(row: number, col: number) {
    const s = this.selected()
    return row >= s.top && row <= s.bottom && col >= s.left && col <= s.right
  }

  private input() {
    return this.wrap.querySelector<HTMLTextAreaElement>('textarea.cm-table-editor')
  }

  /** 当前模型（含正在编辑的草稿） */
  private current() {
    return this.editing ? updateCell(this.model, this.editing.row, this.editing.col, this.draft) : this.model
  }

  private posOf(target: Element | null): CellPos | null {
    const cell = target?.closest<HTMLElement>('td[data-col],th[data-col]')
    const row = cell?.closest<HTMLElement>('tr[data-row]')
    if (!cell || !row || !this.wrap.contains(cell)) return null
    return { row: Number(row.dataset.row), col: Number(cell.dataset.col) }
  }

  private setStatus(text: string) {
    this.status.textContent = text
    window.setTimeout(() => {
      if (this.status.textContent === text) this.status.textContent = ''
    }, 1600)
  }

  // ---------- 渲染 ----------

  private makeCell(row: number, col: number): HTMLElement {
    const raw = this.model.rows[row][col]
    if (this.editing && samePos(this.editing, { row, col })) {
      // 编辑框覆盖在单元格上，隐藏的同字号文本撑开尺寸：进入编辑时列宽不跳动，输入时自然增高
      const box = el('div', 'cm-table-cell is-editing')
      // 保持进入编辑前的格宽，列宽不会因为改为可换行的编辑框而收缩
      if (this.editWidth) box.style.minWidth = this.editWidth + 'px'
      const sizer = el('span', 'cm-table-sizer', this.draft + '​')
      sizer.setAttribute('aria-hidden', 'true')
      const input = el('textarea', 'cm-table-editor')
      input.dataset.cell = `${row}:${col}`
      input.value = this.draft
      input.rows = 1
      input.spellcheck = false
      input.setAttribute('aria-label', `编辑第 ${row + 1} 行第 ${col + 1} 列`)
      box.append(sizer, input)
      return box
    }
    const cell = el('div', 'cm-table-cell' + (isShort(raw) ? ' is-short' : ''))
    cell.dataset.cell = `${row}:${col}`
    cell.tabIndex = -1
    cell.setAttribute('role', 'gridcell')
    cell.setAttribute('aria-label', `第 ${row + 1} 行第 ${col + 1} 列`)
    const value = el('span', 'cm-table-value')
    if (raw) value.innerHTML = renderInline(raw.replace(/\n/g, '<br>'))
    else value.classList.add('is-empty')
    cell.appendChild(value)
    return cell
  }

  private render() {
    const table = el('table')
    table.setAttribute('role', 'grid')
    const thead = el('thead')
    const headRow = el('tr')
    headRow.dataset.row = '0'
    const corner = el('th', 'cm-table-gutter')
    corner.setAttribute('aria-hidden', 'true')
    headRow.appendChild(corner)
    this.model.rows[0].forEach((_, col) => {
      const th = el('th')
      th.dataset.col = String(col)
      th.style.textAlign = this.model.aligns[col]
      const grip = button('cm-table-col-handle', '•••', '拖动调整列顺序，点击打开列菜单')
      grip.dataset.colHandle = String(col)
      grip.draggable = true
      grip.tabIndex = -1
      th.append(grip, this.makeCell(0, col))
      headRow.appendChild(th)
    })
    thead.appendChild(headRow)
    const tbody = el('tbody')
    for (let row = 1; row < this.model.rows.length; row++) {
      const tr = el('tr')
      tr.dataset.row = String(row)
      const gutter = el('td', 'cm-table-gutter')
      const grip = button('cm-table-row-handle', '⋮⋮', '拖动调整行顺序，点击打开行菜单')
      grip.dataset.rowHandle = String(row)
      grip.draggable = true
      grip.tabIndex = -1
      gutter.appendChild(grip)
      tr.appendChild(gutter)
      this.model.rows[row].forEach((_, col) => {
        const td = el('td')
        td.dataset.col = String(col)
        td.style.textAlign = this.model.aligns[col]
        td.appendChild(this.makeCell(row, col))
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }
    table.append(thead, tbody)
    this.rendering = true
    try {
      this.scroller.replaceChildren(table)
    } finally {
      this.rendering = false
    }
    this.paint()
  }

  /** 只更新选区样式，不重建表格 */
  private paint() {
    const multi = !samePos(this.anchor, this.cursor)
    this.wrap.classList.toggle('has-range', multi)
    this.wrap.querySelectorAll<HTMLElement>('div.cm-table-cell[data-cell]').forEach((cell) => {
      const [row, col] = cell.dataset.cell!.split(':').map(Number)
      const sel = this.inSelection(row, col)
      const isCursor = row === this.cursor.row && col === this.cursor.col
      cell.classList.toggle('is-selected', sel)
      cell.classList.toggle('is-cursor', isCursor)
      cell.setAttribute('aria-selected', String(sel))
      // 漫游 tabindex：只有当前格可以 Tab 进入，Tab 不会逐格穿过整张表
      cell.tabIndex = isCursor ? 0 : -1
    })
    const deleteRowButton = this.toolbar.querySelector<HTMLButtonElement>('[data-action="delete-row"]')
    const deleteColButton = this.toolbar.querySelector<HTMLButtonElement>('[data-action="delete-col"]')
    if (deleteRowButton) deleteRowButton.disabled = this.cursor.row === 0 || this.model.rows.length <= 1
    if (deleteColButton) deleteColButton.disabled = this.columns <= 1
  }

  // ---------- 焦点与编辑 ----------

  private focusCell(pos: CellPos) {
    const target = this.wrap.querySelector<HTMLElement>(`div.cm-table-cell[data-cell="${pos.row}:${pos.col}"]`)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private focusInput(caret: Caret) {
    const input = this.input()
    if (!input) return
    input.focus({ preventScroll: true })
    const at = caret === 'end' ? input.value.length : Math.max(0, Math.min(input.value.length, caret))
    input.setSelectionRange(at, at)
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  /** 记下即将进入编辑的格子当前宽度 */
  private keepWidth(pos: CellPos) {
    this.editWidth = this.wrap.querySelector<HTMLElement>(`div.cm-table-cell[data-cell="${pos.row}:${pos.col}"]`)?.offsetWidth ?? 0
  }

  private startEdit(pos: CellPos, caret: Caret = 'end') {
    this.closeMenu()
    this.keepWidth(this.clamp(pos))
    this.editing = this.clamp(pos)
    this.draft = this.model.rows[this.editing.row][this.editing.col]
    this.anchor = { ...this.editing }
    this.cursor = { ...this.editing }
    this.render()
    this.focusInput(caret)
  }

  private select(pos: CellPos, extend = false) {
    this.cursor = this.clamp(pos)
    if (!extend) this.anchor = { ...this.cursor }
    this.paint()
    this.focusCell(this.cursor)
  }

  /** 根据请求恢复选区 / 编辑；deferred 表示元素尚未挂载，需等下一帧 */
  private apply(req: FocusRequest, deferred: boolean) {
    this.anchor = this.clamp(req.anchor)
    this.cursor = this.clamp(req.cursor)
    this.editing = null
    if (req.edit) {
      this.keepWidth(this.cursor)
      this.editing = { ...this.cursor }
      this.draft = this.model.rows[this.cursor.row][this.cursor.col]
    }
    this.render()
    if (req.focus === false) return
    const seq = ++this.focusSeq
    const run = () => {
      if (seq !== this.focusSeq) return
      if (this.editing) this.focusInput(req.caret ?? 'end')
      else this.focusCell(this.cursor)
    }
    if (deferred) requestAnimationFrame(run)
    else run()
  }

  private commit(next: TableModel, req: Omit<FocusRequest, 'from'>) {
    this.editing = null
    if (sameModel(next, this.widget.model)) {
      this.model = this.widget.model
      this.apply({ ...req, from: this.widget.from }, false)
      return
    }
    focusRequests.set(this.view, { ...req, from: this.widget.from })
    const specs: ChangeSpec[] = []
    diffChanges(this.widget.source, serializeTable(next)).iterChanges((from, to, _nextFrom, _nextTo, insert) => {
      specs.push({ from: from + this.widget.from, to: to + this.widget.from, insert })
    })
    this.view.dispatch({ changes: specs, userEvent: 'input.table' })
  }

  /** 提交草稿后移到另一格；edit 为 true 时继续编辑 */
  private commitTo(pos: CellPos, edit: boolean, caret: Caret = 'end') {
    const target = this.clamp(pos)
    this.commit(this.current(), { anchor: target, cursor: target, edit, caret })
  }

  private operate(fn: (base: TableModel) => TableModel, pos: CellPos = this.cursor, edit = false) {
    this.closeMenu()
    this.commit(fn(this.current()), { anchor: pos, cursor: pos, edit })
  }

  private nextCell(pos: CellPos, direction: -1 | 1): CellPos | null {
    const index = pos.row * this.columns + pos.col + direction
    if (index < 0 || index >= this.model.rows.length * this.columns) return null
    return { row: Math.floor(index / this.columns), col: index % this.columns }
  }

  /** 方向键移出表格：光标回到正文的上一行 / 下一行 */
  private leave(dir: 'up' | 'down') {
    this.closeMenu()
    const doc = this.view.state.doc
    const from = this.widget.from
    const to = from + this.widget.source.length
    const pos = dir === 'up' ? (from > 0 ? from - 1 : null) : to < doc.length ? to + 1 : null
    if (pos === null) return false
    this.view.focus()
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    return true
  }

  private editSource() {
    this.closeMenu()
    this.view.focus()
    this.view.dispatch({ selection: { anchor: this.widget.from }, scrollIntoView: true })
  }

  private deleteTable() {
    this.closeMenu()
    const doc = this.view.state.doc
    const from = this.widget.from
    const to = Math.min(doc.length, from + this.widget.source.length + 1)
    this.view.focus()
    this.view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: 'delete.table' })
  }

  private copyGrid() {
    const s = this.selected()
    const model = this.current()
    const rows = model.rows.slice(s.top, s.bottom + 1).map((r) => r.slice(s.left, s.right + 1))
    void copyText(toTsv(rows)).then((ok) => this.setStatus(ok ? '已复制网格' : '复制失败，请重试'))
  }

  private copyMarkdown() {
    void copyText(serializeTable(this.current())).then((ok) => this.setStatus(ok ? '已复制 Markdown 表格' : '复制失败，请重试'))
  }

  // ---------- 菜单 ----------

  private closeMenu() {
    if (!this.menu) return
    this.menu.remove()
    this.menu = null
    window.removeEventListener('mousedown', this.onOutside, true)
  }

  private onOutside = (event: MouseEvent) => {
    if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu()
  }

  private openMenu(items: Array<MenuItem | null>, x: number, y: number) {
    this.closeMenu()
    const menu = el('div', 'cm-table-menu')
    menu.setAttribute('role', 'menu')
    for (const item of items) {
      if (!item) {
        menu.appendChild(el('div', 'cm-table-menu-sep'))
        continue
      }
      const b = button('cm-table-menu-item' + (item.danger ? ' is-danger' : ''), item.label, item.label)
      b.setAttribute('role', 'menuitem')
      b.disabled = !!item.disabled
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.closeMenu()
        item.run()
      })
      menu.appendChild(b)
    }
    this.wrap.appendChild(menu)
    const wr = this.wrap.getBoundingClientRect()
    const left = Math.max(0, Math.min(x - wr.left, wr.width - menu.offsetWidth))
    // 下方放不下时向上展开
    const top = y + menu.offsetHeight > innerHeight - 8 ? Math.max(8, y - menu.offsetHeight - 6) : y
    menu.style.left = left + 'px'
    menu.style.top = top - wr.top + 'px'
    this.menu = menu
    window.addEventListener('mousedown', this.onOutside, true)
  }

  private rowItems(row: number): Array<MenuItem | null> {
    const body = row > 0
    const last = this.model.rows.length - 1
    return [
      { label: '在上方插入行', disabled: !body, run: () => this.operate((b) => insertRow(b, row), { row, col: this.cursor.col }) },
      { label: '在下方插入行', run: () => this.operate((b) => insertRow(b, row + 1), { row: row + 1, col: this.cursor.col }) },
      null,
      { label: '上移', disabled: row <= 1, run: () => this.operate((b) => moveRow(b, row, row - 1), { row: row - 1, col: this.cursor.col }) },
      { label: '下移', disabled: !body || row >= last, run: () => this.operate((b) => moveRow(b, row, row + 1), { row: row + 1, col: this.cursor.col }) },
      null,
      { label: '删除行', danger: true, disabled: !body || this.model.rows.length <= 1, run: () => this.deleteRowAt(row) },
    ]
  }

  private deleteRowAt(row: number) {
    const last = this.model.rows.length - 1
    this.operate((b) => deleteRow(b, row), { row: Math.max(Math.min(row, last - 1), last > 1 ? 1 : 0), col: this.cursor.col })
  }

  private deleteColAt(col: number) {
    this.operate((b) => deleteColumn(b, col), { row: this.cursor.row, col: Math.max(0, Math.min(col, this.columns - 2)) })
  }

  private colItems(col: number): Array<MenuItem | null> {
    const align = this.model.aligns[col]
    const setTo = (a: TableAlign) => () => this.operate((b) => setAlign(b, col, a), { row: this.cursor.row, col })
    return [
      { label: '在左侧插入列', run: () => this.operate((b) => insertColumn(b, col), { row: this.cursor.row, col }) },
      { label: '在右侧插入列', run: () => this.operate((b) => insertColumn(b, col + 1), { row: this.cursor.row, col: col + 1 }) },
      null,
      { label: '左移', disabled: col <= 0, run: () => this.operate((b) => moveColumn(b, col, col - 1), { row: this.cursor.row, col: col - 1 }) },
      { label: '右移', disabled: col >= this.columns - 1, run: () => this.operate((b) => moveColumn(b, col, col + 1), { row: this.cursor.row, col: col + 1 }) },
      null,
      { label: (align === 'left' ? '✓ ' : '') + '左对齐', run: setTo('left') },
      { label: (align === 'center' ? '✓ ' : '') + '居中', run: setTo('center') },
      { label: (align === 'right' ? '✓ ' : '') + '右对齐', run: setTo('right') },
      null,
      { label: '删除列', danger: true, disabled: this.columns <= 1, run: () => this.deleteColAt(col) },
    ]
  }

  private cellItems(pos: CellPos): Array<MenuItem | null> {
    const multi = !samePos(this.anchor, this.cursor)
    return [
      { label: '编辑单元格', run: () => this.startEdit(pos) },
      { label: multi ? '复制所选单元格' : '复制单元格', run: () => this.copyGrid() },
      { label: multi ? '清空所选单元格' : '清空单元格', run: () => this.clearSelection() },
      null,
      { label: '在上方插入行', disabled: pos.row === 0, run: () => this.operate((b) => insertRow(b, pos.row), pos) },
      { label: '在下方插入行', run: () => this.operate((b) => insertRow(b, pos.row + 1), { row: pos.row + 1, col: pos.col }) },
      { label: '在左侧插入列', run: () => this.operate((b) => insertColumn(b, pos.col), pos) },
      { label: '在右侧插入列', run: () => this.operate((b) => insertColumn(b, pos.col + 1), { row: pos.row, col: pos.col + 1 }) },
      null,
      { label: '删除行', danger: true, disabled: pos.row === 0, run: () => this.deleteRowAt(pos.row) },
      { label: '删除列', danger: true, disabled: this.columns <= 1, run: () => this.deleteColAt(pos.col) },
      null,
      { label: '复制为 Markdown', run: () => this.copyMarkdown() },
      { label: '编辑 Markdown 源码', run: () => this.editSource() },
      { label: '删除表格', danger: true, run: () => this.deleteTable() },
    ]
  }

  private clearSelection() {
    const s = this.selected()
    const grid = Array.from({ length: s.bottom - s.top + 1 }, () => Array.from({ length: s.right - s.left + 1 }, () => ''))
    this.operate((b) => pasteGrid(b, s.top, s.left, grid), { row: s.top, col: s.left })
  }

  // ---------- 鼠标选区 ----------

  private onMove = (event: MouseEvent) => {
    if (!this.press) return
    const pos = this.posOf(document.elementFromPoint(event.clientX, event.clientY))
    if (!pos) return
    if (!this.press.moved && samePos(pos, this.press.pos)) return
    this.press.moved = true
    this.anchor = { ...this.press.pos }
    this.cursor = pos
    this.paint()
  }

  private onUp = () => {
    const press = this.press
    this.endPress()
    if (!press) return
    if (press.moved || press.shift) this.focusCell(this.cursor)
    else this.startEdit(press.pos, press.caret)
  }

  private endPress() {
    this.press = null
    window.removeEventListener('mousemove', this.onMove)
    window.removeEventListener('mouseup', this.onUp)
  }

  // ---------- 事件 ----------

  private bind() {
    const w = this.wrap
    w.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement
      if (target.closest('textarea')) return
      if (target.closest('.cm-table-menu')) return event.preventDefault()
      if (target.closest('[draggable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && target.closest('a')) return
      // 按钮与单元格都不抢走焦点，也不让 CodeMirror 处理
      event.preventDefault()
      if (event.button !== 0) return
      const pos = this.posOf(target)
      if (!pos || !target.closest('div.cm-table-cell[data-cell]')) return
      const cell = target.closest<HTMLElement>('div.cm-table-cell')!
      const caret = caretFromPoint(cell, event.clientX, event.clientY, this.model.rows[pos.row][pos.col])
      if (this.editing) {
        // 先提交正在编辑的格子；表格原地更新，不打断这次按下
        this.commit(this.current(), { anchor: pos, cursor: pos, edit: false, focus: false })
      }
      if (event.shiftKey) {
        this.cursor = pos
        this.paint()
      } else {
        this.anchor = { ...pos }
        this.cursor = { ...pos }
        this.paint()
      }
      this.press = { pos, caret, moved: false, shift: event.shiftKey }
      window.addEventListener('mousemove', this.onMove)
      window.addEventListener('mouseup', this.onUp)
    })

    w.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.closest<HTMLButtonElement>('[data-action]')
      if (action) return this.runAction(action.dataset.action!)
      const rowHandle = target.closest<HTMLElement>('[data-row-handle]')
      const colHandle = target.closest<HTMLElement>('[data-col-handle]')
      if (rowHandle || colHandle) {
        const r = (rowHandle ?? colHandle)!.getBoundingClientRect()
        if (rowHandle) {
          const row = Number(rowHandle.dataset.rowHandle)
          this.select({ row, col: this.cursor.col })
          this.openMenu(this.rowItems(row), r.left, r.bottom + 4)
        } else {
          const col = Number(colHandle!.dataset.colHandle)
          this.select({ row: this.cursor.row, col })
          this.openMenu(this.colItems(col), r.left, r.bottom + 4)
        }
        return
      }
      const link = target.closest('a')
      if (link && !(event.ctrlKey || event.metaKey)) event.preventDefault()
    })

    w.addEventListener('contextmenu', (event) => {
      const target = event.target as HTMLElement
      if (target.closest('textarea')) return
      const pos = this.posOf(target)
      if (!pos) return
      event.preventDefault()
      if (this.editing) this.commit(this.current(), { anchor: pos, cursor: pos, edit: false })
      else if (!this.inSelection(pos.row, pos.col)) this.select(pos)
      else this.focusCell(this.cursor)
      this.openMenu(this.cellItems(pos), event.clientX, event.clientY + 2)
    })

    w.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return
      const target = event.target as HTMLElement
      if (this.menu && event.key === 'Escape') {
        event.preventDefault()
        this.closeMenu()
        return
      }
      if (target.matches('textarea.cm-table-editor')) return this.onEditKey(event, target as HTMLTextAreaElement)
      if (target.matches('div.cm-table-cell[data-cell]')) this.onCellKey(event)
    })

    w.addEventListener('input', (event) => {
      const input = event.target
      if (!(input instanceof HTMLTextAreaElement) || !this.editing) return
      this.draft = input.value
      const sizer = input.previousElementSibling
      if (sizer) sizer.textContent = input.value + '​'
    })

    w.addEventListener('focusout', (event) => {
      if (this.rendering || !this.editing || !(event.target instanceof HTMLTextAreaElement)) return
      const next = event.relatedTarget as Node | null
      if (next && w.contains(next)) return
      // 点到表格外：提交但不把焦点抢回来
      this.commit(this.current(), { anchor: this.editing, cursor: this.editing, edit: false, focus: false })
    })

    w.addEventListener('copy', (event) => {
      if ((event.target as HTMLElement).matches('textarea')) return
      const s = this.selected()
      const model = this.current()
      const rows = model.rows.slice(s.top, s.bottom + 1).map((r) => r.slice(s.left, s.right + 1))
      event.clipboardData?.setData('text/plain', toTsv(rows))
      event.preventDefault()
      this.setStatus('已复制网格')
    })

    w.addEventListener('cut', (event) => {
      if ((event.target as HTMLElement).matches('textarea')) return
      const s = this.selected()
      const rows = this.model.rows.slice(s.top, s.bottom + 1).map((r) => r.slice(s.left, s.right + 1))
      event.clipboardData?.setData('text/plain', toTsv(rows))
      event.preventDefault()
      this.clearSelection()
    })

    w.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return
      const isInput = (event.target as HTMLElement).matches('textarea')
      if (isInput && !/[\t\r\n]/.test(text)) return
      event.preventDefault()
      const grid = parseTsv(text)
      const at = this.editing ?? { row: this.selected().top, col: this.selected().left }
      this.operate((b) => pasteGrid(b, at.row, at.col, grid), at)
    })

    w.addEventListener('dragstart', (event) => {
      const target = event.target as HTMLElement
      const row = target.closest<HTMLElement>('[data-row-handle]')
      const col = target.closest<HTMLElement>('[data-col-handle]')
      this.closeMenu()
      this.drag = row ? { kind: 'row', index: Number(row.dataset.rowHandle) } : col ? { kind: 'col', index: Number(col.dataset.colHandle) } : null
      if (this.drag && event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', this.drag.kind + ':' + this.drag.index)
        w.classList.add('is-dragging-' + this.drag.kind)
      }
    })
    const clearDrop = () => w.querySelectorAll('.is-table-drop-target').forEach((x) => x.classList.remove('is-table-drop-target', 'is-drop-after'))
    const dropTarget = (target: HTMLElement) => {
      if (!this.drag) return null
      if (this.drag.kind === 'row') {
        const tr = target.closest<HTMLElement>('tbody tr[data-row]')
        return tr ? { el: tr, index: Number(tr.dataset.row) } : null
      }
      const cell = target.closest<HTMLElement>('[data-col]')
      return cell ? { el: cell, index: Number(cell.dataset.col) } : null
    }
    w.addEventListener('dragover', (event) => {
      const t = dropTarget(event.target as HTMLElement)
      if (!t || !this.drag) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      clearDrop()
      // 拖到哪一行 / 列就放到那里：标出插入线所在的一侧
      const after = t.index > this.drag.index
      if (this.drag.kind === 'row') {
        t.el.classList.add('is-table-drop-target')
        t.el.classList.toggle('is-drop-after', after)
      } else {
        w.querySelectorAll<HTMLElement>(`[data-col="${t.index}"]`).forEach((c) => {
          c.classList.add('is-table-drop-target')
          c.classList.toggle('is-drop-after', after)
        })
      }
    })
    w.addEventListener('dragleave', (event) => {
      if (!w.contains(event.relatedTarget as Node | null)) clearDrop()
    })
    w.addEventListener('drop', (event) => {
      const t = dropTarget(event.target as HTMLElement)
      const drag = this.drag
      this.drag = null
      clearDrop()
      if (!t || !drag) return
      event.preventDefault()
      if (drag.kind === 'row') this.operate((b) => moveRow(b, drag.index, t.index), { row: t.index, col: this.cursor.col })
      else this.operate((b) => moveColumn(b, drag.index, t.index), { row: this.cursor.row, col: t.index })
    })
    w.addEventListener('dragend', () => {
      this.drag = null
      clearDrop()
      w.classList.remove('is-dragging-row', 'is-dragging-col')
    })
  }

  private runAction(action: string) {
    const pos = { ...this.cursor }
    switch (action) {
      case 'insert-row': {
        const row = Math.min(this.model.rows.length, pos.row + 1)
        return this.operate((b) => insertRow(b, row), { row, col: pos.col })
      }
      case 'insert-col':
        return this.operate((b) => insertColumn(b, pos.col + 1), { row: pos.row, col: pos.col + 1 })
      case 'delete-row':
        return this.operate((b) => deleteRow(b, pos.row), { row: Math.max(pos.row > 0 ? 1 : 0, pos.row - 1), col: pos.col })
      case 'delete-col':
        return this.operate((b) => deleteColumn(b, pos.col), { row: pos.row, col: Math.max(0, pos.col - 1) })
      case 'align':
        return this.operate((b) => setAlign(b, pos.col, nextAlignment[b.aligns[pos.col]]))
      case 'copy-grid':
        return this.copyGrid()
      case 'copy-markdown':
        return this.copyMarkdown()
      case 'source':
        return this.editSource()
      case 'append-row': {
        const row = this.model.rows.length
        return this.operate((b) => insertRow(b, row), { row, col: 0 }, true)
      }
      case 'append-col': {
        const col = this.columns
        return this.operate((b) => insertColumn(b, col), { row: 0, col }, true)
      }
    }
  }

  private onEditKey(event: KeyboardEvent, input: HTMLTextAreaElement) {
    const pos = this.editing
    if (!pos) return
    const mod = event.ctrlKey || event.metaKey
    const lastRow = pos.row === this.model.rows.length - 1
    const key = event.key.toLowerCase()
    if (mod && (key === 'z' || key === 'y') && this.draft === this.model.rows[pos.row][pos.col]) {
      // 本格没有改动时，撤销 / 重做作用于整篇文档（例如撤回上一格的提交）
      event.preventDefault()
      event.stopPropagation()
      this.editing = null
      this.render()
      this.focusCell(pos)
      if (key === 'y' || event.shiftKey) useDoc.getState().redo()
      else useDoc.getState().undo()
    } else if (event.key === 'Escape') {
      // 放弃本格修改
      event.preventDefault()
      this.editing = null
      this.render()
      this.focusCell(pos)
    } else if (event.key === 'Enter' && mod) {
      event.preventDefault()
      const row = pos.row + 1
      this.commit(insertRow(this.current(), row), { anchor: { row, col: pos.col }, cursor: { row, col: pos.col }, edit: true })
    } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      // Enter 提交并编辑下一行同一列；最后一行则退出编辑；Shift+Enter 换行
      event.preventDefault()
      if (lastRow) this.commitTo(pos, false)
      else this.commitTo({ row: pos.row + 1, col: pos.col }, true)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const next = this.nextCell(pos, event.shiftKey ? -1 : 1)
      if (next) this.commitTo(next, true)
      else if (!event.shiftKey) {
        // 最后一格再按 Tab：新增一行
        const row = this.model.rows.length
        this.commit(insertRow(this.current(), row), { anchor: { row, col: 0 }, cursor: { row, col: 0 }, edit: true })
      }
    } else if (ARROWS.includes(event.key) && !event.shiftKey && !mod && !event.altKey) {
      if (input.selectionStart !== input.selectionEnd) return
      const at = input.selectionStart
      const value = input.value
      let target: CellPos | null = null
      let caret: Caret = 'end'
      if (event.key === 'ArrowLeft' && at === 0) target = this.nextCell(pos, -1)
      else if (event.key === 'ArrowRight' && at === value.length) {
        target = this.nextCell(pos, 1)
        caret = 0
      } else if (event.key === 'ArrowUp' && !value.slice(0, at).includes('\n')) target = pos.row > 0 ? { row: pos.row - 1, col: pos.col } : null
      else if (event.key === 'ArrowDown' && !value.slice(at).includes('\n')) target = lastRow ? null : { row: pos.row + 1, col: pos.col }
      if (!target) return
      event.preventDefault()
      this.commitTo(target, true, caret)
    }
  }

  private onCellKey(event: KeyboardEvent) {
    const pos = { ...this.cursor }
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'Enter' && mod) {
      event.preventDefault()
      this.operate((b) => insertRow(b, pos.row + 1), { row: pos.row + 1, col: pos.col }, true)
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      this.startEdit(pos)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const next = this.nextCell(pos, event.shiftKey ? -1 : 1)
      if (next) this.select(next)
    } else if (ARROWS.includes(event.key) && !mod) {
      event.preventDefault()
      const row = pos.row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
      const col = pos.col + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)
      if (!event.shiftKey && (row < 0 || row >= this.model.rows.length) && this.leave(row < 0 ? 'up' : 'down')) return
      this.select({ row, col }, event.shiftKey)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (!samePos(this.anchor, this.cursor)) this.select(this.cursor)
      else this.leave('down') || this.leave('up')
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      this.anchor = { row: 0, col: 0 }
      this.cursor = { row: this.model.rows.length - 1, col: this.columns - 1 }
      this.paint()
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && !mod) {
      event.preventDefault()
      this.clearSelection()
    }
  }
}

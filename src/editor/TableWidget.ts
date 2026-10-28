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
import { renderInline } from './inline'

interface CellPos {
  row: number
  col: number
}

interface FocusRequest {
  from: number
  anchor: CellPos
  cursor: CellPos
  edit: boolean
}

const focusRequests = new WeakMap<EditorView, FocusRequest>()
const samePos = (a: CellPos, b: CellPos) => a.row === b.row && a.col === b.col
const nextAlignment: Record<TableAlign, TableAlign> = { '': 'left', left: 'center', center: 'right', right: '' }

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
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table'
    const toolbar = document.createElement('div')
    toolbar.className = 'cm-table-toolbar'
    const status = document.createElement('span')
    status.className = 'cm-table-status'
    const scroller = document.createElement('div')
    scroller.className = 'cm-table-scroll'
    scroller.tabIndex = 0
    scroller.setAttribute('role', 'region')
    scroller.setAttribute('aria-label', '可编辑 Markdown 表格')
    wrap.append(toolbar, scroller, status)

    let model = this.model
    let anchor: CellPos = { row: model.rows.length > 1 ? 1 : 0, col: 0 }
    let cursor = { ...anchor }
    let editing: CellPos | null = null
    let drag: { kind: 'row' | 'col'; index: number } | null = null

    const actions: Array<[string, string, string]> = [
      ['insert-row', '＋行', '在下方插入行'],
      ['insert-col', '＋列', '在右侧插入列'],
      ['delete-row', '－行', '删除当前行'],
      ['delete-col', '－列', '删除当前列'],
      ['align', '对齐', '切换列对齐'],
      ['copy-grid', '复制', '复制所选网格'],
      ['copy-markdown', 'MD', '复制 Markdown 表格'],
    ]
    for (const [action, label, title] of actions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.action = action
      button.title = title
      button.textContent = label
      toolbar.appendChild(button)
    }

    const selected = () => ({
      top: Math.min(anchor.row, cursor.row),
      bottom: Math.max(anchor.row, cursor.row),
      left: Math.min(anchor.col, cursor.col),
      right: Math.max(anchor.col, cursor.col),
    })
    const inSelection = (row: number, col: number) => {
      const s = selected()
      return row >= s.top && row <= s.bottom && col >= s.left && col <= s.right
    }
    const currentModel = () => {
      if (!editing) return model
      const input = wrap.querySelector<HTMLTextAreaElement>('textarea.cm-table-editor')
      return input ? updateCell(model, editing.row, editing.col, input.value) : model
    }
    const setStatus = (text: string) => {
      status.textContent = text
      if (text) window.setTimeout(() => { if (status.textContent === text) status.textContent = '' }, 1600)
    }
    const clampPos = (pos: CellPos): CellPos => ({
      row: Math.max(0, Math.min(model.rows.length - 1, pos.row)),
      col: Math.max(0, Math.min(model.rows[0].length - 1, pos.col)),
    })
    const autoSize = (input: HTMLTextAreaElement) => {
      input.style.height = 'auto'
      input.style.height = Math.max(30, input.scrollHeight) + 'px'
    }

    let render: () => void
    const focusOnly = (pos: CellPos) => {
      const target = wrap.querySelector<HTMLElement>(`.cm-table-cell[data-cell="${pos.row}:${pos.col}"]`)
      target?.focus({ preventScroll: true })
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    const startEdit = (pos: CellPos) => {
      editing = pos
      anchor = { ...pos }
      cursor = { ...pos }
      render()
      const input = wrap.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${pos.row}:${pos.col}"]`)
      if (input) {
        input.focus({ preventScroll: true })
        input.setSelectionRange(input.value.length, input.value.length)
        autoSize(input)
      }
    }
    const applyFocus = (request: FocusRequest) => {
      anchor = clampPos(request.anchor)
      cursor = clampPos(request.cursor)
      editing = null
      render()
      requestAnimationFrame(() => request.edit ? startEdit(cursor) : focusOnly(cursor))
    }
    const commit = (next: TableModel, request?: Partial<FocusRequest>) => {
      const req: FocusRequest = {
        from: this.from,
        anchor: request?.anchor ?? cursor,
        cursor: request?.cursor ?? cursor,
        edit: request?.edit ?? false,
      }
      editing = null
      const unchanged = JSON.stringify(next) === JSON.stringify(this.model)
      if (unchanged) {
        model = this.model
        applyFocus(req)
        return
      }
      focusRequests.set(view, req)
      const specs: ChangeSpec[] = []
      diffChanges(this.source, serializeTable(next)).iterChanges((from, to, _nextFrom, _nextTo, insert) => {
        specs.push({ from: from + this.from, to: to + this.from, insert })
      })
      view.dispatch({ changes: specs, userEvent: 'input.table' })
    }
    const operate = (fn: (base: TableModel) => TableModel, nextPos = cursor) => {
      const next = fn(currentModel())
      commit(next, { anchor: nextPos, cursor: nextPos })
    }

    const makeCell = (row: number, col: number): HTMLElement => {
      const pos = { row, col }
      if (editing && samePos(editing, pos)) {
        const input = document.createElement('textarea')
        input.className = 'cm-table-cell cm-table-editor'
        input.dataset.cell = `${row}:${col}`
        input.value = model.rows[row][col]
        input.rows = Math.max(1, input.value.split('\n').length)
        input.setAttribute('aria-label', `编辑第 ${row + 1} 行第 ${col + 1} 列`)
        return input
      }
      const cell = document.createElement('div')
      cell.className = 'cm-table-cell' + (inSelection(row, col) ? ' is-selected' : '')
      cell.dataset.cell = `${row}:${col}`
      cell.tabIndex = 0
      cell.setAttribute('aria-label', `第 ${row + 1} 行第 ${col + 1} 列`)
      cell.setAttribute('aria-selected', String(inSelection(row, col)))
      const value = document.createElement('span')
      value.className = 'cm-table-value'
      value.innerHTML = renderInline(model.rows[row][col].replace(/\n/g, '<br>'))
      if (!model.rows[row][col]) {
        value.classList.add('is-empty')
        value.textContent = ' '
      }
      cell.appendChild(value)
      return cell
    }

    const renderTable = () => {
      const table = document.createElement('table')
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      headRow.dataset.row = '0'
      const corner = document.createElement('th')
      corner.className = 'cm-table-gutter'
      corner.setAttribute('aria-label', '行列操作')
      headRow.appendChild(corner)
      model.rows[0].forEach((_, col) => {
        const th = document.createElement('th')
        th.dataset.col = String(col)
        th.style.textAlign = model.aligns[col]
        const grip = document.createElement('button')
        grip.type = 'button'
        grip.className = 'cm-table-col-handle'
        grip.dataset.colHandle = String(col)
        grip.draggable = true
        grip.title = '拖动列'
        grip.textContent = '⋮⋮'
        grip.setAttribute('aria-label', `拖动第 ${col + 1} 列`)
        th.append(grip, makeCell(0, col))
        headRow.appendChild(th)
      })
      thead.appendChild(headRow)
      table.appendChild(thead)
      const tbody = document.createElement('tbody')
      model.rows.slice(1).forEach((_, index) => {
        const row = index + 1
        const tr = document.createElement('tr')
        tr.dataset.row = String(row)
        const gutter = document.createElement('td')
        gutter.className = 'cm-table-gutter'
        const grip = document.createElement('button')
        grip.type = 'button'
        grip.className = 'cm-table-row-handle'
        grip.dataset.rowHandle = String(row)
        grip.draggable = true
        grip.title = '拖动行'
        grip.textContent = '⋮'
        grip.setAttribute('aria-label', `拖动第 ${row + 1} 行`)
        gutter.appendChild(grip)
        tr.appendChild(gutter)
        model.rows[row].forEach((_, col) => {
          const td = document.createElement('td')
          td.dataset.col = String(col)
          td.style.textAlign = model.aligns[col]
          td.appendChild(makeCell(row, col))
          tr.appendChild(td)
        })
        tbody.appendChild(tr)
      })
      table.appendChild(tbody)
      scroller.replaceChildren(table)
      const deleteRowButton = toolbar.querySelector<HTMLButtonElement>('[data-action="delete-row"]')
      const deleteColButton = toolbar.querySelector<HTMLButtonElement>('[data-action="delete-col"]')
      if (deleteRowButton) deleteRowButton.disabled = cursor.row === 0 || model.rows.length <= 1
      if (deleteColButton) deleteColButton.disabled = model.rows[0].length <= 1
    }
    render = renderTable

    const moveCursor = (pos: CellPos, extend: boolean) => {
      cursor = clampPos(pos)
      if (!extend) anchor = { ...cursor }
      renderTable()
      focusOnly(cursor)
    }
    const nextCell = (pos: CellPos, direction: -1 | 1): CellPos => {
      const columns = model.rows[0].length
      const index = Math.max(0, Math.min(model.rows.length * columns - 1, pos.row * columns + pos.col + direction))
      return { row: Math.floor(index / columns), col: index % columns }
    }
    const commitEdit = (nextPos = cursor, edit = false) => {
      if (!editing) return
      commit(currentModel(), { anchor: nextPos, cursor: nextPos, edit })
    }

    wrap.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement
      if (target.closest('textarea,[draggable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && target.closest('a')) return
      event.preventDefault()
    })

    wrap.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.closest<HTMLButtonElement>('[data-action]')
      if (action) {
        const pos = { ...cursor }
        switch (action.dataset.action) {
          case 'insert-row': {
            const row = Math.min(model.rows.length, pos.row + 1)
            operate((base) => insertRow(base, row), { row, col: pos.col })
            break
          }
          case 'insert-col':
            operate((base) => insertColumn(base, pos.col + 1), { row: pos.row, col: pos.col + 1 })
            break
          case 'delete-row':
            operate((base) => deleteRow(base, pos.row), { row: Math.max(pos.row > 0 ? 1 : 0, pos.row - 1), col: pos.col })
            break
          case 'delete-col':
            operate((base) => deleteColumn(base, pos.col), { row: pos.row, col: Math.max(0, pos.col - 1) })
            break
          case 'align':
            operate((base) => setAlign(base, pos.col, nextAlignment[base.aligns[pos.col]]))
            break
          case 'copy-grid': {
            const s = selected()
            const rows = model.rows.slice(s.top, s.bottom + 1).map((r) => r.slice(s.left, s.right + 1))
            void copyText(toTsv(rows)).then((ok) => setStatus(ok ? '已复制网格' : '复制失败，请重试'))
            break
          }
          case 'copy-markdown':
            void copyText(serializeTable(model)).then((ok) => setStatus(ok ? '已复制 Markdown 表格' : '复制失败，请重试'))
            break
        }
        return
      }
      if (target.closest('[data-row-handle],[data-col-handle]')) return
      const link = target.closest('a')
      const cell = target.closest<HTMLElement>('.cm-table-cell[data-cell]')
      if (!cell || cell.matches('textarea')) return
      if (link && (event.ctrlKey || event.metaKey)) return
      if (link) event.preventDefault()
      const pos = { row: Number(cell.dataset.row ?? cell.dataset.cell!.split(':')[0]), col: Number(cell.dataset.cell!.split(':')[1]) }
      if (editing && !samePos(editing, pos)) {
        commit(currentModel(), { anchor: pos, cursor: pos, edit: true })
      } else if (event.shiftKey) {
        cursor = pos
        renderTable()
        focusOnly(cursor)
      } else startEdit(pos)
    })

    wrap.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement
      const pos = target.matches('.cm-table-cell[data-cell]')
        ? { row: Number(target.dataset.cell!.split(':')[0]), col: Number(target.dataset.cell!.split(':')[1]) }
        : cursor
      if (target.matches('textarea')) {
        const input = target as HTMLTextAreaElement
        if (event.key === 'Escape') {
          event.preventDefault()
          editing = null
          renderTable()
          focusOnly(pos)
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          commitEdit()
        } else if (event.key === 'Tab') {
          event.preventDefault()
          const next = nextCell(pos, event.shiftKey ? -1 : 1)
          commitEdit(next, true)
        } else if (!event.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          const boundary = event.key === 'ArrowLeft' ? input.selectionStart === 0 && input.selectionEnd === 0
            : event.key === 'ArrowRight' ? input.selectionStart === input.value.length && input.selectionEnd === input.value.length
            : event.key === 'ArrowUp' || event.key === 'ArrowDown'
          if (!boundary) return
          event.preventDefault()
          const row = pos.row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
          const col = pos.col + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)
          commitEdit(clampPos({ row, col }))
        }
        return
      }
      if (!target.matches('.cm-table-cell[data-cell]')) return
      if (event.key === 'Enter') {
        event.preventDefault()
        startEdit(pos)
      } else if (event.key === 'Tab') {
        event.preventDefault()
        moveCursor(nextCell(pos, event.shiftKey ? -1 : 1), false)
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        moveCursor({
          row: pos.row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0),
          col: pos.col + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0),
        }, event.shiftKey)
      } else if (event.key === 'Escape') {
        cursor = { ...anchor }
        renderTable()
        focusOnly(cursor)
      } else if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        const s = selected()
        const grid = Array.from({ length: s.bottom - s.top + 1 }, () => Array.from({ length: s.right - s.left + 1 }, () => ''))
        operate((base) => pasteGrid(base, s.top, s.left, grid), { row: s.top, col: s.left })
      }
    })

    wrap.addEventListener('input', (event) => {
      if (event.target instanceof HTMLTextAreaElement) autoSize(event.target)
    })
    wrap.addEventListener('focusout', (event) => {
      if (!editing || event.target !== wrap.querySelector('textarea.cm-table-editor')) return
      const next = event.relatedTarget as Node | null
      if (next && wrap.contains(next)) return
      commitEdit()
    })
    wrap.addEventListener('copy', (event) => {
      if ((event.target as HTMLElement).matches('textarea')) return
      const s = selected()
      const rows = model.rows.slice(s.top, s.bottom + 1).map((r) => r.slice(s.left, s.right + 1))
      event.clipboardData?.setData('text/plain', toTsv(rows))
      event.preventDefault()
      setStatus('已复制网格')
    })
    wrap.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return
      const isInput = (event.target as HTMLElement).matches('textarea')
      if (isInput && !/[\t\r\n]/.test(text)) return
      event.preventDefault()
      const grid = parseTsv(text)
      operate((base) => pasteGrid(base, cursor.row, cursor.col, grid), cursor)
    })
    wrap.addEventListener('dragstart', (event) => {
      const target = event.target as HTMLElement
      const row = target.closest<HTMLElement>('[data-row-handle]')
      const col = target.closest<HTMLElement>('[data-col-handle]')
      drag = row ? { kind: 'row', index: Number(row.dataset.rowHandle) } : col ? { kind: 'col', index: Number(col.dataset.colHandle) } : null
      if (drag && event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', drag.kind + ':' + drag.index)
      }
    })
    wrap.addEventListener('dragover', (event) => {
      if (!drag) return
      const target = event.target as HTMLElement
      const row = target.closest<HTMLElement>('tbody tr[data-row]')
      const col = target.closest<HTMLElement>('[data-col]')
      if ((drag.kind === 'row' && row) || (drag.kind === 'col' && col)) {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        const dropTarget = drag.kind === 'row' ? row : col
        dropTarget?.classList.add('is-table-drop-target')
      }
    })
    wrap.addEventListener('dragleave', () => {
      wrap.querySelectorAll('.is-table-drop-target').forEach((el) => el.classList.remove('is-table-drop-target'))
    })
    wrap.addEventListener('drop', (event) => {
      if (!drag) return
      const target = event.target as HTMLElement
      const row = target.closest<HTMLElement>('tbody tr[data-row]')
      const col = target.closest<HTMLElement>('[data-col]')
      if (drag.kind === 'row' && row) {
        event.preventDefault()
        const to = Number(row.dataset.row)
        operate((base) => moveRow(base, drag!.index, to), { row: to, col: cursor.col })
      } else if (drag.kind === 'col' && col) {
        event.preventDefault()
        const to = Number(col.dataset.col)
        operate((base) => moveColumn(base, drag!.index, to), { row: cursor.row, col: to })
      }
      drag = null
      wrap.querySelectorAll('.is-table-drop-target').forEach((el) => el.classList.remove('is-table-drop-target'))
    })
    wrap.addEventListener('dragend', () => {
      drag = null
      wrap.querySelectorAll('.is-table-drop-target').forEach((el) => el.classList.remove('is-table-drop-target'))
    })

    const pending = focusRequests.get(view)
    if (pending?.from === this.from) {
      focusRequests.delete(view)
      anchor = clampPos(pending.anchor)
      cursor = clampPos(pending.cursor)
      renderTable()
      requestAnimationFrame(() => pending.edit ? startEdit(cursor) : focusOnly(cursor))
    } else renderTable()
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

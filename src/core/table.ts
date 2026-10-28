export type TableAlign = '' | 'left' | 'center' | 'right'

export interface TableModel {
  rows: string[][]
  aligns: TableAlign[]
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function moveItem<T>(items: T[], from: number, to: number) {
  const out = items.slice()
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}

function rectangular(rows: string[][], aligns: TableAlign[], minColumns = 0): TableModel {
  const columns = Math.max(minColumns, aligns.length, ...rows.map((r) => r.length))
  return {
    rows: rows.map((r) => Array.from({ length: columns }, (_, i) => r[i] ?? '')),
    aligns: Array.from({ length: columns }, (_, i) => aligns[i] ?? ''),
  }
}

function splitRow(line: string) {
  const source = line.trim()
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '\\' && source[i + 1] === '|') {
      cell += '|'
      i++
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += char
  }
  cells.push(cell.trim())
  if (source.startsWith('|') && cells[0] === '') cells.shift()
  if (source.endsWith('|') && cells[cells.length - 1] === '') cells.pop()
  return cells.map((c) => c.replace(/<br\s*\/?>/gi, '\n'))
}

function alignment(cell: string): TableAlign {
  const value = cell.trim()
  if (/^:-+:$/.test(value)) return 'center'
  if (/^-+:$/.test(value)) return 'right'
  if (/^:-+$/.test(value)) return 'left'
  return ''
}

export function parseTable(source: string): TableModel {
  const lines = source.split('\n').filter((line) => line.trim())
  const head = splitRow(lines[0] ?? '')
  const aligns = splitRow(lines[1] ?? '').map(alignment)
  const rows = [head, ...lines.slice(2).map(splitRow)]
  return rectangular(rows, aligns, head.length)
}

function serializeCell(value: string) {
  return value.trim().replace(/\|/g, '\\|').replace(/\r\n?/g, '\n').replace(/\n/g, '<br>')
}

export function serializeTable(model: TableModel): string {
  const { rows, aligns } = rectangular(model.rows, model.aligns)
  const line = (cells: string[]) => '| ' + cells.map(serializeCell).join(' | ') + ' |'
  const separators = aligns.map((align) => align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---')
  return [line(rows[0] ?? []), line(separators), ...rows.slice(1).map(line)].join('\n')
}

export function pasteGrid(model: TableModel, row: number, col: number, grid: string[][]): TableModel {
  if (!grid.length || !grid.some((r) => r.length)) return model
  const startRow = Math.max(0, row)
  const startCol = Math.max(0, col)
  const width = Math.max(...grid.map((r) => r.length))
  const rows = model.rows.map((r) => r.slice())
  while (rows.length < startRow + grid.length) rows.push([])
  const next = rectangular(rows, model.aligns, startCol + width)
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) next.rows[startRow + r][startCol + c] = grid[r][c]
  }
  return next
}

export function updateCell(model: TableModel, row: number, col: number, value: string): TableModel {
  return pasteGrid(model, row, col, [[value]])
}

export function insertRow(model: TableModel, index: number, values: string[] = []): TableModel {
  const rows = model.rows.map((r) => r.slice())
  const columns = Math.max(model.aligns.length, ...rows.map((r) => r.length))
  const row = Array.from({ length: columns }, (_, i) => values[i] ?? '')
  rows.splice(clamp(index, 1, rows.length), 0, row)
  return rectangular(rows, model.aligns, columns)
}

export function deleteRow(model: TableModel, index: number): TableModel {
  if (index <= 0 || index >= model.rows.length || model.rows.length <= 1) return model
  return rectangular(model.rows.filter((_, i) => i !== index), model.aligns)
}

export function moveRow(model: TableModel, from: number, to: number): TableModel {
  if (from <= 0 || from >= model.rows.length) return model
  const target = clamp(to, 1, model.rows.length - 1)
  if (target === from) return model
  return rectangular(moveItem(model.rows, from, target), model.aligns)
}

export function insertColumn(model: TableModel, index: number): TableModel {
  const columns = Math.max(model.aligns.length, ...model.rows.map((r) => r.length))
  const target = clamp(index, 0, columns)
  return rectangular(
    model.rows.map((r) => {
      const next = r.slice()
      next.splice(target, 0, '')
      return next
    }),
    model.aligns.slice(0, target).concat('', model.aligns.slice(target)),
    columns + 1,
  )
}

export function deleteColumn(model: TableModel, index: number): TableModel {
  const columns = Math.max(model.aligns.length, ...model.rows.map((r) => r.length))
  if (index < 0 || index >= columns || columns <= 1) return model
  return rectangular(
    model.rows.map((r) => r.filter((_, i) => i !== index)),
    model.aligns.filter((_, i) => i !== index),
    columns - 1,
  )
}

export function moveColumn(model: TableModel, from: number, to: number): TableModel {
  const columns = Math.max(model.aligns.length, ...model.rows.map((r) => r.length))
  if (from < 0 || from >= columns) return model
  const target = clamp(to, 0, columns - 1)
  if (target === from) return model
  return rectangular(model.rows.map((r) => moveItem(r, from, target)), moveItem(model.aligns, from, target))
}

export function setAlign(model: TableModel, col: number, align: TableAlign): TableModel {
  if (col < 0 || col >= model.aligns.length) return model
  const aligns = model.aligns.slice()
  aligns[col] = align
  return { rows: model.rows.map((r) => r.slice()), aligns }
}

export function parseTsv(text: string): string[][] {
  const input = text.replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && !field) quoted = true
    else if (char === '\t') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  row.push(field)
  rows.push(row)
  if (input.endsWith('\n')) rows.pop()
  return rows
}

export function toTsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => {
    const value = cell.replace(/\r\n?/g, '\n')
    return /["\t\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value
  }).join('\t')).join('\n')
}

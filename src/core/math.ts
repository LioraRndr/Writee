export interface TextRange {
  from: number
  to: number
}

export interface MathRange extends TextRange {
  source: string
  display: boolean
}

function escaped(text: string, pos: number) {
  let slashes = 0
  for (let i = pos - 1; i >= 0 && text[i] === '\\'; i--) slashes++
  return slashes % 2 === 1
}

function overlaps(range: TextRange, excluded: TextRange[]) {
  return excluded.some((e) => range.from < e.to && range.to > e.from)
}

export function findMathRanges(text: string, excluded: TextRange[] = []): MathRange[] {
  const out: MathRange[] = []
  const add = (from: number, to: number, source: string, display: boolean) => {
    if (!source.trim() || overlaps({ from, to }, excluded)) return
    out.push({ from, to, source, display })
  }

  for (let i = 0; i < text.length; ) {
    if (text[i] === '\\' && !escaped(text, i) && (text[i + 1] === '(' || text[i + 1] === '[')) {
      const display = text[i + 1] === '['
      const closeMark = display ? '\\]' : '\\)'
      let search = i + 2
      let found = -1
      while (search < text.length) {
        const at = text.indexOf(closeMark, search)
        if (at < 0) break
        if (!escaped(text, at) && (display || !text.slice(i + 2, at).includes('\n'))) {
          found = at
          break
        }
        search = at + 2
      }
      if (found >= 0) {
        add(i, found + 2, text.slice(i + 2, found), display)
        i = found + 2
      } else i += 2
      continue
    }

    if (text[i] !== '$' || escaped(text, i)) {
      i++
      continue
    }

    if (text[i + 1] === '$') {
      let search = i + 2
      let found = -1
      while (search < text.length) {
        const at = text.indexOf('$$', search)
        if (at < 0) break
        if (!escaped(text, at)) {
          found = at
          break
        }
        search = at + 2
      }
      if (found >= 0) {
        add(i, found + 2, text.slice(i + 2, found), true)
        i = found + 2
      } else i += 2
      continue
    }

    let end = i + 1
    let found = -1
    while (end < text.length && text[end] !== '\n') {
      if (text[end] === '$' && !escaped(text, end) && text[end + 1] !== '$' && text[end - 1] !== '$') {
        found = end
        break
      }
      end++
    }
    const source = found >= 0 ? text.slice(i + 1, found) : ''
    if (found > i + 1 && /^\d+(?:[.,]\d+)?[、，。！？；：]$/.test(source)) {
      i = found + 1
    } else if (found > i + 1 && source.trim() && !/^\s|\s$/.test(source)) {
      add(i, found + 1, source, false)
      i = found + 1
    } else i++
  }
  return out.sort((a, b) => a.from - b.from)
}

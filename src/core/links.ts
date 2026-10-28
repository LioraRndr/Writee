import type { TextRange } from './math'

export type LinkKind = 'external' | 'file' | 'unsafe'

export interface WikiLink extends TextRange {
  target: string
  label: string
}

export function linkKind(target: string): LinkKind {
  const value = target.trim().replace(/^<|>$/g, '')
  if (/^(https?:|mailto:)/i.test(value)) return 'external'
  if (/^file:/i.test(value) || /^[a-z]:[\\/]/i.test(value)) return 'file'
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? 'unsafe' : 'file'
}

export function findWikiLinks(text: string, excluded: TextRange[] = []): WikiLink[] {
  const code = [...excluded]
  for (const match of text.matchAll(/`[^`\n]*`/g)) code.push({ from: match.index, to: match.index + match[0].length })
  const out: WikiLink[] = []
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const from = match.index
    const to = from + match[0].length
    if (code.some((range) => from < range.to && to > range.from)) continue
    const separator = match[1].indexOf('|')
    const target = (separator < 0 ? match[1] : match[1].slice(0, separator)).trim()
    const label = (separator < 0 ? target : match[1].slice(separator + 1).trim()) || target
    if (target && linkKind(target) !== 'unsafe') out.push({ from, to, target, label })
  }
  return out
}

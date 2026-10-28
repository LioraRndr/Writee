import { findMathRanges } from '../core/math'
import { findWikiLinks, linkKind } from '../core/links'
import { renderMath } from './MathWidget'

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function renderText(src: string) {
  let s = escapeHtml(src)
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`)
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t, u) =>
    linkKind(u) === 'unsafe' ? t : `<a href="${u}" data-href="${u}" title="${u}" rel="noreferrer">${t}</a>`,
  )
  return s.replace(/&lt;br\s*\/?&gt;/g, '<br>')
}

/** 极简的行内 Markdown 渲染（用于表格单元格等短片段） */
export function renderInline(src: string) {
  const tokens: Array<{ from: number; to: number; html: string }> = []
  for (const match of src.matchAll(/`([^`]+)`/g)) {
    tokens.push({ from: match.index, to: match.index + match[0].length, html: `<code>${escapeHtml(match[1])}</code>` })
  }
  for (const math of findMathRanges(src, tokens)) {
    tokens.push({
      from: math.from,
      to: math.to,
      html: `<span class="cm-table-math${math.display ? ' is-display' : ''}">${renderMath(math.source, math.display)}</span>`,
    })
  }
  for (const link of findWikiLinks(src, tokens)) {
    tokens.push({
      from: link.from,
      to: link.to,
      html: `<a class="cm-md-wikilink" href="${escapeHtml(link.target)}" data-href="${escapeHtml(link.target)}" title="${escapeHtml(link.target)}">${escapeHtml(link.label)}</a>`,
    })
  }
  tokens.sort((a, b) => a.from - b.from)
  let source = ''
  let last = 0
  tokens.forEach((token, i) => {
    source += src.slice(last, token.from) + `\uE000${i}\uE001`
    last = token.to
  })
  source += src.slice(last)
  let html = renderText(source)
  tokens.forEach((token, i) => {
    html = html.replace(`\uE000${i}\uE001`, token.html)
  })
  return html
}

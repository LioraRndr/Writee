export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** 极简的行内 Markdown 渲染（用于表格单元格等只读片段） */
export function renderInline(src: string) {
  let s = escapeHtml(src)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`)
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t, u) =>
    /^(https?:|mailto:)/.test(u) ? `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>` : t,
  )
  s = s.replace(/&lt;br\s*\/?&gt;/g, '<br>')
  return s
}

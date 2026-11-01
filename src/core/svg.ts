import DOMPurify from 'dompurify'

export type DiagramKind = 'mermaid' | 'svg'

export function diagramLanguage(info: string): DiagramKind | null {
  const language = info.trim().toLowerCase()
  return language === 'mermaid' || language === 'svg' ? language : null
}

export function isStandaloneSvgSource(source: string) {
  const text = source.trim().replace(/^<\?xml[^?]*\?>\s*/i, '')
  return /^<svg(?:\s|>)/i.test(text) && (/<\/svg>$/i.test(text) || /\/>$/.test(text))
}

function unsafeCss(value: string) {
  if (/@import|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:/i.test(value)) return true
  for (const match of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!match[2].trim().startsWith('#')) return true
  }
  return false
}

/** 原始 SVG 与 Mermaid 输出共用同一边界；样式由部件的 Shadow DOM 隔离。 */
export function sanitizeSvg(source: string) {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'a', 'animate', 'animateMotion', 'animateTransform', 'audio', 'canvas', 'discard', 'embed',
      'foreignObject', 'handler', 'iframe', 'image', 'listener', 'object', 'script', 'set', 'video',
    ],
  })
  const document = new DOMParser().parseFromString(clean, 'image/svg+xml')
  const root = document.documentElement
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || root.querySelector('parsererror')) {
    throw new Error('SVG 文档无效')
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (
        name.startsWith('on') ||
        (['href', 'xlink:href', 'src'].includes(name) && value && !value.startsWith('#')) ||
        unsafeCss(value)
      ) {
        element.removeAttribute(attribute.name)
      }
    }
    if (element.localName === 'style' && unsafeCss(element.textContent ?? '')) element.remove()
  }
  if (!root.querySelector('svg') && !root.childElementCount && !root.textContent?.trim()) {
    throw new Error('SVG 内容为空')
  }
  return new XMLSerializer().serializeToString(root)
}

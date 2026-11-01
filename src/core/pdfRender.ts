import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { findMathRanges } from './math'
import { diagramLanguage, sanitizeSvg } from './svg'
import { imageAssetUrl } from './localFile'
import { renderMermaid, type MermaidColors } from './mermaid'
import type { FileHandle } from './types'
import type { PdfOptions } from './pdf'

export interface PdfHeading {
  id: string
  level: number
  text: string
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const markdown = new MarkdownIt({ html: true, linkify: true })
const defaultFence = markdown.renderer.rules.fence!
markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const kind = diagramLanguage(token.info)
  if (!kind) return defaultFence(tokens, index, options, env, self)
  return `<div class="pdf-diagram" data-pdf-diagram="${kind}">${escapeAttribute(token.content)}</div>`
}

function renderMath(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.parentElement?.closest('pre,code,[data-pdf-diagram]') && (node.data.includes('$') || /\\[[(]/.test(node.data))) nodes.push(node)
  }
  for (const node of nodes) {
    const ranges = findMathRanges(node.data)
    if (!ranges.length) continue
    const fragment = document.createDocumentFragment()
    let at = 0
    for (const range of ranges) {
      fragment.appendChild(document.createTextNode(node.data.slice(at, range.from)))
      const span = document.createElement('span')
      span.className = 'pdf-math' + (range.display ? ' is-display' : '')
      span.innerHTML = katex.renderToString(range.source, { displayMode: range.display, throwOnError: false, strict: 'ignore' })
      fragment.appendChild(span)
      at = range.to
    }
    fragment.appendChild(document.createTextNode(node.data.slice(at)))
    node.replaceWith(fragment)
  }
}

function renderTasks(root: HTMLElement) {
  for (const item of root.querySelectorAll('li')) {
    const first = [...item.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) as Text | undefined
    const match = first?.data.match(/^\s*\[([ xX])\]\s+/)
    if (!first || !match) continue
    const box = document.createElement('span')
    box.className = 'pdf-task' + (match[1].toLowerCase() === 'x' ? ' is-checked' : '')
    box.setAttribute('aria-label', match[1].toLowerCase() === 'x' ? '已完成' : '未完成')
    first.replaceWith(box, document.createTextNode(first.data.slice(match[0].length)))
  }
}

function renderImages(root: HTMLElement, handle: FileHandle | null | undefined) {
  for (const image of root.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? ''
    const url = imageAssetUrl(source, handle)
    if (!url) {
      const missing = document.createElement('span')
      missing.className = 'pdf-image-missing'
      missing.textContent = `［图片：${image.alt || source || '未命名'}］`
      image.replaceWith(missing)
      continue
    }
    image.src = url
    image.loading = 'eager'
    image.decoding = 'async'
  }
}

function sanitizeRawSvgs(root: HTMLElement) {
  for (const svg of root.querySelectorAll('svg')) {
    try {
      const template = document.createElement('template')
      template.innerHTML = sanitizeSvg(svg.outerHTML)
      svg.replaceWith(template.content)
    } catch {
      const error = document.createElement('div')
      error.className = 'pdf-diagram-error'
      error.textContent = 'SVG 无法安全渲染'
      svg.replaceWith(error)
    }
  }
}

function pdfMermaidColors(options: PdfOptions): MermaidColors {
  return {
    background: '#ffffff',
    primaryColor: '#f5f3ef',
    primaryTextColor: '#25272b',
    primaryBorderColor: options.accent,
    secondaryColor: '#f5f3ef',
    tertiaryColor: '#faf9f6',
    lineColor: '#777777',
    textColor: '#25272b',
    fontFamily: PDF_FONT_FALLBACK,
    clusterBkg: '#faf9f6',
    clusterBorder: '#d8d5cf',
    edgeLabelBackground: '#ffffff',
  }
}

const PDF_FONT_FALLBACK = "'Noto Serif SC', 'Songti SC', serif"

async function renderDiagrams(root: HTMLElement, options: PdfOptions) {
  for (const placeholder of root.querySelectorAll<HTMLElement>('[data-pdf-diagram]')) {
    const kind = placeholder.dataset.pdfDiagram
    const source = placeholder.textContent ?? ''
    try {
      const output = kind === 'mermaid' ? await renderMermaid(source, 'pdf', pdfMermaidColors(options)) : source
      placeholder.innerHTML = sanitizeSvg(output)
      placeholder.classList.add('is-ready')
    } catch (error) {
      placeholder.classList.add('pdf-diagram-error')
      placeholder.textContent = error instanceof Error ? error.message : '图表渲染失败'
    }
  }
}

export async function renderPdfMarkdown(text: string, handle: FileHandle | null | undefined, options: PdfOptions) {
  const clean = DOMPurify.sanitize(markdown.render(text), {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'audio', 'video'],
  })
  const template = document.createElement('template')
  template.innerHTML = clean
  const root = document.createElement('div')
  root.appendChild(template.content)
  sanitizeRawSvgs(root)
  renderMath(root)
  renderTasks(root)
  renderImages(root, handle)
  await renderDiagrams(root, options)
  const headings: PdfHeading[] = [...root.querySelectorAll('h1,h2,h3')].map((heading, index) => {
    const id = `pdf-heading-${index + 1}`
    heading.id = id
    return { id, level: Number(heading.tagName[1]), text: heading.textContent?.trim() ?? '' }
  }).filter((heading) => heading.text)
  return { html: root.innerHTML, headings }
}

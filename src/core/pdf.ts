export type PdfPreset = 'elegant' | 'modern' | 'academic' | 'compact'
export type PdfPaper = 'a4' | 'a5' | 'letter'
export type PdfOrientation = 'portrait' | 'landscape'
export type PdfFont = 'serif' | 'sans' | 'kai'

export interface PdfOptions {
  preset: PdfPreset
  paper: PdfPaper
  orientation: PdfOrientation
  font: PdfFont
  fontSize: number
  lineHeight: number
  margin: number
  paragraphSpacing: number
  accent: string
  showTitle: boolean
  showToc: boolean
  showHeader: boolean
  showPageNumbers: boolean
}

export const PDF_DEFAULTS: PdfOptions = {
  preset: 'elegant',
  paper: 'a4',
  orientation: 'portrait',
  font: 'serif',
  fontSize: 12,
  lineHeight: 1.85,
  margin: 22,
  paragraphSpacing: 0.8,
  accent: '#9b4132',
  showTitle: true,
  showToc: false,
  showHeader: false,
  showPageNumbers: true,
}

export const PDF_PRESETS: { id: PdfPreset; name: string; desc: string; options: Partial<PdfOptions> }[] = [
  {
    id: 'elegant',
    name: '雅致书页',
    desc: '宋体 · 宽松行距',
    options: { font: 'serif', fontSize: 12, lineHeight: 1.85, margin: 22, paragraphSpacing: 0.8, accent: '#9b4132' },
  },
  {
    id: 'modern',
    name: '现代简约',
    desc: '黑体 · 清晰利落',
    options: { font: 'sans', fontSize: 11, lineHeight: 1.65, margin: 20, paragraphSpacing: 0.65, accent: '#365f91' },
  },
  {
    id: 'academic',
    name: '学术论文',
    desc: '紧凑宋体 · 目录页眉',
    options: {
      font: 'serif', fontSize: 11, lineHeight: 1.6, margin: 25, paragraphSpacing: 0.35, accent: '#333333',
      showToc: true, showHeader: true, showPageNumbers: true,
    },
  },
  {
    id: 'compact',
    name: '紧凑笔记',
    desc: '小字号 · 窄页边距',
    options: { font: 'sans', fontSize: 10, lineHeight: 1.45, margin: 14, paragraphSpacing: 0.35, accent: '#3d6f64' },
  },
]

export const PDF_PAPERS: Record<PdfPaper, { name: string; width: number; height: number }> = {
  a4: { name: 'A4', width: 210, height: 297 },
  a5: { name: 'A5', width: 148, height: 210 },
  letter: { name: 'Letter', width: 215.9, height: 279.4 },
}

export const PDF_FONTS: Record<PdfFont, { name: string; stack: string }> = {
  serif: { name: '宋体 / 衬线', stack: "'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', serif" },
  sans: { name: '黑体 / 无衬线', stack: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif" },
  kai: { name: '楷体', stack: "'Kaiti SC', 'KaiTi', 'STKaiti', 'Noto Serif SC', serif" },
}

export const PDF_ACCENTS = ['#9b4132', '#365f91', '#3d6f64', '#8a5a2b', '#654f82', '#333333']

export function pdfPaperSize(options: Pick<PdfOptions, 'paper' | 'orientation'>) {
  const paper = PDF_PAPERS[options.paper]
  return options.orientation === 'portrait'
    ? { width: paper.width, height: paper.height }
    : { width: paper.height, height: paper.width }
}

export function pdfPageCss(options: PdfOptions, title = '') {
  const size = options.paper === 'letter' ? 'letter' : options.paper.toUpperCase()
  const top = options.margin + (options.showHeader ? 5 : 0)
  const bottom = options.margin + (options.showPageNumbers ? 5 : 0)
  const running = 'font: 8.5pt -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; color: #777;'
  const header = options.showHeader
    ? ` @top-right { content: "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ')}"; ${running} }`
    : ''
  const footer = options.showPageNumbers ? ` @bottom-center { content: counter(page); ${running} }` : ''
  return `@page { size: ${size} ${options.orientation}; margin: ${top}mm ${options.margin}mm ${bottom}mm;${header}${footer} }`
}

export function pdfFileName(name: string) {
  const base = name.replace(/\.(md|markdown|mdown|txt)$/i, '').trim() || '未命名文档'
  return base.replace(/[\\/:*?"<>|]/g, '_') + '.pdf'
}

export function loadPdfOptions(): PdfOptions {
  try {
    const saved = JSON.parse(localStorage.getItem('writee.pdf') ?? '{}') as Partial<PdfOptions>
    return { ...PDF_DEFAULTS, ...saved }
  } catch {
    return PDF_DEFAULTS
  }
}

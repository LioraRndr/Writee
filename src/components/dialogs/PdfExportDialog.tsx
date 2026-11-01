import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDoc } from '../../store/docStore'
import { useUI } from '../../store/uiStore'
import {
  PDF_ACCENTS,
  PDF_DEFAULTS,
  PDF_FONTS,
  PDF_PRESETS,
  loadPdfOptions,
  pdfFileName,
  pdfPageCss,
  pdfPaperSize,
  type PdfOptions,
} from '../../core/pdf'
import { renderPdfMarkdown, type PdfHeading } from '../../core/pdfRender'
import { IconClose, IconDownload, IconMinus, IconPlus } from '../icons'

declare global {
  interface Window {
    writeeDesktop?: {
      savePdf(suggestedName: string): Promise<{ saved: boolean; path?: string }>
    }
  }
}

function Field({ label, children, value }: { label: string; children: ReactNode; value?: string }) {
  return (
    <label className="pdf-field">
      <span>{label}</span>
      {children}
      {value && <span className="pdf-field-value">{value}</span>}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="pdf-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function PdfExportDialog() {
  const meta = useDoc((state) => state.meta)
  const text = useDoc((state) => state.data.text)
  const [options, setOptions] = useState<PdfOptions>(loadPdfOptions)
  const [rendered, setRendered] = useState<{ html: string; headings: PdfHeading[] }>({ html: '', headings: [] })
  const [rendering, setRendering] = useState(true)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(75)
  const [pages, setPages] = useState(1)
  const [closing, setClosing] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  const title = meta?.name.replace(/\.(md|markdown|mdown|txt)$/i, '') || '未命名文档'
  const size = pdfPaperSize(options)
  const update = (patch: Partial<PdfOptions>) => setOptions((current) => ({ ...current, ...patch }))
  const close = () => {
    if (busy || closing) return
    setClosing(true)
    setTimeout(() => useUI.setState({ dialog: null }), 150)
  }

  useEffect(() => {
    localStorage.setItem('writee.pdf', JSON.stringify(options))
  }, [options])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })

  useEffect(() => {
    let active = true
    setRendering(true)
    const timer = setTimeout(() => {
      void renderPdfMarkdown(text, meta?.handle, options).then((result) => {
        if (!active) return
        setRendered(result)
        setRendering(false)
      }).catch((error) => {
        if (!active) return
        setRendered({ html: '', headings: [] })
        setRendering(false)
        useUI.getState().toast('预览生成失败：' + (error instanceof Error ? error.message : String(error)), { tone: 'error' })
      })
    }, 120)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [text, meta?.handle, options.accent])

  useLayoutEffect(() => {
    const element = sheet.current
    if (!element) return
    const measure = () => {
      const pageHeight = size.height * 96 / 25.4
      setPages(Math.max(1, Math.ceil(element.scrollHeight / pageHeight)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [rendered, options, size.height])

  const exportPdf = async () => {
    if (busy || rendering) return
    setBusy(true)
    document.body.classList.add('is-printing-pdf')
    try {
      await document.fonts.ready
      const images = [...(sheet.current?.querySelectorAll('img') ?? [])]
      await Promise.all(images.map((image) => image.complete ? image.decode().catch(() => undefined) : new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      })))
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (window.writeeDesktop) {
        const result = await window.writeeDesktop.savePdf(pdfFileName(meta?.name ?? title))
        if (result.saved) useUI.getState().toast('PDF 已导出')
      } else {
        useUI.getState().toast('请在系统打印窗口中选择“存储为 PDF”', { ms: 5000 })
        window.print()
      }
    } catch (error) {
      useUI.getState().toast('PDF 导出失败：' + (error instanceof Error ? error.message : String(error)), { tone: 'error', ms: 6000 })
    } finally {
      document.body.classList.remove('is-printing-pdf')
      setBusy(false)
    }
  }

  const sheetStyle = {
    '--pdf-accent': options.accent,
    '--pdf-margin': `${options.margin}mm`,
    '--pdf-paragraph-spacing': `${options.paragraphSpacing}em`,
    width: `${size.width}mm`,
    minHeight: `${size.height}mm`,
    padding: `${options.showHeader ? options.margin + 5 : options.margin}mm ${options.margin}mm ${options.showPageNumbers ? options.margin + 5 : options.margin}mm`,
    fontFamily: PDF_FONTS[options.font].stack,
    fontSize: `${options.fontSize}pt`,
    lineHeight: options.lineHeight,
    zoom: zoom / 100,
  } as CSSProperties

  return createPortal(
    <div className={'modal-backdrop pdf-export-backdrop' + (closing ? ' is-closing' : '')} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <style>{pdfPageCss(options, title)}</style>
      <section className="pdf-export" role="dialog" aria-modal="true" aria-label="导出 PDF">
        <header className="pdf-export-head">
          <div>
            <h2>导出 PDF</h2>
            <p>排版预览与导出结果共用同一样式</p>
          </div>
          <button className="icon-btn" onClick={close} title="关闭（Esc）" disabled={busy}><IconClose size={17} /></button>
        </header>
        <div className="pdf-export-main">
          <aside className="pdf-options">
            <div className="pdf-option-group">
              <div className="pdf-option-title">排版预设</div>
              <div className="pdf-presets">
                {PDF_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className={'pdf-preset' + (options.preset === preset.id ? ' is-on' : '')}
                    onClick={() => setOptions((current) => ({ ...current, ...preset.options, preset: preset.id }))}
                  >
                    <span className={`pdf-preset-sample is-${preset.id}`}>文<span>Aa</span></span>
                    <span><b>{preset.name}</b><small>{preset.desc}</small></span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pdf-option-group">
              <div className="pdf-option-title">页面</div>
              <Field label="纸张">
                <select className="input" value={options.paper} onChange={(event) => update({ paper: event.target.value as PdfOptions['paper'] })}>
                  <option value="a4">A4</option><option value="a5">A5</option><option value="letter">Letter</option>
                </select>
              </Field>
              <Field label="方向">
                <div className="seg small">
                  <button className={options.orientation === 'portrait' ? 'is-on' : ''} onClick={() => update({ orientation: 'portrait' })}>纵向</button>
                  <button className={options.orientation === 'landscape' ? 'is-on' : ''} onClick={() => update({ orientation: 'landscape' })}>横向</button>
                </div>
              </Field>
              <Field label="页边距" value={`${options.margin} mm`}>
                <input type="range" min="10" max="32" step="1" value={options.margin} onChange={(event) => update({ margin: Number(event.target.value) })} />
              </Field>
            </div>

            <div className="pdf-option-group">
              <div className="pdf-option-title">文字</div>
              <Field label="字体">
                <select className="input" value={options.font} onChange={(event) => update({ font: event.target.value as PdfOptions['font'] })}>
                  {Object.entries(PDF_FONTS).map(([id, font]) => <option key={id} value={id}>{font.name}</option>)}
                </select>
              </Field>
              <Field label="字号" value={`${options.fontSize} pt`}>
                <input type="range" min="9" max="18" step="0.5" value={options.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} />
              </Field>
              <Field label="行距" value={options.lineHeight.toFixed(2)}>
                <input type="range" min="1.3" max="2.2" step="0.05" value={options.lineHeight} onChange={(event) => update({ lineHeight: Number(event.target.value) })} />
              </Field>
              <Field label="段间距" value={options.paragraphSpacing.toFixed(2)}>
                <input type="range" min="0" max="1.5" step="0.05" value={options.paragraphSpacing} onChange={(event) => update({ paragraphSpacing: Number(event.target.value) })} />
              </Field>
              <div className="pdf-field">
                <span>强调色</span>
                <div className="pdf-accents">
                  {PDF_ACCENTS.map((color) => <button key={color} aria-label={`强调色 ${color}`} className={options.accent === color ? 'is-on' : ''} style={{ background: color }} onClick={() => update({ accent: color })} />)}
                </div>
              </div>
            </div>

            <div className="pdf-option-group">
              <div className="pdf-option-title">附加内容</div>
              <div className="pdf-toggles">
                <Toggle label="文档名标题" checked={options.showTitle} onChange={(showTitle) => update({ showTitle })} />
                <Toggle label="目录（三级标题）" checked={options.showToc} onChange={(showToc) => update({ showToc })} />
                <Toggle label="页眉文档名" checked={options.showHeader} onChange={(showHeader) => update({ showHeader })} />
                <Toggle label="页码" checked={options.showPageNumbers} onChange={(showPageNumbers) => update({ showPageNumbers })} />
              </div>
            </div>
          </aside>

          <section className="pdf-preview">
            <div className="pdf-preview-toolbar">
              <span>{PDF_FONTS[options.font].name} · {options.paper.toUpperCase()} · 约 {pages} 页</span>
              <div className="pdf-zoom">
                <button className="icon-btn" title="缩小预览" disabled={zoom <= 40} onClick={() => setZoom((value) => Math.max(40, value - 10))}><IconMinus size={14} /></button>
                <button className="pdf-zoom-value" title="恢复 100%" onClick={() => setZoom(100)}>{zoom}%</button>
                <button className="icon-btn" title="放大预览" disabled={zoom >= 140} onClick={() => setZoom((value) => Math.min(140, value + 10))}><IconPlus size={14} /></button>
              </div>
            </div>
            <div className="pdf-preview-scroll">
              {rendering && <div className="pdf-rendering">正在生成预览…</div>}
              <div ref={sheet} className={`pdf-sheet preset-${options.preset}`} style={sheetStyle} data-testid="pdf-preview-sheet">
                {options.showHeader && <div className="pdf-running-header">{title}</div>}
                {options.showTitle && <div className="pdf-doc-title">{title}</div>}
                {options.showToc && rendered.headings.length > 0 && (
                  <nav className="pdf-toc">
                    <div className="pdf-toc-title">目录</div>
                    <ol>{rendered.headings.map((heading) => <li key={heading.id} className={`level-${heading.level}`}><a href={`#${heading.id}`}>{heading.text}</a></li>)}</ol>
                  </nav>
                )}
                <article className="pdf-content" dangerouslySetInnerHTML={{ __html: rendered.html }} />
                {options.showPageNumbers && <div className="pdf-running-footer"><span className="pdf-page-number" /></div>}
              </div>
            </div>
          </section>
        </div>
        <footer className="pdf-export-foot">
          <button className="btn is-ghost" disabled={busy} onClick={() => setOptions(PDF_DEFAULTS)}>恢复默认</button>
          <span className="pdf-export-hint">{window.writeeDesktop ? '文字保持清晰，可选中、可检索' : '导出时在系统窗口中选择“存储为 PDF”，并开启背景图形'}</span>
          <button className="btn is-primary" disabled={busy || rendering || !text.trim()} onClick={() => void exportPdf()}>
            <IconDownload size={15} />{busy ? '正在导出…' : '导出 PDF'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

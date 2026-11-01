import { EditorView, WidgetType } from '@codemirror/view'
import { sanitizeSvg, type DiagramKind } from '../core/svg'

interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, source: string): Promise<{ svg: string }>
}

let mermaidImport: Promise<MermaidApi> | null = null
let mermaidQueue: Promise<unknown> = Promise.resolve()
let mermaidId = 0

function loadMermaid() {
  mermaidImport ??= import('mermaid').then((module) => module.default as unknown as MermaidApi)
  return mermaidImport
}

function renderMermaid(source: string, theme: string) {
  const task = mermaidQueue.then(async () => {
    const mermaid = await loadMermaid()
    const styles = getComputedStyle(document.documentElement)
    const value = (name: string) => styles.getPropertyValue(name).trim()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      darkMode: styles.colorScheme === 'dark',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      themeVariables: {
        background: value('--bg'),
        primaryColor: value('--accent-soft'),
        primaryTextColor: value('--ink'),
        primaryBorderColor: value('--line-strong'),
        secondaryColor: value('--bg-sunken'),
        tertiaryColor: value('--bg-elev'),
        lineColor: value('--ink-3'),
        textColor: value('--ink'),
        fontFamily: value('--font-ui'),
        fontSize: '16px',
        clusterBkg: value('--bg-elev'),
        clusterBorder: value('--line'),
        edgeLabelBackground: value('--bg-elev'),
      },
    })
    const result = await mermaid.render(`writee-mermaid-${theme}-${++mermaidId}`, source)
    return result.svg
  })
  mermaidQueue = task.catch(() => undefined)
  return task
}

const controllers = new WeakMap<HTMLElement, DiagramController>()

export class DiagramWidget extends WidgetType {
  constructor(
    readonly kind: DiagramKind,
    readonly source: string,
    readonly from: number,
    readonly theme: string,
  ) {
    super()
  }

  eq(other: DiagramWidget) {
    return other.kind === this.kind && other.source === this.source && other.from === this.from && other.theme === this.theme
  }

  toDOM(view: EditorView) {
    return new DiagramController(view, this).root
  }

  updateDOM(dom: HTMLElement, view: EditorView, previous?: WidgetType) {
    const controller = controllers.get(dom)
    if (!controller || !(previous instanceof DiagramWidget) || previous.kind !== this.kind) return false
    controller.update(this, view)
    return true
  }

  destroy(dom: HTMLElement) {
    controllers.get(dom)?.destroy()
  }

  get estimatedHeight() {
    return 220
  }

  ignoreEvent() {
    return true
  }
}

class DiagramController {
  readonly root = document.createElement('div')
  private readonly frame = document.createElement('div')
  private readonly status = document.createElement('div')
  private readonly shadow: ShadowRoot
  private readonly observer: ResizeObserver
  private generation = 0
  private disposed = false
  private zoom = 1
  private baseWidth = 0
  private svg: SVGSVGElement | null = null
  private canvas: HTMLElement | null = null
  private zoomLabel: HTMLButtonElement | null = null
  private fullscreenLabel: HTMLButtonElement | null = null
  private drag: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null

  constructor(private view: EditorView, private widget: DiagramWidget) {
    this.root.className = 'cm-diagram-block'
    this.frame.className = `cm-md-diagram is-${widget.kind}`
    this.frame.dataset.diagram = widget.kind
    this.frame.contentEditable = 'false'
    this.frame.setAttribute('role', 'group')
    this.frame.setAttribute('aria-label', widget.kind === 'mermaid' ? 'Mermaid 图表，点击编辑源码' : 'SVG 图像，点击编辑源码')
    this.status.className = 'cm-diagram-status'
    this.shadow = this.frame.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      :host{display:block;max-width:100%;overflow:hidden;background:var(--bg-elev)}
      *{box-sizing:border-box}
      .diagram-tools{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-bottom:10px;font:12px/1 var(--font-ui)}
      .diagram-tools button{min-width:28px;height:27px;padding:0 7px;color:var(--ink-2);background:var(--bg-sunken);border:1px solid var(--line);border-radius:6px;font:inherit;cursor:pointer}
      .diagram-tools button:hover{color:var(--accent);border-color:var(--accent)}
      .diagram-tools .diagram-zoom-label{min-width:48px;font-variant-numeric:tabular-nums}
      .diagram-canvas{width:100%;max-height:520px;overflow:auto;overscroll-behavior:contain;text-align:center;border-radius:6px;user-select:none}
      .diagram-canvas.is-pannable{cursor:grab}
      .diagram-canvas.is-dragging{cursor:grabbing}
      .diagram-zoom{display:inline-block;min-width:100%;text-align:center}
      svg{display:inline-block;max-width:100%;height:auto;vertical-align:top}
      .diagram-error{white-space:pre-wrap;font:13px/1.7 var(--font-ui);color:var(--nc-cinnabar)}
      :host(:fullscreen){padding:28px;background:var(--bg)}
      :host(:fullscreen) .diagram-canvas{max-height:calc(100vh - 90px)}
    `
    this.shadow.appendChild(style)
    this.root.append(this.frame, this.status)
    this.root.addEventListener('mousedown', this.editSource)
    document.addEventListener('fullscreenchange', this.onFullscreen)
    controllers.set(this.root, this)
    this.observer = new ResizeObserver(() => {
      if (!this.disposed) this.view.requestMeasure()
    })
    this.observer.observe(this.frame)
    this.render()
  }

  update(widget: DiagramWidget, view: EditorView) {
    this.widget = widget
    this.view = view
    this.render()
  }

  private editSource = (event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    this.view.focus()
    this.view.dispatch({ selection: { anchor: this.widget.from } })
  }

  private onFullscreen = () => {
    if (this.fullscreenLabel) this.fullscreenLabel.textContent = document.fullscreenElement === this.frame ? '退出全屏' : '全屏'
    requestAnimationFrame(() => this.fit())
  }

  private toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await this.frame.requestFullscreen()
    } catch {
      this.status.textContent = '当前环境无法进入全屏'
    }
  }

  private fit() {
    if (!this.svg) return
    this.svg.style.width = ''
    this.svg.style.maxWidth = '100%'
    this.svg.style.maxHeight = 'none'
    this.baseWidth = this.svg.getBoundingClientRect().width
    this.zoom = 1
    this.applyZoom()
  }

  private setZoom(value: number) {
    this.zoom = Math.max(0.25, Math.min(8, value))
    this.applyZoom()
  }

  private applyZoom() {
    if (!this.svg) return
    this.svg.style.maxWidth = 'none'
    this.svg.style.maxHeight = 'none'
    this.svg.style.width = `${Math.max(1, this.baseWidth * this.zoom)}px`
    this.svg.style.height = 'auto'
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`
    this.view.requestMeasure()
    requestAnimationFrame(() => {
      if (!this.canvas || this.disposed) return
      this.canvas.classList.toggle('is-pannable', this.canvas.scrollWidth > this.canvas.clientWidth + 1 || this.canvas.scrollHeight > this.canvas.clientHeight + 1)
    })
  }

  private makeButton(text: string, title: string, action: () => void) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = text
    button.title = title
    button.setAttribute('aria-label', title)
    button.addEventListener('click', action)
    return button
  }

  private makeTools() {
    const tools = document.createElement('div')
    tools.className = 'diagram-tools'
    tools.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    tools.append(
      this.makeButton('−', '缩小', () => this.setZoom(this.zoom / 1.25)),
      this.makeButton('100%', '适应宽度', () => this.fit()),
      this.makeButton('＋', '放大', () => this.setZoom(this.zoom * 1.25)),
      this.makeButton('全屏', '全屏查看', () => void this.toggleFullscreen()),
    )
    this.zoomLabel = tools.children[1] as HTMLButtonElement
    this.fullscreenLabel = tools.children[3] as HTMLButtonElement
    return tools
  }

  private bindCanvas(canvas: HTMLElement) {
    canvas.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      this.setZoom(this.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
    }, { passive: false })
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return
      if (canvas.scrollWidth <= canvas.clientWidth + 1 && canvas.scrollHeight <= canvas.clientHeight + 1) return
      event.preventDefault()
      event.stopPropagation()
      canvas.setPointerCapture(event.pointerId)
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop, moved: false }
      canvas.classList.add('is-dragging')
    })
    canvas.addEventListener('pointermove', (event) => {
      if (!this.drag || this.drag.id !== event.pointerId) return
      const dx = event.clientX - this.drag.x
      const dy = event.clientY - this.drag.y
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true
      canvas.scrollLeft = this.drag.left - dx
      canvas.scrollTop = this.drag.top - dy
    })
    const finish = (event: PointerEvent) => {
      if (!this.drag || this.drag.id !== event.pointerId) return
      const moved = this.drag.moved
      this.drag = null
      canvas.classList.remove('is-dragging')
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      if (!moved) this.editSource(event)
    }
    canvas.addEventListener('pointerup', finish)
    canvas.addEventListener('pointercancel', finish)
  }

  private async render() {
    const generation = ++this.generation
    this.frame.classList.remove('has-error', 'is-ready')
    this.status.textContent = this.widget.kind === 'mermaid' ? '正在绘制图表…' : ''
    try {
      const output = this.widget.kind === 'mermaid'
        ? await renderMermaid(this.widget.source, this.widget.theme)
        : this.widget.source
      const clean = sanitizeSvg(output)
      if (this.disposed || generation !== this.generation) return
      const style = this.shadow.querySelector('style')
      const canvas = document.createElement('div')
      canvas.className = 'diagram-canvas'
      const zoomRoot = document.createElement('div')
      zoomRoot.className = 'diagram-zoom'
      zoomRoot.innerHTML = clean
      canvas.appendChild(zoomRoot)
      this.shadow.replaceChildren(style!, this.makeTools(), canvas)
      this.canvas = canvas
      this.svg = zoomRoot.querySelector('svg')
      if (this.widget.kind === 'svg' && this.svg && !this.svg.hasAttribute('width') && !this.svg.hasAttribute('height')) {
        const viewBox = this.svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
        if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
          this.svg.setAttribute('width', String(viewBox[2]))
          this.svg.setAttribute('height', String(viewBox[3]))
        }
      }
      this.bindCanvas(canvas)
      this.frame.classList.add('is-ready')
      this.status.textContent = ''
      const zoom = this.zoom
      requestAnimationFrame(() => {
        if (this.disposed || generation !== this.generation) return
        this.fit()
        this.setZoom(zoom)
      })
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      const style = this.shadow.querySelector('style')
      const message = document.createElement('div')
      message.className = 'diagram-error'
      message.textContent = error instanceof Error ? error.message : '图表渲染失败'
      this.shadow.replaceChildren(style!, message)
      this.svg = null
      this.canvas = null
      this.frame.classList.add('has-error')
      this.status.textContent = this.widget.kind === 'mermaid' ? 'Mermaid 语法有误，点击检查源码' : 'SVG 无法渲染，点击检查源码'
    }
    this.view.requestMeasure()
  }

  destroy() {
    this.disposed = true
    this.generation++
    this.observer.disconnect()
    this.root.removeEventListener('mousedown', this.editSource)
    document.removeEventListener('fullscreenchange', this.onFullscreen)
    if (document.fullscreenElement === this.frame) void document.exitFullscreen()
    controllers.delete(this.root)
  }
}

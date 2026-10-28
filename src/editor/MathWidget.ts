import katex from 'katex'
import 'katex/dist/katex.min.css'
import { EditorView, WidgetType } from '@codemirror/view'

export function renderMath(source: string, display: boolean) {
  return katex.renderToString(source.trim(), {
    displayMode: display,
    throwOnError: false,
    trust: false,
    errorColor: 'currentColor',
  })
}

export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
    readonly block: boolean,
    readonly from: number,
  ) {
    super()
  }

  eq(o: MathWidget) {
    return o.source === this.source && o.display === this.display && o.block === this.block && o.from === this.from
  }

  toDOM(view: EditorView) {
    const el = document.createElement(this.block ? 'div' : 'span')
    el.className =
      'cm-md-math' + (this.display ? ' is-display' : ' is-inline') + (this.block ? ' is-block' : '')
    el.contentEditable = 'false'
    try {
      el.innerHTML = renderMath(this.source, this.display)
      const error = el.querySelector<HTMLElement>('.katex-error')
      if (error) {
        el.classList.add('has-error')
        el.title = error.title || '公式语法有误'
      }
    } catch (error) {
      el.textContent = this.source
      el.classList.add('has-error')
      el.title = error instanceof Error ? error.message : '公式渲染失败'
    }
    el.addEventListener('mousedown', (e: Event) => {
      const mouse = e as MouseEvent
      if (mouse.ctrlKey || mouse.metaKey) return
      e.preventDefault()
      view.focus()
      view.dispatch({ selection: { anchor: this.from } })
    })
    return el
  }

  ignoreEvent() {
    return true
  }
}

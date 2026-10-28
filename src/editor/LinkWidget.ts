import { EditorView, WidgetType } from '@codemirror/view'

export class LinkWidget extends WidgetType {
  constructor(readonly label: string, readonly target: string, readonly from: number) {
    super()
  }

  eq(o: LinkWidget) {
    return o.label === this.label && o.target === this.target && o.from === this.from
  }

  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = 'cm-md-link cm-md-wikilink'
    el.dataset.href = this.target
    el.title = this.target + '（Ctrl/Cmd+点击打开）'
    el.textContent = this.label
    el.contentEditable = 'false'
    el.addEventListener('mousedown', (event: Event) => {
      const mouse = event as MouseEvent
      if (mouse.ctrlKey || mouse.metaKey) return
      mouse.preventDefault()
      view.focus()
      view.dispatch({ selection: { anchor: this.from } })
    })
    return el
  }

  ignoreEvent() {
    return true
  }
}

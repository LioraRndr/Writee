interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, source: string): Promise<{ svg: string }>
}

export interface MermaidColors {
  background: string
  primaryColor: string
  primaryTextColor: string
  primaryBorderColor: string
  secondaryColor: string
  tertiaryColor: string
  lineColor: string
  textColor: string
  fontFamily: string
  clusterBkg: string
  clusterBorder: string
  edgeLabelBackground: string
  darkMode?: boolean
}

let mermaidImport: Promise<MermaidApi> | null = null
let mermaidQueue: Promise<unknown> = Promise.resolve()
let mermaidId = 0

function loadMermaid() {
  mermaidImport ??= import('mermaid').then((module) => module.default as unknown as MermaidApi)
  return mermaidImport
}

export function currentMermaidColors(_theme: string): MermaidColors {
  const styles = getComputedStyle(document.documentElement)
  const value = (name: string) => styles.getPropertyValue(name).trim()
  return {
    background: value('--bg'),
    primaryColor: value('--accent-soft'),
    primaryTextColor: value('--ink'),
    primaryBorderColor: value('--line-strong'),
    secondaryColor: value('--bg-sunken'),
    tertiaryColor: value('--bg-elev'),
    lineColor: value('--ink-3'),
    textColor: value('--ink'),
    fontFamily: value('--font-ui'),
    clusterBkg: value('--bg-elev'),
    clusterBorder: value('--line'),
    edgeLabelBackground: value('--bg-elev'),
    darkMode: styles.colorScheme === 'dark',
  }
}

export function renderMermaid(source: string, theme: string, colors = currentMermaidColors(theme)) {
  const task = mermaidQueue.then(async () => {
    const mermaid = await loadMermaid()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      darkMode: colors.darkMode ?? false,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      themeVariables: { ...colors, fontSize: '16px' },
    })
    const result = await mermaid.render(`writee-mermaid-${theme}-${++mermaidId}`, source)
    return result.svg
  })
  mermaidQueue = task.catch(() => undefined)
  return task
}

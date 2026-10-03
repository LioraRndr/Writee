import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/theme.css'
import './styles/app.css'
import './styles/editor.css'
import './styles/cards.css'
import './styles/rail.css'
import App from './App'
import { useDoc } from './store/docStore'
import { useUI } from './store/uiStore'
import { registry } from './editor/registry'
import * as session from './store/session'
import { buildNotesPrompt } from './core/notesPrompt'
import { importAnalysis } from './analysis/format'
import { buildManualPrompt } from './analysis/run'

if (import.meta.env.DEV)
  Object.assign(window, { __writee: { useDoc, useUI, registry, session, buildNotesPrompt, importAnalysis, buildManualPrompt } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

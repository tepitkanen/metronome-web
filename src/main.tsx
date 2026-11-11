import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MetronomeController } from './audio/MetronomeController'
// Bundled as a separate file; Vite gives us its URL for audioWorklet.addModule().
import workletUrl from './engine/worklet.ts?worker&url'

const controller = new MetronomeController(workletUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
)

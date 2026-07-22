import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ConfirmationProvider } from './components/ConfirmationProvider.tsx'
import { DesktopTaskNote } from './views/DesktopTaskNote.tsx'

const isDesktopTaskNote = window.location.hash === '#desktop-task-note'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDesktopTaskNote ? (
      <DesktopTaskNote />
    ) : (
      <ConfirmationProvider>
        <App />
      </ConfirmationProvider>
    )}
  </StrictMode>,
)

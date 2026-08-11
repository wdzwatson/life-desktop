import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ConfirmationProvider } from './components/ConfirmationProvider.tsx'
import { DesktopTaskNote } from './views/DesktopTaskNote.tsx'

const isDesktopTaskNote = window.location.hash === '#desktop-task-note'
const isNotesPopup = window.location.hash === '#notes-popup'
const Notes = lazy(() => import('./views/Notes.tsx').then(({ Notes }) => ({ default: Notes })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDesktopTaskNote ? (
      <DesktopTaskNote />
    ) : isNotesPopup ? (
      <Suspense fallback={null}>
        <Notes popup />
      </Suspense>
    ) : (
      <ConfirmationProvider>
        <App />
      </ConfirmationProvider>
    )}
  </StrictMode>,
)

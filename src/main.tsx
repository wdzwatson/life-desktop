import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ConfirmationProvider } from './components/ConfirmationProvider.tsx'
import { DesktopTaskNote } from './views/DesktopTaskNote.tsx'
import { ScreenCaptureEditorWindow } from './components/ScreenCaptureEditorWindow.tsx'
import { DesktopTitlebar } from './components/DesktopTitlebar.tsx'

const isDesktopTaskNote = window.location.hash === '#desktop-task-note'
const isNotesPopup = window.location.hash === '#notes-popup'
const Notes = lazy(() => import('./views/Notes.tsx').then(({ Notes }) => ({ default: Notes })))
const isScreenCaptureEditor = window.location.hash === '#screen-capture-editor'
const electronPlatform = (window as any).electronAPI?.platform
const hasCustomTitlebar = electronPlatform === 'win32' || electronPlatform === 'linux'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScreenCaptureEditor ? (
      <ScreenCaptureEditorWindow />
    ) : isDesktopTaskNote ? (
      <DesktopTaskNote />
    ) : isNotesPopup ? (
      <Suspense fallback={null}>
        <Notes popup />
      </Suspense>
    ) : (
      <ConfirmationProvider>
        <div className={`app-window${hasCustomTitlebar ? ' app-window--custom-titlebar' : ''}`}>
          <DesktopTitlebar />
          <App />
        </div>
      </ConfirmationProvider>
    )}
  </StrictMode>,
)

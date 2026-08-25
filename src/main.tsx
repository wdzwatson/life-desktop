import { lazy, StrictMode, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ConfirmationProvider } from './components/ConfirmationProvider.tsx'
import { DesktopTaskNote } from './views/DesktopTaskNote.tsx'
import { ScreenCaptureEditorWindow } from './components/ScreenCaptureEditorWindow.tsx'
import { DesktopTitlebar } from './components/DesktopTitlebar.tsx'
import { useAppStore } from './store/useAppStore'
import { applyAppearanceToDocument, normalizeAppearanceSettings } from './appearance'

const isDesktopTaskNote = window.location.hash === '#desktop-task-note'
const isNotesPopup = window.location.hash === '#notes-popup'
const Notes = lazy(() => import('./views/Notes.tsx').then(({ Notes }) => ({ default: Notes })))
const isScreenCaptureEditor = window.location.hash === '#screen-capture-editor'
const electronPlatform = (window as any).electronAPI?.platform
const hasCustomTitlebar = electronPlatform === 'win32' || electronPlatform === 'linux'

function NotesPopup() {
  const loadInitialConfig = useAppStore((state) => state.loadInitialConfig)

  useEffect(() => {
    void loadInitialConfig()
  }, [loadInitialConfig])

  return (
    <Suspense fallback={null}>
      <div className={`app-window${hasCustomTitlebar ? ' app-window--custom-titlebar' : ''}`}>
        <DesktopTitlebar title="LifeOS 笔记编辑" />
        <Notes popup />
      </div>
    </Suspense>
  )
}

function DesktopTaskNoteShell() {
  const loadInitialConfig = useAppStore((state) => state.loadInitialConfig)
  const api = (window as any).electronAPI

  useEffect(() => {
    void loadInitialConfig()
    return api?.onAppearanceChanged?.((change: { appearance?: unknown; theme?: string }) => {
      applyAppearanceToDocument(normalizeAppearanceSettings(change.appearance, change.theme))
    })
  }, [api, loadInitialConfig])

  return <DesktopTaskNote />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScreenCaptureEditor ? (
      <ScreenCaptureEditorWindow />
    ) : isDesktopTaskNote ? (
      <DesktopTaskNoteShell />
    ) : isNotesPopup ? (
      <NotesPopup />
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

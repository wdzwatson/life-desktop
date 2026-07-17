import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Statusbar } from './components/Statusbar'
import { ViewportPortal } from './components/ViewportPortal'
import { useAppStore } from './store/useAppStore'
import { useTranslation } from 'react-i18next'

// Screen views
import { AuthScreen } from './components/AuthScreen'

function ScreenLoading({ screen }: { screen: string }) {
  return (
    <div
      className={`screen-loading screen-loading--${screen}`}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="screen-loading__bar" />
      <div className="screen-loading__row screen-loading__row--wide" />
      <div className="screen-loading__row" />
      <div className="screen-loading__grid">
        <div className="screen-loading__card" />
        <div className="screen-loading__card" />
        <div className="screen-loading__card" />
      </div>
    </div>
  )
}

const Dashboard = lazy(() => import('./views/Dashboard').then(({ Dashboard }) => ({ default: Dashboard })))
const Tasks = lazy(() => import('./views/Tasks').then(({ Tasks }) => ({ default: Tasks })))
const Notes = lazy(() => import('./views/Notes').then(({ Notes }) => ({ default: Notes })))
const Books = lazy(() => import('./views/Books').then(({ Books }) => ({ default: Books })))
const Videos = lazy(() => import('./views/Videos').then(({ Videos }) => ({ default: Videos })))
const Toolbox = lazy(() => import('./views/Toolbox').then(({ Toolbox }) => ({ default: Toolbox })))
const Settings = lazy(() => import('./views/Settings').then(({ Settings }) => ({ default: Settings })))

function App() {
  const { t } = useTranslation()

  const isAuthenticated = useAppStore((state) => state.isAuthenticated)
  const activeScreen = useAppStore((state) => state.activeScreen)
  const setActiveScreen = useAppStore((state) => state.setActiveScreen)
  const setTaskTab = useAppStore((state) => state.setTaskTab)
  const loadInitialConfig = useAppStore((state) => state.loadInitialConfig)
  const showToast = useAppStore((state) => state.showToast)
  const userId = useAppStore((state) => state.userId)

  // Command palette overlay states
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [screenProgressVisible, setScreenProgressVisible] = useState(false)
  const hasMountedScreen = useRef(false)

  const api = (window as any).electronAPI
  const isMac = navigator.userAgent.includes('Mac')

  useEffect(() => {
    if (!hasMountedScreen.current) {
      hasMountedScreen.current = true
      return
    }

    setScreenProgressVisible(true)
    const timer = window.setTimeout(() => setScreenProgressVisible(false), 360)

    return () => window.clearTimeout(timer)
  }, [activeScreen])

  useEffect(() => {
    const preloadTimer = window.setTimeout(() => {
      // Warm the largest screen chunks while the user is idle. Browser caching
      // deduplicates these imports when React.lazy needs them later.
      void import('./views/Notes')
      void import('./views/Books')
      void import('./views/Videos')
    }, 1200)

    return () => window.clearTimeout(preloadTimer)
  }, [])

  useEffect(() => {
    // 1. Initialize store config (theme, language, active user)
    loadInitialConfig()

    // 2. Register global hotkey listeners (Cmd+K / Ctrl+K)
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      } else if (e.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    // 3. Register scheduler notifications from IPC
    let unsubUpdate: (() => void) | undefined

    if (api) {
      api.onDownloadFinished?.((data: any) => {
        showToast(t('app.download_finished', { title: data.title }))
      })

      // Auto check updates if enabled
      api.getSettings().then((settings: unknown) => {
        const s = settings as { autoCheckUpdates?: boolean }
        const autoCheck = s?.autoCheckUpdates !== false
        if (autoCheck) {
          api.checkForUpdates(true)
        }
      })

      // Listen to update available event
      unsubUpdate = api.onUpdateAvailable?.((info: unknown) => {
        const inf = info as { version: string }
        showToast(t('app.update_available_toast', { version: inf.version }))
      })
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (unsubUpdate) unsubUpdate()
    }
  }, [])

  // Dynamic search engine querying tasks, notes, books, and videos
  useEffect(() => {
    if (!searchQuery.trim() || !api) {
      setSearchResults([])
      return
    }

    const runFtsQuery = async () => {
      const results: any[] = []

      // If command `/` input
      if (searchQuery.startsWith('/task ')) {
        results.push({
          type: 'cmd',
          title: t('app.create_task_cmd_title', { query: searchQuery.replace('/task ', '') }),
          desc: t('app.create_task_cmd_desc'),
          action: () => handleCreateTaskFromCmd(searchQuery.replace('/task ', '')),
        })
      } else if (searchQuery.startsWith('/note ')) {
        results.push({
          type: 'cmd',
          title: t('app.create_note_cmd_title', { query: searchQuery.replace('/note ', '') }),
          desc: t('app.create_note_cmd_desc'),
          action: () => handleCreateNoteFromCmd(searchQuery.replace('/note ', '')),
        })
      } else {
        // Query tasks.db
        const tasksRes = await api.dbQuery(
          'tasks',
          'SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? LIMIT 3',
          [`%${searchQuery}%`, `%${searchQuery}%`],
        )
        if (tasksRes?.success) {
          tasksRes.data.forEach((taskObj: any) => {
            results.push({
              type: 'tasks',
              title: taskObj.title,
              desc: t('app.search_desc_task', {
                priority: taskObj.priority,
                due_date: taskObj.due_date,
              }),
              action: () => {
                setActiveScreen('tasks')
                setTaskTab('list')
                setSearchOpen(false)
              },
            })
          })
        }

        // Query notes.db (FTS5)
        const notesRes = await api.dbQuery(
          'notes',
          'SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? LIMIT 3',
          [`%${searchQuery}%`, `%${searchQuery}%`],
        )
        if (notesRes?.success) {
          notesRes.data.forEach((n: any) => {
            results.push({
              type: 'notes',
              title: n.title,
              desc: t('app.search_desc_note', { type: n.note_type }),
              action: () => {
                setActiveScreen('notes')
                setSearchOpen(false)
              },
            })
          })
        }

        // Query books.db
        const booksRes = await api.dbQuery(
          'books',
          'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? LIMIT 2',
          [`%${searchQuery}%`, `%${searchQuery}%`],
        )
        if (booksRes?.success) {
          booksRes.data.forEach((b: any) => {
            results.push({
              type: 'books',
              title: b.title,
              desc: t('app.search_desc_book', {
                author: b.author,
                progress: Math.round(b.progress),
              }),
              action: () => {
                setActiveScreen('books')
                setSearchOpen(false)
              },
            })
          })
        }
      }

      setSearchResults(results)
    }

    const timer = setTimeout(runFtsQuery, 150)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Create task command handler
  const handleCreateTaskFromCmd = async (title: string) => {
    if (!api) return
    const todayYMD = new Date().toISOString().slice(0, 10)
    const res = await api.dbQuery(
      'tasks',
      `
      INSERT INTO tasks (title, description, priority, status, due_date, is_completed, progress)
      VALUES (?, '', 'mid', '待处理', ?, 0, 0)
    `,
      [title.trim(), todayYMD],
    )

    if (res?.success) {
      showToast(t('app.toast_task_generated', { title }))
      setSearchOpen(false)
      setSearchQuery('')
      setActiveScreen('tasks')
      setTaskTab('list')
    }
  }

  // Create note command handler
  const handleCreateNoteFromCmd = async (title: string) => {
    if (!api) return
    const res = await api.dbQuery(
      'notes',
      `
      INSERT INTO notes (title, content, note_type) 
      VALUES (?, '# 新建笔记', 'markdown')
    `,
      [title.trim()],
    )

    if (res?.success) {
      showToast(t('app.toast_note_created', { title }))
      setSearchOpen(false)
      setSearchQuery('')
      setActiveScreen('notes')
    }
  }

  const handleDotClick = (action: string) => {
    if (api) {
      if (action === 'minimize') api.minimize()
      else if (action === 'maximize') api.maximize()
      else if (action === 'close') api.close()
    }
  }

  // Screen View Switch Router
  const renderScreen = () => {
    switch (activeScreen) {
      case 'dashboard':
        return <Dashboard />
      case 'tasks':
        return <Tasks />
      case 'notes':
        return <Notes />
      case 'books':
        return <Books />
      case 'videos':
        return <Videos />
      case 'toolbox':
        return <Toolbox />
      case 'settings':
        return <Settings />
      default:
        return <Dashboard />
    }
  }

  if (!isAuthenticated) {
    return <AuthScreen />
  }

  return (
    <div className="app-container">
      {/* 1. Window Frameless Titlebar */}
      <header className="title-bar">
        <div className="window-dots">
          {!isMac && (
            <>
              <button className="dot-btn dot-close" onClick={() => handleDotClick('close')} />
              <button className="dot-btn dot-min" onClick={() => handleDotClick('minimize')} />
              <button className="dot-btn dot-max" onClick={() => handleDotClick('maximize')} />
            </>
          )}
        </div>
        <div className="app-title">LifeOS — Local Workspace</div>
        <div className="app-meta">SQLite · Local ({userId})</div>
      </header>

      {/* 2. Main Workspace Layout */}
      <div className="shell-container">
        <Sidebar />
        <main className="main-workspace">
          <Topbar onOpenSearch={() => setSearchOpen(true)} />
          <div
            className={`screen-progress ${screenProgressVisible ? 'is-visible' : ''}`}
            role="progressbar"
            aria-hidden="true"
          />
          <section className="content-pane">
            <div key={activeScreen} className="screen-transition">
              <Suspense fallback={<ScreenLoading screen={activeScreen} />}>
                {renderScreen()}
              </Suspense>
            </div>
          </section>
        </main>
      </div>

      {/* 3. Window Status bar */}
      <Statusbar />

      {/* 4. Global Search & Command Palette Modal Overlay */}
      {searchOpen && (
        <ViewportPortal>
          <div
            className="command-palette-overlay"
            onClick={() => setSearchOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              backgroundColor: 'var(--overlay-command-bg)',
              backdropFilter: 'blur(var(--overlay-command-blur))',
              WebkitBackdropFilter: 'blur(var(--overlay-command-blur))',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              paddingTop: '80px',
            }}
          >
            <div
              className="command-palette"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '600px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                boxShadow:
                  '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                overflow: 'hidden',
              }}
            >
              {/* Search Input */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--color-border)',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '18px', color: 'var(--text-muted)' }}>⌕</span>
                <input
                  autoFocus
                  style={{
                    border: 'none',
                    outline: 'none',
                    fontSize: '14px',
                    width: '100%',
                    backgroundColor: 'transparent',
                    color: 'var(--text-main)',
                  }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('app.search_placeholder')}
                />
                <span className="kbd-shortcut" style={{ margin: 0 }}>
                  Esc
                </span>
              </div>

              {/* Results Grid */}
              <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '8px' }}>
                {searchResults.length === 0 ? (
                  <div
                    style={{
                      padding: '24px',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                    }}
                  >
                    {searchQuery.trim() ? t('app.search_no_results') : t('app.search_default_hint')}
                  </div>
                ) : (
                  searchResults.map((result, idx) => (
                    <div
                      key={idx}
                      onClick={result.action}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: 'transparent',
                        transition: 'background-color 0.1s',
                      }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-app)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div>
                        <strong
                          style={{ fontSize: '13px', display: 'block', color: 'var(--text-main)' }}
                        >
                          {result.title}
                        </strong>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {result.desc}
                        </span>
                      </div>
                    <span className="pill" style={{ textTransform: 'uppercase', fontSize: '9px' }}>
                        {result.type}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </ViewportPortal>
      )}
    </div>
  )
}

export default App

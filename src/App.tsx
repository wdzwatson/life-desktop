import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Statusbar } from './components/Statusbar'
import { useAppStore } from './store/useAppStore'
import { useTranslation } from 'react-i18next'

// Screen views
import { Dashboard } from './views/Dashboard'
import { Tasks } from './views/Tasks'
import { Notes } from './views/Notes'
import { Books } from './views/Books'
import { Videos } from './views/Videos'
import { Toolbox } from './views/Toolbox'
import { Settings } from './views/Settings'
import { AuthScreen } from './components/AuthScreen'

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

  const api = (window as any).electronAPI
  const isMac = navigator.userAgent.includes('Mac')

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
    if (api) {
      api.onDownloadFinished?.((data: any) => {
        showToast(t('app.download_finished', { title: data.title }))
      })
      // Listen to task generation and overdue events
      const handleSchedulerNotif = (_event: any, data: any) => {
        showToast(t('app.recurring_triggered', { body: data.body }))
      }
      const handleOverdueNotif = (_event: any, data: any) => {
        showToast(t('app.task_overdue_warning', { title: data.title }))
      }
      // Since contextBridge exposes these events if we define them,
      // we can listen via ipcRenderer if exposed or standard window callbacks.
      // (For this mock setup we handle notifications via the main thread logger).
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
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
          <section className="content-pane">{renderScreen()}</section>
        </main>
      </div>

      {/* 3. Window Status bar */}
      <Statusbar />

      {/* 4. Global Search & Command Palette Modal Overlay */}
      {searchOpen && (
        <div
          onClick={() => setSearchOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(2px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '80px',
            animation: 'fadeIn 0.15s ease both',
          }}
        >
          <style
            dangerouslySetInnerHTML={{
              __html: `
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideDown { from { transform: translateY(-10px); } to { transform: none; } }
          `,
            }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '600px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              boxShadow:
                '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              overflow: 'hidden',
              animation: 'slideDown 0.15s ease both',
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
      )}
    </div>
  )
}

export default App

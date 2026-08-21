import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Statusbar } from './components/Statusbar'
import { ViewportPortal } from './components/ViewportPortal'
import { useAppStore } from './store/useAppStore'
import { useTranslation } from 'react-i18next'
import { AIChatBoundary } from './views/ai/AIChatBoundary'
import {
  dispatchGlobalSearchOpen,
  groupGlobalSearchResults,
  getGlobalSearchOptionId,
  getNextGlobalSearchIndex,
  rankGlobalSearchResults,
  type GlobalSearchState,
  type GlobalSearchResult,
} from './globalSearch'

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

const Dashboard = lazy(() =>
  import('./views/Dashboard').then(({ Dashboard }) => ({ default: Dashboard })),
)
const Tasks = lazy(() => import('./views/Tasks').then(({ Tasks }) => ({ default: Tasks })))
const Notes = lazy(() => import('./views/Notes').then(({ Notes }) => ({ default: Notes })))
const Books = lazy(() => import('./views/Books').then(({ Books }) => ({ default: Books })))
const Videos = lazy(() => import('./views/Videos').then(({ Videos }) => ({ default: Videos })))
const Toolbox = lazy(() => import('./views/Toolbox').then(({ Toolbox }) => ({ default: Toolbox })))
const AIChat = lazy(() => import('./views/ai/AIChat').then(({ AIChat }) => ({ default: AIChat })))
const Settings = lazy(() =>
  import('./views/Settings').then(({ Settings }) => ({ default: Settings })),
)
const Launchpad = lazy(() =>
  import('./views/Launchpad').then(({ Launchpad }) => ({ default: Launchpad })),
)

function App() {
  const { t } = useTranslation()

  const isAuthenticated = useAppStore((state) => state.isAuthenticated)
  const activeScreen = useAppStore((state) => state.activeScreen)
  const setActiveScreen = useAppStore((state) => state.setActiveScreen)
  const setTaskTab = useAppStore((state) => state.setTaskTab)
  const sidebarDisplayMode = useAppStore((state) => state.sidebarDisplayMode)
  const loadInitialConfig = useAppStore((state) => state.loadInitialConfig)
  const showToast = useAppStore((state) => state.showToast)
  const isInitialConfigLoaded = useAppStore((state) => state.isInitialConfigLoaded)

  // Command palette overlay states
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([])
  const [searchState, setSearchState] = useState<GlobalSearchState>('idle')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchRetryNonce, setSearchRetryNonce] = useState(0)
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  const searchRequestIdRef = useRef(0)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const wasSearchOpenRef = useRef(false)
  const [screenProgressVisible, setScreenProgressVisible] = useState(false)
  const hasMountedScreen = useRef(false)

  const api = (window as any).electronAPI
  const searchGroups = groupGlobalSearchResults(searchResults)
  const visibleSearchResults = searchGroups.flatMap((group) => group.items)

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
    const query = searchQuery.trim()
    const requestId = ++searchRequestIdRef.current

    if (!query) {
      setSearchResults([])
      setSearchError(null)
      setSearchState('idle')
      return
    }
    if (!api) {
      setSearchResults([])
      setSearchError(t('app.search_unavailable'))
      setSearchState('error')
      return
    }

    setSearchResults([])
    setSearchError(null)
    setSearchState('loading')

    const timer = window.setTimeout(() => {
      const runSearchQuery = async () => {
        const results: GlobalSearchResult[] = []

        if (query.startsWith('/task ')) {
          const title = query.replace('/task ', '')
          results.push({
            type: 'cmd',
            id: `command:task:${query}`,
            module: 'command',
            title: t('app.create_task_cmd_title', { query: title }),
            description: t('app.create_task_cmd_desc'),
            action: () => handleCreateTaskFromCmd(title),
          })
        } else if (query.startsWith('/note ')) {
          const title = query.replace('/note ', '')
          results.push({
            type: 'cmd',
            id: `command:note:${query}`,
            module: 'command',
            title: t('app.create_note_cmd_title', { query: title }),
            description: t('app.create_note_cmd_desc'),
            action: () => handleCreateNoteFromCmd(title),
          })
        } else {
          const likeQuery = `%${query}%`
          const querySafely = (database: string, sql: string, params: string[]) =>
            Promise.resolve(api.dbQuery(database, sql, params)).catch((error: unknown) => ({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }))
          const [tasksRes, notesRes, booksRes, videosRes] = await Promise.all([
            querySafely(
              'tasks',
              'SELECT id, title, description, priority, due_date, updated_at, COUNT(*) OVER() AS total_count FROM tasks WHERE title LIKE ? OR description LIKE ? LIMIT 4',
              [likeQuery, likeQuery],
            ),
            querySafely(
              'notes',
              'SELECT id, title, content, note_type, updated_at, COUNT(*) OVER() AS total_count FROM notes WHERE COALESCE(is_private, 0) = 0 AND (title LIKE ? OR content LIKE ?) LIMIT 4',
              [likeQuery, likeQuery],
            ),
            querySafely(
              'books',
              'SELECT id, title, author, progress, created_at AS updated_at, COUNT(*) OVER() AS total_count FROM books WHERE title LIKE ? OR author LIKE ? LIMIT 4',
              [likeQuery, likeQuery],
            ),
            querySafely(
              'videos',
              'SELECT id, title, source, duration, url, source_url, updated_at, COUNT(*) OVER() AS total_count FROM videos WHERE title LIKE ? OR url LIKE ? OR source_url LIKE ? LIMIT 4',
              [likeQuery, likeQuery, likeQuery],
            ),
          ])

          if (requestId !== searchRequestIdRef.current) return

          const responses = [
            ['tasks', tasksRes],
            ['notes', notesRes],
            ['books', booksRes],
            ['videos', videosRes],
          ] as const
          const failedModules = responses.filter(([, response]) => !response?.success)

          if (tasksRes?.success) {
            tasksRes.data.forEach((taskObj: any) => {
              results.push({
                type: 'tasks',
                id: taskObj.id,
                module: 'tasks',
                title: taskObj.title,
                matchedField: t('app.search_match_title'),
                updatedAt: taskObj.updated_at,
                totalCount: taskObj.total_count,
                searchableFields: {
                  [t('app.search_match_description')]: taskObj.description,
                },
                description: t('app.search_desc_task', {
                  priority: taskObj.priority,
                  due_date: taskObj.due_date,
                }),
                action: () => {
                  setActiveScreen('tasks')
                  setTaskTab('list')
                  window.setTimeout(() => dispatchGlobalSearchOpen('tasks', taskObj.id), 200)
                  setSearchOpen(false)
                },
              })
            })
          }
          if (notesRes?.success) {
            notesRes.data.forEach((n: any) => {
              results.push({
                type: 'notes',
                id: n.id,
                module: 'notes',
                title: n.title,
                matchedField: t('app.search_match_title'),
                updatedAt: n.updated_at,
                totalCount: n.total_count,
                searchableFields: {
                  [t('app.search_match_content')]: n.content,
                },
                description: t('app.search_desc_note', { type: n.note_type }),
                action: () => {
                  setActiveScreen('notes')
                  window.setTimeout(() => dispatchGlobalSearchOpen('notes', n.id), 200)
                  setSearchOpen(false)
                },
              })
            })
          }
          if (booksRes?.success) {
            booksRes.data.forEach((b: any) => {
              results.push({
                type: 'books',
                id: b.id,
                module: 'books',
                title: b.title,
                matchedField: t('app.search_match_title'),
                updatedAt: b.updated_at,
                totalCount: b.total_count,
                searchableFields: {
                  [t('app.search_match_author')]: b.author,
                },
                description: t('app.search_desc_book', {
                  author: b.author,
                  progress: Math.round(b.progress),
                }),
                action: () => {
                  setActiveScreen('books')
                  window.setTimeout(() => dispatchGlobalSearchOpen('books', b.id), 200)
                  setSearchOpen(false)
                },
              })
            })
          }
          if (videosRes?.success) {
            videosRes.data.forEach((video: any) => {
              results.push({
                type: 'videos',
                id: video.id,
                module: 'videos',
                title: video.title,
                matchedField: t('app.search_match_title'),
                updatedAt: video.updated_at,
                totalCount: video.total_count,
                searchableFields: {
                  [t('app.search_match_url')]: video.url || video.source_url,
                },
                description: t('app.search_desc_video', {
                  source: video.source || t('app.search_video_source_unknown'),
                  duration: video.duration || t('app.search_video_duration_unknown'),
                }),
                action: () => {
                  setActiveScreen('videos')
                  window.setTimeout(() => dispatchGlobalSearchOpen('videos', video.id), 200)
                  setSearchOpen(false)
                },
              })
            })
          }

          if (failedModules.length === responses.length) {
            setSearchResults([])
            setSearchError(t('app.search_error'))
            setSearchState('error')
            return
          }
          setSearchResults(rankGlobalSearchResults(query, results))
          setSearchError(
            failedModules.length > 0
              ? t('app.search_partial_error', {
                  modules: failedModules.map(([module]) => module).join(', '),
                })
              : null,
          )
          setSearchState(
            failedModules.length > 0 ? 'partial-error' : results.length > 0 ? 'ready' : 'empty',
          )
          return
        }

        if (requestId !== searchRequestIdRef.current) return
        setSearchResults(rankGlobalSearchResults(query, results))
        setSearchState('ready')
      }

      void runSearchQuery().catch((error: unknown) => {
        if (requestId !== searchRequestIdRef.current) return
        setSearchResults([])
        setSearchError(error instanceof Error ? error.message : t('app.search_error'))
        setSearchState('error')
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [api, searchQuery, searchRetryNonce, t])

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
    } else if (wasSearchOpenRef.current) {
      searchButtonRef.current?.focus()
    }
    wasSearchOpenRef.current = searchOpen
  }, [searchOpen])

  useEffect(() => {
    setActiveSearchIndex(-1)
  }, [searchQuery, searchState, visibleSearchResults.length])

  const openSearchModule = (module: GlobalSearchResult['module']) => {
    if (module === 'command') return
    setActiveScreen(module)
    if (module === 'tasks') setTaskTab('list')
    setSearchOpen(false)
  }

  // Create task command handler
  const handleCreateTaskFromCmd = async (title: string) => {
    if (!api) return
    const now = new Date()
    const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const startTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const res = await api.dbQuery(
      'tasks',
      `
      INSERT INTO tasks (title, description, priority, status, start_date, start_time, due_date, due_time, is_completed, progress)
      VALUES (?, '', 'mid', '进行中', ?, ?, ?, '23:59:59', 0, 0)
    `,
      [title.trim(), todayYMD, startTime, todayYMD],
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
      case 'ai':
        return (
          <AIChatBoundary>
            <AIChat />
          </AIChatBoundary>
        )
      case 'settings':
        return <Settings />
      default:
        return <Dashboard />
    }
  }

  if (!isInitialConfigLoaded) {
    return (
      <div className="app-boot-loading">
        <ScreenLoading screen="landing" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <AuthScreen />
  }

  // Launchpad intentionally sits outside the workspace shell. It is a focused startup
  // moment, so navigation, topbar, and status information appear only after an action.
  if (activeScreen === 'landing') {
    return (
      <Suspense
        fallback={
          <div className="app-boot-loading">
            <ScreenLoading screen="landing" />
          </div>
        }
      >
        <Launchpad />
      </Suspense>
    )
  }

  return (
    <div className="app-container">
      {/* 1. Main Workspace Layout. The native title bar lives outside this client area. */}
      <div className={`shell-container sidebar-display-${sidebarDisplayMode}`}>
        <Sidebar />
        <main className="main-workspace">
          <Topbar searchButtonRef={searchButtonRef} onOpenSearch={() => setSearchOpen(true)} />
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

      {/* 2. Window Status bar */}
      <Statusbar />

      {/* 3. Global Search & Command Palette Modal Overlay */}
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
              role="dialog"
              aria-modal="true"
              aria-label={t('sidebar.search')}
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
                  ref={searchInputRef}
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
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setSearchOpen(false)
                      return
                    }
                    if (event.key === 'Enter') {
                      if (activeSearchIndex >= 0 && visibleSearchResults[activeSearchIndex]) {
                        event.preventDefault()
                        visibleSearchResults[activeSearchIndex].action()
                      }
                      return
                    }
                    const nextIndex = getNextGlobalSearchIndex(
                      activeSearchIndex,
                      event.key,
                      visibleSearchResults.length,
                    )
                    if (nextIndex !== activeSearchIndex) {
                      event.preventDefault()
                      setActiveSearchIndex(nextIndex)
                    }
                  }}
                  placeholder={t('app.search_placeholder')}
                  aria-label={t('app.search_placeholder')}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="global-search-results"
                  aria-expanded="true"
                  aria-activedescendant={
                    activeSearchIndex >= 0 ? getGlobalSearchOptionId(activeSearchIndex) : undefined
                  }
                />
                <span className="kbd-shortcut" style={{ margin: 0 }}>
                  Esc
                </span>
              </div>

              {/* Results Grid */}
              <div
                id="global-search-results"
                role="listbox"
                aria-label={t('app.search_results_label', { count: visibleSearchResults.length })}
                style={{ maxHeight: '360px', overflowY: 'auto', padding: '8px' }}
              >
                {searchState === 'loading' ? (
                  <div className="command-palette__status" role="status" aria-live="polite">
                    {t('app.search_loading')}
                  </div>
                ) : searchState === 'error' ? (
                  <div
                    className="command-palette__status command-palette__status--error"
                    role="alert"
                  >
                    <span>{searchError || t('app.search_error')}</span>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setSearchRetryNonce((value) => value + 1)}
                    >
                      {t('common.retry')}
                    </button>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div
                    style={{
                      padding: '24px',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                    }}
                  >
                    {searchState === 'empty'
                      ? t('app.search_no_results')
                      : t('app.search_default_hint')}
                  </div>
                ) : (
                  <>
                    {searchState === 'partial-error' && searchError ? (
                      <div
                        className="command-palette__status command-palette__status--warning"
                        role="status"
                      >
                        {searchError}
                      </div>
                    ) : null}
                    {searchGroups.map((group) => (
                      <div
                        key={group.module}
                        role="group"
                        aria-label={t('app.search_group_label', {
                          module: t(`app.search_group_${group.module}`),
                          count: group.totalCount,
                        })}
                        className="command-palette__group"
                      >
                        <div className="command-palette__group-heading" aria-hidden="true">
                          <span>{t(`app.search_group_${group.module}`)}</span>
                          <span>{group.totalCount}</span>
                        </div>
                        {group.items.map((result) => {
                          const index = visibleSearchResults.indexOf(result)
                          return (
                            <div
                              key={`${result.module}:${result.id}`}
                              id={getGlobalSearchOptionId(index)}
                              role="option"
                              aria-selected={activeSearchIndex === index}
                              tabIndex={-1}
                              onClick={result.action}
                              onMouseEnter={() => setActiveSearchIndex(index)}
                              style={{
                                padding: '10px 14px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                backgroundColor:
                                  activeSearchIndex === index ? 'var(--bg-app)' : 'transparent',
                                transition: 'background-color 0.1s',
                              }}
                              onMouseLeave={() => setActiveSearchIndex(-1)}
                            >
                              <div>
                                <strong
                                  style={{
                                    fontSize: '13px',
                                    display: 'block',
                                    color: 'var(--text-main)',
                                  }}
                                >
                                  {result.title}
                                </strong>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  {result.matchedField && result.snippet
                                    ? `${result.matchedField}: ${result.snippet}`
                                    : result.description}
                                </span>
                              </div>
                              <span
                                className="pill"
                                style={{ textTransform: 'uppercase', fontSize: '9px' }}
                              >
                                {result.type}
                              </span>
                            </div>
                          )
                        })}
                        {group.hasMore ? (
                          <button
                            type="button"
                            className="command-palette__view-all"
                            onClick={() => openSearchModule(group.module)}
                          >
                            {t('app.search_view_all', {
                              module: t(`app.search_group_${group.module}`),
                            })}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </>
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

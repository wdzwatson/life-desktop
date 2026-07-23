import { ExternalLink, Folder, KeyRound, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  filterDouyinFavoriteItems,
  getActiveDouyinFolderId,
  type DouyinFavoriteFolderView,
  type DouyinFavoriteItemView,
} from './douyinFavoritesUtils'
import { formatDuration } from './videoLibraryUtils'

interface DouyinAuthStatus {
  loggedIn?: boolean
}

interface DouyinListResponse<T> {
  success?: boolean
  data?: T
  error?: string
}

interface DouyinFavoriteItemsPage {
  items: DouyinFavoriteItemView[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

interface DouyinSyncProgress {
  phase: string
  startedAt: number
  foldersDiscovered: number
  foldersCompleted: number
  itemsSynced: number
  pagesLoaded: number
  currentFolderTitle?: string
}

interface DouyinSyncDiagnostic {
  kind:
    | 'page_loading'
    | 'page_ready'
    | 'page_failed'
    | 'triggering'
    | 'request_observed'
    | 'response_observed'
    | 'timeout'
  path?: string
  status?: number
}

const DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID = 'my-favorite-videos'

export function DouyinFavoritesPanel({
  showToast,
  workspace = false,
}: {
  showToast: (message: string) => void
  workspace?: boolean
}) {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  const [auth, setAuth] = useState<DouyinAuthStatus>({ loggedIn: false })
  const [folders, setFolders] = useState<DouyinFavoriteFolderView[]>([])
  const [items, setItems] = useState<DouyinFavoriteItemView[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [itemsHasMore, setItemsHasMore] = useState(false)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<DouyinSyncProgress | null>(null)
  const [syncDiagnostic, setSyncDiagnostic] = useState<DouyinSyncDiagnostic | null>(null)
  const [syncNow, setSyncNow] = useState(() => Date.now())
  const [syncRefreshNonce, setSyncRefreshNonce] = useState(0)
  const [error, setError] = useState('')
  const lastSyncRefreshAt = useRef(0)
  const lastSyncActivityAt = useRef(0)
  const syncTimedOut = useRef(false)

  const refreshFolders = useCallback(async () => {
    if (!api) return
    const [authResult, foldersResult] = await Promise.all([
      api.getDouyinAuthStatus(),
      api.listDouyinFavoriteFolders(),
    ])
    setAuth(authResult || { loggedIn: false })
    if (!foldersResult?.success) {
      setError(foldersResult?.error || t('videos.douyin_load_failed'))
      return
    }
    const nextFolders = (foldersResult.data || []) as DouyinFavoriteFolderView[]
    setFolders(nextFolders)
    setActiveFolderId((current) => getActiveDouyinFolderId(nextFolders, current))
  }, [api, t])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await refreshFolders()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('videos.douyin_load_failed'))
    } finally {
      setLoading(false)
    }
  }, [refreshFolders, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!api || !activeFolderId) {
      setItems([])
      setItemsTotal(0)
      setItemsHasMore(false)
      return
    }
    let cancelled = false
    setItemsLoading(true)
    setItems([])
    void api
      .listDouyinFavoriteItems(activeFolderId, { offset: 0, limit: 100, query: searchQuery })
      .then((result: DouyinListResponse<DouyinFavoriteItemsPage>) => {
        if (cancelled) return
        if (!result?.success) {
          setError(result?.error || t('videos.douyin_load_failed'))
          setItems([])
          setItemsTotal(0)
          setItemsHasMore(false)
          return
        }
        const page = result.data
        setItems(page?.items || [])
        setItemsTotal(page?.total || 0)
        setItemsHasMore(Boolean(page?.hasMore))
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeFolderId, api, searchQuery, syncRefreshNonce, t])

  const loadMoreItems = async () => {
    if (!api || !activeFolderId || itemsLoading || !itemsHasMore) return
    setItemsLoading(true)
    try {
      const result = (await api.listDouyinFavoriteItems(activeFolderId, {
        offset: items.length,
        limit: 100,
        query: searchQuery,
      })) as DouyinListResponse<DouyinFavoriteItemsPage>
      if (!result?.success) {
        setError(result?.error || t('videos.douyin_load_failed'))
        return
      }
      const page = result.data
      setItems((current) => [...current, ...(page?.items || [])])
      setItemsTotal(page?.total || 0)
      setItemsHasMore(Boolean(page?.hasMore))
    } finally {
      setItemsLoading(false)
    }
  }

  useEffect(() => {
    if (!api?.onDouyinSyncProgress) return
    return api.onDouyinSyncProgress((progress: DouyinSyncProgress) => {
      lastSyncActivityAt.current = Date.now()
      setSyncProgress(progress)
      if (progress.phase !== 'writing_folders' && progress.phase !== 'writing_items') return
      const now = Date.now()
      if (now - lastSyncRefreshAt.current < 350) return
      lastSyncRefreshAt.current = now
      void refreshFolders()
      setSyncRefreshNonce((value) => value + 1)
    })
  }, [api, refreshFolders])

  useEffect(() => {
    if (!api?.onDouyinSyncDiagnostic) return
    return api.onDouyinSyncDiagnostic((event: DouyinSyncDiagnostic) => {
      lastSyncActivityAt.current = Date.now()
      setSyncDiagnostic(event)
    })
  }, [api])

  useEffect(() => {
    if (!syncing || !syncProgress) return
    setSyncNow(Date.now())
    const timer = window.setInterval(() => setSyncNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [syncing, syncProgress])

  useEffect(() => {
    if (!syncing) return
    const timer = window.setInterval(() => {
      if (Date.now() - lastSyncActivityAt.current < 75_000) return
      syncTimedOut.current = true
      const message = t('videos.douyin_sync_stalled')
      setError(message)
      setSyncing(false)
      setSyncProgress(null)
      showToast(message)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [showToast, syncing, t])

  const handleSync = async () => {
    if (!api || syncing) return
    if (!auth.loggedIn) {
      showToast(t('videos.douyin_login_required'))
      return
    }
    setSyncing(true)
    syncTimedOut.current = false
    lastSyncActivityAt.current = Date.now()
    setSyncProgress({
      phase: 'starting',
      startedAt: Date.now(),
      foldersDiscovered: 0,
      foldersCompleted: 0,
      itemsSynced: 0,
      pagesLoaded: 0,
    })
    setSyncDiagnostic(null)
    setError('')
    try {
      const result = await api.syncDouyinFavorites()
      if (syncTimedOut.current) return
      if (!result?.success) {
        const message = result?.error?.message || t('videos.douyin_sync_failed')
        setError(message)
        showToast(message)
        return
      }
      await refresh()
      showToast(
        result.complete === false
          ? t('videos.douyin_sync_partial', { count: result.itemsSynced || 0 })
          : t('videos.douyin_sync_success', { count: result.itemsSynced || 0 }),
      )
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  const filteredItems = useMemo(
    () => filterDouyinFavoriteItems(items, searchQuery),
    [items, searchQuery],
  )
  const isVideoFavoritesOnly =
    folders.length === 1 && folders[0].remote_id === DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID
  const syncElapsedSeconds = syncProgress
    ? Math.max(0, Math.floor((syncNow - syncProgress.startedAt) / 1_000))
    : 0
  const syncProgressLabel = syncProgress
    ? t(`videos.douyin_sync_phase_${syncProgress.phase}`, {
        folder: syncProgress.currentFolderTitle || t('videos.douyin_folders'),
        completed: syncProgress.foldersCompleted,
        total: syncProgress.foldersDiscovered,
        items: syncProgress.itemsSynced,
        pages: syncProgress.pagesLoaded,
        seconds: syncElapsedSeconds,
      })
    : ''
  const syncDiagnosticLabel = syncDiagnostic
    ? t(`videos.douyin_sync_diagnostic_${syncDiagnostic.kind}`, {
        path: syncDiagnostic.path || t('videos.douyin_sync_unknown_path'),
        status: syncDiagnostic.status || '-',
      })
    : ''

  return (
    <section
      className="card"
      aria-busy={loading || syncing}
      style={{
        display: 'grid',
        gap: '10px',
        minWidth: 0,
        minHeight: 0,
        flex: workspace ? 1 : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <strong
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flex: '1 1 160px' }}
        >
          <Folder size={14} />
          {t('videos.douyin_title')}
        </strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
          {auth.loggedIn ? t('videos.douyin_logged_in') : t('videos.douyin_not_logged_in')}
        </span>
        <button
          type="button"
          className="btn sm btn-icon"
          onClick={() => void refresh()}
          disabled={loading || syncing}
          title={t('videos.douyin_refresh')}
          aria-label={t('videos.douyin_refresh')}
          style={{ width: '30px', height: '30px', minWidth: '30px', padding: 0 }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => void handleSync()}
          disabled={syncing || !auth.loggedIn}
        >
          <RefreshCw size={13} className={syncing ? 'animate-spin' : undefined} />
          {syncing ? t('videos.douyin_syncing') : t('videos.douyin_sync')}
        </button>
      </div>

      {!auth.loggedIn ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }}>
          <KeyRound size={13} style={{ marginRight: '5px', verticalAlign: 'text-bottom' }} />
          {t('videos.douyin_login_hint')}
        </p>
      ) : null}
      {error ? (
        <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: '12px' }}>{error}</p>
      ) : null}
      {syncProgress ? (
        <div
          style={{ display: 'grid', gap: '3px', color: 'var(--text-muted)', fontSize: '12px' }}
          aria-live="polite"
        >
          <span>{syncProgressLabel}</span>
          <span>
            {t('videos.douyin_sync_counts', {
              folders: syncProgress.foldersDiscovered,
              items: syncProgress.itemsSynced,
              pages: syncProgress.pagesLoaded,
            })}
          </span>
          {syncDiagnostic ? <span>{syncDiagnosticLabel}</span> : null}
          <span>{t('videos.douyin_sync_window_hint')}</span>
        </div>
      ) : null}

      {folders.length === 0 && !loading ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }}>
          {t('videos.douyin_empty')}
        </p>
      ) : null}

      {folders.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isVideoFavoritesOnly
              ? 'minmax(0, 1fr)'
              : 'minmax(160px, 240px) minmax(0, 1fr)',
            gap: '12px',
            minWidth: 0,
            minHeight: 0,
            flex: workspace ? 1 : undefined,
          }}
        >
          {!isVideoFavoritesOnly ? (
            <nav
              aria-label={t('videos.douyin_folders')}
              style={{ display: 'grid', alignContent: 'start', gap: '3px' }}
            >
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={`btn sm ${activeFolderId === folder.id ? 'primary' : 'ghost'}`}
                  onClick={() => setActiveFolderId(folder.id)}
                  title={folder.diagnostic_message || folder.title}
                  style={{ justifyContent: 'space-between', minWidth: 0 }}
                >
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {folder.title}
                  </span>
                  <span aria-label={t('videos.douyin_item_count', { count: folder.item_count })}>
                    {folder.item_count}
                  </span>
                </button>
              ))}
            </nav>
          ) : null}
          <div
            style={{
              display: 'grid',
              gap: '8px',
              minWidth: 0,
              minHeight: 0,
              gridTemplateRows: workspace ? 'auto minmax(0, 1fr)' : undefined,
            }}
          >
            {isVideoFavoritesOnly ? (
              <strong style={{ fontSize: '12px' }}>{t('videos.douyin_my_favorite_videos')}</strong>
            ) : null}
            <input
              className="form-field"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('videos.douyin_search_placeholder')}
              style={{ height: '30px' }}
            />
            {itemsLoading && items.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }}>
                {t('videos.douyin_loading_items')}
              </p>
            ) : filteredItems.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }}>
                {t('videos.douyin_empty_folder')}
              </p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gap: '5px',
                  maxHeight: workspace ? undefined : '260px',
                  minHeight: 0,
                  overflowY: 'auto',
                }}
              >
                {filteredItems.map((item) => (
                  <article
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '40px minmax(0, 1fr) 30px',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    {item.thumbnail_url ? (
                      <img
                        src={item.thumbnail_url}
                        alt=""
                        style={{
                          width: '40px',
                          height: '40px',
                          objectFit: 'cover',
                          borderRadius: '4px',
                        }}
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '4px',
                          background: 'var(--bg-muted)',
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div
                        title={item.title}
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '12px',
                          fontWeight: 650,
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '10.5px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.author_name || t('videos.douyin_unknown_author')}
                        {item.duration_seconds ? ` · ${formatDuration(item.duration_seconds)}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn sm btn-icon ghost"
                      title={t('videos.btn_open_external')}
                      aria-label={t('videos.btn_open_external')}
                      onClick={() => void api?.openExternal?.(item.source_url)}
                      style={{ width: '30px', height: '30px', minWidth: '30px', padding: 0 }}
                    >
                      <ExternalLink size={13} />
                    </button>
                  </article>
                ))}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    paddingTop: '4px',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                    {t('videos.douyin_loaded_count', { loaded: items.length, total: itemsTotal })}
                  </span>
                  {itemsHasMore ? (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => void loadMoreItems()}
                      disabled={itemsLoading}
                    >
                      {itemsLoading
                        ? t('videos.douyin_loading_items')
                        : t('videos.douyin_load_more')}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

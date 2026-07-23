import {
  CheckSquare,
  Download,
  ExternalLink,
  Folder,
  KeyRound,
  Play,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfirmation } from '../components/ConfirmationProvider'
import { ViewportPortal } from '../components/ViewportPortal'
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
  const { confirm } = useConfirmation()
  const api = (window as any).electronAPI
  const [auth, setAuth] = useState<DouyinAuthStatus>({ loggedIn: false })
  const [folders, setFolders] = useState<DouyinFavoriteFolderView[]>([])
  const [items, setItems] = useState<DouyinFavoriteItemView[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [itemsHasMore, setItemsHasMore] = useState(false)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([])
  const [playingItem, setPlayingItem] = useState<DouyinFavoriteItemView | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState('')
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
    setSelectedItemIds([])
    void api
      .listDouyinFavoriteItems(activeFolderId, { offset: 0, limit: 20, query: searchQuery })
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

  useEffect(() => {
    if (!api?.onDouyinDownloadProgress) return
    return api.onDouyinDownloadProgress((event: { itemId?: number; progress?: number }) => {
      if (!event.itemId) return
      setItems((current) =>
        current.map((item) =>
          item.id === event.itemId
            ? {
                ...item,
                download_status: 'downloading',
                download_progress: Math.max(0, Math.min(100, event.progress || 0)),
              }
            : item,
        ),
      )
    })
  }, [api])

  useEffect(() => {
    if (!api?.onDouyinDownloadFinished) return
    return api.onDouyinDownloadFinished((event: { itemId?: number; filePath?: string }) => {
      if (!event.itemId) return
      setItems((current) =>
        current.map((item) =>
          item.id === event.itemId
            ? {
                ...item,
                download_status: 'downloaded',
                download_progress: 100,
                local_path: event.filePath || null,
                download_error: null,
              }
            : item,
        ),
      )
    })
  }, [api])

  useEffect(() => {
    if (!api?.onDouyinDownloadFailed) return
    return api.onDouyinDownloadFailed((event: { itemId?: number; message?: string }) => {
      if (!event.itemId) return
      setItems((current) =>
        current.map((item) =>
          item.id === event.itemId
            ? { ...item, download_status: 'failed', download_progress: 0, download_error: event.message || null }
            : item,
        ),
      )
    })
  }, [api])

  const loadMoreItems = async () => {
    if (!api || !activeFolderId || itemsLoading || !itemsHasMore) return
    setItemsLoading(true)
    try {
      const result = (await api.listDouyinFavoriteItems(activeFolderId, {
        offset: items.length,
        limit: 20,
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

  const startItemDownload = async (item: DouyinFavoriteItemView) => {
    if (!api || item.download_status === 'downloading') return
    if (item.download_status === 'downloaded') {
      if (
        !(await confirm({
          description: t('videos.douyin_confirm_redownload'),
          confirmLabel: t('videos.douyin_redownload'),
        }))
      )
        return
    }
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, download_status: 'downloading', download_progress: 0, download_error: null }
          : entry,
      ),
    )
    try {
      const result = await api.downloadDouyinFavorite(item.id)
      if (result?.success) return
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, download_status: 'failed', download_progress: 0, download_error: result?.error || null }
            : entry,
        ),
      )
      setError(result?.error || t('videos.douyin_download_failed'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, download_status: 'failed', download_progress: 0, download_error: message }
            : entry,
        ),
      )
      setError(message || t('videos.douyin_download_failed'))
    }
  }

  const playDownloadedItem = async (item: DouyinFavoriteItemView) => {
    if (!api || !item.local_path) return
    const result = await api.getVideoPlaybackUrl(item.local_path)
    if (!result?.success) {
      setError(result?.error || t('videos.toast_playback_failed'))
      return
    }
    setPlayingItem(item)
    setPlaybackUrl(result.url)
  }

  const toggleItemSelection = (itemId: number) => {
    setSelectedItemIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    )
  }

  const selectVisibleItems = () => {
    setSelectedItemIds((current) => [
      ...new Set([...current, ...filteredItems.map((item) => item.id)]),
    ])
  }

  const deleteSelectedItems = async () => {
    if (!api || selectedItemIds.length === 0) return
    if (
      !(await confirm({
        description: t('videos.douyin_confirm_delete', { count: selectedItemIds.length }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    const result = await api.deleteDouyinFavoriteItems(selectedItemIds)
    if (!result?.success) {
      setError(result?.error || t('videos.douyin_load_failed'))
      return
    }
    setSelectedItemIds([])
    await refreshFolders()
    setSyncRefreshNonce((value) => value + 1)
  }

  const clearAllItems = async () => {
    if (!api || itemsTotal === 0) return
    if (
      !(await confirm({
        description: t('videos.douyin_confirm_clear', { count: itemsTotal }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    const result = await api.clearDouyinFavoriteItems()
    if (!result?.success) {
      setError(result?.error || t('videos.douyin_load_failed'))
      return
    }
    setSelectedItemIds([])
    await refreshFolders()
    setSyncRefreshNonce((value) => value + 1)
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

  const filteredItems = filterDouyinFavoriteItems(items, searchQuery)
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn sm"
                onClick={selectVisibleItems}
                disabled={itemsLoading || filteredItems.length === 0}
              >
                <CheckSquare size={13} />
                {t('videos.douyin_select_visible')}
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => void deleteSelectedItems()}
                disabled={selectedItemIds.length === 0}
              >
                <Trash2 size={13} />
                {t('videos.douyin_delete_selected', { count: selectedItemIds.length })}
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => void clearAllItems()}
                disabled={itemsTotal === 0 || itemsLoading}
              >
                <Trash2 size={13} />
                {t('videos.douyin_clear_all')}
              </button>
            </div>
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
                  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                  gap: '10px',
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
                      gridTemplateRows: 'auto auto',
                      gap: '8px',
                      minWidth: 0,
                      overflow: 'hidden',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      background: 'var(--bg-muted)',
                    }}
                  >
                    <div style={{ position: 'relative', aspectRatio: '16 / 9', background: 'var(--color-border)' }}>
                      {item.thumbnail_url ? (
                        <img
                          src={item.thumbnail_url}
                          alt=""
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <div aria-hidden="true" style={{ width: '100%', height: '100%', background: 'var(--bg-muted)' }} />
                      )}
                      <input
                        type="checkbox"
                        checked={selectedItemIds.includes(item.id)}
                        onChange={() => toggleItemSelection(item.id)}
                        aria-label={item.title}
                        style={{ position: 'absolute', top: '8px', left: '8px', width: '16px', height: '16px' }}
                      />
                      {item.download_status === 'downloading' ? (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'grid',
                            alignContent: 'center',
                            gap: '8px',
                            padding: '12px',
                            background: 'rgba(8, 12, 18, 0.68)',
                            color: '#fff',
                            textAlign: 'center',
                          }}
                        >
                          <strong style={{ fontSize: '13px' }}>
                            {Math.round(item.download_progress || 0)}%
                          </strong>
                          <div
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(item.download_progress || 0)}
                            style={{ height: '5px', overflow: 'hidden', borderRadius: '3px', background: 'rgba(255,255,255,0.28)' }}
                          >
                            <div
                              style={{
                                width: `${Math.max(0, Math.min(100, item.download_progress || 0))}%`,
                                height: '100%',
                                background: 'var(--color-accent)',
                                transition: 'width 180ms ease-out',
                              }}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: 'grid', gap: '6px', minWidth: 0, padding: '0 9px 9px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                        <div
                          title={item.title}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 2,
                            fontSize: '12px',
                            lineHeight: 1.4,
                            fontWeight: 650,
                          }}
                        >
                          {item.title}
                        </div>
                        {item.download_status === 'downloaded' && item.local_path ? (
                          <button
                            type="button"
                            className="btn sm btn-icon ghost"
                            title={t('videos.douyin_play')}
                            aria-label={t('videos.douyin_play')}
                            onClick={() => void playDownloadedItem(item)}
                            style={{ width: '28px', height: '28px', minWidth: '28px', padding: 0 }}
                          >
                            <Play size={13} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn sm btn-icon ghost"
                          title={t('videos.btn_open_external')}
                          aria-label={t('videos.btn_open_external')}
                          onClick={() => void api?.openExternal?.(item.source_url)}
                          style={{ width: '28px', height: '28px', minWidth: '28px', padding: 0 }}
                        >
                          <ExternalLink size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn sm btn-icon ghost"
                          title={
                            item.download_status === 'downloaded'
                              ? t('videos.douyin_downloaded')
                              : t('videos.douyin_download')
                          }
                          aria-label={
                            item.download_status === 'downloaded'
                              ? t('videos.douyin_downloaded')
                              : t('videos.douyin_download')
                          }
                          onClick={() => void startItemDownload(item)}
                          disabled={item.download_status === 'downloading'}
                          style={{ width: '28px', height: '28px', minWidth: '28px', padding: 0 }}
                        >
                          <Download size={13} />
                        </button>
                      </div>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          width: 'fit-content',
                          maxWidth: '100%',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          color:
                            item.download_status === 'downloaded'
                              ? 'var(--color-success)'
                              : item.download_status === 'failed'
                                ? 'var(--color-danger)'
                                : 'var(--text-muted)',
                          background: 'var(--bg-subtle)',
                          fontSize: '10px',
                          fontWeight: 650,
                        }}
                      >
                        {item.download_status === 'downloading'
                          ? t('videos.douyin_status_downloading', {
                              progress: Math.round(item.download_progress || 0),
                            })
                          : item.download_status === 'downloaded'
                            ? t('videos.douyin_status_downloaded')
                            : item.download_status === 'failed'
                              ? t('videos.douyin_status_failed')
                              : t('videos.douyin_status_not_downloaded')}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '10.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.author_name || t('videos.douyin_unknown_author')}
                        {item.duration_seconds ? ` · ${formatDuration(item.duration_seconds)}` : ''}
                      </div>
                    </div>
                  </article>
                ))}
                <div
                  style={{
                    display: 'flex',
                    gridColumn: '1 / -1',
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
      {playingItem && playbackUrl ? (
        <ViewportPortal>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2000,
              display: 'grid',
              gridTemplateRows: '48px minmax(0, 1fr)',
              background: '#000',
              color: '#fff',
            }}
          >
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '0 14px',
                borderBottom: '1px solid rgba(255,255,255,0.14)',
              }}
            >
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setPlayingItem(null)
                  setPlaybackUrl('')
                }}
                style={{ background: '#222', borderColor: '#444', color: '#fff' }}
              >
                <X size={14} />
                {t('common.close')}
              </button>
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                  fontSize: '13px',
                }}
              >
                {playingItem.title}
              </span>
            </header>
            <video
              src={playbackUrl}
              controls
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            />
          </div>
        </ViewportPortal>
      ) : null}
    </section>
  )
}

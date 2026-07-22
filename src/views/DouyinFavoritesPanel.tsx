import { ExternalLink, Folder, KeyRound, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

export function DouyinFavoritesPanel({ showToast }: { showToast: (message: string) => void }) {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  const [auth, setAuth] = useState<DouyinAuthStatus>({ loggedIn: false })
  const [folders, setFolders] = useState<DouyinFavoriteFolderView[]>([])
  const [items, setItems] = useState<DouyinFavoriteItemView[]>([])
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

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
      return
    }
    let cancelled = false
    void api.listDouyinFavoriteItems(activeFolderId).then((result: DouyinListResponse<DouyinFavoriteItemView[]>) => {
      if (cancelled) return
      if (!result?.success) {
        setError(result?.error || t('videos.douyin_load_failed'))
        setItems([])
        return
      }
      setItems(result.data || [])
    })
    return () => {
      cancelled = true
    }
  }, [activeFolderId, api, t])

  const handleSync = async () => {
    if (!api || syncing) return
    if (!auth.loggedIn) {
      showToast(t('videos.douyin_login_required'))
      return
    }
    setSyncing(true)
    setError('')
    try {
      const result = await api.syncDouyinFavorites()
      if (!result?.success) {
        const message = result?.error?.message || t('videos.douyin_sync_failed')
        setError(message)
        showToast(message)
        return
      }
      await refresh()
      showToast(t('videos.douyin_sync_success', { count: result.itemsSynced || 0 }))
    } finally {
      setSyncing(false)
    }
  }

  const filteredItems = useMemo(() => filterDouyinFavoriteItems(items, searchQuery), [items, searchQuery])

  return (
    <section className="card" aria-busy={loading || syncing} style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flex: '1 1 160px' }}>
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
      {error ? <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: '12px' }}>{error}</p> : null}

      {folders.length === 0 && !loading ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }}>{t('videos.douyin_empty')}</p>
      ) : null}

      {folders.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(132px, 190px) minmax(0, 1fr)', gap: '10px', minWidth: 0 }}>
          <nav aria-label={t('videos.douyin_folders')} style={{ display: 'grid', alignContent: 'start', gap: '3px' }}>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={`btn sm ${activeFolderId === folder.id ? 'primary' : 'ghost'}`}
                onClick={() => setActiveFolderId(folder.id)}
                title={folder.diagnostic_message || folder.title}
                style={{ justifyContent: 'space-between', minWidth: 0 }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.title}</span>
                <span aria-label={t('videos.douyin_item_count', { count: folder.item_count })}>{folder.item_count}</span>
              </button>
            ))}
          </nav>
          <div style={{ display: 'grid', gap: '8px', minWidth: 0 }}>
            <input
              className="form-field"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('videos.douyin_search_placeholder')}
              style={{ height: '30px' }}
            />
            {filteredItems.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }}>{t('videos.douyin_empty_folder')}</p>
            ) : (
              <div style={{ display: 'grid', gap: '5px', maxHeight: '260px', overflowY: 'auto' }}>
                {filteredItems.map((item) => (
                  <article
                    key={item.id}
                    style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr) 30px', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}
                  >
                    {item.thumbnail_url ? (
                      <img src={item.thumbnail_url} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                    ) : (
                      <div aria-hidden="true" style={{ width: '40px', height: '40px', borderRadius: '4px', background: 'var(--bg-muted)' }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div title={item.title} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: 650 }}>{item.title}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '10.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

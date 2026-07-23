export interface DouyinFavoriteFolderView {
  id: number
  remote_id: string
  title: string
  item_count: number
  sync_status: string
  last_sync_at: string | null
  diagnostic_message: string | null
}

export interface DouyinFavoriteItemView {
  id: number
  remote_id: string
  title: string
  author_id: string | null
  author_name: string | null
  source_url: string
  thumbnail_url: string | null
  duration_seconds: number | null
  collected_at: string | null
  position: number
  download_status: 'not_downloaded' | 'downloading' | 'downloaded' | 'failed'
  download_progress: number
  local_path: string | null
  download_error: string | null
}

export function getActiveDouyinFolderId(
  folders: DouyinFavoriteFolderView[],
  activeFolderId: number | null,
) {
  return folders.some((folder) => folder.id === activeFolderId) ? activeFolderId : (folders[0]?.id ?? null)
}

export function filterDouyinFavoriteItems(items: DouyinFavoriteItemView[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items
  return items.filter((item) =>
    `${item.title} ${item.author_name || ''}`.toLocaleLowerCase().includes(normalizedQuery),
  )
}

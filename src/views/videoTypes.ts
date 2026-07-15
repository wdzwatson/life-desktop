export type VideoStatus = 'not_downloaded' | 'queued' | 'downloading' | 'downloaded' | 'download_failed' | 'invalid'

export type VideoDownloadPhase = 'preparing' | 'downloading' | 'processing' | 'failed'

export type VideoSortKey =
  | 'default'
  | 'recently_added'
  | 'recently_downloaded'
  | 'download_batch'
  | 'title'
  | 'duration'
  | 'status'
  | 'group'

export type SortDirection = 'asc' | 'desc'

export interface VideoDownloadBatchRecord {
  id: number
  batch_key: string
  source_url?: string | null
  source?: string | null
  title?: string | null
  item_count: number
  status: string
  created_at?: string
  updated_at?: string
}

export interface VideoRecord {
  id: number
  title: string
  group_id?: number | null
  status?: VideoStatus | 'unclassified' | string
  url?: string
  source_url?: string
  source_cid?: string | null
  local_path?: string
  path?: string
  duration?: string
  duration_seconds?: number
  source?: string
  tags?: string[]
  download_progress?: number | null
  download_phase?: VideoDownloadPhase | string | null
  download_message?: string | null
  download_error?: string | null
  invalid_reason?: string | null
  download_batch_id?: number | null
  download_batch_key?: string | null
  download_batch_created_at?: string | null
  download_batch_order?: number | null
  downloaded_at?: string | null
  created_at?: string
  updated_at?: string
  group_name?: string | null
  diagnostic_message?: string | null
}

export interface VideoFilter {
  query: string
  groupId: number | null | 'all'
  groupIds?: number[]
  validGroupIds?: number[]
  tag: string | null
}

export interface VideoGroupRecord {
  id: number
  name: string
  parent_id?: number | null
  sort_order?: number
}

export interface VideoGroupTranslation {
  group_id: number
  locale: string
  translation: string
}

export interface VideoTagRecord {
  id: number
  name: string
  color?: string
}

export interface VideoGroupTreeNode extends VideoGroupRecord {
  displayName: string
  depth: number
  path: string
  children: VideoGroupTreeNode[]
}

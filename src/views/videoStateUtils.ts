import type { SortDirection, VideoRecord, VideoSortKey, VideoStatus } from './videoTypes'

export interface VideoSortState {
  key: VideoSortKey
  direction: SortDirection
}

export function normalizeVideoStatus(status?: string | null): VideoStatus {
  if (status === 'downloaded') return 'downloaded'
  if (status === 'queued') return 'queued'
  if (status === 'downloading') return 'downloading'
  if (status === 'download_failed') return 'download_failed'
  if (status === 'invalid') return 'invalid'
  return 'not_downloaded'
}

export function canEditVideoDetails(video: VideoRecord) {
  const status = normalizeVideoStatus(video.status)
  return status !== 'queued' && status !== 'downloading' && status !== 'invalid'
}

export function canPlayVideoRecord(video: VideoRecord) {
  return normalizeVideoStatus(video.status) === 'downloaded' && Boolean(video.local_path || video.path)
}

export function getVideoRowDownloadAction(video: VideoRecord) {
  const status = normalizeVideoStatus(video.status)
  if (status === 'queued') return { visible: false, disabled: true, reason: 'active' as const }
  if (status === 'downloading') return { visible: false, disabled: true, reason: 'active' as const }
  if (status === 'downloaded') return { visible: false, disabled: true, reason: 'downloaded' as const }
  if (status === 'invalid') return { visible: false, disabled: true, reason: 'invalid' as const }
  if (!video.source_url && !video.url) return { visible: true, disabled: true, reason: 'missing-source' as const }
  return {
    visible: true,
    disabled: false,
    reason: status === 'download_failed' ? ('retry' as const) : ('download' as const),
  }
}

export function getVideoRowStyle(video: VideoRecord) {
  const status = normalizeVideoStatus(video.status)
  if (status === 'downloaded') {
    return {
      backgroundColor: 'rgba(34, 197, 94, 0.1)',
      borderColor: 'rgba(34, 197, 94, 0.28)',
      opacity: 1,
    }
  }
  if (status === 'download_failed') {
    return {
      backgroundColor: 'var(--bg-app)',
      borderColor: 'rgba(220, 38, 38, 0.45)',
      opacity: 1,
    }
  }
  if (status === 'invalid') {
    return {
      backgroundColor: 'rgba(100, 116, 139, 0.16)',
      borderColor: 'rgba(100, 116, 139, 0.32)',
      opacity: 0.62,
    }
  }
  return { backgroundColor: 'var(--bg-app)', borderColor: 'var(--color-border)', opacity: 1 }
}

export function createBulkMetadataEditPlan(videos: VideoRecord[]) {
  const editableIds: number[] = []
  const skippedIds: number[] = []

  for (const video of videos) {
    if (canEditVideoDetails(video)) editableIds.push(video.id)
    else skippedIds.push(video.id)
  }

  return {
    editableIds,
    skippedIds,
    editableCount: editableIds.length,
    skippedCount: skippedIds.length,
  }
}

export function getBulkMetadataActionLabels() {
  return {
    selectedCount: 'videos.bulk_selected_count',
    selectVisible: 'videos.bulk_select_visible',
    invertVisible: 'videos.bulk_invert_visible',
    group: 'videos.bulk_group',
    tags: 'videos.bulk_tags',
    more: 'videos.bulk_more',
    cancel: 'videos.bulk_cancel',
  }
}

export function getBulkVisibleSelectionAction(visibleIds: number[], selectedIds: number[]) {
  if (visibleIds.length === 0) return 'select' as const
  const selected = new Set(selectedIds)
  return visibleIds.every((id) => selected.has(id)) ? ('invert' as const) : ('select' as const)
}

export function toggleVisibleBulkSelection(visibleIds: number[], selectedIds: number[]) {
  const visible = new Set(visibleIds)
  const selected = new Set(selectedIds)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  if (allVisibleSelected) {
    return selectedIds.filter((id) => !visible.has(id))
  }

  for (const id of visibleIds) selected.add(id)
  return Array.from(selected)
}

export function getBulkDownloadSelectionPlan(videos: VideoRecord[]) {
  const downloadableIds: number[] = []
  let downloadedCount = 0

  for (const video of videos) {
    const action = getVideoRowDownloadAction(video)
    if (action.visible && !action.disabled) {
      downloadableIds.push(video.id)
    }
    if (action.reason === 'downloaded') {
      downloadedCount += 1
    }
  }

  return {
    downloadableIds,
    downloadableCount: downloadableIds.length,
    downloadedCount,
    skippedCount: videos.length - downloadableIds.length,
    totalCount: videos.length,
    allSelectedDownloaded: videos.length > 0 && downloadedCount === videos.length,
  }
}

export function parseBulkGroupPickerValue(value: string) {
  if (value === '__choose__') return undefined
  if (value === '__none__') return null
  const groupId = Number(value)
  return Number.isFinite(groupId) ? groupId : undefined
}

export function shouldCreateBulkTagRecord(mode: 'add' | 'remove') {
  return mode === 'add'
}

export function isBulkMetadataWriteResultSuccess(result: { success?: boolean } | null | undefined) {
  return result?.success === true
}

export function getBulkTagEditButtonLabels() {
  return {
    add: 'videos.bulk_add_tags',
    remove: 'videos.bulk_remove_tags',
  }
}

export type BulkVideoTagMode = 'add' | 'remove'

export function normalizeBulkVideoTagPayload(payload: {
  videoIds?: unknown
  tagNames?: unknown
  mode?: unknown
}) {
  const videoIds = Array.isArray(payload.videoIds)
    ? Array.from(
        new Set(
          payload.videoIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      )
    : []
  const tagNames = Array.isArray(payload.tagNames)
    ? Array.from(
        new Set(
          payload.tagNames
            .map((tag) => String(tag).trim())
            .filter(Boolean),
        ),
      )
    : []
  const mode = payload.mode === 'add' || payload.mode === 'remove' ? payload.mode : null

  if (videoIds.length === 0) return { success: false as const, error: 'No videos selected' }
  if (tagNames.length === 0) return { success: false as const, error: 'No tags provided' }
  if (!mode) return { success: false as const, error: 'Invalid tag update mode' }

  return { success: true as const, videoIds, tagNames, mode }
}

export function getStatusBadgeTone(status: string | undefined) {
  const normalized = normalizeVideoStatus(status)
  if (normalized === 'download_failed') return 'danger' as const
  if (normalized === 'downloaded') return 'success' as const
  if (normalized === 'downloading') return 'accent' as const
  if (normalized === 'invalid') return 'muted' as const
  return 'neutral' as const
}

export function getDefaultVideoSortRank(status?: string | null) {
  const rank: Record<VideoStatus, number> = {
    downloading: 0,
    queued: 1,
    download_failed: 2,
    not_downloaded: 3,
    downloaded: 4,
    invalid: 5,
  }
  return rank[normalizeVideoStatus(status)]
}

function timeValue(value?: string | null) {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function compareText(a?: string | null, b?: string | null) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function applyDirection(value: number, direction: SortDirection) {
  return direction === 'asc' ? value : -value
}

export function getSortDirectionIconName(direction: SortDirection) {
  return direction === 'asc' ? 'sort-asc' : 'sort-desc'
}

export function toggleSortDirection(direction: SortDirection): SortDirection {
  return direction === 'asc' ? 'desc' : 'asc'
}

export function sortVideoRecords(records: VideoRecord[], sort: VideoSortState) {
  return [...records].sort((a, b) => {
    if (sort.key === 'default') {
      return (
        getDefaultVideoSortRank(a.status) - getDefaultVideoSortRank(b.status) ||
        timeValue(b.download_batch_created_at) - timeValue(a.download_batch_created_at) ||
        (a.download_batch_order ?? Number.MAX_SAFE_INTEGER) -
          (b.download_batch_order ?? Number.MAX_SAFE_INTEGER) ||
        timeValue(b.created_at) - timeValue(a.created_at) ||
        a.id - b.id
      )
    }
    if (sort.key === 'title') return applyDirection(compareText(a.title, b.title), sort.direction)
    if (sort.key === 'duration') return applyDirection((a.duration_seconds || 0) - (b.duration_seconds || 0), sort.direction)
    if (sort.key === 'recently_added') return applyDirection(timeValue(a.created_at) - timeValue(b.created_at), sort.direction)
    if (sort.key === 'recently_downloaded') {
      return applyDirection(timeValue(a.downloaded_at) - timeValue(b.downloaded_at), sort.direction)
    }
    if (sort.key === 'download_batch') {
      return applyDirection(
        timeValue(a.download_batch_created_at) - timeValue(b.download_batch_created_at) ||
          (a.download_batch_order ?? 0) - (b.download_batch_order ?? 0),
        sort.direction,
      )
    }
    if (sort.key === 'status') {
      return applyDirection(getDefaultVideoSortRank(a.status) - getDefaultVideoSortRank(b.status), sort.direction)
    }
    if (sort.key === 'group') {
      return applyDirection(compareText(a.group_name, b.group_name) || compareText(a.title, b.title), sort.direction)
    }
    return 0
  })
}

export function createVideoBatchKey(date = new Date(), sequence = 1) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}-${String(sequence).padStart(3, '0')}`
}

export interface ParsedVideoMetadataDefaults {
  groupId?: number | null
  tagNames?: string[]
}

export function parseParsedVideoImportTagDraft(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  )
}

export function applyParsedVideoMetadataDefaults<T extends { group_id?: number | null; tags?: string[] }>(
  item: T,
  defaults: ParsedVideoMetadataDefaults,
) {
  const tagNames = Array.from(
    new Set(
      [...(item.tags || []), ...(defaults.tagNames || [])]
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  )
  return {
    ...item,
    group_id: typeof defaults.groupId === 'number' ? defaults.groupId : item.group_id,
    tags: tagNames.length > 0 ? tagNames : item.tags || [],
  }
}

export function buildParsedVideoTitle(playlistTitle: string | null | undefined, item: { title?: string | null }) {
  const normalizedPlaylistTitle = String(playlistTitle || '').trim()
  const itemTitle = String(item.title || '').trim()
  if (!normalizedPlaylistTitle) return itemTitle
  if (!itemTitle) return normalizedPlaylistTitle
  return `${normalizedPlaylistTitle} - ${itemTitle}`
}

export function getParseResultActionLabels() {
  return {
    cancel: 'videos.btn_cancel_parse',
    addToList: 'videos.btn_add_to_video_list',
    download: 'videos.btn_download_video',
  }
}

import type { VideoFilter, VideoGroupRecord, VideoRecord } from './videoTypes'

export type VideoEngineLoadState = 'idle' | 'loading' | 'ready' | 'error'
export interface VideoEngineStatus {
  status: VideoEngineLoadState
  message?: string
  updatedAt?: string
  tools?: unknown
}

export function formatDuration(seconds?: number) {
  if (!seconds || seconds < 0) return ''
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function parseTagInput(input: string) {
  const seen = new Set<string>()
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag || seen.has(tag)) return false
      seen.add(tag)
      return true
    })
}

export function toggleSelectedTag(selectedTags: string[], tag: string) {
  const normalized = tag.trim()
  if (!normalized) return selectedTags
  return selectedTags.includes(normalized)
    ? selectedTags.filter((current) => current !== normalized)
    : [...selectedTags, normalized]
}

export function normalizeVideoGroupName(input: string) {
  return input.trim()
}

export function getProgressPercentLabel(progress?: number) {
  const value = typeof progress === 'number' && Number.isFinite(progress) ? progress : 0
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`
}

export function getBulkSelectionState(allIds: string[], selectedIds: string[]) {
  const visibleIds = allIds.filter(Boolean)
  if (visibleIds.length === 0) return { checked: false, indeterminate: false }
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.includes(id)).length
  return {
    checked: selectedVisibleCount === visibleIds.length,
    indeterminate: selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length,
  }
}

export function toggleBulkSelection(allIds: string[], selectedIds: string[]) {
  const visibleIds = allIds.filter(Boolean)
  const state = getBulkSelectionState(visibleIds, selectedIds)
  return state.checked ? [] : visibleIds
}

export function canPlayVideo(video: VideoRecord) {
  return video.status === 'downloaded' && Boolean(video.local_path || video.path)
}

export function createVideoDetailDraft(video: Pick<VideoRecord, 'group_id' | 'tags'>) {
  return {
    groupId: video.group_id ?? null,
    tags: [...(video.tags || [])],
  }
}

export function getVideoDurationLabel(video: VideoRecord) {
  if (video.duration) return video.duration
  if (typeof video.duration_seconds === 'number') return formatDuration(video.duration_seconds)
  return ''
}

export function getVideoSourceUrl(video: Pick<VideoRecord, 'source_url' | 'url'>) {
  return video.source_url || video.url || ''
}

export function shouldShowLibraryDownloadAction(video: VideoRecord) {
  return video.status !== 'downloaded'
}

export interface VideoDownloadQueueItem {
  id?: number
  title: string
  status?: string
}

export type VideoListDownloadActionState = 'downloaded' | 'active' | 'retry' | 'ready' | 'missing-source'

export function getVideoDownloadQueueItem(video: Pick<VideoRecord, 'id' | 'title'>, queueItems: VideoDownloadQueueItem[]) {
  return queueItems.find((item) => item.id === video.id || item.title === video.title)
}

export function getVideoListDownloadAction(video: VideoRecord, queueItems: VideoDownloadQueueItem[] = []) {
  const queueItem = getVideoDownloadQueueItem(video, queueItems)
  if (video.status === 'downloaded') {
    return { visible: false, disabled: true, state: 'downloaded' as VideoListDownloadActionState }
  }
  if (queueItem?.status === 'failed') {
    return { visible: true, disabled: false, state: 'retry' as VideoListDownloadActionState }
  }
  if (
    video.status === 'queued' ||
    video.status === 'downloading' ||
    queueItem?.status === 'queued' ||
    queueItem?.status === 'downloading'
  ) {
    return { visible: true, disabled: true, state: 'active' as VideoListDownloadActionState }
  }
  if (!video.source_url && !video.url) {
    return { visible: true, disabled: true, state: 'missing-source' as VideoListDownloadActionState }
  }
  return { visible: true, disabled: false, state: 'ready' as VideoListDownloadActionState }
}

export function getVideoListItemBackground(video: VideoRecord) {
  return video.status === 'downloaded' ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-app)'
}

export function isYtDlpAvailable(toolStatus: any) {
  return Boolean(toolStatus?.ytDlp?.ok)
}

export function getMissingDownloaderMessage(toolStatus: any) {
  const path = toolStatus?.ytDlp?.path || 'yt-dlp'
  const detail = toolStatus?.ytDlp?.error || toolStatus?.ytDlp?.version || ''
  return `Missing or invalid yt-dlp downloader (${path}). ${detail}`.trim()
}

export function getDownloadFailureToastData(title: string, message?: string) {
  return {
    title,
    error: message?.trim() || 'Unknown error',
  }
}

export function getPendingDownloadRecordStatus() {
  return 'queued'
}

export const DEFAULT_VIDEO_CONCURRENT_DOWNLOADS = 3
export const MAX_VIDEO_CONCURRENT_DOWNLOADS = 10

export function clampVideoConcurrentDownloads(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_VIDEO_CONCURRENT_DOWNLOADS
  return Math.max(1, Math.min(MAX_VIDEO_CONCURRENT_DOWNLOADS, Math.floor(parsed)))
}

export async function runVideoDownloadTasksWithLimit<T>(
  tasks: T[],
  limit: unknown,
  runner: (task: T, index: number) => Promise<void>,
) {
  const concurrency = clampVideoConcurrentDownloads(limit)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      await runner(tasks[currentIndex], currentIndex)
    }
  })
  await Promise.all(workers)
}

export function canStartVideoDownloadWithEngine(status: Pick<VideoEngineStatus, 'status'> | null | undefined) {
  if (status?.status === 'ready') {
    return { canStart: true, toastKey: null as string | null }
  }
  if (status?.status === 'error') {
    return { canStart: false, toastKey: 'videos.toast_video_engine_failed' }
  }
  return { canStart: false, toastKey: 'videos.toast_video_engine_loading' }
}

export function getPlaybackOverlayChrome(isMac: boolean) {
  return {
    topInset: isMac ? 38 : 0,
    headerAppRegion: 'no-drag' as const,
  }
}

const chipPalette = [
  { backgroundColor: 'rgba(14, 165, 233, 0.14)', color: '#0369a1', borderColor: 'rgba(14, 165, 233, 0.28)' },
  { backgroundColor: 'rgba(34, 197, 94, 0.14)', color: '#15803d', borderColor: 'rgba(34, 197, 94, 0.28)' },
  { backgroundColor: 'rgba(245, 158, 11, 0.16)', color: '#92400e', borderColor: 'rgba(245, 158, 11, 0.3)' },
  { backgroundColor: 'rgba(236, 72, 153, 0.14)', color: '#be185d', borderColor: 'rgba(236, 72, 153, 0.28)' },
  { backgroundColor: 'rgba(99, 102, 241, 0.14)', color: '#4338ca', borderColor: 'rgba(99, 102, 241, 0.28)' },
  { backgroundColor: 'rgba(20, 184, 166, 0.14)', color: '#0f766e', borderColor: 'rgba(20, 184, 166, 0.28)' },
]

export function getChipStyle(seed: string | number) {
  const raw = String(seed || 'default')
  let hash = 0
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0
  }
  return chipPalette[hash % chipPalette.length]
}

export interface VideoGroupOption extends VideoGroupRecord {
  depth: number
  path: string
}

export function getVideoGroupOptions(groups: VideoGroupRecord[]): VideoGroupOption[] {
  const childrenByParent = new Map<number | null, VideoGroupRecord[]>()
  for (const group of groups) {
    const parentId = group.parent_id ?? null
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), group])
  }
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name))
  }

  const visited = new Set<number>()
  const options: VideoGroupOption[] = []
  const visit = (group: VideoGroupRecord, ancestors: string[], depth: number) => {
    if (visited.has(group.id)) return
    visited.add(group.id)
    const nextPath = [...ancestors, group.name]
    options.push({ ...group, depth, path: nextPath.join(' / ') })
    for (const child of childrenByParent.get(group.id) || []) {
      visit(child, nextPath, depth + 1)
    }
  }

  for (const group of childrenByParent.get(null) || []) visit(group, [], 0)
  for (const group of groups) {
    if (!visited.has(group.id)) visit(group, [], 0)
  }
  return options
}

export function getDescendantGroupIds(groups: VideoGroupRecord[], groupId: number) {
  const childrenByParent = new Map<number, VideoGroupRecord[]>()
  for (const group of groups) {
    if (typeof group.parent_id === 'number') {
      childrenByParent.set(group.parent_id, [...(childrenByParent.get(group.parent_id) || []), group])
    }
  }

  const ids: number[] = []
  const visit = (id: number) => {
    if (ids.includes(id)) return
    ids.push(id)
    for (const child of childrenByParent.get(id) || []) visit(child.id)
  }
  visit(groupId)
  return ids
}

export function getSelectedGroupPathLabel(
  options: VideoGroupOption[],
  groupId: number | null | undefined,
  fallback: string,
) {
  if (!groupId) return fallback
  return options.find((group) => group.id === groupId)?.path || fallback
}

export function getFloatingDropdownFrame(
  anchor: { top: number; bottom: number; left: number; width: number },
  viewportHeight: number,
) {
  const margin = 16
  const gap = 4
  const preferredHeight = 220
  const minHeight = 120
  const below = viewportHeight - anchor.bottom - margin
  const above = anchor.top - margin
  const opensBelow = below >= minHeight || below >= above
  const maxHeight = Math.max(minHeight, Math.min(preferredHeight, opensBelow ? below : above))
  return {
    top: opensBelow ? anchor.bottom + gap : Math.max(margin, anchor.top - maxHeight - gap),
    left: anchor.left,
    width: anchor.width,
    maxHeight,
  }
}

export type VideoDrawerState = { open: boolean }
export type VideoDrawerAction = 'open-details' | 'outside-click' | 'close'

export function nextVideoDrawerState(state: VideoDrawerState, action: VideoDrawerAction): VideoDrawerState {
  if (action === 'open-details') return { open: true }
  if (action === 'outside-click' || action === 'close') return { ...state, open: false }
  return state
}

export function getVideoDrawerTitleKey() {
  return 'videos.details_title'
}

export function getVideoDetailsSaveSuccessFeedback(): { drawerAction: VideoDrawerAction; toastKey: string } {
  return {
    drawerAction: 'close',
    toastKey: 'videos.toast_video_details_saved',
  }
}

export function filterVideos(videos: VideoRecord[], filter: VideoFilter) {
  const query = filter.query.trim().toLowerCase()
  return videos.filter((video) => {
    if (query && !video.title.toLowerCase().includes(query)) return false
    if (typeof filter.groupId === 'number') {
      const groupIds = filter.groupIds?.length ? filter.groupIds : [filter.groupId]
      if (!video.group_id || !groupIds.includes(video.group_id)) return false
    }
    if (filter.groupId === null) {
      const isUngrouped = video.group_id == null
      const isMissingGroup =
        filter.validGroupIds !== undefined &&
        typeof video.group_id === 'number' &&
        !filter.validGroupIds.includes(video.group_id)
      if (!isUngrouped && !isMissingGroup) return false
    }
    if (filter.tag && !video.tags?.includes(filter.tag)) return false
    return true
  })
}

export function getDownloadedLibraryVideos(videos: VideoRecord[], filter: VideoFilter) {
  return filterVideos(
    videos.filter((video) => video.status === 'downloaded'),
    filter,
  )
}

export function getVideoLibraryVideos(videos: VideoRecord[], filter: VideoFilter) {
  return filterVideos(videos, filter)
}

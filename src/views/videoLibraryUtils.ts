import type { VideoFilter, VideoRecord } from './videoTypes'

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

export function canPlayVideo(video: VideoRecord) {
  return video.status === 'downloaded' && Boolean(video.local_path || video.path)
}

export function filterVideos(videos: VideoRecord[], filter: VideoFilter) {
  const query = filter.query.trim().toLowerCase()
  return videos.filter((video) => {
    if (query && !video.title.toLowerCase().includes(query)) return false
    if (filter.groupId === 'downloaded' && video.status !== 'downloaded') return false
    if (filter.groupId === 'downloading' && video.status !== 'downloading') return false
    if (typeof filter.groupId === 'number' && video.group_id !== filter.groupId) return false
    if (filter.groupId === null && video.group_id) return false
    if (filter.tag && !video.tags?.includes(filter.tag)) return false
    return true
  })
}

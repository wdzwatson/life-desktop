import type { VideoDiagnostic, VideoSource } from './types'

export interface NormalizeContext {
  fallbackUrl: string
  wasFlatPlaylist: boolean
}

export interface NormalizedVideoItem {
  id: string
  title: string
  source: VideoSource
  sourceUrl: string
  sourceId: string
  durationSeconds?: number
  durationLabel?: string
  thumbnailUrl?: string
  partIndex?: number
  playlistId?: string
  extractor?: string
  requiresAuth: boolean
}

export interface NormalizedParseResult {
  kind: 'single' | 'playlist'
  source: VideoSource
  title: string
  sourceUrl: string
  sourceId?: string
  playlistId?: string
  playlistTitle?: string
  items: NormalizedVideoItem[]
  diagnostics: VideoDiagnostic[]
}

function sourceFromExtractor(extractor: string | undefined): VideoSource {
  const normalized = String(extractor || '').toLowerCase()
  if (normalized.includes('bili')) return 'bilibili'
  if (normalized.includes('youtube')) return 'youtube'
  return 'other'
}

function firstThumbnail(raw: any): string | undefined {
  if (raw.thumbnail) return raw.thumbnail
  if (Array.isArray(raw.thumbnails) && raw.thumbnails.length > 0) {
    return raw.thumbnails[raw.thumbnails.length - 1]?.url
  }
  return undefined
}

function isWebUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function isLikelyWebpageUrl(value: unknown): value is string {
  if (!isWebUrl(value)) return false
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    if (host.includes('googlevideo.com')) return false
    if (host.includes('bilivideo.com')) return false
    if (host.includes('youtube.com') || host.includes('youtu.be')) return true
    if (host.includes('bilibili.com')) return true
    return !/\/(videoplayback|audio|video|stream)(\/|$)/i.test(parsed.pathname)
  } catch {
    return false
  }
}

function extractBilibiliId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.match(/\b(BV[a-zA-Z0-9]+)\b/i)
  return match?.[1]
}

function resolveSourceUrl(raw: any, parent: any, ctx: NormalizeContext) {
  if (isLikelyWebpageUrl(raw.webpage_url)) return raw.webpage_url
  if (isLikelyWebpageUrl(raw.original_url)) return raw.original_url
  if (isLikelyWebpageUrl(raw.url)) return raw.url
  if (isLikelyWebpageUrl(parent.webpage_url)) return parent.webpage_url
  if (isLikelyWebpageUrl(parent.original_url)) return parent.original_url
  return ctx.fallbackUrl
}

function resolveSourceId(raw: any, parent: any, source: VideoSource, sourceUrl: string) {
  if (source === 'bilibili') {
    return (
      extractBilibiliId(sourceUrl) ||
      extractBilibiliId(parent.webpage_url) ||
      extractBilibiliId(parent.id) ||
      String(raw.id || parent.id || sourceUrl)
    )
  }
  return String(raw.id || raw.display_id || parent.id || sourceUrl)
}

function normalizeItem(raw: any, parent: any, ctx: NormalizeContext): NormalizedVideoItem {
  const extractor = raw.extractor_key || parent.extractor_key || raw.extractor || parent.extractor
  const source = sourceFromExtractor(extractor)
  const sourceUrl = resolveSourceUrl(raw, parent, ctx)
  const sourceId = resolveSourceId(raw, parent, source, sourceUrl)
  return {
    id: `${source}:${parent.id || parent.playlist_id || sourceId}:${raw.playlist_index || sourceId}`,
    title: raw.title || parent.title || sourceUrl,
    source,
    sourceUrl,
    sourceId,
    durationSeconds: typeof raw.duration === 'number' ? raw.duration : undefined,
    durationLabel: raw.duration_string,
    thumbnailUrl: firstThumbnail(raw),
    partIndex: typeof raw.playlist_index === 'number' ? raw.playlist_index : undefined,
    playlistId: parent.id || parent.playlist_id,
    extractor,
    requiresAuth: false,
  }
}

export function normalizeYtDlpMetadata(raw: any, ctx: NormalizeContext): NormalizedParseResult {
  const entries = Array.isArray(raw.entries) ? raw.entries.filter(Boolean) : []
  const source = sourceFromExtractor(raw.extractor_key || raw.extractor)
  const diagnostics: VideoDiagnostic[] =
    raw._type === 'playlist' && entries.length === 0
      ? [
          {
            code: 'unknown_error',
            severity: 'warning',
            message: 'Parsed playlist metadata, but no importable videos were returned.',
          },
        ]
      : [{ code: 'ok', severity: 'info', message: 'Parsed video metadata successfully.' }]

  if (entries.length > 0 || raw._type === 'playlist') {
    return {
      kind: 'playlist',
      source,
      title: raw.title || raw.playlist_title || ctx.fallbackUrl,
      sourceUrl: raw.webpage_url || ctx.fallbackUrl,
      sourceId: raw.id,
      playlistId: raw.id || raw.playlist_id,
      playlistTitle: raw.title || raw.playlist_title,
      items: entries.map((entry: any) => normalizeItem(entry, raw, ctx)),
      diagnostics,
    }
  }

  const item = normalizeItem(raw, raw, ctx)
  return {
    kind: 'single',
    source: item.source,
    title: item.title,
    sourceUrl: item.sourceUrl,
    sourceId: item.sourceId,
    playlistId: raw.playlist_id,
    playlistTitle: raw.playlist_title,
    items: [item],
    diagnostics,
  }
}

export function normalizeYtDlpError(rawMessage: string): VideoDiagnostic {
  const lower = rawMessage.toLowerCase()
  if (lower.includes('http error 412') && lower.includes('bili')) {
    return {
      code: 'bilibili_412',
      severity: 'warning',
      message:
        'Bilibili blocked anonymous metadata access. Configure browser cookies or a cookies.txt file, then retry.',
      rawMessage,
    }
  }
  if (lower.includes('cookie') && (lower.includes('expired') || lower.includes('invalid'))) {
    return {
      code: 'cookies_expired',
      severity: 'warning',
      message: 'The configured cookies appear to be expired. Re-login in the browser or refresh cookies.txt.',
      rawMessage,
    }
  }
  if (lower.includes('login') || lower.includes('sign in') || lower.includes('cookies')) {
    return {
      code: 'login_required',
      severity: 'warning',
      message: 'This video may require a logged-in session. Configure browser cookies or cookies.txt.',
      rawMessage,
    }
  }
  if (lower.includes('unsupported url')) {
    return {
      code: 'unsupported',
      severity: 'error',
      message: 'This URL is not supported by the installed yt-dlp.',
      rawMessage,
    }
  }
  return {
    code: 'unknown_error',
    severity: 'error',
    message: 'Video parsing failed. Check the diagnostic log for details.',
    rawMessage,
  }
}

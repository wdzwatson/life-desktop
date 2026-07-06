import type { NormalizedParseResult } from './normalize'

function extractYoutubeVideoId(url: string) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if ((host === 'youtube.com' || host.endsWith('.youtube.com')) && parsed.pathname === '/watch') {
      return parsed.searchParams.get('v') || undefined
    }
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0]
      return id || undefined
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/)
      return shortsMatch?.[1]
    }
    return undefined
  } catch {
    return undefined
  }
}

function canonicalYoutubeWatchUrl(url: string, sourceId: string) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
      return `https://www.youtube.com/watch?v=${sourceId}`
    }
  } catch {
    // Keep the original fallback URL below.
  }
  return url
}

export function shouldPreferYoutubeOEmbedMetadata(url: string) {
  return Boolean(extractYoutubeVideoId(url))
}

export function normalizeYoutubeOEmbedMetadata(
  raw: any,
  ctx: { fallbackUrl: string },
): NormalizedParseResult {
  const sourceId = extractYoutubeVideoId(ctx.fallbackUrl) || ctx.fallbackUrl
  const sourceUrl = canonicalYoutubeWatchUrl(ctx.fallbackUrl, sourceId)
  const title = raw?.title || ctx.fallbackUrl
  return {
    kind: 'single',
    source: 'youtube',
    title,
    sourceUrl,
    sourceId,
    items: [
      {
        id: `youtube:${sourceId}:${sourceId}`,
        title,
        source: 'youtube',
        sourceUrl,
        sourceId,
        thumbnailUrl: raw?.thumbnail_url,
        requiresAuth: false,
      },
    ],
    diagnostics: [{ code: 'ok', severity: 'info', message: 'Parsed YouTube metadata quickly.' }],
  }
}

export async function fetchYoutubeOEmbedMetadata(url: string) {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
  const response = await fetch(endpoint, {
    headers: {
      'user-agent': 'LifeOS video metadata',
    },
  })
  if (!response.ok) throw new Error(`YouTube oEmbed failed with HTTP ${response.status}`)
  return normalizeYoutubeOEmbedMetadata(await response.json(), { fallbackUrl: url })
}

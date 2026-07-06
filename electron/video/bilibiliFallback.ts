import type { NormalizedParseResult, NormalizedVideoItem } from './normalize'

interface BilibiliHtmlContext {
  fallbackUrl: string
}

function extractInitialState(html: string) {
  const marker = 'window.__INITIAL_STATE__='
  const start = html.indexOf(marker)
  if (start < 0) return undefined
  const jsonStart = html.indexOf('{', start + marker.length)
  if (jsonStart < 0) return undefined

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = jsonStart; index < html.length; index += 1) {
    const char = html[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return html.slice(jsonStart, index + 1)
    }
  }
  return undefined
}

function extractBvid(value: string) {
  return value.match(/\b(BV[a-zA-Z0-9]+)\b/)?.[1]
}

function canonicalBilibiliUrl(fallbackUrl: string, bvid: string, page?: number) {
  const suffix = page ? `?p=${page}` : ''
  return `https://www.bilibili.com/video/${bvid}/${suffix}`
}

function normalizeImageUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined
  if (value.startsWith('//')) return `https:${value}`
  return value.replaceAll('\\u002F', '/')
}

function buildItems(videoData: any, bvid: string, fallbackUrl: string): NormalizedVideoItem[] {
  const pages = Array.isArray(videoData.pages) && videoData.pages.length > 0 ? videoData.pages : []
  if (pages.length === 0) {
    return [
      {
        id: `bilibili:${bvid}:${bvid}`,
        title: String(videoData.title || fallbackUrl),
        source: 'bilibili',
        sourceUrl: canonicalBilibiliUrl(fallbackUrl, bvid),
        sourceId: bvid,
        sourceCid: videoData.cid ? String(videoData.cid) : undefined,
        durationSeconds: typeof videoData.duration === 'number' ? videoData.duration : undefined,
        thumbnailUrl: normalizeImageUrl(videoData.pic),
        partIndex: 1,
        playlistId: bvid,
        extractor: 'BiliBiliHtml',
        requiresAuth: false,
      },
    ]
  }

  return pages.map((page: any) => ({
    id: `bilibili:${bvid}:${page.page || page.cid || page.part || bvid}`,
    title: String(page.part || videoData.title || fallbackUrl),
    source: 'bilibili' as const,
    sourceUrl: canonicalBilibiliUrl(fallbackUrl, bvid, page.page),
    sourceId: bvid,
    sourceCid: page.cid ? String(page.cid) : undefined,
    durationSeconds: typeof page.duration === 'number' ? page.duration : undefined,
    thumbnailUrl: normalizeImageUrl(page.first_frame) || normalizeImageUrl(videoData.pic),
    partIndex: typeof page.page === 'number' ? page.page : undefined,
    playlistId: bvid,
    extractor: 'BiliBiliHtml',
    requiresAuth: false,
  }))
}

export function normalizeBilibiliHtmlMetadata(
  html: string,
  ctx: BilibiliHtmlContext,
): NormalizedParseResult {
  const initialState = extractInitialState(html)
  if (!initialState) {
    throw new Error('Bilibili initial state was not found in the page HTML.')
  }

  const parsed = JSON.parse(initialState)
  const videoData = parsed.videoData
  const bvid = String(videoData?.bvid || parsed.bvid || extractBvid(ctx.fallbackUrl) || '')
  if (!videoData || !bvid) {
    throw new Error('Bilibili page HTML did not include usable video metadata.')
  }

  const items = buildItems(videoData, bvid, ctx.fallbackUrl)
  const title = String(videoData.title || ctx.fallbackUrl)
  const sourceUrl = canonicalBilibiliUrl(ctx.fallbackUrl, bvid)
  const kind = items.length > 1 ? 'playlist' : 'single'

  return {
    kind,
    source: 'bilibili',
    title,
    sourceUrl,
    sourceId: bvid,
    playlistId: bvid,
    playlistTitle: kind === 'playlist' ? title : undefined,
    items,
    diagnostics: [
      {
        code: 'ok',
        severity: 'info',
        message: 'Parsed Bilibili page metadata successfully.',
      },
    ],
  }
}

export async function fetchBilibiliHtmlMetadata(url: string) {
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      referer: 'https://www.bilibili.com/',
    },
  })
  if (!response.ok) {
    throw new Error(`Bilibili page request failed with HTTP ${response.status}.`)
  }
  return normalizeBilibiliHtmlMetadata(await response.text(), { fallbackUrl: url })
}

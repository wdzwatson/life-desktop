import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { VideoCookieConfig, VideoQualityPreference } from './types'
import { parseBilibiliCookieFile } from './bilibiliCookies'

export { parseBilibiliCookieFile } from './bilibiliCookies'

interface BilibiliStream {
  id?: number
  bandwidth?: number
  baseUrl?: string
  base_url?: string
}

interface BilibiliDash {
  video?: BilibiliStream[]
  audio?: BilibiliStream[]
}

export function extractBilibiliBvid(url: string) {
  return url.match(/\b(BV[a-zA-Z0-9]+)\b/)?.[1]
}

function qualityToQn(quality: VideoQualityPreference) {
  if (quality === '1080p') return 80
  if (quality === '720p') return 64
  return 80
}

export function buildBilibiliApiUrl(input: {
  bvid: string
  cid: string | number
  quality: VideoQualityPreference
}) {
  const params = new URLSearchParams({
    bvid: input.bvid,
    cid: String(input.cid),
    qn: String(qualityToQn(input.quality)),
    fnval: '16',
    fourk: '1',
  })
  return `https://api.bilibili.com/x/player/playurl?${params.toString()}`
}

function streamUrl(stream: BilibiliStream | undefined) {
  return stream?.baseUrl || stream?.base_url
}

function selectByQuality(streams: BilibiliStream[], maxQuality: number) {
  const eligible = streams.filter((stream) => typeof stream.id !== 'number' || stream.id <= maxQuality)
  const candidates = eligible.length > 0 ? eligible : streams
  return [...candidates].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0]
}

export function selectBilibiliDashStreams(dash: BilibiliDash, quality: VideoQualityPreference) {
  const videos = Array.isArray(dash.video) ? dash.video : []
  const audios = Array.isArray(dash.audio) ? dash.audio : []
  const video = selectByQuality(videos, qualityToQn(quality))
  const audio = [...audios].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0]
  const videoUrl = streamUrl(video)
  const audioUrl = streamUrl(audio)
  if (!videoUrl) throw new Error('Bilibili fast path did not return a video stream.')
  return { videoUrl, audioUrl }
}

export function parseFfmpegProgressPercent(message: string, durationSeconds?: number) {
  if (message.includes('progress=end')) return 99
  if (!durationSeconds || durationSeconds <= 0) return undefined
  const match = message.match(/out_time_(?:ms|us)=(\d+)/)
  if (!match) return undefined
  const seconds = Number(match[1]) / 1_000_000
  if (!Number.isFinite(seconds)) return undefined
  return Math.max(1, Math.min(99, (seconds / durationSeconds) * 100))
}

const invalidFilenameChars = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

function sanitizeFilename(value: string) {
  const cleaned = Array.from(value, (char) =>
    invalidFilenameChars.has(char) || char.charCodeAt(0) < 32 ? ' ' : char,
  ).join('')
  return cleaned.replace(/\s+/g, ' ').trim() || 'video'
}

function resolveOutputPath(outputDir: string, title: string) {
  const base = sanitizeFilename(title)
  let candidate = path.join(outputDir, `${base}.mp4`)
  let index = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${base} (${index}).mp4`)
    index += 1
  }
  return candidate
}

function buildHeaders(sourceUrl: string, cookieHeader?: string) {
  const headers = [
    'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    `Referer: ${sourceUrl}`,
  ]
  if (cookieHeader) headers.push(`Cookie: ${cookieHeader}`)
  return `${headers.join('\r\n')}\r\n`
}

function buildFetchHeaders(sourceUrl: string, cookieHeader?: string) {
  const headers: Record<string, string> = {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    referer: sourceUrl,
  }
  if (cookieHeader) headers.cookie = cookieHeader
  return headers
}

export function shouldTryBilibiliDirectDownload(input: {
  url: string
  source?: string
  quality: VideoQualityPreference
  cookieConfig: VideoCookieConfig
}) {
  if (input.source !== 'bilibili' && !extractBilibiliBvid(input.url)) return false
  if (input.cookieConfig.mode === 'browser' && input.quality === 'best') return false
  return true
}

async function fetchCidFromPage(url: string) {
  const html = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      referer: 'https://www.bilibili.com/',
    },
  }).then((response) => response.text())
  return html.match(/"cid":(\d+)/)?.[1]
}

export async function startBilibiliDirectDownload(input: {
  ffmpegPath: string
  url: string
  title: string
  outputDir: string
  quality: VideoQualityPreference
  cookieConfig: VideoCookieConfig
  sourceCid?: string | number
  durationSeconds?: number
  onProgress?: (progress?: number, message?: string) => void | Promise<void>
}) {
  const bvid = extractBilibiliBvid(input.url)
  if (!bvid) throw new Error('Bilibili fast path requires a BV id.')
  const cid = input.sourceCid || (await fetchCidFromPage(input.url))
  if (!cid) throw new Error('Bilibili fast path requires a cid.')
  const cookieHeader =
    input.cookieConfig.mode === 'file' || input.cookieConfig.mode === 'bilibili'
      ? parseBilibiliCookieFile(input.cookieConfig.cookiesPath)
      : undefined
  const headers = buildHeaders(input.url, cookieHeader)
  const apiUrl = buildBilibiliApiUrl({ bvid, cid, quality: input.quality })
  const play = await fetch(apiUrl, { headers: buildFetchHeaders(input.url, cookieHeader) }).then((response) =>
    response.json(),
  )
  if (play?.code !== 0 || !play?.data?.dash) {
    throw new Error(play?.message || 'Bilibili fast path did not return playable DASH metadata.')
  }
  const streams = selectBilibiliDashStreams(play.data.dash, input.quality)
  const outputPath = resolveOutputPath(input.outputDir, input.title)
  const args = ['-hide_banner', '-y', '-headers', headers, '-i', streams.videoUrl]
  if (streams.audioUrl) {
    args.push('-headers', headers, '-i', streams.audioUrl, '-map', '0:v:0', '-map', '1:a:0')
  }
  args.push('-c', 'copy', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath)

  await input.onProgress?.(1, 'Bilibili fast path resolved media streams.')

  return new Promise<string>((resolve, reject) => {
    const child = spawn(input.ffmpegPath, args, { windowsHide: true })
    let log = ''
    child.stdout.on('data', async (chunk) => {
      const message = chunk.toString()
      log += message
      const progress = parseFfmpegProgressPercent(message, input.durationSeconds)
      if (typeof progress === 'number') await input.onProgress?.(progress, message)
    })
    child.stderr.on('data', (chunk) => {
      log += chunk.toString()
      if (log.length > 8000) log = log.slice(-8000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath)
      } else {
        reject(new Error(log.trim().split(/\r?\n/).slice(-4).join('\n') || `ffmpeg exited with code ${code}`))
      }
    })
  })
}

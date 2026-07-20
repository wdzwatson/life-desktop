import type { VideoCookieConfig, VideoQualityPreference } from './types'

export type { VideoCookieConfig, VideoQualityPreference }

export interface BuildMetadataArgsInput {
  url: string
  flatPlaylist: boolean
  playlistEnd?: number
  cookieConfig: VideoCookieConfig
}

export interface BuildDownloadArgsInput {
  url: string
  outputTemplate: string
  cookieConfig: VideoCookieConfig
  quality: VideoQualityPreference
  ffmpegPath?: string
}

function appendCookieArgs(args: string[], cookieConfig: VideoCookieConfig) {
  if (cookieConfig.mode === 'browser') {
    args.push('--cookies-from-browser', cookieConfig.browser)
  }
  if (cookieConfig.mode === 'file' || cookieConfig.mode === 'bilibili') {
    args.push('--cookies', cookieConfig.cookiesPath)
  }
}

export function buildMetadataArgs(input: BuildMetadataArgsInput): string[] {
  const args = ['--skip-download']
  if (input.flatPlaylist) {
    args.push('--flat-playlist')
  }
  args.push('--dump-single-json')
  if (input.flatPlaylist && input.playlistEnd) {
    args.push('--playlist-end', String(input.playlistEnd))
  }
  appendCookieArgs(args, input.cookieConfig)
  args.push('--no-warnings', input.url)
  return args
}

function resolveFormat(quality: VideoQualityPreference): string {
  if (quality === '1080p') return 'bv*[height<=1080]+ba/b[height<=1080]/b'
  if (quality === '720p') return 'bv*[height<=720]+ba/b[height<=720]/b'
  if (quality === 'audio') return 'ba/bestaudio'
  return 'bv*+ba/b'
}

export function buildDownloadArgs(input: BuildDownloadArgsInput): string[] {
  const args = [
    '--newline',
    '--progress',
    '--no-playlist',
    '--print',
    'after_move:filepath:%(filepath)j',
    '-f',
    resolveFormat(input.quality),
  ]
  if (input.quality !== 'audio') {
    args.push('--merge-output-format', 'mp4')
  }
  if (input.ffmpegPath) {
    args.push('--ffmpeg-location', input.ffmpegPath)
  }
  appendCookieArgs(args, input.cookieConfig)
  args.push('-o', input.outputTemplate, input.url)
  return args
}

export type VideoSource = 'bilibili' | 'youtube' | 'other'

export type VideoCookieConfig =
  | { mode: 'none' }
  | { mode: 'browser'; browser: 'chrome' | 'safari' | 'firefox' | 'edge' | 'brave' | 'chromium' }
  | { mode: 'file'; cookiesPath: string }

export type VideoQualityPreference = 'best' | '1080p' | '720p' | 'audio'

export interface VideoDiagnostic {
  code:
    | 'ok'
    | 'tool_missing'
    | 'ffmpeg_missing'
    | 'bilibili_412'
    | 'login_required'
    | 'cookies_expired'
    | 'unsupported'
    | 'download_failed'
    | 'unknown_error'
  severity: 'info' | 'warning' | 'error'
  message: string
  rawMessage?: string
}

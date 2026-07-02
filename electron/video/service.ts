import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserWindow } from 'electron'
import { buildDownloadArgs, buildMetadataArgs } from './ytDlpArgs'
import { normalizeYtDlpError, normalizeYtDlpMetadata } from './normalize'
import type { VideoCookieConfig, VideoQualityPreference } from './types'

export function resolveVideoToolPath(settings: Record<string, any>, executable: 'yt-dlp' | 'ffmpeg') {
  const key = executable === 'yt-dlp' ? 'ytDlpPath' : 'ffmpegPath'
  return settings[key] || executable
}

export function resolveCookieConfigFromSettings(settings: Record<string, any>): VideoCookieConfig {
  if (settings.cookieMode === 'browser' && settings.cookieBrowser) {
    return { mode: 'browser', browser: settings.cookieBrowser }
  }
  if (settings.cookieMode === 'file' && settings.cookiesPath) {
    return { mode: 'file', cookiesPath: settings.cookiesPath }
  }
  return { mode: 'none' }
}

function runProcess(command: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: err.message })
    })
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

export async function checkVideoTools(settings: Record<string, any>) {
  const ytDlpPath = resolveVideoToolPath(settings, 'yt-dlp')
  const ffmpegPath = resolveVideoToolPath(settings, 'ffmpeg')
  const ytDlp = await runProcess(ytDlpPath, ['--version'])
  const ffmpeg = await runProcess(ffmpegPath, ['-version'])
  return {
    ytDlp: {
      ok: ytDlp.code === 0,
      path: ytDlpPath,
      version: ytDlp.stdout.trim(),
      error: ytDlp.stderr.trim(),
    },
    ffmpeg: {
      ok: ffmpeg.code === 0,
      path: ffmpegPath,
      version: ffmpeg.stdout.split('\n')[0] || '',
      error: ffmpeg.stderr.trim(),
    },
  }
}

export async function parseVideoUrl(settings: Record<string, any>, url: string) {
  const ytDlpPath = resolveVideoToolPath(settings, 'yt-dlp')
  const cookieConfig = resolveCookieConfigFromSettings(settings)
  const full = await runProcess(
    ytDlpPath,
    buildMetadataArgs({ url, flatPlaylist: false, cookieConfig }),
  )
  if (full.code === 0) {
    return normalizeYtDlpMetadata(JSON.parse(full.stdout), { fallbackUrl: url, wasFlatPlaylist: false })
  }

  const diagnostic = normalizeYtDlpError(full.stderr || full.stdout)
  if (diagnostic.code === 'bilibili_412') {
    const flat = await runProcess(
      ytDlpPath,
      buildMetadataArgs({ url, flatPlaylist: true, playlistEnd: 100, cookieConfig }),
    )
    if (flat.code === 0) {
      const result = normalizeYtDlpMetadata(JSON.parse(flat.stdout), {
        fallbackUrl: url,
        wasFlatPlaylist: true,
      })
      result.diagnostics.unshift(diagnostic)
      return result
    }
  }

  return {
    kind: 'single' as const,
    source: 'other' as const,
    title: url,
    sourceUrl: url,
    items: [],
    diagnostics: [diagnostic],
  }
}

export async function startVideoDownload(input: {
  settings: Record<string, any>
  mainWindow: BrowserWindow | null
  url: string
  title: string
  outputDir: string
}) {
  fs.mkdirSync(input.outputDir, { recursive: true })
  const ytDlpPath = resolveVideoToolPath(input.settings, 'yt-dlp')
  const args = buildDownloadArgs({
    url: input.url,
    outputTemplate: path.join(input.outputDir, '%(title)s.%(ext)s'),
    cookieConfig: resolveCookieConfigFromSettings(input.settings),
    quality: (input.settings.qualityPreference || 'best') as VideoQualityPreference,
    ffmpegPath: input.settings.ffmpegPath,
  })
  const child = spawn(ytDlpPath, args, { windowsHide: true })
  child.stdout.on('data', (chunk) => {
    input.mainWindow?.webContents.send('video:download-progress', {
      title: input.title,
      message: chunk.toString(),
    })
  })
  child.stderr.on('data', (chunk) => {
    input.mainWindow?.webContents.send('video:download-progress', {
      title: input.title,
      message: chunk.toString(),
    })
  })
  child.on('close', (code) => {
    if (code === 0) {
      input.mainWindow?.webContents.send('video:download-finished', { title: input.title })
    }
  })
  return { success: true }
}

export function resolvePlaybackPath(userVideoDir: string, localPath: string) {
  const resolved = path.resolve(localPath)
  const allowedRoot = path.resolve(userVideoDir)
  const relative = path.relative(allowedRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { success: false, error: 'Playback path is outside the video library.' }
  }
  if (!fs.existsSync(resolved)) {
    return { success: false, error: 'Video file does not exist.' }
  }
  return { success: true, url: pathToFileURL(resolved).toString() }
}

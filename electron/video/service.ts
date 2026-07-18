import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import AdmZip from 'adm-zip'
import { fetchBilibiliHtmlMetadata } from './bilibiliFallback'
import { shouldTryBilibiliDirectDownload, startBilibiliDirectDownload } from './bilibiliDirect'
import { fetchYoutubeOEmbedMetadata, shouldPreferYoutubeOEmbedMetadata } from './youtubeOembed'
import { buildDownloadArgs, buildMetadataArgs } from './ytDlpArgs'
import { normalizeYtDlpError, normalizeYtDlpMetadata } from './normalize'
import { getManagedVideoToolInstallSupport, type ManagedVideoTool } from './toolSupport'
import type { VideoCookieConfig, VideoDiagnostic, VideoQualityPreference } from './types'

export const DEFAULT_VIDEO_TOOL_CHECK_TIMEOUT_MS = 60000
export const DEFAULT_VIDEO_METADATA_TIMEOUT_MS = 60000
export type VideoEngineLoadState = 'idle' | 'loading' | 'ready' | 'error'
export interface VideoToolCheckItem {
  ok: boolean
  path: string
  version: string
  error: string
}
export interface VideoToolsCheckResult {
  ytDlp: VideoToolCheckItem
  ffmpeg: VideoToolCheckItem
}
export interface VideoEngineStatus {
  status: VideoEngineLoadState
  message?: string
  tools?: VideoToolsCheckResult
  updatedAt?: string
}

export function getManagedVideoToolPath(toolsDir: string, executable: ManagedVideoTool) {
  const filename = executable === 'yt-dlp' ? 'yt-dlp' : 'ffmpeg'
  const extension = process.platform === 'win32' ? '.exe' : ''
  return path.join(toolsDir, `${filename}${extension}`)
}

export function resolveVideoToolPath(settings: Record<string, any>, executable: 'yt-dlp' | 'ffmpeg') {
  const key = executable === 'yt-dlp' ? 'ytDlpPath' : 'ffmpegPath'
  if (settings[key]) return settings[key]
  if (settings.videoToolsDir) {
    const managedPath = getManagedVideoToolPath(settings.videoToolsDir, executable)
    if (fs.existsSync(managedPath)) return managedPath
  }
  return executable
}

function getToolDownloadPlan(tool: ManagedVideoTool) {
  if (!getManagedVideoToolInstallSupport()[tool]) {
    throw new Error(
      `Managed ${tool} install is not supported on ${process.platform}/${process.arch}.`,
    )
  }

  if (tool === 'yt-dlp') {
    if (process.platform === 'darwin') {
      return {
        url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
        kind: 'binary' as const,
      }
    }
    if (process.platform === 'win32') {
      return {
        url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
        kind: 'binary' as const,
      }
    }
    if (process.platform === 'linux') {
      return {
        url:
          process.arch === 'arm64'
            ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64'
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
        kind: 'binary' as const,
      }
    }
  }

  if (tool === 'ffmpeg' && process.platform === 'darwin') {
    return {
      url: 'https://evermeet.cx/ffmpeg/getrelease/zip',
      kind: 'zip' as const,
      entryName: 'ffmpeg',
    }
  }

  throw new Error(`Managed ${tool} download plan is unavailable on ${process.platform}/${process.arch}.`)
}

async function downloadBuffer(url: string) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'LifeOS video tool installer',
    },
  })
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function writeExecutable(filePath: string, buffer: Buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o755)
}

function extractZipExecutable(zipBuffer: Buffer, entryName: string, targetPath: string) {
  const zip = new AdmZip(zipBuffer)
  const entry = zip
    .getEntries()
    .find((item) => !item.isDirectory && path.basename(item.entryName) === entryName)
  if (!entry) throw new Error(`${entryName} was not found in downloaded archive.`)
  writeExecutable(targetPath, entry.getData())
}

export async function installManagedVideoTool(settings: Record<string, any>, tool: ManagedVideoTool) {
  const toolsDir = settings.videoToolsDir
  if (!toolsDir) throw new Error('videoToolsDir is required to install managed video tools.')
  const targetPath = getManagedVideoToolPath(toolsDir, tool)
  const plan = getToolDownloadPlan(tool)
  const payload = await downloadBuffer(plan.url)

  if (plan.kind === 'zip') {
    extractZipExecutable(payload, plan.entryName, targetPath)
  } else {
    writeExecutable(targetPath, payload)
  }

  return {
    success: true,
    tool,
    path: targetPath,
  }
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

function isBilibiliUrl(url: string) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    return host === 'bilibili.com' || host.endsWith('.bilibili.com')
  } catch {
    return false
  }
}

export function resolveCookieConfigForUrl(settings: Record<string, any>, url: string): VideoCookieConfig {
  if (!isBilibiliUrl(url)) return { mode: 'none' }
  return resolveCookieConfigFromSettings(settings)
}

function isBilibiliVideoUrl(url: string) {
  try {
    const parsed = new URL(url)
    return isBilibiliUrl(url) && /\/video\/BV/i.test(parsed.pathname)
  } catch {
    return false
  }
}

export function shouldPreferBilibiliHtmlMetadata(url: string) {
  return isBilibiliVideoUrl(url)
}

export function shouldUseBilibiliHtmlFallback(url: string, diagnostic: VideoDiagnostic) {
  if (!isBilibiliVideoUrl(url)) return false
  return ['bilibili_412', 'tool_missing', 'login_required', 'cookies_expired', 'unknown_error'].includes(
    diagnostic.code,
  )
}

export function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: { code: number | null; stdout: string; stderr: string }) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = () => {
      child.kill('SIGTERM')
      finish({ code: -1, stdout, stderr: 'Process cancelled.' })
    }
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM')
          finish({ code: -1, stdout, stderr: `Process timed out after ${options.timeoutMs}ms` })
        }, options.timeoutMs)
      : undefined
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      finish({ code: -1, stdout, stderr: err.message })
    })
    child.on('close', (code) => {
      finish({ code, stdout, stderr })
    })
  })
}

export function parsePrintedFilePath(line: string) {
  if (!line.startsWith('filepath:')) return undefined
  const payload = line.slice('filepath:'.length).trim()
  try {
    return JSON.parse(payload)
  } catch {
    return payload || undefined
  }
}

export function parseDownloadProgressPercent(message: string) {
  const match = message.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
  if (!match) return undefined
  const progress = Number(match[1])
  if (!Number.isFinite(progress)) return undefined
  return Math.max(0, Math.min(100, progress))
}

export function normalizeActiveDownloadProgress(progress: number, previousProgress: number) {
  if (!Number.isFinite(progress)) return previousProgress
  const activeProgress = Math.min(Math.max(progress, 0), 99)
  return Math.max(previousProgress, activeProgress)
}

export function inferDownloadPhase(message: string, progress?: number) {
  if (typeof progress === 'number') return 'downloading'
  if (/^filepath:|\[(Merger|Fixup|ExtractAudio|VideoRemuxer)\]|ffmpeg|post-process|postprocess/i.test(message)) {
    return 'processing'
  }
  return 'preparing'
}

export function parseFfprobeDurationSeconds(stdout: string) {
  const value = Number(stdout.trim())
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value)
}

export function parseFfmpegDurationSeconds(output: string) {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (![hours, minutes, seconds].every(Number.isFinite)) return undefined
  return Math.round(hours * 3600 + minutes * 60 + seconds)
}

export function formatDurationSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function resolveFfprobePath(settings: Record<string, any>) {
  const ffmpegPath = resolveVideoToolPath(settings, 'ffmpeg')
  if (path.basename(ffmpegPath).startsWith('ffmpeg')) {
    const candidate = path.join(
      path.dirname(ffmpegPath),
      process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
    )
    if (fs.existsSync(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
}

export async function probeVideoDurationSeconds(settings: Record<string, any>, filePath: string) {
  const ffprobePath = resolveFfprobePath(settings)
  const result = await runProcess(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { timeoutMs: 15000 },
  )
  if (result.code === 0) return parseFfprobeDurationSeconds(result.stdout)

  const ffmpegPath = resolveVideoToolPath(settings, 'ffmpeg')
  const fallback = await runProcess(ffmpegPath, ['-i', filePath], { timeoutMs: 15000 })
  return parseFfmpegDurationSeconds(`${fallback.stderr}\n${fallback.stdout}`)
}

export function resolveVideoDownloadDir(settings: Record<string, any>, defaultDir: string) {
  const configured = typeof settings.videoDownloadDir === 'string' ? settings.videoDownloadDir.trim() : ''
  return configured || defaultDir
}

export function buildCookieAccessVerificationArgs(input: {
  url: string
  cookieConfig: VideoCookieConfig
}) {
  return buildMetadataArgs({
    url: input.url,
    flatPlaylist: false,
    cookieConfig: input.cookieConfig,
  })
}

export async function verifyVideoCookieAccess(settings: Record<string, any>) {
  const cookieConfig = resolveCookieConfigForUrl(settings, url)
  if (cookieConfig.mode === 'none') {
    return { success: false, error: 'Cookie mode is disabled.' }
  }
  const ytDlpPath = resolveVideoToolPath(settings, 'yt-dlp')
  const result = await runProcess(
    ytDlpPath,
    buildCookieAccessVerificationArgs({
      url: settings.cookieTestUrl || 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
      cookieConfig,
    }),
    { timeoutMs: 45000 },
  )
  if (result.code === 0) return { success: true }
  const diagnostic = normalizeYtDlpError(result.stderr || result.stdout)
  return { success: false, error: diagnostic.message, diagnostic }
}

export function createInitialVideoEngineStatus(): VideoEngineStatus {
  return { status: 'idle', updatedAt: new Date().toISOString() }
}

export function deriveVideoEngineStatus(tools: VideoToolsCheckResult): VideoEngineStatus {
  const missing: string[] = []
  if (!tools.ytDlp.ok) {
    missing.push(`yt-dlp (${tools.ytDlp.path})${tools.ytDlp.error ? `: ${tools.ytDlp.error}` : ''}`)
  }
  if (!tools.ffmpeg.ok) {
    missing.push(`ffmpeg (${tools.ffmpeg.path})${tools.ffmpeg.error ? `: ${tools.ffmpeg.error}` : ''}`)
  }
  if (missing.length === 0) {
    return {
      status: 'ready',
      message: 'Video download plugin is ready.',
      tools,
      updatedAt: new Date().toISOString(),
    }
  }
  return {
    status: 'error',
    message: `Missing or invalid video download component: ${missing.join('; ')}`,
    tools,
    updatedAt: new Date().toISOString(),
  }
}

export function isVideoEngineReady(status: Pick<VideoEngineStatus, 'status'> | null | undefined) {
  return status?.status === 'ready'
}

export async function checkVideoTools(settings: Record<string, any>): Promise<VideoToolsCheckResult> {
  const ytDlpPath = resolveVideoToolPath(settings, 'yt-dlp')
  const ffmpegPath = resolveVideoToolPath(settings, 'ffmpeg')
  const [ytDlp, ffmpeg] = await Promise.all([
    runProcess(ytDlpPath, ['--version'], { timeoutMs: DEFAULT_VIDEO_TOOL_CHECK_TIMEOUT_MS }),
    runProcess(ffmpegPath, ['-version'], { timeoutMs: DEFAULT_VIDEO_TOOL_CHECK_TIMEOUT_MS }),
  ])
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
  if (shouldPreferYoutubeOEmbedMetadata(url)) {
    try {
      return await fetchYoutubeOEmbedMetadata(url)
    } catch {
      // Fall back to yt-dlp when oEmbed metadata is unavailable.
    }
  }

  if (shouldPreferBilibiliHtmlMetadata(url)) {
    try {
      return await fetchBilibiliHtmlMetadata(url)
    } catch {
      // Fall back to yt-dlp when the page metadata is unavailable.
    }
  }

  const ytDlpPath = resolveVideoToolPath(settings, 'yt-dlp')
  const cookieConfig = resolveCookieConfigFromSettings(settings)
  const full = await runProcess(
    ytDlpPath,
    buildMetadataArgs({ url, flatPlaylist: false, cookieConfig }),
    { timeoutMs: DEFAULT_VIDEO_METADATA_TIMEOUT_MS },
  )
  if (full.code === 0) {
    return normalizeYtDlpMetadata(JSON.parse(full.stdout), { fallbackUrl: url, wasFlatPlaylist: false })
  }

  const diagnostic = normalizeYtDlpError(full.stderr || full.stdout)
  if (diagnostic.code === 'bilibili_412') {
    const flat = await runProcess(
      ytDlpPath,
      buildMetadataArgs({ url, flatPlaylist: true, playlistEnd: 100, cookieConfig }),
      { timeoutMs: DEFAULT_VIDEO_METADATA_TIMEOUT_MS },
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

  if (shouldUseBilibiliHtmlFallback(url, diagnostic)) {
    try {
      const result = await fetchBilibiliHtmlMetadata(url)
      result.diagnostics.unshift(diagnostic)
      return result
    } catch {
      // Keep the original yt-dlp diagnostic; the page fallback is best-effort.
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

export function buildResolvedDownloadArgs(input: {
  settings: Record<string, any>
  url: string
  outputDir: string
}) {
  const ffmpegPath = resolveVideoToolPath(input.settings, 'ffmpeg')
  const shouldUseFfmpegLocation = Boolean(input.settings.ffmpegPath) || ffmpegPath !== 'ffmpeg'
  return buildDownloadArgs({
    url: input.url,
    outputTemplate: path.join(input.outputDir, '%(title)s.%(ext)s'),
    cookieConfig: resolveCookieConfigForUrl(input.settings, input.url),
    quality: (input.settings.qualityPreference || 'best') as VideoQualityPreference,
    ffmpegPath: shouldUseFfmpegLocation ? ffmpegPath : undefined,
  })
}

export async function startVideoDownload(input: {
  settings: Record<string, any>
  mainWindow: BrowserWindow | null
  url: string
  title: string
  outputDir: string
  videoId?: number
  source?: string
  sourceCid?: string | number | null
  durationSeconds?: number | null
  onProgress?: (progress?: number, message?: string) => void | Promise<void>
  onFinished?: (filePath?: string) => void | Promise<void>
  onFailed?: (message: string) => void
}) {
  fs.mkdirSync(input.outputDir, { recursive: true })
  const ytDlpPath = resolveVideoToolPath(input.settings, 'yt-dlp')
  const quality = (input.settings.qualityPreference || 'best') as VideoQualityPreference
  const cookieConfig = resolveCookieConfigForUrl(input.settings, input.url)
  const ffmpegPath = resolveVideoToolPath(input.settings, 'ffmpeg')
  const args = buildResolvedDownloadArgs({
    settings: input.settings,
    url: input.url,
    outputDir: input.outputDir,
  })
  input.mainWindow?.webContents.send('video:download-progress', {
    videoId: input.videoId,
    title: input.title,
    progress: 0,
    phase: 'preparing',
  })
  const emitProgress = async (progress: number | undefined, message: string, phase: string) => {
    if (typeof progress === 'number') await input.onProgress?.(progress, message)
    input.mainWindow?.webContents.send('video:download-progress', {
      videoId: input.videoId,
      title: input.title,
      message,
      progress,
      phase,
    })
  }
  if (
    shouldTryBilibiliDirectDownload({
      url: input.url,
      source: input.source,
      quality,
      cookieConfig,
    })
  ) {
    try {
      const filePath = await startBilibiliDirectDownload({
        ffmpegPath,
        url: input.url,
        title: input.title,
        outputDir: input.outputDir,
        quality,
        cookieConfig,
        sourceCid: input.sourceCid || undefined,
        durationSeconds: input.durationSeconds || undefined,
        onProgress: async (progress, message) => {
          await emitProgress(progress, message || 'Downloading with Bilibili fast path.', 'downloading')
        },
      })
      await emitProgress(99, 'Processing downloaded file...', 'processing')
      await input.onFinished?.(filePath)
      input.mainWindow?.webContents.send('video:download-finished', {
        videoId: input.videoId,
        title: input.title,
        filePath,
      })
      return { success: true, engine: 'bilibili-direct' }
    } catch (error: any) {
      input.mainWindow?.webContents.send('video:download-progress', {
        videoId: input.videoId,
        title: input.title,
        message: `Bilibili fast path unavailable, falling back to yt-dlp: ${error?.message || String(error)}`,
        phase: 'preparing',
      })
    }
  }
  const child = spawn(ytDlpPath, args, { windowsHide: true })
  let downloadedFilePath: string | undefined
  let lastProgress = 0
  let outputLog = ''
  let failed = false
  const appendOutputLog = (message: string) => {
    outputLog = `${outputLog}${message}`
    if (outputLog.length > 8000) outputLog = outputLog.slice(-8000)
  }
  const buildFailureMessage = (fallback: string) => {
    const diagnostic = normalizeYtDlpError(outputLog)
    if (diagnostic.code !== 'unknown_error') return diagnostic.message
    const detail = outputLog.trim().split(/\r?\n/).filter(Boolean).slice(-3).join('\n')
    return detail ? `${fallback}: ${detail}` : fallback
  }
  const notifyFailed = (message: string) => {
    if (failed) return
    failed = true
    input.onFailed?.(message)
    input.mainWindow?.webContents.send('video:download-progress', {
      videoId: input.videoId,
      title: input.title,
      message,
      phase: 'failed',
    })
    input.mainWindow?.webContents.send('video:download-failed', {
      videoId: input.videoId,
      title: input.title,
      message,
    })
  }
  child.stdout.on('data', (chunk) => {
    const message = chunk.toString()
    appendOutputLog(message)
    for (const line of message.split(/\r?\n/)) {
      const filePath = parsePrintedFilePath(line)
      if (filePath) downloadedFilePath = filePath
    }
    const progress = parseDownloadProgressPercent(message)
    const normalizedProgress =
      typeof progress === 'number' ? normalizeActiveDownloadProgress(progress, lastProgress) : undefined
    if (typeof normalizedProgress === 'number') {
      lastProgress = normalizedProgress
      input.onProgress?.(normalizedProgress, message)
    }
    input.mainWindow?.webContents.send('video:download-progress', {
      videoId: input.videoId,
      title: input.title,
      message,
      progress: normalizedProgress,
      phase: inferDownloadPhase(message, normalizedProgress),
    })
  })
  child.stderr.on('data', (chunk) => {
    const message = chunk.toString()
    appendOutputLog(message)
    const progress = parseDownloadProgressPercent(message)
    const normalizedProgress =
      typeof progress === 'number' ? normalizeActiveDownloadProgress(progress, lastProgress) : undefined
    if (typeof normalizedProgress === 'number') {
      lastProgress = normalizedProgress
      input.onProgress?.(normalizedProgress, message)
    }
    input.mainWindow?.webContents.send('video:download-progress', {
      videoId: input.videoId,
      title: input.title,
      message,
      progress: normalizedProgress,
      phase: inferDownloadPhase(message, normalizedProgress),
    })
  })
  child.on('error', (err) => {
    notifyFailed(`yt-dlp failed to start: ${err.message}`)
  })
  child.on('close', async (code) => {
    if (failed) return
    if (code === 0) {
      if (!downloadedFilePath) {
        notifyFailed('Download finished, but yt-dlp did not return a local file path.')
        return
      }
      input.mainWindow?.webContents.send('video:download-progress', {
        videoId: input.videoId,
        title: input.title,
        message: 'Processing downloaded file...',
        progress: lastProgress || 99,
        phase: 'processing',
      })
      await input.onFinished?.(downloadedFilePath)
      input.mainWindow?.webContents.send('video:download-finished', {
        videoId: input.videoId,
        title: input.title,
        filePath: downloadedFilePath,
      })
    } else {
      notifyFailed(buildFailureMessage(`yt-dlp exited with code ${code}`))
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
  return { success: true, url: `life-video://play/${encodeURIComponent(resolved)}` }
}

export function resolveVideoProtocolPath(userVideoDir: string, requestUrl: string) {
  try {
    const parsed = new URL(requestUrl)
    if (parsed.protocol !== 'life-video:' || parsed.hostname !== 'play') {
      return { success: false, error: 'Invalid video playback URL.' }
    }
    const localPath = decodeURIComponent(parsed.pathname.slice(1))
    const resolved = path.resolve(localPath)
    const allowedRoot = path.resolve(userVideoDir)
    const relative = path.relative(allowedRoot, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { success: false, error: 'Playback path is outside the video library.' }
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: 'Video file does not exist.' }
    }
    return { success: true, path: resolved }
  } catch {
    return { success: false, error: 'Invalid video playback URL.' }
  }
}

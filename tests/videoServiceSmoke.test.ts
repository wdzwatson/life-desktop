import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildCookieAccessVerificationArgs,
  deriveVideoEngineStatus,
  DEFAULT_VIDEO_METADATA_TIMEOUT_MS,
  DEFAULT_VIDEO_TOOL_CHECK_TIMEOUT_MS,
  buildResolvedDownloadArgs,
  getVideoCookieAccessStatus,
  isVideoEngineReady,
  getManagedVideoToolPath,
  parseFfmpegDurationSeconds,
  parseFfprobeDurationSeconds,
  parseDownloadProgressPercent,
  inferDownloadPhase,
  parsePrintedFilePath,
  resolveCookieConfigForUrl,
  resolveCookieConfigFromSettings,
  resolvePlaybackPath,
  resolveVideoProtocolPath,
  resolveVideoDownloadDir,
  resolveVideoToolPath,
  runProcess,
  shouldPreferBilibiliHtmlMetadata,
  shouldUseBilibiliHtmlFallback,
  startVideoDownload,
} from '../electron/video/service.ts'

function writeFakeYtDlp(outputDir: string, unixScript: string, windowsScript: string) {
  const fakeYtDlp = path.join(outputDir, process.platform === 'win32' ? 'fake-yt-dlp.cmd' : 'fake-yt-dlp')
  writeFileSync(fakeYtDlp, process.platform === 'win32' ? windowsScript : unixScript)
  if (process.platform !== 'win32') chmodSync(fakeYtDlp, 0o755)
  return fakeYtDlp
}

test('video tool checks allow slow macOS managed yt-dlp startup', () => {
  assert.ok(DEFAULT_VIDEO_TOOL_CHECK_TIMEOUT_MS >= 45000)
  assert.ok(DEFAULT_VIDEO_METADATA_TIMEOUT_MS >= 45000)
})

test('deriveVideoEngineStatus requires both yt-dlp and ffmpeg before downloads are ready', () => {
  const ready = deriveVideoEngineStatus({
    ytDlp: { ok: true, path: '/tools/yt-dlp', version: '2026.01.01', error: '' },
    ffmpeg: { ok: true, path: '/tools/ffmpeg', version: 'ffmpeg version 7', error: '' },
  })
  assert.equal(ready.status, 'ready')
  assert.equal(isVideoEngineReady(ready), true)

  const missingYtDlp = deriveVideoEngineStatus({
    ytDlp: { ok: false, path: 'yt-dlp', version: '', error: 'spawn yt-dlp ENOENT' },
    ffmpeg: { ok: true, path: '/tools/ffmpeg', version: 'ffmpeg version 7', error: '' },
  })
  assert.equal(missingYtDlp.status, 'error')
  assert.equal(isVideoEngineReady(missingYtDlp), false)
  assert.match(missingYtDlp.message || '', /yt-dlp/)

  const missingFfmpeg = deriveVideoEngineStatus({
    ytDlp: { ok: true, path: '/tools/yt-dlp', version: '2026.01.01', error: '' },
    ffmpeg: { ok: false, path: 'ffmpeg', version: '', error: 'spawn ffmpeg ENOENT' },
  })
  assert.equal(missingFfmpeg.status, 'error')
  assert.equal(isVideoEngineReady(missingFfmpeg), false)
  assert.match(missingFfmpeg.message || '', /ffmpeg/)
})

test('resolveVideoToolPath prefers configured path over executable name', () => {
  assert.equal(resolveVideoToolPath({ ytDlpPath: '/opt/bin/yt-dlp' }, 'yt-dlp'), '/opt/bin/yt-dlp')
  assert.equal(resolveVideoToolPath({}, 'yt-dlp'), 'yt-dlp')
})

test('resolveVideoToolPath prefers installed managed tool before PATH fallback', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-video-tools-'))
  const toolPath = getManagedVideoToolPath(root, 'yt-dlp')
  mkdirSync(path.dirname(toolPath), { recursive: true })
  writeFileSync(toolPath, 'fake')

  assert.equal(resolveVideoToolPath({ videoToolsDir: root }, 'yt-dlp'), toolPath)
  assert.equal(resolveVideoToolPath({ videoToolsDir: root, ytDlpPath: '/custom/yt-dlp' }, 'yt-dlp'), '/custom/yt-dlp')
})

test('resolveCookieConfigFromSettings handles none, browser, and file modes', () => {
  assert.deepEqual(resolveCookieConfigFromSettings({ cookieMode: 'none' }), { mode: 'none' })
  assert.deepEqual(
    resolveCookieConfigFromSettings({ cookieMode: 'browser', cookieBrowser: 'safari' }),
    {
      mode: 'browser',
      browser: 'safari',
    },
  )
  assert.deepEqual(
    resolveCookieConfigFromSettings({ cookieMode: 'file', cookiesPath: '/tmp/c.txt' }),
    {
      mode: 'file',
      cookiesPath: '/tmp/c.txt',
    },
  )
  assert.deepEqual(
    resolveCookieConfigFromSettings({ cookieMode: 'bilibili', bilibiliCookiesPath: '/tmp/bili.txt' }),
    {
      mode: 'bilibili',
      cookiesPath: '/tmp/bili.txt',
    },
  )
})

test('resolveCookieConfigForUrl applies configured cookies only to Bilibili urls', () => {
  const settings = { cookieMode: 'browser', cookieBrowser: 'chrome' }

  assert.deepEqual(resolveCookieConfigForUrl(settings, 'https://www.bilibili.com/video/BV1G7jJ6nEbV/'), {
    mode: 'browser',
    browser: 'chrome',
  })
  assert.deepEqual(resolveCookieConfigForUrl(settings, 'https://www.youtube.com/watch?v=HigBrtgPzKQ'), {
    mode: 'none',
  })
})

test('getVideoCookieAccessStatus requires configured cookies for Bilibili downloads', () => {
  const missing = getVideoCookieAccessStatus({}, 'https://www.bilibili.com/video/BV1G7jJ6nEbV/')
  assert.equal(missing.required, true)
  assert.equal(missing.hasAccess, false)

  const browser = getVideoCookieAccessStatus(
    { cookieMode: 'browser', cookieBrowser: 'firefox' },
    'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
  )
  assert.equal(browser.required, true)
  assert.equal(browser.hasAccess, true)

  const nonBilibili = getVideoCookieAccessStatus({}, 'https://www.youtube.com/watch?v=HigBrtgPzKQ')
  assert.equal(nonBilibili.required, false)
  assert.equal(nonBilibili.hasAccess, true)
})

test('getVideoCookieAccessStatus validates configured Bilibili cookie files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-cookie-status-'))
  const cookiePath = path.join(dir, 'bilibili-cookies.txt')
  writeFileSync(
    cookiePath,
    [
      '# Netscape HTTP Cookie File',
      '#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t1893456000\tSESSDATA\tsecret',
      '',
    ].join('\n'),
  )

  const valid = getVideoCookieAccessStatus(
    { cookieMode: 'bilibili', bilibiliCookiesPath: cookiePath },
    'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
  )
  assert.equal(valid.required, true)
  assert.equal(valid.hasAccess, true)

  const missing = getVideoCookieAccessStatus(
    { cookieMode: 'bilibili', bilibiliCookiesPath: path.join(dir, 'missing.txt') },
    'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
  )
  assert.equal(missing.required, true)
  assert.equal(missing.hasAccess, false)
})

test('resolveVideoDownloadDir prefers configured directory over per-user default', () => {
  assert.equal(resolveVideoDownloadDir({ videoDownloadDir: '/custom/videos' }, '/default/videos'), '/custom/videos')
  assert.equal(resolveVideoDownloadDir({ videoDownloadDir: '   ' }, '/default/videos'), '/default/videos')
})

test('buildCookieAccessVerificationArgs uses current cookie configuration', () => {
  const browserArgs = buildCookieAccessVerificationArgs({
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    cookieConfig: { mode: 'browser', browser: 'chrome' },
  })
  assert.equal(browserArgs.includes('--cookies-from-browser'), true)
  assert.equal(browserArgs.includes('chrome'), true)

  const fileArgs = buildCookieAccessVerificationArgs({
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    cookieConfig: { mode: 'file', cookiesPath: '/tmp/cookies.txt' },
  })
  assert.equal(fileArgs.includes('--cookies'), true)
  assert.equal(fileArgs.includes('/tmp/cookies.txt'), true)

  const bilibiliArgs = buildCookieAccessVerificationArgs({
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    cookieConfig: { mode: 'bilibili', cookiesPath: '/tmp/bilibili-cookies.txt' },
  })
  assert.equal(bilibiliArgs.includes('--cookies'), true)
  assert.equal(bilibiliArgs.includes('/tmp/bilibili-cookies.txt'), true)
})

test('buildResolvedDownloadArgs passes managed ffmpeg location to yt-dlp', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-video-tools-'))
  const ffmpegPath = getManagedVideoToolPath(root, 'ffmpeg')
  mkdirSync(path.dirname(ffmpegPath), { recursive: true })
  writeFileSync(ffmpegPath, 'fake')

  const args = buildResolvedDownloadArgs({
    settings: { videoToolsDir: root, qualityPreference: 'best' },
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    outputDir: root,
  })

  assert.equal(args[args.indexOf('--ffmpeg-location') + 1], ffmpegPath)
})

test('buildResolvedDownloadArgs does not pass Bilibili cookies to YouTube downloads', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-video-tools-'))

  const args = buildResolvedDownloadArgs({
    settings: {
      cookieMode: 'browser',
      cookieBrowser: 'chrome',
      qualityPreference: 'best',
    },
    url: 'https://www.youtube.com/watch?v=HigBrtgPzKQ',
    outputDir: root,
  })

  assert.equal(args.includes('--cookies-from-browser'), false)
  assert.equal(args.includes('chrome'), false)
})

test('resolvePlaybackPath allows existing files inside the video directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-video-playback-'))
  const videoDir = path.join(root, 'videos')
  mkdirSync(videoDir)
  const filePath = path.join(videoDir, 'clip with spaces.mp4')
  writeFileSync(filePath, 'fake')

  const result = resolvePlaybackPath(videoDir, filePath)

  assert.equal(result.success, true)
  assert.equal(result.url?.startsWith('life-video://play/'), true)
  assert.match(result.url || '', /clip%20with%20spaces\.mp4/)
})

test('resolvePlaybackPath rejects sibling directories with the same prefix', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-video-playback-'))
  const videoDir = path.join(root, 'videos')
  const siblingDir = path.join(root, 'videos-other')
  mkdirSync(videoDir)
  mkdirSync(siblingDir)
  const filePath = path.join(siblingDir, 'clip.mp4')
  writeFileSync(filePath, 'fake')

  const result = resolvePlaybackPath(videoDir, filePath)

  assert.equal(result.success, false)
})

test('resolveVideoProtocolPath allows only encoded files inside the video directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-video-protocol-'))
  const videoDir = path.join(root, 'videos')
  const otherDir = path.join(root, 'other')
  mkdirSync(videoDir)
  mkdirSync(otherDir)
  const allowedFile = path.join(videoDir, 'clip.mp4')
  const blockedFile = path.join(otherDir, 'clip.mp4')
  writeFileSync(allowedFile, 'fake')
  writeFileSync(blockedFile, 'fake')

  assert.equal(
    resolveVideoProtocolPath(videoDir, `life-video://play/${encodeURIComponent(allowedFile)}`).success,
    true,
  )
  assert.equal(
    resolveVideoProtocolPath(videoDir, `life-video://play/${encodeURIComponent(blockedFile)}`).success,
    false,
  )
})

test('parsePrintedFilePath reads yt-dlp json filepath lines', () => {
  assert.equal(parsePrintedFilePath('filepath:"/tmp/video file.mp4"'), '/tmp/video file.mp4')
  assert.equal(parsePrintedFilePath('not a filepath'), undefined)
})

test('parseDownloadProgressPercent reads yt-dlp download percentages', () => {
  assert.equal(
    parseDownloadProgressPercent('[download]  12.3% of   54.00MiB at 1.10MiB/s ETA 00:39'),
    12.3,
  )
  assert.equal(parseDownloadProgressPercent('[download] 100% of 54.00MiB in 00:50'), 100)
  assert.equal(parseDownloadProgressPercent('Starting download...'), undefined)
})

test('inferDownloadPhase maps yt-dlp output into user-facing phases', () => {
  assert.equal(inferDownloadPhase('[download]  12.3% of 54.00MiB', 12.3), 'downloading')
  assert.equal(inferDownloadPhase('[Merger] Merging formats into "video.mp4"'), 'processing')
  assert.equal(inferDownloadPhase('[BiliBili] Extracting URL'), 'preparing')
})

test('active download progress is monotonic and does not report 100 before completion', async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-download-progress-'))
  const fakeYtDlp = writeFakeYtDlp(
    outputDir,
    [
      '#!/bin/sh',
      'echo "[download]   0.0% of 10.00MiB"',
      'sleep 0.01',
      'echo "[download] 100.0% of 10.00MiB"',
      'sleep 0.01',
      'echo "[download]   8.0% of 2.00MiB"',
      'sleep 0.01',
      'echo "[download]  54.0% of 2.00MiB"',
      'sleep 0.01',
      'echo "filepath:\\"/tmp/final.mp4\\""',
      'exit 0',
      '',
    ].join('\n'),
    [
      '@echo off',
      'echo [download]   0.0%% of 10.00MiB',
      'echo [download] 100.0%% of 10.00MiB',
      'echo [download]   8.0%% of 2.00MiB',
      'echo [download]  54.0%% of 2.00MiB',
      'echo filepath:"/tmp/final.mp4"',
      'exit /b 0',
      '',
    ].join('\r\n'),
  )
  const sent: any[][] = []
  const progressUpdates: number[] = []

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('download finished callback was not called')), 3000)
    startVideoDownload({
      settings: { ytDlpPath: fakeYtDlp },
      mainWindow: {
        webContents: {
          send: (...args: any[]) => sent.push(args),
        },
      } as any,
      url: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0',
      title: 'Multi-stage progress',
      outputDir,
      onProgress: (progress) => {
        if (typeof progress === 'number') progressUpdates.push(progress)
      },
      onFinished: () => {
        clearTimeout(timeout)
        resolve()
      },
    }).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.deepEqual(progressUpdates, [0, 99, 99, 99])
  const eventProgresses = sent
    .filter(([channel, payload]) => channel === 'video:download-progress' && typeof payload.progress === 'number')
    .map(([, payload]) => payload.progress)
  assert.deepEqual(eventProgresses, [0, 0, 99, 99, 99, 99])
  const eventPhases = sent
    .filter(([channel, payload]) => channel === 'video:download-progress' && payload.phase)
    .map(([, payload]) => payload.phase)
  assert.deepEqual(eventPhases, [
    'preparing',
    'downloading',
    'downloading',
    'downloading',
    'downloading',
    'processing',
    'processing',
  ])
  assert.equal(sent.some(([channel]) => channel === 'video:download-finished'), true)
})

test('startVideoDownload fails when yt-dlp exits successfully without a filepath', async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-download-no-filepath-'))
  const fakeYtDlp = writeFakeYtDlp(
    outputDir,
    '#!/bin/sh\necho "[download] 100.0% of 10.00MiB"\nexit 0\n',
    '@echo off\r\necho [download] 100.0%% of 10.00MiB\r\nexit /b 0\r\n',
  )
  const sent: any[][] = []
  const message = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('download failure callback was not called')), 3000)
    startVideoDownload({
      settings: { ytDlpPath: fakeYtDlp },
      mainWindow: {
        webContents: {
          send: (...args: any[]) => sent.push(args),
        },
      } as any,
      url: 'https://www.bilibili.com/video/BV1QFTb6nE4L/?p=1',
      title: 'No filepath',
      outputDir,
      onFailed: (failure) => {
        clearTimeout(timeout)
        resolve(failure)
      },
      onFinished: () => {
        clearTimeout(timeout)
        reject(new Error('download should not finish without a filepath'))
      },
    }).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  assert.match(message, /file path/i)
  assert.equal(sent.some(([channel]) => channel === 'video:download-failed'), true)
  assert.equal(sent.some(([channel]) => channel === 'video:download-finished'), false)
})

test('parseFfprobeDurationSeconds reads numeric ffprobe output', () => {
  assert.equal(parseFfprobeDurationSeconds('95.241000\n'), 95)
  assert.equal(parseFfprobeDurationSeconds('N/A\n'), undefined)
})

test('parseFfmpegDurationSeconds reads duration from ffmpeg stderr', () => {
  assert.equal(parseFfmpegDurationSeconds('Duration: 00:01:35.24, start: 0.000000, bitrate: 512 kb/s'), 95)
  assert.equal(parseFfmpegDurationSeconds('no duration here'), undefined)
})

test('Bilibili HTML fallback is allowed when yt-dlp is missing', () => {
  assert.equal(
    shouldUseBilibiliHtmlFallback('https://www.bilibili.com/video/BV1G7jJ6nEbV/?spm_id_from=333', {
      code: 'tool_missing',
      severity: 'error',
      message: 'yt-dlp is not installed.',
    }),
    true,
  )
  assert.equal(
    shouldUseBilibiliHtmlFallback('https://fakebilibili.com/video/BV1G7jJ6nEbV/', {
      code: 'tool_missing',
      severity: 'error',
      message: 'yt-dlp is not installed.',
    }),
    false,
  )
})

test('Bilibili video URLs prefer HTML metadata before yt-dlp probing', () => {
  assert.equal(
    shouldPreferBilibiliHtmlMetadata('https://www.bilibili.com/video/BV1G7jJ6nEbV/?spm_id_from=333'),
    true,
  )
  assert.equal(shouldPreferBilibiliHtmlMetadata('https://fakebilibili.com/video/BV1G7jJ6nEbV/'), false)
  assert.equal(shouldPreferBilibiliHtmlMetadata('https://www.youtube.com/watch?v=hLQl3WQQoQ0'), false)
})

test('runProcess times out instead of waiting forever', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
    timeoutMs: 50,
  })

  assert.equal(result.code, -1)
  assert.match(result.stderr, /timed out/i)
})

test('startVideoDownload reports missing yt-dlp without throwing an uncaught child process error', async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-download-'))
  const sent: any[][] = []
  const message = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('download failure callback was not called')), 3000)

    startVideoDownload({
      settings: { ytDlpPath: path.join(outputDir, 'missing-yt-dlp') },
      mainWindow: {
        webContents: {
          send: (...args: any[]) => sent.push(args),
        },
      } as any,
      url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
      title: 'Missing downloader',
      outputDir,
      onFailed: (failure) => {
        clearTimeout(timeout)
        resolve(failure)
      },
    }).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  assert.match(message, /yt-dlp|missing-yt-dlp|ENOENT/i)
  assert.equal(sent.some(([channel]) => channel === 'video:download-failed'), true)
  assert.equal(sent.some(([channel]) => channel === 'video:download-progress'), true)
})

test('startVideoDownload sends an initial progress event without a duplicate status message', async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-download-start-'))
  const sent: any[][] = []
  await startVideoDownload({
    settings: { ytDlpPath: path.join(outputDir, 'missing-yt-dlp') },
    mainWindow: {
      webContents: {
        send: (...args: any[]) => sent.push(args),
      },
    } as any,
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    title: 'Starts immediately',
    outputDir,
  })

  const firstProgress = sent.find(([channel]) => channel === 'video:download-progress')
  assert.equal(firstProgress?.[1]?.title, 'Starts immediately')
  assert.equal(firstProgress?.[1]?.message, undefined)
  assert.equal(firstProgress?.[1]?.progress, 0)
})

test('startVideoDownload reports the real yt-dlp stderr instead of only exit code 1', async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-download-error-'))
  const fakeYtDlp = writeFakeYtDlp(
    outputDir,
    '#!/bin/sh\necho "ERROR: [BiliBili] 1G7jJ6nEbV: Unable to download JSON metadata: HTTP Error 412: Precondition Failed" >&2\nexit 1\n',
    '@echo off\r\necho ERROR: [BiliBili] 1G7jJ6nEbV: Unable to download JSON metadata: HTTP Error 412: Precondition Failed 1>&2\r\nexit /b 1\r\n',
  )
  const sent: any[][] = []
  const message = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('download failure callback was not called')), 3000)

    startVideoDownload({
      settings: { ytDlpPath: fakeYtDlp },
      mainWindow: {
        webContents: {
          send: (...args: any[]) => sent.push(args),
        },
      } as any,
      url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
      title: 'Blocked by Bilibili',
      outputDir,
      onFailed: (failure) => {
        clearTimeout(timeout)
        resolve(failure)
      },
    }).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  assert.match(message, /Bilibili blocked anonymous/i)
  assert.doesNotMatch(message, /^yt-dlp exited with code 1$/)
  const failedEvent = sent.find(([channel]) => channel === 'video:download-failed')
  assert.match(failedEvent?.[1]?.message, /cookies/i)
})

test('startVideoDownload includes video id in progress and failure events when provided', async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-download-id-'))
  const fakeYtDlp = writeFakeYtDlp(
    outputDir,
    '#!/bin/sh\necho "[download]  42.0% of 10.00MiB"\necho "ERROR: cookies are missing" >&2\nexit 1\n',
    '@echo off\r\necho [download]  42.0%% of 10.00MiB\r\necho ERROR: cookies are missing 1>&2\r\nexit /b 1\r\n',
  )
  const sent: any[][] = []

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('download failure callback was not called')), 3000)
    startVideoDownload({
      settings: { ytDlpPath: fakeYtDlp },
      mainWindow: {
        webContents: {
          send: (...args: any[]) => sent.push(args),
        },
      } as any,
      url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
      title: 'With video id',
      videoId: 42,
      outputDir,
      onFailed: () => {
        clearTimeout(timeout)
        resolve()
      },
    }).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  const progressEvent = sent.find(([channel, payload]) => channel === 'video:download-progress' && payload.progress === 42)
  assert.equal(progressEvent?.[1]?.videoId, 42)
  const failedEvent = sent.find(([channel]) => channel === 'video:download-failed')
  assert.equal(failedEvent?.[1]?.videoId, 42)
})

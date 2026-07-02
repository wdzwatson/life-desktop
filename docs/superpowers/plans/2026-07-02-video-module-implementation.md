# Video Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a library-first video module with groups, tags, reliable `yt-dlp` parsing/downloading, Bilibili cookie authentication diagnostics, and real local playback.

**Architecture:** Keep untrusted downloader execution in Electron main process and expose only structured IPC to the renderer. Split parser normalization and command argument construction into small pure TypeScript modules with Node tests before wiring them into IPC and UI. Use additive SQLite migrations so existing user data remains valid.

**Tech Stack:** Electron main/preload IPC, React 19 renderer, better-sqlite3, Node `node:test`, `yt-dlp`, `ffmpeg`, lucide-react.

---

## File Structure

- Create `electron/video/types.ts`: shared main-process video service types.
- Create `electron/video/ytDlpArgs.ts`: pure functions for building `yt-dlp` metadata/download arguments.
- Create `electron/video/normalize.ts`: pure functions for converting raw `yt-dlp` JSON/errors into app parse results and diagnostics.
- Create `electron/video/service.ts`: main-process service that checks tools, invokes `yt-dlp`, parses output, downloads videos, and resolves playback URLs.
- Modify `electron/db/schema.ts`: add video grouping/tagging tables and additive `videos` columns.
- Modify `electron/main.ts`: replace mock video IPC handlers with service-backed handlers and add cookie file selection if needed.
- Modify `electron/preload.ts`: expose structured video IPC methods.
- Create `src/views/videoTypes.ts`: renderer-facing video types.
- Create `src/views/videoLibraryUtils.ts`: pure renderer helpers for filtering, tag parsing, duration formatting, and playback-state decisions.
- Rewrite `src/views/Videos.tsx`: implement the approved three-column library layout, metadata editing, diagnostics, and real player.
- Modify `src/views/Settings.tsx`: add video downloader settings for tool paths, cookie mode, browser, cookies file, and quality.
- Modify `src/locales/en-US.json` and `src/locales/zh-CN.json`: add UI copy for groups, tags, diagnostics, downloader settings, and auth.
- Create `tests/videoYtDlpArgs.test.ts`: pure tests for command arguments.
- Create `tests/videoNormalize.test.ts`: pure tests for JSON normalization and error diagnostics.
- Create `tests/videoLibraryUtils.test.ts`: pure renderer helper tests.
- Create `tests/fixtures/video/*.json`: small representative `yt-dlp` JSON fixtures.

## Task 1: Parser Types, Argument Builder, And Tests

**Files:**
- Create: `electron/video/types.ts`
- Create: `electron/video/ytDlpArgs.ts`
- Create: `tests/videoYtDlpArgs.test.ts`

- [ ] **Step 1: Write failing tests for metadata arguments**

Create `tests/videoYtDlpArgs.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMetadataArgs,
  buildDownloadArgs,
  type VideoCookieConfig,
  type VideoQualityPreference,
} from '../electron/video/ytDlpArgs.ts'

test('metadata args request full JSON without shell interpolation', () => {
  const args = buildMetadataArgs({
    url: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0',
    flatPlaylist: false,
    cookieConfig: { mode: 'none' },
  })

  assert.deepEqual(args, [
    '--skip-download',
    '--dump-single-json',
    '--no-warnings',
    'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0',
  ])
})

test('metadata args can request flat playlist preview', () => {
  const args = buildMetadataArgs({
    url: 'https://www.bilibili.com/video/BV15j2LBDEyv/',
    flatPlaylist: true,
    playlistEnd: 50,
    cookieConfig: { mode: 'none' },
  })

  assert.deepEqual(args, [
    '--skip-download',
    '--flat-playlist',
    '--dump-single-json',
    '--playlist-end',
    '50',
    '--no-warnings',
    'https://www.bilibili.com/video/BV15j2LBDEyv/',
  ])
})

test('metadata args support browser cookies', () => {
  const cookieConfig: VideoCookieConfig = { mode: 'browser', browser: 'chrome' }
  const args = buildMetadataArgs({
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    flatPlaylist: false,
    cookieConfig,
  })

  assert.deepEqual(args, [
    '--skip-download',
    '--dump-single-json',
    '--cookies-from-browser',
    'chrome',
    '--no-warnings',
    'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
  ])
})

test('metadata args support cookies file', () => {
  const cookieConfig: VideoCookieConfig = { mode: 'file', cookiesPath: '/Users/me/bili.txt' }
  const args = buildMetadataArgs({
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    flatPlaylist: false,
    cookieConfig,
  })

  assert.deepEqual(args, [
    '--skip-download',
    '--dump-single-json',
    '--cookies',
    '/Users/me/bili.txt',
    '--no-warnings',
    'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
  ])
})

test('download args select playable best quality with ffmpeg available', () => {
  const quality: VideoQualityPreference = 'best'
  const args = buildDownloadArgs({
    url: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0',
    outputTemplate: '/Users/me/LifeOS/users/guest/files/videos/%(title)s.%(ext)s',
    cookieConfig: { mode: 'none' },
    quality,
    ffmpegPath: '/opt/homebrew/bin/ffmpeg',
  })

  assert.deepEqual(args, [
    '--newline',
    '--print',
    'after_move:filepath:%(filepath)j',
    '-f',
    'bv*+ba/b',
    '--merge-output-format',
    'mp4',
    '--ffmpeg-location',
    '/opt/homebrew/bin/ffmpeg',
    '-o',
    '/Users/me/LifeOS/users/guest/files/videos/%(title)s.%(ext)s',
    'https://www.youtube.com/watch?v=hLQl3WQQoQ0',
  ])
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm exec tsc -- --noEmit
node --import tsx tests/videoYtDlpArgs.test.ts
```

Expected: TypeScript or runtime failure because `electron/video/ytDlpArgs.ts` does not exist.

- [ ] **Step 3: Add types and argument builder**

Create `electron/video/types.ts`:

```ts
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
```

Create `electron/video/ytDlpArgs.ts`:

```ts
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
  if (cookieConfig.mode === 'file') {
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
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
node --import tsx tests/videoYtDlpArgs.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/video/types.ts electron/video/ytDlpArgs.ts tests/videoYtDlpArgs.test.ts
git commit -m "feat: add video downloader argument builder"
```

## Task 2: Normalize yt-dlp JSON And Diagnostics

**Files:**
- Create: `electron/video/normalize.ts`
- Create: `tests/fixtures/video/youtube-playlist.json`
- Create: `tests/fixtures/video/bilibili-flat-playlist.json`
- Create: `tests/videoNormalize.test.ts`

- [ ] **Step 1: Write fixture files**

Create `tests/fixtures/video/youtube-playlist.json`:

```json
{
  "_type": "playlist",
  "extractor_key": "Youtube",
  "id": "RDhLQl3WQQoQ0",
  "title": "Mix - Adele - Someone Like You (Official Music Video)",
  "webpage_url": "https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0",
  "entries": [
    {
      "id": "hLQl3WQQoQ0",
      "title": "Adele - Someone Like You (Official Music Video)",
      "url": "https://www.youtube.com/watch?v=hLQl3WQQoQ0",
      "duration": 285,
      "duration_string": "4:45",
      "thumbnail": "https://i.ytimg.com/vi/hLQl3WQQoQ0/hqdefault.jpg",
      "extractor_key": "Youtube"
    }
  ]
}
```

Create `tests/fixtures/video/bilibili-flat-playlist.json`:

```json
{
  "_type": "playlist",
  "extractor_key": "BiliBili",
  "id": "BV15j2LBDEyv",
  "title": "LangChain1.0+LangGraph1.0快速落地",
  "webpage_url": "https://www.bilibili.com/video/BV15j2LBDEyv/",
  "entries": [
    {
      "_type": "url",
      "id": "15j2LBDEyv",
      "title": "P1 课程介绍",
      "url": "https://www.bilibili.com/video/BV15j2LBDEyv?p=1",
      "webpage_url": "https://www.bilibili.com/video/BV15j2LBDEyv?p=1",
      "playlist_index": 1,
      "extractor_key": "BiliBili"
    },
    {
      "_type": "url",
      "id": "15j2LBDEyv",
      "title": "P2 环境准备",
      "url": "https://www.bilibili.com/video/BV15j2LBDEyv?p=2",
      "webpage_url": "https://www.bilibili.com/video/BV15j2LBDEyv?p=2",
      "playlist_index": 2,
      "extractor_key": "BiliBili"
    }
  ]
}
```

- [ ] **Step 2: Write failing normalization tests**

Create `tests/videoNormalize.test.ts`:

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeYtDlpError, normalizeYtDlpMetadata } from '../electron/video/normalize.ts'

function fixture(name: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/video/${name}`, import.meta.url), 'utf-8'))
}

test('normalizes YouTube playlist metadata', () => {
  const result = normalizeYtDlpMetadata(fixture('youtube-playlist.json'), {
    fallbackUrl: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0',
    wasFlatPlaylist: false,
  })

  assert.equal(result.kind, 'playlist')
  assert.equal(result.source, 'youtube')
  assert.equal(result.playlistId, 'RDhLQl3WQQoQ0')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].sourceId, 'hLQl3WQQoQ0')
  assert.equal(result.items[0].durationLabel, '4:45')
  assert.equal(result.diagnostics[0].code, 'ok')
})

test('normalizes Bilibili flat playlist entries as selectable parts', () => {
  const result = normalizeYtDlpMetadata(fixture('bilibili-flat-playlist.json'), {
    fallbackUrl: 'https://www.bilibili.com/video/BV15j2LBDEyv/',
    wasFlatPlaylist: true,
  })

  assert.equal(result.kind, 'playlist')
  assert.equal(result.source, 'bilibili')
  assert.equal(result.playlistId, 'BV15j2LBDEyv')
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].partIndex, 1)
  assert.equal(result.items[1].sourceUrl, 'https://www.bilibili.com/video/BV15j2LBDEyv?p=2')
})

test('maps Bilibili HTTP 412 to auth-aware diagnostic', () => {
  const diagnostic = normalizeYtDlpError(
    'ERROR: [BiliBili] 1G7jJ6nEbV: Unable to download JSON metadata: HTTP Error 412: Precondition Failed',
  )

  assert.equal(diagnostic.code, 'bilibili_412')
  assert.equal(diagnostic.severity, 'warning')
  assert.match(diagnostic.message, /cookies/)
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
node --import tsx tests/videoNormalize.test.ts
```

Expected: fails because `electron/video/normalize.ts` does not exist.

- [ ] **Step 4: Implement normalizer**

Create `electron/video/normalize.ts`:

```ts
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

function normalizeItem(raw: any, parent: any, ctx: NormalizeContext): NormalizedVideoItem {
  const extractor = raw.extractor_key || parent.extractor_key || raw.extractor || parent.extractor
  const source = sourceFromExtractor(extractor)
  const sourceUrl = raw.webpage_url || raw.url || ctx.fallbackUrl
  const sourceId = String(raw.id || raw.display_id || sourceUrl)
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
  const diagnostics: VideoDiagnostic[] = [
    { code: 'ok', severity: 'info', message: 'Parsed video metadata successfully.' },
  ]

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
```

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
node --import tsx tests/videoNormalize.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add electron/video/normalize.ts tests/videoNormalize.test.ts tests/fixtures/video
git commit -m "feat: normalize video metadata"
```

## Task 3: Add Video Schema Migration

**Files:**
- Modify: `electron/db/schema.ts`
- Create: `tests/videoSchema.test.mjs`

- [ ] **Step 1: Write failing schema test**

Create `tests/videoSchema.test.mjs`:

```js
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../dist-electron/db/schema.js'

test('video schema includes groups, tags, links, and additive video metadata columns', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-'))
  initializeUserDatabase(dir)

  const db = new Database(path.join(dir, 'videos.db'))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const tableNames = tables.map((row) => row.name)

  assert.ok(tableNames.includes('video_groups'))
  assert.ok(tableNames.includes('video_tags'))
  assert.ok(tableNames.includes('video_tag_links'))

  const columns = db.prepare('PRAGMA table_info(videos)').all().map((row) => row.name)
  for (const column of [
    'group_id',
    'source_id',
    'source_url',
    'playlist_id',
    'playlist_title',
    'part_index',
    'thumbnail_url',
    'local_path',
    'selected_quality',
    'parse_status',
    'diagnostic_message',
  ]) {
    assert.ok(columns.includes(column), `missing ${column}`)
  }
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm run build
node tests/videoSchema.test.mjs
```

Expected: test fails because the new tables/columns are missing.

- [ ] **Step 3: Implement additive schema changes**

In `electron/db/schema.ts`, after the existing `CREATE TABLE IF NOT EXISTS videos (...)` statement, add:

```ts
  const videoColumns = videosDb.prepare('PRAGMA table_info(videos)').all() as Array<{ name: string }>
  const videoColumnNames = new Set(videoColumns.map((column) => column.name))
  const addVideoColumn = (name: string, definition: string) => {
    if (!videoColumnNames.has(name)) {
      videosDb.prepare(`ALTER TABLE videos ADD COLUMN ${name} ${definition}`).run()
      videoColumnNames.add(name)
    }
  }

  addVideoColumn('group_id', 'INTEGER')
  addVideoColumn('source_id', 'TEXT')
  addVideoColumn('source_url', 'TEXT')
  addVideoColumn('playlist_id', 'TEXT')
  addVideoColumn('playlist_title', 'TEXT')
  addVideoColumn('part_index', 'INTEGER')
  addVideoColumn('thumbnail_url', 'TEXT')
  addVideoColumn('local_path', 'TEXT')
  addVideoColumn('selected_quality', "TEXT DEFAULT 'best'")
  addVideoColumn('parse_status', "TEXT DEFAULT 'ok'")
  addVideoColumn('diagnostic_message', 'TEXT')

  videosDb.exec(`
    CREATE TABLE IF NOT EXISTS video_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS video_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#64748b',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS video_tag_links (
      video_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (video_id, tag_id),
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES video_tags(id) ON DELETE CASCADE
    );
  `)
```

- [ ] **Step 4: Run schema test and app build**

Run:

```bash
npm run build
node tests/videoSchema.test.mjs
```

Expected: build succeeds and test passes.

- [ ] **Step 5: Commit**

```bash
git add electron/db/schema.ts tests/videoSchema.test.mjs
git commit -m "feat: add video library schema"
```

## Task 4: Main-Process Video Service And IPC

**Files:**
- Create: `electron/video/service.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Write a focused service smoke test**

Create `tests/videoServiceSmoke.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCookieConfigFromSettings, resolveVideoToolPath } from '../electron/video/service.ts'

test('resolveVideoToolPath prefers configured path over executable name', () => {
  assert.equal(resolveVideoToolPath({ ytDlpPath: '/opt/bin/yt-dlp' }, 'yt-dlp'), '/opt/bin/yt-dlp')
  assert.equal(resolveVideoToolPath({}, 'yt-dlp'), 'yt-dlp')
})

test('resolveCookieConfigFromSettings handles none, browser, and file modes', () => {
  assert.deepEqual(resolveCookieConfigFromSettings({ cookieMode: 'none' }), { mode: 'none' })
  assert.deepEqual(resolveCookieConfigFromSettings({ cookieMode: 'browser', cookieBrowser: 'safari' }), {
    mode: 'browser',
    browser: 'safari',
  })
  assert.deepEqual(resolveCookieConfigFromSettings({ cookieMode: 'file', cookiesPath: '/tmp/c.txt' }), {
    mode: 'file',
    cookiesPath: '/tmp/c.txt',
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --import tsx tests/videoServiceSmoke.test.ts
```

Expected: fails because `electron/video/service.ts` does not exist.

- [ ] **Step 3: Implement video service skeleton**

Create `electron/video/service.ts` with:

```ts
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
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
  return { success: true }
}

export function resolvePlaybackPath(userVideoDir: string, localPath: string) {
  const resolved = path.resolve(localPath)
  const allowedRoot = path.resolve(userVideoDir)
  if (!resolved.startsWith(allowedRoot)) {
    return { success: false, error: 'Playback path is outside the video library.' }
  }
  if (!fs.existsSync(resolved)) {
    return { success: false, error: 'Video file does not exist.' }
  }
  return { success: true, url: `file://${resolved}` }
}
```

- [ ] **Step 4: Run smoke test**

Run:

```bash
node --import tsx tests/videoServiceSmoke.test.ts
```

Expected: pass.

- [ ] **Step 5: Replace mock IPC in `electron/main.ts`**

Replace the existing `video:parseUrl` and `video:download` handlers near the bottom of `electron/main.ts` with imports and handlers:

```ts
import {
  checkVideoTools,
  parseVideoUrl,
  resolvePlaybackPath,
  startVideoDownload,
} from './video/service'
```

```ts
function getActiveUserVideoDir() {
  return path.join(BASE_DIR, 'users', activeUserId, 'files', 'videos')
}

ipcMain.handle('video:checkTools', async () => {
  return checkVideoTools(getSettings())
})

ipcMain.handle('video:parseUrl', async (_, url: string) => {
  return parseVideoUrl(getSettings(), url)
})

ipcMain.handle('video:download', async (_, videoData: any) => {
  const result = await startVideoDownload({
    settings: getSettings(),
    mainWindow,
    url: videoData.sourceUrl || videoData.url,
    title: videoData.title,
    outputDir: getActiveUserVideoDir(),
  })
  return result
})

ipcMain.handle('video:getPlaybackUrl', async (_, localPath: string) => {
  return resolvePlaybackPath(getActiveUserVideoDir(), localPath)
})
```

- [ ] **Step 6: Update preload**

In `electron/preload.ts`, add:

```ts
checkVideoTools: () => ipcRenderer.invoke('video:checkTools'),
getVideoPlaybackUrl: (localPath: string) => ipcRenderer.invoke('video:getPlaybackUrl', localPath),
```

Keep existing `parseVideoUrl`, `startDownload`, and listeners.

- [ ] **Step 7: Build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 8: Commit**

```bash
git add electron/video/service.ts electron/main.ts electron/preload.ts tests/videoServiceSmoke.test.ts
git commit -m "feat: wire video service ipc"
```

## Task 5: Renderer Helpers For Library Filtering And Playback State

**Files:**
- Create: `src/views/videoTypes.ts`
- Create: `src/views/videoLibraryUtils.ts`
- Create: `tests/videoLibraryUtils.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/videoLibraryUtils.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canPlayVideo,
  filterVideos,
  formatDuration,
  parseTagInput,
} from '../src/views/videoLibraryUtils.ts'

const videos = [
  { id: 1, title: 'LangChain 入门', group_id: 2, status: 'downloaded', local_path: '/a.mp4', tags: ['AI', '课程'] },
  { id: 2, title: 'Adele Someone Like You', group_id: null, status: 'unclassified', local_path: '', tags: ['音乐'] },
]

test('filterVideos matches query, group, and tag', () => {
  assert.deepEqual(filterVideos(videos, { query: 'lang', groupId: 2, tag: 'AI' }).map((v) => v.id), [1])
  assert.deepEqual(filterVideos(videos, { query: '', groupId: null, tag: '音乐' }).map((v) => v.id), [2])
})

test('canPlayVideo requires downloaded status and local path', () => {
  assert.equal(canPlayVideo(videos[0]), true)
  assert.equal(canPlayVideo(videos[1]), false)
})

test('formatDuration converts seconds to labels', () => {
  assert.equal(formatDuration(285), '4:45')
  assert.equal(formatDuration(undefined), '')
})

test('parseTagInput trims and deduplicates tags', () => {
  assert.deepEqual(parseTagInput('AI, 课程,AI,, 前端'), ['AI', '课程', '前端'])
})
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
```

Expected: fails because helper file does not exist.

- [ ] **Step 3: Implement renderer types and helpers**

Create `src/views/videoTypes.ts`:

```ts
export interface VideoRecord {
  id: number
  title: string
  group_id?: number | null
  status?: string
  local_path?: string
  path?: string
  duration?: string
  source?: string
  tags?: string[]
}

export interface VideoFilter {
  query: string
  groupId: number | null | 'all' | 'downloaded' | 'downloading'
  tag: string | null
}
```

Create `src/views/videoLibraryUtils.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/views/videoTypes.ts src/views/videoLibraryUtils.ts tests/videoLibraryUtils.test.ts
git commit -m "feat: add video library helpers"
```

## Task 6: Rebuild Videos UI Around Groups, Tags, Diagnostics, And Playback

**Files:**
- Modify: `src/views/Videos.tsx`
- Modify: `src/locales/en-US.json`
- Modify: `src/locales/zh-CN.json`

- [ ] **Step 1: Replace local query with joined library query**

In `src/views/Videos.tsx`, update `loadData` to fetch groups, tags, and videos:

```ts
const groupsRes = await api.dbQuery('videos', 'SELECT * FROM video_groups ORDER BY sort_order ASC, name ASC')
const tagsRes = await api.dbQuery('videos', 'SELECT * FROM video_tags ORDER BY name ASC')
const videosRes = await api.dbQuery(
  'videos',
  `
  SELECT v.*,
         g.name as group_name,
         COALESCE(GROUP_CONCAT(t.name), '') as tag_names
  FROM videos v
  LEFT JOIN video_groups g ON g.id = v.group_id
  LEFT JOIN video_tag_links vtl ON vtl.video_id = v.id
  LEFT JOIN video_tags t ON t.id = vtl.tag_id
  GROUP BY v.id
  ORDER BY v.priority = 'high' DESC, v.priority = 'mid' DESC, v.favorite_time DESC
  `,
)
```

Map `tag_names` to arrays before storing in state.

- [ ] **Step 2: Add group and tag actions**

Add handlers in `Videos.tsx`:

```ts
const handleCreateGroup = async () => {
  const name = window.prompt(t('videos.prompt_group_name'))
  if (!api || !name?.trim()) return
  await api.dbQuery('videos', 'INSERT OR IGNORE INTO video_groups (name, sort_order) VALUES (?, ?)', [
    name.trim(),
    groups.length + 1,
  ])
  loadData()
}

const handleSaveVideoTags = async (videoId: number, input: string) => {
  if (!api) return
  const tags = parseTagInput(input)
  await api.dbQuery('videos', 'DELETE FROM video_tag_links WHERE video_id = ?', [videoId])
  for (const tag of tags) {
    await api.dbQuery('videos', 'INSERT OR IGNORE INTO video_tags (name) VALUES (?)', [tag])
    const res = await api.dbQuery('videos', 'SELECT id FROM video_tags WHERE name = ?', [tag])
    const tagId = res?.data?.[0]?.id
    if (tagId) {
      await api.dbQuery('videos', 'INSERT OR IGNORE INTO video_tag_links (video_id, tag_id) VALUES (?, ?)', [
        videoId,
        tagId,
      ])
    }
  }
  loadData()
}
```

- [ ] **Step 3: Update parse and import behavior**

Change `handleQueueDownload` so parsed items are inserted with normalized fields:

```ts
await api.dbQuery(
  'videos',
  `
  INSERT INTO videos
    (title, url, source_url, source_id, playlist_id, playlist_title, part_index, thumbnail_url, duration, source, status, parse_status, diagnostic_message)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclassified', ?, ?)
  `,
  [
    item.title,
    item.sourceUrl,
    item.sourceUrl,
    item.sourceId,
    item.playlistId,
    parsedData.playlistTitle,
    item.partIndex,
    item.thumbnailUrl,
    item.durationLabel,
    item.source,
    parsedData.diagnostics?.[0]?.code || 'ok',
    parsedData.diagnostics?.map((d: any) => d.message).join('\n') || '',
  ],
)
```

Keep actual downloading as a separate action button so importing metadata is not conflated with immediate download.

- [ ] **Step 4: Replace layout JSX**

Use a top-level grid:

```tsx
<div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr) 320px', gap: '16px', minHeight: 0, flexGrow: 1 }}>
  <aside>{/* groups and tags */}</aside>
  <main>{/* parser and video list */}</main>
  <aside>{/* selected video details and diagnostics */}</aside>
</div>
```

Preserve existing `card`, `btn`, and `form-field` classes. Use lucide icons for play, download, tag, folder, settings, and delete buttons.

- [ ] **Step 5: Implement real playback overlay**

Replace the placeholder player body with:

```tsx
<video
  ref={videoRef}
  src={playbackUrl}
  controls
  autoPlay
  style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
/>
```

When opening a video:

```ts
const handlePlayVideo = async (video: any) => {
  const localPath = video.local_path || video.path
  if (!localPath) {
    showToast(t('videos.toast_download_before_play'))
    return
  }
  const res = await api.getVideoPlaybackUrl(localPath)
  if (!res?.success) {
    showToast(res?.error || t('videos.toast_playback_failed'))
    return
  }
  setPlayingVideo(video)
  setPlaybackUrl(res.url)
}
```

Apply speed changes with:

```ts
useEffect(() => {
  if (videoRef.current) videoRef.current.playbackRate = playbackSpeed
}, [playbackSpeed, playbackUrl])
```

- [ ] **Step 6: Add locale keys**

Add these keys under `videos` in both locale files with translated text:

```json
{
  "all_videos": "All",
  "uncategorized": "Uncategorized",
  "downloaded_filter": "Downloaded",
  "downloading_filter": "Downloading",
  "groups_title": "Groups",
  "tags_title": "Tags",
  "btn_new_group": "New group",
  "prompt_group_name": "Group name",
  "details_title": "Details",
  "diagnostics_title": "Diagnostics",
  "btn_import_selected": "Import selected",
  "btn_download": "Download",
  "toast_download_before_play": "Download this video before playback.",
  "toast_playback_failed": "Unable to open this video file."
}
```

- [ ] **Step 7: Build and manually inspect**

Run:

```bash
npm run build
```

Expected: build succeeds. Open the dev app and confirm the Videos screen renders with three columns, parser input, groups/tags, and details panel.

- [ ] **Step 8: Commit**

```bash
git add src/views/Videos.tsx src/locales/en-US.json src/locales/zh-CN.json
git commit -m "feat: rebuild video library ui"
```

## Task 7: Downloader Settings UI

**Files:**
- Modify: `src/views/Settings.tsx`
- Modify: `src/locales/en-US.json`
- Modify: `src/locales/zh-CN.json`

- [ ] **Step 1: Add Settings tab state**

Update `activeMenu` type in `src/views/Settings.tsx`:

```ts
const [activeMenu, setActiveMenu] = useState<
  'appearance' | 'categories' | 'profile' | 'security' | 'updates' | 'video'
>('appearance')
```

- [ ] **Step 2: Add video settings state**

Add state near update settings:

```ts
const [videoSettings, setVideoSettings] = useState({
  ytDlpPath: '',
  ffmpegPath: '',
  cookieMode: 'none',
  cookieBrowser: 'chrome',
  cookiesPath: '',
  qualityPreference: 'best',
})
const [videoToolStatus, setVideoToolStatus] = useState<any>(null)
```

In the existing `api.getSettings()` effect, merge settings:

```ts
setVideoSettings({
  ytDlpPath: settings.ytDlpPath || '',
  ffmpegPath: settings.ffmpegPath || '',
  cookieMode: settings.cookieMode || 'none',
  cookieBrowser: settings.cookieBrowser || 'chrome',
  cookiesPath: settings.cookiesPath || '',
  qualityPreference: settings.qualityPreference || 'best',
})
```

- [ ] **Step 3: Add save and check handlers**

Add:

```ts
const handleSaveVideoSettings = async () => {
  if (!api) return
  const current = await api.getSettings()
  await api.saveSettings({ ...(current as Record<string, any>), ...videoSettings })
  showToast(t('settings.toast_video_settings_saved'))
}

const handleCheckVideoTools = async () => {
  if (!api) return
  const status = await api.checkVideoTools()
  setVideoToolStatus(status)
}
```

- [ ] **Step 4: Add sidebar menu item and panel**

Add a settings nav item:

```tsx
<button className={`settings-menu-item ${activeMenu === 'video' ? 'active' : ''}`} onClick={() => setActiveMenu('video')}>
  <BookOpen size={16} />
  {t('settings.video_downloader_title')}
</button>
```

Add panel:

```tsx
{activeMenu === 'video' && (
  <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <h3>{t('settings.video_downloader_title')}</h3>
    <input className="form-field" value={videoSettings.ytDlpPath} onChange={(e) => setVideoSettings({ ...videoSettings, ytDlpPath: e.target.value })} placeholder="yt-dlp" />
    <input className="form-field" value={videoSettings.ffmpegPath} onChange={(e) => setVideoSettings({ ...videoSettings, ffmpegPath: e.target.value })} placeholder="ffmpeg" />
    <select className="form-field" value={videoSettings.cookieMode} onChange={(e) => setVideoSettings({ ...videoSettings, cookieMode: e.target.value })}>
      <option value="none">{t('settings.video_cookie_none')}</option>
      <option value="browser">{t('settings.video_cookie_browser')}</option>
      <option value="file">{t('settings.video_cookie_file')}</option>
    </select>
    {videoSettings.cookieMode === 'browser' && (
      <select className="form-field" value={videoSettings.cookieBrowser} onChange={(e) => setVideoSettings({ ...videoSettings, cookieBrowser: e.target.value })}>
        <option value="chrome">Chrome</option>
        <option value="safari">Safari</option>
        <option value="firefox">Firefox</option>
        <option value="edge">Edge</option>
        <option value="brave">Brave</option>
        <option value="chromium">Chromium</option>
      </select>
    )}
    {videoSettings.cookieMode === 'file' && (
      <input className="form-field" value={videoSettings.cookiesPath} onChange={(e) => setVideoSettings({ ...videoSettings, cookiesPath: e.target.value })} placeholder="/path/to/cookies.txt" />
    )}
    <select className="form-field" value={videoSettings.qualityPreference} onChange={(e) => setVideoSettings({ ...videoSettings, qualityPreference: e.target.value })}>
      <option value="best">{t('settings.video_quality_best')}</option>
      <option value="1080p">1080P</option>
      <option value="720p">720P</option>
      <option value="audio">{t('settings.video_quality_audio')}</option>
    </select>
    <div style={{ display: 'flex', gap: '8px' }}>
      <button className="btn primary" onClick={handleSaveVideoSettings}>{t('common.save')}</button>
      <button className="btn" onClick={handleCheckVideoTools}>{t('settings.video_check_tools')}</button>
    </div>
    {videoToolStatus && <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px' }}>{JSON.stringify(videoToolStatus, null, 2)}</pre>}
  </section>
)}
```

- [ ] **Step 5: Add locale keys and build**

Add translated keys under `settings`:

```json
{
  "video_downloader_title": "Video downloader",
  "video_cookie_none": "No cookies",
  "video_cookie_browser": "Use browser login cookies",
  "video_cookie_file": "Use cookies.txt",
  "video_quality_best": "Best available",
  "video_quality_audio": "Audio only",
  "video_check_tools": "Check tools",
  "toast_video_settings_saved": "Video downloader settings saved"
}
```

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/views/Settings.tsx src/locales/en-US.json src/locales/zh-CN.json
git commit -m "feat: add video downloader settings"
```

## Task 8: End-To-End Verification And Polish

**Files:**
- Modify as needed based on verification findings.

- [ ] **Step 1: Run all pure tests**

Run:

```bash
node --import tsx tests/videoYtDlpArgs.test.ts
node --import tsx tests/videoNormalize.test.ts
node --import tsx tests/videoLibraryUtils.test.ts
node tests/indexSecurity.test.mjs
node --import tsx tests/bookReaderUtils.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Manual `yt-dlp` check**

With `yt-dlp` installed, test the three user URLs from the spec:

```bash
yt-dlp --skip-download --flat-playlist --dump-single-json --playlist-end 10 'https://www.bilibili.com/video/BV15j2LBDEyv/?spm_id_from=333.1387.favlist.content.click&vd_source=f42340e3bdb93c782818cf08ede22786'
yt-dlp --skip-download --flat-playlist --dump-json --playlist-end 10 'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0&start_radio=1'
yt-dlp --skip-download --dump-single-json 'https://www.bilibili.com/video/BV1G7jJ6nEbV/?spm_id_from=333.1007.tianma.1-3-3.click'
```

Expected: Bilibili multipart and YouTube parse; Bilibili single either parses with configured cookies or displays the HTTP 412 diagnostic in the app.

- [ ] **Step 4: Manual app verification**

Run:

```bash
npm run dev
```

Expected:

- Settings has a Video downloader section.
- Tool check reports `yt-dlp` and `ffmpeg` status.
- Videos screen shows three-column library layout.
- Groups can be created.
- Tags can be saved and filtered.
- Parser displays normalized results and diagnostics.
- Downloaded local files open in the real video player.

- [ ] **Step 5: Commit any verification fixes**

If verification changed files, inspect and commit the exact files reported by `git status --short`:

```bash
git status --short
git add electron src tests
git commit -m "fix: polish video module verification issues"
```

Skip this commit only if no files changed during verification.

## Self-Review

- Spec coverage: the plan covers grouping, tagging, Bilibili/YouTube parsing, authenticated cookies, tool diagnostics, download command generation, database migration, UI layout, and local playback.
- Placeholder scan: no task uses unresolved implementation placeholders. Task 8 has a conditional verification commit because it is explicitly dependent on verification results.
- Type consistency: `VideoCookieConfig`, `VideoQualityPreference`, normalized parse result fields, settings keys, and IPC names are consistent across tasks.

# Video Module Stateful List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate download queue model with one persistent, stateful video list that supports video statuses, row-level progress, retry, invalid videos, download batches, editable details, and multi-dimensional sorting.

**Architecture:** The database video record becomes the source of truth for list state. Download events from the Electron main process update persistent video rows and the renderer reloads or patches rows from those persisted values. Pure status/sort/action helpers are extracted out of `Videos.tsx` so the large UI change can be tested without mounting React.

**Tech Stack:** Electron main/preload IPC, React + TypeScript renderer, SQLite via `better-sqlite3`, Node test runner with `tsx`, existing `i18next` locale JSON files, existing `yt-dlp` download service.

---

## Approved Spec

Implement the approved design in `docs/superpowers/specs/2026-07-05-video-module-stateful-list-design.md`.

## File Structure

- Modify `electron/db/schema.ts`: add stateful video columns, `video_download_batches`, and migration from legacy statuses.
- Create `electron/video/downloadState.ts`: main-process status constants, stale download recovery SQL helper, and failure classification.
- Modify `electron/main.ts`: update download IPC to persist progress/success/failure/invalid state and expose external URL opening if not already available.
- Modify `electron/preload.ts`: expose any new video IPC helpers needed by the renderer.
- Modify `src/views/videoTypes.ts`: add typed video statuses, batch fields, progress/error fields, sort option types, and stricter record shape.
- Create `src/views/videoStateUtils.ts`: pure renderer helpers for row actions, row styling, editability, sorting, parse actions, and status labels.
- Modify `src/views/videoLibraryUtils.ts`: remove or delegate obsolete download queue/list helpers after `videoStateUtils.ts` exists.
- Modify `src/views/Videos.tsx`: remove queue drawer tab, render one stateful video list, implement parse actions, row-level progress, retry, details permissions, and sorting controls.
- Modify `src/locales/zh-CN.json` and `src/locales/en-US.json`: add labels for statuses, sorting, parse actions, details read-only states, and notifications.
- Modify `tests/videoSchema.test.mjs`: assert new schema and fix the existing `videoDb` variable typo while touching the file.
- Create `tests/videoDownloadState.test.ts`: main-process state/failure classification tests.
- Create `tests/videoStateUtils.test.ts`: renderer pure helper tests.
- Modify `tests/videoLibraryUtils.test.ts`: update legacy expectations that currently use `unclassified`, queue-only retry, and old list naming.
- Modify `tests/videoServiceSmoke.test.ts`: verify progress/failure payloads carry video ids where needed.

---

## Task 1: Schema And Status Foundation

**Files:**
- Modify: `src/views/videoTypes.ts`
- Modify: `electron/db/schema.ts`
- Modify: `tests/videoSchema.test.mjs`
- Create: `electron/video/downloadState.ts`
- Create: `tests/videoDownloadState.test.ts`

- [ ] **Step 1: Add failing schema expectations**

Replace the video-specific assertions in `tests/videoSchema.test.mjs` with this shape. Keep the imports and database setup already in the file, but fix the current `videoDb` typo by using `db` consistently.

```js
test('video schema includes stateful list columns and download batches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-'))
  initializeUserDatabase(dir)

  const db = new Database(path.join(dir, 'videos.db'))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const tableNames = tables.map((row) => row.name)

  for (const tableName of ['video_groups', 'video_tags', 'video_tag_links', 'video_download_batches']) {
    assert.ok(tableNames.includes(tableName), `missing ${tableName}`)
  }

  const groupColumns = db.prepare('PRAGMA table_info(video_groups)').all().map((column) => column.name)
  assert.ok(groupColumns.includes('parent_id'))

  const videoColumns = db.prepare('PRAGMA table_info(videos)').all().map((row) => row.name)
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
    'duration_seconds',
    'download_progress',
    'download_error',
    'invalid_reason',
    'download_batch_id',
    'download_batch_order',
    'downloaded_at',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(videoColumns.includes(column), `missing ${column}`)
  }

  const batchColumns = db.prepare('PRAGMA table_info(video_download_batches)').all().map((row) => row.name)
  for (const column of ['id', 'batch_key', 'source_url', 'source', 'title', 'item_count', 'status', 'created_at', 'updated_at']) {
    assert.ok(batchColumns.includes(column), `missing batch column ${column}`)
  }

  db.close()
})
```

- [ ] **Step 2: Add failing status migration/recovery tests**

Create `tests/videoDownloadState.test.ts` with:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyVideoDownloadFailure,
  getInterruptedDownloadMessage,
  normalizeLegacyVideoStatus,
} from '../electron/video/downloadState.ts'

test('normalizeLegacyVideoStatus maps legacy statuses into the stateful video model', () => {
  assert.equal(normalizeLegacyVideoStatus('unclassified'), 'not_downloaded')
  assert.equal(normalizeLegacyVideoStatus('downloading'), 'download_failed')
  assert.equal(normalizeLegacyVideoStatus('downloaded'), 'downloaded')
  assert.equal(normalizeLegacyVideoStatus('download_failed'), 'download_failed')
  assert.equal(normalizeLegacyVideoStatus('invalid'), 'invalid')
  assert.equal(normalizeLegacyVideoStatus(undefined), 'not_downloaded')
})

test('getInterruptedDownloadMessage gives stale downloading rows a retryable reason', () => {
  assert.match(getInterruptedDownloadMessage(), /interrupted/i)
  assert.match(getInterruptedDownloadMessage(), /retry/i)
})

test('classifyVideoDownloadFailure only marks clearly unavailable sources invalid', () => {
  assert.deepEqual(classifyVideoDownloadFailure('HTTP Error 404: Not Found'), {
    status: 'invalid',
    invalidReason: 'HTTP Error 404: Not Found',
    downloadError: 'HTTP Error 404: Not Found',
  })
  assert.deepEqual(classifyVideoDownloadFailure('Private video'), {
    status: 'invalid',
    invalidReason: 'Private video',
    downloadError: 'Private video',
  })
  assert.deepEqual(classifyVideoDownloadFailure('cookies are missing'), {
    status: 'download_failed',
    invalidReason: null,
    downloadError: 'cookies are missing',
  })
})
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
node --import tsx tests/videoDownloadState.test.ts
node --import tsx tests/videoSchema.test.mjs
```

Expected:

- `tests/videoDownloadState.test.ts` fails because `electron/video/downloadState.ts` does not exist.
- `tests/videoSchema.test.mjs` fails because the new columns/table do not exist. If the local `better-sqlite3` binary has a Node ABI mismatch, record that separately and continue with the TypeScript tests; do not claim the schema test passed.

- [ ] **Step 4: Add shared status types to renderer types**

Update `src/views/videoTypes.ts` to include these definitions while preserving existing exported interfaces:

```ts
export type VideoStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'download_failed' | 'invalid'

export type VideoSortKey =
  | 'default'
  | 'recently_added'
  | 'recently_downloaded'
  | 'download_batch'
  | 'title'
  | 'duration'
  | 'status'
  | 'group'

export type SortDirection = 'asc' | 'desc'

export interface VideoDownloadBatchRecord {
  id: number
  batch_key: string
  source_url?: string | null
  source?: string | null
  title?: string | null
  item_count: number
  status: string
  created_at?: string
  updated_at?: string
}
```

Extend `VideoRecord` with:

```ts
  status?: VideoStatus | 'unclassified' | string
  download_progress?: number | null
  download_error?: string | null
  invalid_reason?: string | null
  download_batch_id?: number | null
  download_batch_key?: string | null
  download_batch_created_at?: string | null
  download_batch_order?: number | null
  downloaded_at?: string | null
  created_at?: string
  updated_at?: string
  group_name?: string | null
  diagnostic_message?: string | null
```

- [ ] **Step 5: Implement main-process state helper**

Create `electron/video/downloadState.ts`:

```ts
export type StatefulVideoStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'download_failed' | 'invalid'

const invalidPatterns = [
  /\b404\b/i,
  /not found/i,
  /private video/i,
  /video unavailable/i,
  /has been deleted/i,
  /removed by/i,
  /does not exist/i,
]

export function normalizeLegacyVideoStatus(status?: string | null): StatefulVideoStatus {
  if (status === 'downloaded') return 'downloaded'
  if (status === 'downloading') return 'download_failed'
  if (status === 'download_failed') return 'download_failed'
  if (status === 'invalid') return 'invalid'
  if (status === 'not_downloaded') return 'not_downloaded'
  return 'not_downloaded'
}

export function getInterruptedDownloadMessage() {
  return 'Download was interrupted. Retry is available.'
}

export function classifyVideoDownloadFailure(message?: string | null): {
  status: 'download_failed' | 'invalid'
  downloadError: string
  invalidReason: string | null
} {
  const downloadError = message?.trim() || 'Unknown download error'
  const isInvalid = invalidPatterns.some((pattern) => pattern.test(downloadError))
  return {
    status: isInvalid ? 'invalid' : 'download_failed',
    downloadError,
    invalidReason: isInvalid ? downloadError : null,
  }
}
```

- [ ] **Step 6: Implement additive schema migration**

In `electron/db/schema.ts`, change the `videos` table `status` check to include the new statuses for newly-created databases:

```sql
status TEXT CHECK(status IN ('unclassified', 'not_downloaded', 'downloading', 'downloaded', 'download_failed', 'invalid')) DEFAULT 'not_downloaded',
created_at TEXT DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT DEFAULT CURRENT_TIMESTAMP
```

After the existing `addVideoColumn('diagnostic_message', 'TEXT')`, add:

```ts
  addVideoColumn('duration_seconds', 'INTEGER')
  addVideoColumn('download_progress', 'REAL')
  addVideoColumn('download_error', 'TEXT')
  addVideoColumn('invalid_reason', 'TEXT')
  addVideoColumn('download_batch_id', 'INTEGER')
  addVideoColumn('download_batch_order', 'INTEGER')
  addVideoColumn('downloaded_at', 'TEXT')
  addVideoColumn('created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP')
  addVideoColumn('updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP')
```

Add the batch table to the `videosDb.exec` block that creates groups/tags/links:

```sql
    CREATE TABLE IF NOT EXISTS video_download_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_key TEXT NOT NULL UNIQUE,
      source_url TEXT,
      source TEXT DEFAULT 'other',
      title TEXT,
      item_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'downloading',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
```

After table creation, normalize legacy status data for existing databases:

```ts
  try {
    videosDb
      .prepare(
        `
        UPDATE videos
        SET status = 'not_downloaded'
        WHERE status IS NULL OR status = 'unclassified'
        `,
      )
      .run()
    videosDb
      .prepare(
        `
        UPDATE videos
        SET status = 'download_failed',
            download_error = COALESCE(download_error, 'Download was interrupted. Retry is available.'),
            diagnostic_message = COALESCE(diagnostic_message, 'Download was interrupted. Retry is available.')
        WHERE status = 'downloading'
        `,
      )
      .run()
  } catch (error) {
    console.error('Failed to normalize legacy video statuses:', error)
  }
```

If SQLite rejects the new status because an old table-level `CHECK` still allows only `unclassified/downloading/downloaded`, implement a table rebuild migration inside this task. The rebuild must copy all existing columns, widen the status check, and preserve user data.

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
node --import tsx tests/videoDownloadState.test.ts
node --import tsx tests/videoSchema.test.mjs
npm exec tsc -- --noEmit
```

Expected:

- `videoDownloadState` tests pass.
- `videoSchema` passes unless the local native module ABI is broken; if ABI is broken, capture the exact error.
- TypeScript passes.

- [ ] **Step 8: Commit task**

```bash
git add electron/db/schema.ts electron/video/downloadState.ts src/views/videoTypes.ts tests/videoDownloadState.test.ts tests/videoSchema.test.mjs
git commit -m "feat: add stateful video schema"
```

---

## Task 2: Renderer State, Sorting, And Row Action Helpers

**Files:**
- Create: `src/views/videoStateUtils.ts`
- Create: `tests/videoStateUtils.test.ts`
- Modify: `src/views/videoLibraryUtils.ts`
- Modify: `tests/videoLibraryUtils.test.ts`

- [ ] **Step 1: Write failing renderer state tests**

Create `tests/videoStateUtils.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canEditVideoDetails,
  canPlayVideoRecord,
  getDefaultVideoSortRank,
  getStatusBadgeTone,
  getVideoRowDownloadAction,
  getVideoRowStyle,
  sortVideoRecords,
} from '../src/views/videoStateUtils.ts'
import type { VideoRecord } from '../src/views/videoTypes.ts'

const base = (overrides: Partial<VideoRecord>): VideoRecord => ({ id: 1, title: 'Video', status: 'not_downloaded', ...overrides })

test('getVideoRowDownloadAction follows the approved status rules', () => {
  assert.deepEqual(getVideoRowDownloadAction(base({ status: 'not_downloaded', source_url: 'https://x.test' })), {
    visible: true,
    disabled: false,
    reason: 'download',
  })
  assert.deepEqual(getVideoRowDownloadAction(base({ status: 'downloading', source_url: 'https://x.test' })), {
    visible: false,
    disabled: true,
    reason: 'active',
  })
  assert.deepEqual(getVideoRowDownloadAction(base({ status: 'downloaded', local_path: '/a.mp4' })), {
    visible: false,
    disabled: true,
    reason: 'downloaded',
  })
  assert.deepEqual(getVideoRowDownloadAction(base({ status: 'download_failed', source_url: 'https://x.test' })), {
    visible: true,
    disabled: false,
    reason: 'retry',
  })
  assert.deepEqual(getVideoRowDownloadAction(base({ status: 'invalid', source_url: 'https://x.test' })), {
    visible: false,
    disabled: true,
    reason: 'invalid',
  })
})

test('canEditVideoDetails locks downloading and invalid videos', () => {
  assert.equal(canEditVideoDetails(base({ status: 'not_downloaded' })), true)
  assert.equal(canEditVideoDetails(base({ status: 'download_failed' })), true)
  assert.equal(canEditVideoDetails(base({ status: 'downloaded' })), true)
  assert.equal(canEditVideoDetails(base({ status: 'downloading' })), false)
  assert.equal(canEditVideoDetails(base({ status: 'invalid' })), false)
})

test('canPlayVideoRecord only allows downloaded videos with a local path', () => {
  assert.equal(canPlayVideoRecord(base({ status: 'downloaded', local_path: '/a.mp4' })), true)
  assert.equal(canPlayVideoRecord(base({ status: 'downloaded' })), false)
  assert.equal(canPlayVideoRecord(base({ status: 'invalid', local_path: '/a.mp4' })), false)
})

test('row style and badge tone distinguish downloaded, failed, and invalid videos', () => {
  assert.equal(getVideoRowStyle(base({ status: 'downloaded' })).backgroundColor, 'rgba(34, 197, 94, 0.1)')
  assert.equal(getVideoRowStyle(base({ status: 'download_failed' })).borderColor, 'rgba(220, 38, 38, 0.45)')
  assert.equal(getVideoRowStyle(base({ status: 'invalid' })).opacity, 0.62)
  assert.equal(getStatusBadgeTone('download_failed'), 'danger')
  assert.equal(getStatusBadgeTone('invalid'), 'muted')
})

test('sortVideoRecords default order prioritizes active work then batch ordering', () => {
  const records: VideoRecord[] = [
    base({ id: 1, title: 'Downloaded', status: 'downloaded', created_at: '2026-01-01T00:00:00Z' }),
    base({ id: 2, title: 'Failed', status: 'download_failed', download_batch_created_at: '2026-01-03T00:00:00Z' }),
    base({ id: 3, title: 'Active 2', status: 'downloading', download_batch_id: 9, download_batch_order: 2, download_batch_created_at: '2026-01-04T00:00:00Z' }),
    base({ id: 4, title: 'Invalid', status: 'invalid' }),
    base({ id: 5, title: 'Active 1', status: 'downloading', download_batch_id: 9, download_batch_order: 1, download_batch_created_at: '2026-01-04T00:00:00Z' }),
    base({ id: 6, title: 'Pending', status: 'not_downloaded', created_at: '2026-01-05T00:00:00Z' }),
  ]

  assert.deepEqual(sortVideoRecords(records, { key: 'default', direction: 'desc' }).map((video) => video.id), [5, 3, 2, 6, 1, 4])
  assert.equal(getDefaultVideoSortRank('downloading'), 0)
  assert.equal(getDefaultVideoSortRank('invalid'), 4)
})

test('sortVideoRecords supports title and duration ordering', () => {
  const records: VideoRecord[] = [
    base({ id: 1, title: 'Beta', duration_seconds: 300 }),
    base({ id: 2, title: 'Alpha', duration_seconds: 100 }),
  ]

  assert.deepEqual(sortVideoRecords(records, { key: 'title', direction: 'asc' }).map((video) => video.id), [2, 1])
  assert.deepEqual(sortVideoRecords(records, { key: 'duration', direction: 'desc' }).map((video) => video.id), [1, 2])
})
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
node --import tsx tests/videoStateUtils.test.ts
```

Expected: FAIL because `src/views/videoStateUtils.ts` does not exist.

- [ ] **Step 3: Implement renderer state utility**

Create `src/views/videoStateUtils.ts`:

```ts
import type { SortDirection, VideoRecord, VideoSortKey, VideoStatus } from './videoTypes'

export interface VideoSortState {
  key: VideoSortKey
  direction: SortDirection
}

export function normalizeVideoStatus(status?: string | null): VideoStatus {
  if (status === 'downloaded') return 'downloaded'
  if (status === 'downloading') return 'downloading'
  if (status === 'download_failed') return 'download_failed'
  if (status === 'invalid') return 'invalid'
  return 'not_downloaded'
}

export function canEditVideoDetails(video: VideoRecord) {
  const status = normalizeVideoStatus(video.status)
  return status !== 'downloading' && status !== 'invalid'
}

export function canPlayVideoRecord(video: VideoRecord) {
  return normalizeVideoStatus(video.status) === 'downloaded' && Boolean(video.local_path || video.path)
}

export function getVideoRowDownloadAction(video: VideoRecord) {
  const status = normalizeVideoStatus(video.status)
  if (status === 'downloading') return { visible: false, disabled: true, reason: 'active' as const }
  if (status === 'downloaded') return { visible: false, disabled: true, reason: 'downloaded' as const }
  if (status === 'invalid') return { visible: false, disabled: true, reason: 'invalid' as const }
  if (!video.source_url && !video.url) return { visible: true, disabled: true, reason: 'missing-source' as const }
  return { visible: true, disabled: false, reason: status === 'download_failed' ? ('retry' as const) : ('download' as const) }
}

export function getVideoRowStyle(video: VideoRecord) {
  const status = normalizeVideoStatus(video.status)
  if (status === 'downloaded') return { backgroundColor: 'rgba(34, 197, 94, 0.1)', borderColor: 'rgba(34, 197, 94, 0.28)', opacity: 1 }
  if (status === 'download_failed') return { backgroundColor: 'var(--bg-app)', borderColor: 'rgba(220, 38, 38, 0.45)', opacity: 1 }
  if (status === 'invalid') return { backgroundColor: 'rgba(100, 116, 139, 0.16)', borderColor: 'rgba(100, 116, 139, 0.32)', opacity: 0.62 }
  return { backgroundColor: 'var(--bg-app)', borderColor: 'var(--color-border)', opacity: 1 }
}

export function getStatusBadgeTone(status: string | undefined) {
  const normalized = normalizeVideoStatus(status)
  if (normalized === 'download_failed') return 'danger' as const
  if (normalized === 'downloaded') return 'success' as const
  if (normalized === 'downloading') return 'accent' as const
  if (normalized === 'invalid') return 'muted' as const
  return 'neutral' as const
}

export function getDefaultVideoSortRank(status?: string | null) {
  const rank: Record<VideoStatus, number> = {
    downloading: 0,
    download_failed: 1,
    not_downloaded: 2,
    downloaded: 3,
    invalid: 4,
  }
  return rank[normalizeVideoStatus(status)]
}

function timeValue(value?: string | null) {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function compareText(a?: string | null, b?: string | null) {
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
}

function applyDirection(value: number, direction: SortDirection) {
  return direction === 'asc' ? value : -value
}

export function sortVideoRecords(records: VideoRecord[], sort: VideoSortState) {
  return [...records].sort((a, b) => {
    if (sort.key === 'default') {
      return (
        getDefaultVideoSortRank(a.status) - getDefaultVideoSortRank(b.status) ||
        timeValue(b.download_batch_created_at) - timeValue(a.download_batch_created_at) ||
        (a.download_batch_order ?? Number.MAX_SAFE_INTEGER) - (b.download_batch_order ?? Number.MAX_SAFE_INTEGER) ||
        timeValue(b.created_at) - timeValue(a.created_at) ||
        a.id - b.id
      )
    }
    if (sort.key === 'title') return applyDirection(compareText(a.title, b.title), sort.direction)
    if (sort.key === 'duration') return applyDirection((a.duration_seconds || 0) - (b.duration_seconds || 0), sort.direction)
    if (sort.key === 'recently_added') return applyDirection(timeValue(a.created_at) - timeValue(b.created_at), sort.direction)
    if (sort.key === 'recently_downloaded') return applyDirection(timeValue(a.downloaded_at) - timeValue(b.downloaded_at), sort.direction)
    if (sort.key === 'download_batch') {
      return applyDirection(
        timeValue(a.download_batch_created_at) - timeValue(b.download_batch_created_at) ||
          (a.download_batch_order ?? 0) - (b.download_batch_order ?? 0),
        sort.direction,
      )
    }
    if (sort.key === 'status') return applyDirection(getDefaultVideoSortRank(a.status) - getDefaultVideoSortRank(b.status), sort.direction)
    if (sort.key === 'group') return applyDirection(compareText(a.group_name, b.group_name) || compareText(a.title, b.title), sort.direction)
    return 0
  })
}
```

- [ ] **Step 4: Run tests**

```bash
node --import tsx tests/videoStateUtils.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

- [ ] **Step 5: Update legacy utility tests to stop asserting queue-driven row state**

In `tests/videoLibraryUtils.test.ts`, remove imports and tests for `getVideoListDownloadAction` and `getVideoListItemBackground` after `Videos.tsx` no longer uses them. Keep `getVideoLibraryVideos` until Task 5 either removes or delegates it.

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
node --import tsx tests/videoStateUtils.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit task**

```bash
git add src/views/videoStateUtils.ts src/views/videoLibraryUtils.ts tests/videoStateUtils.test.ts tests/videoLibraryUtils.test.ts
git commit -m "feat: add video state list helpers"
```

---

## Task 3: Persist Download Progress, Success, Failure, And Invalid State

**Files:**
- Modify: `electron/video/service.ts`
- Modify: `electron/main.ts`
- Modify: `tests/videoServiceSmoke.test.ts`
- Modify: `electron/preload.ts` only if a new external-open IPC is needed

- [ ] **Step 1: Write failing service event test for video id progress**

In `tests/videoServiceSmoke.test.ts`, add a test using the existing fake `yt-dlp` pattern:

```ts
test('startVideoDownload includes video id in progress and failure events when provided', async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-download-id-'))
  const fakeYtDlp = path.join(outputDir, 'fake-yt-dlp')
  writeFileSync(fakeYtDlp, '#!/bin/sh\necho "[download]  42.0% of 10.00MiB"\necho "ERROR: cookies are missing" >&2\nexit 1\n')
  chmodSync(fakeYtDlp, 0o755)
  const sent: any[][] = []

  await startVideoDownload({
    settings: { ytDlpPath: fakeYtDlp },
    mainWindow: { webContents: { send: (...args: any[]) => sent.push(args) } } as any,
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    title: 'With video id',
    videoId: 42,
    outputDir,
  })

  const progressEvent = sent.find(([channel, payload]) => channel === 'video:download-progress' && payload.progress === 42)
  assert.equal(progressEvent?.[1]?.videoId, 42)
  const failedEvent = sent.find(([channel]) => channel === 'video:download-failed')
  assert.equal(failedEvent?.[1]?.videoId, 42)
})
```

- [ ] **Step 2: Run test and verify failure**

```bash
node --import tsx tests/videoServiceSmoke.test.ts
```

Expected: FAIL because `startVideoDownload` does not accept or emit `videoId` yet.

- [ ] **Step 3: Add `videoId` to download service event payloads**

In `electron/video/service.ts`, extend the input type for `startVideoDownload` with:

```ts
videoId?: number
```

Update every `video:download-progress`, `video:download-failed`, and `video:download-finished` payload to include:

```ts
videoId: input.videoId,
```

- [ ] **Step 4: Update main-process download persistence**

In `electron/main.ts`, import:

```ts
import { classifyVideoDownloadFailure } from './video/downloadState'
```

In the `ipcMain.handle('video:download', ...)` call to `startVideoDownload`, pass:

```ts
videoId: videoData.id,
```

In `onFinished`, update success SQL to:

```sql
UPDATE videos
SET status = 'downloaded',
    local_path = ?,
    path = ?,
    duration = COALESCE(duration, ?),
    duration_seconds = COALESCE(duration_seconds, ?),
    download_progress = 100,
    downloaded_at = CURRENT_TIMESTAMP,
    download_error = NULL,
    invalid_reason = NULL,
    diagnostic_message = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
```

Use parameters:

```ts
filePath, filePath, durationLabel, durationSeconds || null, videoData.id
```

In `onFailed`, classify and persist:

```ts
const failure = classifyVideoDownloadFailure(message)
db.prepare(
  `
  UPDATE videos
  SET status = ?,
      download_error = ?,
      invalid_reason = ?,
      diagnostic_message = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
  `,
).run(failure.status, failure.downloadError, failure.invalidReason, failure.downloadError, videoData.id)
```

- [ ] **Step 5: Add progress persistence from renderer event or main callback**

Prefer main-process persistence. Extend `startVideoDownload` input with:

```ts
onProgress?: (progress?: number, message?: string) => void | Promise<void>
```

Call it when parsed progress is numeric:

```ts
const progress = parseDownloadProgressPercent(message)
if (typeof progress === 'number') input.onProgress?.(progress, message)
```

In `electron/main.ts`, pass:

```ts
onProgress: async (progress) => {
  if (!videoData.id || typeof progress !== 'number') return
  const db = getUserDb('videos')
  db.prepare(
    `
    UPDATE videos
    SET status = 'downloading',
        download_progress = ?,
        download_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
  ).run(progress, videoData.id)
},
```

- [ ] **Step 6: Run tests**

```bash
node --import tsx tests/videoServiceSmoke.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit task**

```bash
git add electron/main.ts electron/video/service.ts tests/videoServiceSmoke.test.ts
git commit -m "feat: persist video download state"
```

---

## Task 4: Batch Creation And Parse Result Actions

**Files:**
- Modify: `src/views/Videos.tsx`
- Modify: `src/views/videoTypes.ts`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`
- Create or modify: `tests/videoStateUtils.test.ts`

- [ ] **Step 1: Add pure tests for parse action labels and batch keys**

Add to `tests/videoStateUtils.test.ts`:

```ts
import { createVideoBatchKey, getParseResultActionLabels } from '../src/views/videoStateUtils.ts'

test('createVideoBatchKey uses date and sequence for readable batches', () => {
  assert.equal(createVideoBatchKey(new Date('2026-07-05T01:02:03Z'), 1), '20260705-001')
  assert.equal(createVideoBatchKey(new Date('2026-07-05T01:02:03Z'), 12), '20260705-012')
})

test('getParseResultActionLabels exposes cancel, add, and download actions', () => {
  assert.deepEqual(getParseResultActionLabels(), {
    cancel: 'videos.btn_cancel_parse',
    addToList: 'videos.btn_add_to_video_list',
    download: 'videos.btn_download_video',
  })
})
```

- [ ] **Step 2: Run test and verify failure**

```bash
node --import tsx tests/videoStateUtils.test.ts
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement helpers**

Add to `src/views/videoStateUtils.ts`:

```ts
export function createVideoBatchKey(date = new Date(), sequence = 1) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}-${String(sequence).padStart(3, '0')}`
}

export function getParseResultActionLabels() {
  return {
    cancel: 'videos.btn_cancel_parse',
    addToList: 'videos.btn_add_to_video_list',
    download: 'videos.btn_download_video',
  }
}
```

- [ ] **Step 4: Add locale strings**

In `src/locales/zh-CN.json` under `videos`:

```json
"btn_cancel_parse": "取消",
"btn_add_to_video_list": "加入视频列表",
"btn_download_video": "下载视频",
"toast_videos_added_to_list": "已加入视频列表：{{count}} 个视频",
"toast_videos_download_started": "已开始下载：{{count}} 个视频"
```

In `src/locales/en-US.json` under `videos`:

```json
"btn_cancel_parse": "Cancel",
"btn_add_to_video_list": "Add to video list",
"btn_download_video": "Download video",
"toast_videos_added_to_list": "Added {{count}} videos to the video list",
"toast_videos_download_started": "Started downloading {{count}} videos"
```

- [ ] **Step 5: Refactor parse actions in `Videos.tsx`**

Replace the current single `handleDownloadSelected` path with two explicit paths:

```ts
const createDownloadBatch = async (items: any[]) => {
  const batchKey = createVideoBatchKey(new Date(), Date.now() % 1000 || 1)
  const result = await api.dbQuery(
    'videos',
    `
    INSERT INTO video_download_batches (batch_key, source_url, source, title, item_count, status)
    VALUES (?, ?, ?, ?, ?, 'downloading')
    `,
    [batchKey, videoUrl.trim() || parsedData?.sourceUrl || null, parsedData?.source || 'other', parsedData?.title || parsedData?.playlistTitle || batchKey, items.length],
  )
  return { id: Number(result?.data?.lastInsertRowid), batchKey }
}
```

Add:

```ts
const handleAddSelectedToVideoList = async () => {
  if (!parsedData || !api) return
  const selected = parsedItems.filter((item: any) => selectedVideoIds.includes(item.id))
  if (selected.length === 0) {
    showToast(t('videos.toast_select_at_least_one'))
    return
  }
  for (const item of selected) {
    await insertParsedVideo(item, 'not_downloaded')
  }
  setParsedData(null)
  setVideoUrl('')
  showToast(t('videos.toast_videos_added_to_list', { count: selected.length }))
  loadData()
}
```

Update `insertParsedVideo` to accept optional batch data:

```ts
const insertParsedVideo = async (
  item: any,
  initialStatus: string,
  batch?: { id: number; order: number },
) => {
  // include download_progress, download_batch_id, download_batch_order, created_at/updated_at compatible fields
}
```

For download action, create one batch, insert every selected video with `status = 'downloading'`, then start downloads with the inserted ids.

- [ ] **Step 6: Run tests and typecheck**

```bash
node --import tsx tests/videoStateUtils.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit task**

```bash
git add src/views/Videos.tsx src/views/videoStateUtils.ts src/locales/zh-CN.json src/locales/en-US.json tests/videoStateUtils.test.ts
git commit -m "feat: add parse result video list actions"
```

---

## Task 5: Replace Queue Drawer With Stateful Video Rows

**Files:**
- Modify: `src/views/Videos.tsx`
- Modify: `src/views/videoLibraryUtils.ts`
- Modify: `tests/videoLibraryUtils.test.ts`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`

- [ ] **Step 1: Add/adjust tests for list filtering without downloaded-only behavior**

In `tests/videoLibraryUtils.test.ts`, replace `getDownloadedLibraryVideos hides queued...` with:

```ts
test('getVideoLibraryVideos keeps every video status in one filterable list', () => {
  const records = [
    { id: 1, title: 'Done', status: 'downloaded', group_id: 2, tags: ['AI'] },
    { id: 2, title: 'Pending', status: 'not_downloaded', group_id: null, tags: [] },
    { id: 3, title: 'Active', status: 'downloading', group_id: null, tags: [] },
    { id: 4, title: 'Broken', status: 'download_failed', group_id: null, tags: [] },
    { id: 5, title: 'Gone', status: 'invalid', group_id: null, tags: [] },
  ]

  assert.deepEqual(
    getVideoLibraryVideos(records, { query: '', groupId: 'all', tag: null }).map((video) => video.id),
    [1, 2, 3, 4, 5],
  )
})
```

- [ ] **Step 2: Run test and verify current behavior**

```bash
node --import tsx tests/videoLibraryUtils.test.ts
```

Expected: FAIL if old downloaded-only helper is still in use.

- [ ] **Step 3: Remove queue tab state from drawer**

In `src/views/videoLibraryUtils.ts`, replace:

```ts
export type VideoDrawerTab = 'details' | 'queue'
export type VideoDrawerState = { open: boolean; tab: VideoDrawerTab }
export type VideoDrawerAction = 'open-details' | 'open-queue' | 'outside-click' | 'close'
```

with:

```ts
export type VideoDrawerState = { open: boolean }
export type VideoDrawerAction = 'open-details' | 'outside-click' | 'close'
```

Update `nextVideoDrawerState`:

```ts
export function nextVideoDrawerState(state: VideoDrawerState, action: VideoDrawerAction): VideoDrawerState {
  if (action === 'open-details') return { open: true }
  if (action === 'outside-click' || action === 'close') return { ...state, open: false }
  return state
}
```

Update `getVideoDrawerTitleKey`:

```ts
export function getVideoDrawerTitleKey() {
  return 'videos.details_title'
}
```

Update tests that expect `open-queue` or queue title.

- [ ] **Step 4: Render progress and status inside rows**

In `src/views/Videos.tsx`, remove the queue button from the list header and remove drawer queue content. Use:

```ts
const [drawerState, setDrawerState] = useState<VideoDrawerState>({ open: false })
```

For each row:

```ts
const rowStyle = getVideoRowStyle(video)
const downloadAction = getVideoRowDownloadAction(video)
```

Render progress only for `normalizeVideoStatus(video.status) === 'downloading'`:

```tsx
{normalizeVideoStatus(video.status) === 'downloading' && (
  <div style={{ display: 'grid', gap: '4px', marginTop: '6px' }}>
    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
      {t('videos.download_progress_label')} {getProgressPercentLabel(video.download_progress || 0)}
    </span>
    <div style={{ height: '6px', borderRadius: '999px', backgroundColor: 'var(--bg-muted)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, video.download_progress || 0))}%`, height: '100%', backgroundColor: 'var(--color-accent)' }} />
    </div>
  </div>
)}
```

Render failure/invalid summaries:

```tsx
{normalizeVideoStatus(video.status) === 'download_failed' && video.download_error && (
  <p style={{ color: 'var(--color-danger)', fontSize: '10.5px', marginTop: '4px' }}>{video.download_error.slice(0, 160)}</p>
)}
{normalizeVideoStatus(video.status) === 'invalid' && video.invalid_reason && (
  <p style={{ color: 'var(--text-muted)', fontSize: '10.5px', marginTop: '4px' }}>{video.invalid_reason.slice(0, 160)}</p>
)}
```

- [ ] **Step 5: Make row download/retry update persistent state**

Replace row download logic with:

```ts
const handleStartVideoDownload = async (video: VideoRecord) => {
  if (!api) return
  const action = getVideoRowDownloadAction(video)
  if (!action.visible || action.disabled) return
  const sourceUrl = video.source_url || video.url
  if (!sourceUrl) {
    showToast(t('videos.toast_missing_download_source'))
    return
  }
  const batch = await createDownloadBatch([video])
  await api.dbQuery(
    'videos',
    `
    UPDATE videos
    SET status = 'downloading',
        download_progress = 0,
        download_error = NULL,
        invalid_reason = NULL,
        download_batch_id = ?,
        download_batch_order = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [batch.id, video.id],
  )
  await loadData()
  await api.startDownload({ id: video.id, title: video.title, sourceUrl, url: sourceUrl })
}
```

- [ ] **Step 6: Update progress event handling to patch local rows**

In `api.onDownloadProgress`, update by `videoId` first, then title fallback:

```ts
setLocalVideos((prev) =>
  prev.map((video) =>
    (data.videoId && video.id === data.videoId) || video.title === data.title
      ? { ...video, status: 'downloading', download_progress: typeof data.progress === 'number' ? data.progress : video.download_progress }
      : video,
  ),
)
```

In `onDownloadFinished` and `onDownloadFailed`, show toast and call `loadData()`.

- [ ] **Step 7: Run tests and typecheck**

```bash
node --import tsx tests/videoLibraryUtils.test.ts
node --import tsx tests/videoStateUtils.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit task**

```bash
git add src/views/Videos.tsx src/views/videoLibraryUtils.ts tests/videoLibraryUtils.test.ts src/locales/zh-CN.json src/locales/en-US.json
git commit -m "feat: render downloads in video rows"
```

---

## Task 6: Details Drawer Permissions And External Source URL

**Files:**
- Modify: `src/views/Videos.tsx`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`
- Modify: `tests/videoStateUtils.test.ts`

- [ ] **Step 1: Add locale strings**

Chinese:

```json
"status_not_downloaded": "未下载",
"status_downloaded": "已下载",
"status_invalid": "已失效",
"source_url_label": "链接地址",
"btn_open_external": "浏览器打开",
"details_readonly_downloading": "下载中，详情暂不可编辑。",
"details_readonly_invalid": "该视频已失效，仅可查看详情或删除。"
```

English:

```json
"status_not_downloaded": "Not downloaded",
"status_downloaded": "Downloaded",
"status_invalid": "Invalid",
"source_url_label": "Source URL",
"btn_open_external": "Open in browser",
"details_readonly_downloading": "This video is downloading. Details are read-only for now.",
"details_readonly_invalid": "This video is invalid. You can only view details or delete it."
```

- [ ] **Step 2: Add external open IPC if missing**

In `electron/main.ts`, import `shell` from `electron` if not already imported. Add:

```ts
ipcMain.handle('shell:openExternal', async (_, url: string) => {
  if (!/^https?:\/\//i.test(url)) return { success: false, error: 'Only HTTP(S) URLs can be opened externally.' }
  await shell.openExternal(url)
  return { success: true }
})
```

In `electron/preload.ts`, expose:

```ts
openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
```

- [ ] **Step 3: Apply details editability in `Videos.tsx`**

In details render:

```ts
const detailsEditable = selectedVideo ? canEditVideoDetails(selectedVideo) : false
```

Disable title/group/tag inputs and save button when not editable:

```tsx
<input className="form-field" value={draftTitle} disabled={!detailsEditable} />
```

Source URL display:

```tsx
<section>
  <strong style={{ fontSize: '12px' }}>{t('videos.source_url_label')}</strong>
  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
    <input className="form-field" value={selectedVideo.source_url || selectedVideo.url || ''} readOnly />
    {(selectedVideo.source_url || selectedVideo.url) && (
      <button className="btn sm" onClick={() => api.openExternal(selectedVideo.source_url || selectedVideo.url)}>
        {t('videos.btn_open_external')}
      </button>
    )}
  </div>
</section>
```

Read-only notices:

```tsx
{normalizeVideoStatus(selectedVideo.status) === 'downloading' && <p>{t('videos.details_readonly_downloading')}</p>}
{normalizeVideoStatus(selectedVideo.status) === 'invalid' && <p>{t('videos.details_readonly_invalid')}</p>}
```

- [ ] **Step 4: Ensure save handler respects read-only status**

At the start of `handleSaveVideoDetails`:

```ts
if (selectedVideo && !canEditVideoDetails(selectedVideo)) return
```

Include title in save if the details now supports title editing:

```sql
UPDATE videos SET title = ?, group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
```

- [ ] **Step 5: Run checks**

```bash
npm exec tsc -- --noEmit
node --import tsx tests/videoStateUtils.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit task**

```bash
git add src/views/Videos.tsx electron/main.ts electron/preload.ts src/locales/zh-CN.json src/locales/en-US.json tests/videoStateUtils.test.ts
git commit -m "feat: enforce video details permissions"
```

---

## Task 7: Sorting Controls In The Video List

**Files:**
- Modify: `src/views/Videos.tsx`
- Modify: `src/views/videoStateUtils.ts`
- Modify: `tests/videoStateUtils.test.ts`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`

- [ ] **Step 1: Add sorting locale labels**

Chinese:

```json
"sort_label": "排序",
"sort_default": "默认排序",
"sort_recently_added": "最近加入",
"sort_recently_downloaded": "最近下载",
"sort_download_batch": "下载批次",
"sort_title": "标题",
"sort_duration": "时长",
"sort_status": "状态",
"sort_group": "分组",
"sort_asc": "升序",
"sort_desc": "降序"
```

English:

```json
"sort_label": "Sort",
"sort_default": "Default sort",
"sort_recently_added": "Recently added",
"sort_recently_downloaded": "Recently downloaded",
"sort_download_batch": "Download batch",
"sort_title": "Title",
"sort_duration": "Duration",
"sort_status": "Status",
"sort_group": "Group",
"sort_asc": "Ascending",
"sort_desc": "Descending"
```

- [ ] **Step 2: Add sort state to `Videos.tsx`**

```ts
const [videoSort, setVideoSort] = useState<VideoSortState>({ key: 'default', direction: 'desc' })
```

Use sorting after filtering:

```ts
const filteredLocalVideos = useMemo(
  () =>
    sortVideoRecords(
      getVideoLibraryVideos(localVideos, {
        query: searchQuery,
        groupId: activeGroupId,
        groupIds: selectedGroupIds,
        tag: activeTag,
      }),
      videoSort,
    ),
  [localVideos, searchQuery, activeGroupId, selectedGroupIds, activeTag, videoSort],
)
```

- [ ] **Step 3: Add compact sort controls to list header**

Use a select for the sort key and a button or select for direction. Hide or disable direction when `videoSort.key === 'default'`.

```tsx
<select className="form-field" value={videoSort.key} onChange={(event) => setVideoSort({ key: event.target.value as VideoSortKey, direction: 'desc' })}>
  <option value="default">{t('videos.sort_default')}</option>
  <option value="recently_added">{t('videos.sort_recently_added')}</option>
  <option value="recently_downloaded">{t('videos.sort_recently_downloaded')}</option>
  <option value="download_batch">{t('videos.sort_download_batch')}</option>
  <option value="title">{t('videos.sort_title')}</option>
  <option value="duration">{t('videos.sort_duration')}</option>
  <option value="status">{t('videos.sort_status')}</option>
  <option value="group">{t('videos.sort_group')}</option>
</select>
```

- [ ] **Step 4: Run tests and typecheck**

```bash
node --import tsx tests/videoStateUtils.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit task**

```bash
git add src/views/Videos.tsx src/views/videoStateUtils.ts tests/videoStateUtils.test.ts src/locales/zh-CN.json src/locales/en-US.json
git commit -m "feat: add video list sorting"
```

---

## Task 8: Final Verification And Manual QA

**Files:**
- Modify only files needed to fix issues found in verification.

- [ ] **Step 1: Run focused unit tests**

```bash
node --import tsx tests/videoStateUtils.test.ts
node --import tsx tests/videoDownloadState.test.ts
node --import tsx tests/videoLibraryUtils.test.ts
node --import tsx tests/videoServiceSmoke.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run schema test**

```bash
node --import tsx tests/videoSchema.test.mjs
```

Expected: pass. If `better-sqlite3` native ABI mismatch occurs, run the repository's dependency rebuild command or document the exact ABI error in the final report.

- [ ] **Step 3: Run typecheck and build**

```bash
npm exec tsc -- --noEmit
npm run build
git diff --check
```

Expected: typecheck passes, build passes, diff check has no whitespace errors. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 4: Start the app for manual QA**

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

Expected: Vite reports a local URL and Electron launches without main-process errors.

- [ ] **Step 5: Manual QA checklist**

- [ ] Parse a single Bilibili URL and click `加入视频列表`; verify rows appear as `未下载` and show enabled download icons.
- [ ] Parse a multipart Bilibili URL and click `下载视频`; verify selected rows share one batch, enter `下载中`, and show row progress.
- [ ] Parse a YouTube URL and download; verify row progress reaches `100%`, status becomes `已下载`, and playback works in app.
- [ ] Force a download failure by temporarily using an invalid `yt-dlp` path; verify status becomes `下载失败`, toast includes reason, and row retry icon is enabled.
- [ ] Retry a failed row; verify a new batch is created and row returns to `下载中`.
- [ ] Mark or simulate an invalid-source failure; verify row is gray, shows `已失效`, and play/download/edit are disabled while details and delete remain available.
- [ ] Open details for each status and verify editability rules.
- [ ] Use sort menu for default, recently added, recently downloaded, download batch, title, duration, status, and group.

- [ ] **Step 6: Update implementation plan checkboxes or final notes**

If any item cannot be verified, add a short note under this task explaining the blocker and exact command/output.

- [ ] **Step 7: Commit final fixes**

```bash
git add electron src tests docs/superpowers/specs docs/superpowers/plans
git commit -m "feat: redesign video list download states"
```

---

## Self-Review

Spec coverage:

- Single stateful video list: Task 5.
- Removal of queue drawer: Task 5.
- Five statuses: Tasks 1, 2, 5, 6.
- Row download/retry/progress behavior: Tasks 2, 3, 5.
- Download notifications: Task 3 and Task 8 manual QA.
- Details fields, read-only source URL, editability rules: Task 6.
- Parse result actions: Task 4.
- Download batches: Tasks 1 and 4.
- Multi-dimensional sorting: Task 7.
- Startup stale downloading recovery: Task 1.
- Failure versus invalid classification: Tasks 1 and 3.

Plan marker scan:

- This plan contains no unresolved draft markers.

Type consistency:

- Renderer status type is `VideoStatus` in `src/views/videoTypes.ts`.
- Main-process status type is `StatefulVideoStatus` in `electron/video/downloadState.ts`.
- Renderer row helpers live in `src/views/videoStateUtils.ts` and are referenced by `Videos.tsx`.
- Batch fields use `download_batch_id`, `download_batch_order`, `download_batch_key`, and `download_batch_created_at` consistently.

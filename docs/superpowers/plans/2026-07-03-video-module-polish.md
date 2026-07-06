# Video Module Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the video module flow with parsed-result bulk selection, reliable duration display, simpler filters, Bilibili setup guidance, colored group/tag chips, and a collapsible right drawer for details and downloads.

**Architecture:** Keep the existing `Videos.tsx` page but move reusable behavior into `videoLibraryUtils.ts` so selection, duration, color, and drawer behavior can be tested without rendering React. The main process will continue owning download completion; it will enrich video records with local media duration when a download finishes. The settings page will add static Bilibili guidance using existing localization patterns.

**Tech Stack:** React, Electron IPC, better-sqlite3, yt-dlp/ffmpeg, Node test runner with `tsx`, existing inline style conventions.

---

## File Map

- Modify `src/views/Videos.tsx`: parse modal bulk checkbox, remove downloaded/downloading pseudo-groups, use colored chips, add collapsible drawer and outside-click behavior, display normalized duration.
- Modify `src/views/videoLibraryUtils.ts`: add tested helpers for bulk selection, duration display, stable chip colors, and drawer state.
- Modify `src/views/videoTypes.ts`: extend video record duration fields if needed.
- Modify `electron/video/service.ts`: add ffprobe duration extraction helper using managed ffmpeg/ffprobe path logic.
- Modify `electron/main.ts`: after successful download, probe local duration and store it.
- Modify `src/views/Settings.tsx`: add Bilibili usage guidance below video downloader settings.
- Modify `src/locales/zh-CN.json` and `src/locales/en-US.json`: add labels and guidance copy.
- Modify `tests/videoLibraryUtils.test.ts`: add utility regression tests.
- Modify `tests/videoServiceSmoke.test.ts`: add duration probing behavior tests.

---

### Task 1: Parsed Result Bulk Selection

**Files:**
- Modify: `src/views/videoLibraryUtils.ts`
- Modify: `src/views/Videos.tsx`
- Test: `tests/videoLibraryUtils.test.ts`

- [x] **Step 1: Write failing tests for bulk selection helpers**

Add to `tests/videoLibraryUtils.test.ts`:

```ts
import {
  getBulkSelectionState,
  toggleBulkSelection,
} from '../src/views/videoLibraryUtils.ts'

test('bulk selection reports checked, unchecked, and indeterminate states', () => {
  const ids = ['a', 'b', 'c']
  assert.deepEqual(getBulkSelectionState(ids, []), {
    checked: false,
    indeterminate: false,
  })
  assert.deepEqual(getBulkSelectionState(ids, ['a']), {
    checked: false,
    indeterminate: true,
  })
  assert.deepEqual(getBulkSelectionState(ids, ['a', 'b', 'c']), {
    checked: true,
    indeterminate: false,
  })
})

test('toggleBulkSelection selects all visible ids or clears them', () => {
  assert.deepEqual(toggleBulkSelection(['a', 'b'], []), ['a', 'b'])
  assert.deepEqual(toggleBulkSelection(['a', 'b'], ['a', 'b']), [])
  assert.deepEqual(toggleBulkSelection(['a', 'b'], ['a']), ['a', 'b'])
})
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
```

Expected: FAIL because `getBulkSelectionState` and `toggleBulkSelection` are not exported.

- [x] **Step 3: Implement selection helpers**

Add to `src/views/videoLibraryUtils.ts`:

```ts
export function getBulkSelectionState(allIds: string[], selectedIds: string[]) {
  const visibleIds = allIds.filter(Boolean)
  if (visibleIds.length === 0) return { checked: false, indeterminate: false }
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.includes(id)).length
  return {
    checked: selectedVisibleCount === visibleIds.length,
    indeterminate: selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length,
  }
}

export function toggleBulkSelection(allIds: string[], selectedIds: string[]) {
  const visibleIds = allIds.filter(Boolean)
  const state = getBulkSelectionState(visibleIds, selectedIds)
  return state.checked ? [] : visibleIds
}
```

- [x] **Step 4: Update parse modal UI**

In `src/views/Videos.tsx`, import helpers:

```ts
getBulkSelectionState,
toggleBulkSelection,
```

Before rendering parsed items, derive:

```ts
const parsedItemIds = parsedItems.map((item: any) => item.id)
const bulkSelection = getBulkSelectionState(parsedItemIds, selectedVideoIds)
```

In the parse modal, above the item list, add:

```tsx
{parsedItems.length > 1 && (
  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
    <input
      type="checkbox"
      checked={bulkSelection.checked}
      ref={(node) => {
        if (node) node.indeterminate = bulkSelection.indeterminate
      }}
      onChange={() => setSelectedVideoIds(toggleBulkSelection(parsedItemIds, selectedVideoIds))}
    />
    {t('videos.select_all_parts')}
  </label>
)}
```

- [x] **Step 5: Run tests**

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

---

### Task 2: Duration Display and Download Completion Enrichment

**Files:**
- Modify: `src/views/videoLibraryUtils.ts`
- Modify: `electron/video/service.ts`
- Modify: `electron/main.ts`
- Modify: `src/views/Videos.tsx`
- Test: `tests/videoLibraryUtils.test.ts`
- Test: `tests/videoServiceSmoke.test.ts`

- [x] **Step 1: Write failing duration display tests**

Add to `tests/videoLibraryUtils.test.ts`:

```ts
import { getVideoDurationLabel } from '../src/views/videoLibraryUtils.ts'

test('getVideoDurationLabel prefers saved duration and formats numeric seconds', () => {
  assert.equal(getVideoDurationLabel({ id: 1, title: 'x', duration: '12:34' }), '12:34')
  assert.equal(getVideoDurationLabel({ id: 1, title: 'x', duration_seconds: 95 } as any), '1:35')
  assert.equal(getVideoDurationLabel({ id: 1, title: 'x' }), '')
})
```

- [x] **Step 2: Implement duration label helper**

Add to `src/views/videoLibraryUtils.ts`:

```ts
export function getVideoDurationLabel(video: VideoRecord & { duration_seconds?: number }) {
  if (video.duration) return video.duration
  if (typeof video.duration_seconds === 'number') return formatDuration(video.duration_seconds)
  return ''
}
```

- [x] **Step 3: Write failing ffprobe duration test**

Add to `tests/videoServiceSmoke.test.ts`:

```ts
import { parseFfprobeDurationSeconds } from '../electron/video/service.ts'

test('parseFfprobeDurationSeconds reads numeric ffprobe output', () => {
  assert.equal(parseFfprobeDurationSeconds('95.241000\n'), 95)
  assert.equal(parseFfprobeDurationSeconds('N/A\n'), undefined)
})
```

- [x] **Step 4: Implement duration probe helper**

Add to `electron/video/service.ts`:

```ts
export function parseFfprobeDurationSeconds(stdout: string) {
  const value = Number(stdout.trim())
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value)
}

export function resolveFfprobePath(settings: Record<string, any>) {
  const ffmpegPath = resolveVideoToolPath(settings, 'ffmpeg')
  if (path.basename(ffmpegPath).startsWith('ffmpeg')) {
    const candidate = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    if (fs.existsSync(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
}

export async function probeVideoDurationSeconds(settings: Record<string, any>, filePath: string) {
  const ffprobePath = resolveFfprobePath(settings)
  const result = await runProcess(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { timeoutMs: 15000 })
  if (result.code !== 0) return undefined
  return parseFfprobeDurationSeconds(result.stdout)
}
```

- [x] **Step 5: Store duration on download finish**

In `electron/main.ts`, make the download `onFinished` callback async-compatible by probing before update:

```ts
onFinished: async (filePath) => {
  if (!videoData.id || !filePath) return
  const durationSeconds = await probeVideoDurationSeconds(getVideoToolSettings(), filePath)
  const db = getUserDb('videos')
  db.prepare(`
    UPDATE videos
    SET status = 'downloaded',
        local_path = ?,
        path = ?,
        duration = COALESCE(duration, ?),
        diagnostic_message = NULL
    WHERE id = ?
  `).run(filePath, filePath, durationSeconds ? formatDuration(durationSeconds) : null, videoData.id)
}
```

If importing `formatDuration` into Electron creates bundling issues, store `durationSeconds` formatted by a local service helper:

```ts
export function formatDurationSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
```

- [x] **Step 6: Use duration helper in list**

In `src/views/Videos.tsx`, replace:

```tsx
{video.duration || t('videos.duration_unknown')}
```

with:

```tsx
{getVideoDurationLabel(video) || t('videos.duration_unknown')}
```

- [x] **Step 7: Run tests**

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
node --import tsx tests/videoServiceSmoke.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

---

### Task 3: Remove Downloaded/Downloading Pseudo-Groups

**Files:**
- Modify: `src/views/Videos.tsx`
- Modify: `src/views/videoTypes.ts`
- Modify: `src/views/videoLibraryUtils.ts`
- Test: `tests/videoLibraryUtils.test.ts`

- [x] **Step 1: Narrow filter type**

Change `VideoFilter.groupId` in `src/views/videoTypes.ts` to:

```ts
groupId: number | null | 'all'
```

Change local `FilterId` in `src/views/Videos.tsx` to:

```ts
type FilterId = number | null | 'all'
```

- [x] **Step 2: Remove pseudo-group branches**

In `filterVideos`, delete:

```ts
if (filter.groupId === 'downloaded' && video.status !== 'downloaded') return false
if (filter.groupId === 'downloading' && video.status !== 'downloading') return false
```

- [x] **Step 3: Remove buttons from left nav**

In `src/views/Videos.tsx`, change the static group array to:

```ts
[
  ['all', t('videos.all_videos')],
  [null, t('videos.uncategorized')],
]
```

- [x] **Step 4: Run tests**

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

---

### Task 4: Bilibili Guidance in Settings

**Files:**
- Modify: `src/views/Settings.tsx`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`

- [x] **Step 1: Add localization keys**

Add under `settings` in `src/locales/zh-CN.json`:

```json
"video_bilibili_notes_title": "Bilibili 下载说明",
"video_bilibili_note_login": "下载 Bilibili 高清、会员或受限视频时，请先在浏览器中登录对应账号，并在这里选择“使用浏览器登录 cookies”。",
"video_bilibili_note_verify": "建议先点击“验证 Cookie 授权”，macOS 可能会弹出浏览器或钥匙串访问授权，请选择允许。",
"video_bilibili_note_412": "如果下载失败并出现 HTTP 412，通常表示匿名访问被 Bilibili 拦截，需要刷新登录状态或改用 cookies.txt。",
"video_bilibili_note_rights": "会员视频只能下载当前账号有权限访问的清晰度。"
```

Add equivalent English keys in `src/locales/en-US.json`.

- [x] **Step 2: Render guidance block**

In `Settings.tsx`, below the video action buttons/status area, add:

```tsx
<div
  style={{
    padding: '12px',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    backgroundColor: 'var(--bg-muted)',
    display: 'grid',
    gap: '6px',
  }}
>
  <strong style={{ fontSize: '12px' }}>{t('settings.video_bilibili_notes_title')}</strong>
  {[
    'settings.video_bilibili_note_login',
    'settings.video_bilibili_note_verify',
    'settings.video_bilibili_note_412',
    'settings.video_bilibili_note_rights',
  ].map((key) => (
    <p key={key} style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
      {t(key)}
    </p>
  ))}
</div>
```

- [x] **Step 3: Run type check**

Run:

```bash
npm exec tsc -- --noEmit
```

Expected: PASS.

---

### Task 5: Colored Tags and Groups

**Files:**
- Modify: `src/views/videoLibraryUtils.ts`
- Modify: `src/views/Videos.tsx`
- Test: `tests/videoLibraryUtils.test.ts`

- [x] **Step 1: Write failing color helper tests**

Add to `tests/videoLibraryUtils.test.ts`:

```ts
import { getChipStyle } from '../src/views/videoLibraryUtils.ts'

test('getChipStyle returns stable distinct chip colors', () => {
  assert.deepEqual(getChipStyle('AI'), getChipStyle('AI'))
  assert.notDeepEqual(getChipStyle('AI'), getChipStyle('美食'))
})
```

- [x] **Step 2: Implement stable color helper**

Add to `src/views/videoLibraryUtils.ts`:

```ts
const chipPalette = [
  { backgroundColor: 'rgba(14, 165, 233, 0.14)', color: '#0369a1', borderColor: 'rgba(14, 165, 233, 0.28)' },
  { backgroundColor: 'rgba(34, 197, 94, 0.14)', color: '#15803d', borderColor: 'rgba(34, 197, 94, 0.28)' },
  { backgroundColor: 'rgba(245, 158, 11, 0.16)', color: '#92400e', borderColor: 'rgba(245, 158, 11, 0.3)' },
  { backgroundColor: 'rgba(236, 72, 153, 0.14)', color: '#be185d', borderColor: 'rgba(236, 72, 153, 0.28)' },
  { backgroundColor: 'rgba(99, 102, 241, 0.14)', color: '#4338ca', borderColor: 'rgba(99, 102, 241, 0.28)' },
  { backgroundColor: 'rgba(20, 184, 166, 0.14)', color: '#0f766e', borderColor: 'rgba(20, 184, 166, 0.28)' },
]

export function getChipStyle(seed: string | number) {
  const raw = String(seed || 'default')
  let hash = 0
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0
  }
  return chipPalette[hash % chipPalette.length]
}
```

- [x] **Step 3: Apply chip styles**

In `Videos.tsx`, apply `getChipStyle(tagName)` to tag spans and `getChipStyle(group.id)` to group buttons. Add border color:

```tsx
const chip = getChipStyle(tagName)
style={{
  fontSize: '10.5px',
  padding: '2px 6px',
  borderRadius: '999px',
  backgroundColor: chip.backgroundColor,
  color: chip.color,
  border: `1px solid ${chip.borderColor}`,
}}
```

- [x] **Step 4: Run tests**

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

---

### Task 6: Collapsible Right Drawer

**Files:**
- Modify: `src/views/videoLibraryUtils.ts`
- Modify: `src/views/Videos.tsx`
- Test: `tests/videoLibraryUtils.test.ts`

- [x] **Step 1: Add drawer state helper tests**

Add to `tests/videoLibraryUtils.test.ts`:

```ts
import { nextVideoDrawerState } from '../src/views/videoLibraryUtils.ts'

test('nextVideoDrawerState opens details or queue and closes on outside click', () => {
  assert.deepEqual(nextVideoDrawerState({ open: false, tab: 'details' }, 'open-details'), {
    open: true,
    tab: 'details',
  })
  assert.deepEqual(nextVideoDrawerState({ open: true, tab: 'details' }, 'open-queue'), {
    open: true,
    tab: 'queue',
  })
  assert.deepEqual(nextVideoDrawerState({ open: true, tab: 'queue' }, 'outside-click'), {
    open: false,
    tab: 'queue',
  })
})
```

- [x] **Step 2: Implement drawer state helper**

Add to `src/views/videoLibraryUtils.ts`:

```ts
export type VideoDrawerState = { open: boolean; tab: 'details' | 'queue' }
export type VideoDrawerAction = 'open-details' | 'open-queue' | 'outside-click' | 'close'

export function nextVideoDrawerState(state: VideoDrawerState, action: VideoDrawerAction): VideoDrawerState {
  if (action === 'open-details') return { open: true, tab: 'details' }
  if (action === 'open-queue') return { open: true, tab: 'queue' }
  if (action === 'outside-click' || action === 'close') return { ...state, open: false }
  return state
}
```

- [x] **Step 3: Add drawer state to Videos page**

In `Videos.tsx`:

```ts
const [drawerState, setDrawerState] = useState({ open: false, tab: 'details' as 'details' | 'queue' })
const updateDrawer = (action: VideoDrawerAction) =>
  setDrawerState((current) => nextVideoDrawerState(current, action))
```

When a video card is clicked:

```tsx
onClick={() => {
  setSelectedVideo(video)
  updateDrawer('open-details')
}}
```

Add a queue button near the library header:

```tsx
<button className="btn sm" onClick={() => updateDrawer('open-queue')}>
  {t('videos.download_queue')} ({downloadQueue.length})
</button>
```

- [x] **Step 4: Replace fixed right column with drawer overlay**

Change main grid from:

```ts
gridTemplateColumns: '220px minmax(0, 1fr) 320px'
```

to:

```ts
gridTemplateColumns: '220px minmax(0, 1fr)'
```

Remove the always-visible right `<aside>`.

Add after the main grid:

```tsx
{drawerState.open && (
  <div
    onClick={() => updateDrawer('outside-click')}
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 900,
      backgroundColor: 'rgba(0,0,0,0.18)',
      display: 'flex',
      justifyContent: 'flex-end',
    }}
  >
    <aside
      onClick={(event) => event.stopPropagation()}
      style={{
        width: '360px',
        maxWidth: 'calc(100vw - 24px)',
        height: '100%',
        backgroundColor: 'var(--bg-surface)',
        borderLeft: '1px solid var(--color-border)',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className={`btn sm ${drawerState.tab === 'details' ? 'primary' : ''}`} onClick={() => updateDrawer('open-details')}>
          {t('videos.details_title')}
        </button>
        <button className={`btn sm ${drawerState.tab === 'queue' ? 'primary' : ''}`} onClick={() => updateDrawer('open-queue')}>
          {t('videos.download_queue')}
        </button>
        <button className="btn sm btn-icon" style={{ marginLeft: 'auto' }} onClick={() => updateDrawer('close')}>
          <X size={14} />
        </button>
      </div>
      {drawerState.tab === 'details' ? renderDetailsPanel() : renderQueuePanel()}
    </aside>
  </div>
)}
```

Use local JSX helpers or inline blocks for `renderDetailsPanel` and `renderQueuePanel`; keep the existing details and queue content unchanged except for fitting the drawer width.

- [x] **Step 5: Run tests and type check**

Run:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
npm exec tsc -- --noEmit
```

Expected: PASS.

---

### Final Verification

- [x] Run all video utility and service tests:

```bash
node --import tsx tests/videoLibraryUtils.test.ts
node --import tsx tests/videoServiceSmoke.test.ts
node --import tsx tests/videoNormalize.test.ts
node --import tsx tests/videoBilibiliFallback.test.ts
```

Expected: all tests PASS.

- [x] Run CSP test:

```bash
node tests/indexSecurity.test.mjs
```

Expected: PASS.

- [x] Run type check:

```bash
npm exec tsc -- --noEmit
```

Expected: no output and exit code 0.

- [x] Run production build:

```bash
npm run build
```

Expected: exit code 0. Existing Vite chunk-size warning is acceptable.

- [x] Restart dev server:

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

Expected: Vite prints `Local: http://localhost:5173/` or next available port, and Electron starts.

---

## Self-Review

- Spec coverage: all six approved requirements are covered by Tasks 1-6.
- Placeholder scan: no TBD/TODO items remain; every task has concrete files, commands, and expected results.
- Type consistency: `VideoDrawerState`, `VideoDrawerAction`, chip helpers, bulk selection helpers, and duration helpers are defined before being used.

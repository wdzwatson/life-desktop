import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canPlayVideo,
  canStartVideoDownloadWithEngine,
  clampVideoConcurrentDownloads,
  createVideoDetailDraft,
  filterVideos,
  formatDuration,
  getBulkSelectionState,
  getChipStyle,
  getDescendantGroupIds,
  getDownloadedLibraryVideos,
  getDownloadFailureToastData,
  getMissingDownloaderMessage,
  getPendingDownloadRecordStatus,
  getPlaybackOverlayChrome,
  getProgressPercentLabel,
  getSelectedGroupPathLabel,
  getVideoSourceUrl,
  getFloatingDropdownFrame,
  getVideoDetailsSaveSuccessFeedback,
  getVideoGroupOptions,
  getVideoDrawerTitleKey,
  getVideoDurationLabel,
  getVideoLibraryVideos,
  getVideoListDownloadAction,
  getVideoListItemBackground,
  runVideoDownloadTasksWithLimit,
  isYtDlpAvailable,
  nextVideoDrawerState,
  normalizeVideoGroupName,
  toggleSelectedTag,
  parseTagInput,
  shouldShowLibraryDownloadAction,
  toggleBulkSelection,
} from '../src/views/videoLibraryUtils.ts'

const videos = [
  {
    id: 1,
    title: 'LangChain 入门',
    group_id: 2,
    status: 'downloaded',
    local_path: '/a.mp4',
    tags: ['AI', '课程'],
  },
  {
    id: 2,
    title: 'Adele Someone Like You',
    group_id: null,
    status: 'unclassified',
    local_path: '',
    tags: ['音乐'],
  },
]

test('filterVideos matches query, group, and tag', () => {
  assert.deepEqual(
    filterVideos(videos, { query: 'lang', groupId: 2, tag: 'AI' }).map((v) => v.id),
    [1],
  )
  assert.deepEqual(
    filterVideos(videos, { query: '', groupId: null, tag: '音乐' }).map((v) => v.id),
    [2],
  )
})

test('filterVideos includes child groups when descendant ids are provided', () => {
  const records = [
    ...videos,
    { id: 5, title: 'Nested AI lesson', group_id: 4, status: 'downloaded', tags: [] },
  ]

  assert.deepEqual(
    filterVideos(records, {
      query: '',
      groupId: 2,
      groupIds: [2, 4],
      tag: null,
    }).map((v) => v.id),
    [1, 5],
  )
})

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

test('getDownloadedLibraryVideos hides queued and downloading records from the downloaded library', () => {
  const records = [
    ...videos,
    { id: 3, title: 'Queued clip', group_id: null, status: 'queued', tags: [] },
    { id: 4, title: 'Downloading clip', group_id: null, status: 'downloading', tags: [] },
  ]

  assert.deepEqual(
    getDownloadedLibraryVideos(records, { query: '', groupId: 'all', tag: null }).map((v) => v.id),
    [1],
  )
})

test('getVideoLibraryVideos keeps every video status in one filterable list', () => {
  const records = [
    { id: 1, title: 'Done', status: 'downloaded', group_id: 2, tags: ['AI'] },
    { id: 2, title: 'Pending', status: 'not_downloaded', group_id: null, tags: [] },
    { id: 3, title: 'Active', status: 'downloading', group_id: null, tags: [] },
    { id: 4, title: 'Broken', status: 'download_failed', group_id: null, tags: [] },
    { id: 5, title: 'Gone', status: 'invalid', group_id: null, tags: [] },
  ]

  assert.deepEqual(
    getVideoLibraryVideos(records, { query: '', groupId: 'all', tag: null }).map((v) => v.id),
    [1, 2, 3, 4, 5],
  )
})

test('getPendingDownloadRecordStatus uses a database-allowed status', () => {
  assert.equal(getPendingDownloadRecordStatus(), 'queued')
})

test('canStartVideoDownloadWithEngine allows downloads only after the engine is ready', () => {
  assert.deepEqual(canStartVideoDownloadWithEngine({ status: 'ready' }), {
    canStart: true,
    toastKey: null,
  })
  assert.deepEqual(canStartVideoDownloadWithEngine({ status: 'loading' }), {
    canStart: false,
    toastKey: 'videos.toast_video_engine_loading',
  })
  assert.deepEqual(canStartVideoDownloadWithEngine({ status: 'error', message: 'Missing yt-dlp' }), {
    canStart: false,
    toastKey: 'videos.toast_video_engine_failed',
  })
})

test('clampVideoConcurrentDownloads keeps simultaneous download limits between 1 and 10', () => {
  assert.equal(clampVideoConcurrentDownloads(undefined), 3)
  assert.equal(clampVideoConcurrentDownloads(0), 1)
  assert.equal(clampVideoConcurrentDownloads(4.8), 4)
  assert.equal(clampVideoConcurrentDownloads(20), 10)
})

test('runVideoDownloadTasksWithLimit never starts more than the configured limit at once', async () => {
  let active = 0
  let maxActive = 0
  const started: number[] = []
  const tasks = [1, 2, 3, 4, 5]

  await runVideoDownloadTasksWithLimit(tasks, 2, async (task) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    started.push(task)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
  })

  assert.equal(maxActive, 2)
  assert.deepEqual(started.sort((a, b) => a - b), tasks)
})

test('canPlayVideo requires downloaded status and local path', () => {
  assert.equal(canPlayVideo(videos[0]), true)
  assert.equal(canPlayVideo(videos[1]), false)
})

test('createVideoDetailDraft copies group and tags without mutating the video record', () => {
  const video = { id: 1, title: 'x', group_id: 2, tags: ['AI'] }
  const draft = createVideoDetailDraft(video)

  draft.groupId = 3
  draft.tags.push('课程')

  assert.deepEqual(draft, { groupId: 3, tags: ['AI', '课程'] })
  assert.deepEqual(video, { id: 1, title: 'x', group_id: 2, tags: ['AI'] })
})

test('getVideoDurationLabel prefers saved duration and formats numeric seconds', () => {
  assert.equal(getVideoDurationLabel({ id: 1, title: 'x', duration: '12:34' }), '12:34')
  assert.equal(getVideoDurationLabel({ id: 1, title: 'x', duration_seconds: 95 } as any), '1:35')
  assert.equal(getVideoDurationLabel({ id: 1, title: 'x' }), '')
})

test('getVideoSourceUrl prefers read-only source url over legacy url', () => {
  assert.equal(
    getVideoSourceUrl({ id: 1, title: 'x', source_url: 'https://source.test/video', url: 'https://legacy.test/video' }),
    'https://source.test/video',
  )
  assert.equal(getVideoSourceUrl({ id: 1, title: 'x', url: 'https://legacy.test/video' }), 'https://legacy.test/video')
  assert.equal(getVideoSourceUrl({ id: 1, title: 'x' }), '')
})

test('shouldShowLibraryDownloadAction hides download action for downloaded local videos', () => {
  assert.equal(shouldShowLibraryDownloadAction(videos[0]), false)
  assert.equal(shouldShowLibraryDownloadAction(videos[1]), true)
})

test('getVideoListDownloadAction enables downloads only when ready or retryable', () => {
  assert.deepEqual(getVideoListDownloadAction({ id: 1, title: 'Done', status: 'downloaded' }, []), {
    visible: false,
    disabled: true,
    state: 'downloaded',
  })
  assert.deepEqual(
    getVideoListDownloadAction({ id: 2, title: 'Active', status: 'unclassified', source_url: 'https://x.test' } as any, [
      { id: 2, title: 'Active', status: 'downloading' },
    ]),
    {
      visible: true,
      disabled: true,
      state: 'active',
    },
  )
  assert.deepEqual(
    getVideoListDownloadAction({ id: 3, title: 'Failed', status: 'unclassified', source_url: 'https://x.test' } as any, [
      { id: 3, title: 'Failed', status: 'failed' },
    ]),
    {
      visible: true,
      disabled: false,
      state: 'retry',
    },
  )
  assert.deepEqual(
    getVideoListDownloadAction({ id: 4, title: 'Ready', status: 'unclassified', source_url: 'https://x.test' } as any, []),
    {
      visible: true,
      disabled: false,
      state: 'ready',
    },
  )
})

test('getVideoListItemBackground highlights downloaded videos with a translucent green background', () => {
  assert.equal(getVideoListItemBackground({ id: 1, title: 'Done', status: 'downloaded' }), 'rgba(34, 197, 94, 0.1)')
  assert.equal(getVideoListItemBackground({ id: 2, title: 'Pending', status: 'unclassified' }), 'var(--bg-app)')
})

test('formatDuration converts seconds to labels', () => {
  assert.equal(formatDuration(285), '4:45')
  assert.equal(formatDuration(undefined), '')
})

test('parseTagInput trims and deduplicates tags', () => {
  assert.deepEqual(parseTagInput('AI, 课程,AI,, 前端'), ['AI', '课程', '前端'])
})

test('toggleSelectedTag adds and removes tags without duplicates', () => {
  assert.deepEqual(toggleSelectedTag(['AI'], '课程'), ['AI', '课程'])
  assert.deepEqual(toggleSelectedTag(['AI', '课程'], 'AI'), ['课程'])
  assert.deepEqual(toggleSelectedTag(['AI'], '  '), ['AI'])
})

test('getVideoGroupOptions returns nested paths and descendant ids', () => {
  const groups = [
    { id: 1, name: '课程', parent_id: null },
    { id: 2, name: 'AI', parent_id: 1 },
    { id: 3, name: 'LangChain', parent_id: 2 },
    { id: 4, name: '音乐', parent_id: null },
  ]

  assert.deepEqual(
    getVideoGroupOptions(groups).map(({ id, path, depth }) => ({ id, path, depth })),
    [
      { id: 1, path: '课程', depth: 0 },
      { id: 2, path: '课程 / AI', depth: 1 },
      { id: 3, path: '课程 / AI / LangChain', depth: 2 },
      { id: 4, path: '音乐', depth: 0 },
    ],
  )
  assert.deepEqual(getDescendantGroupIds(groups, 1), [1, 2, 3])
})

test('getSelectedGroupPathLabel resolves current group path with fallback', () => {
  const options = getVideoGroupOptions([
    { id: 1, name: '课程', parent_id: null },
    { id: 2, name: 'AI', parent_id: 1 },
  ])

  assert.equal(getSelectedGroupPathLabel(options, 2, '未分类'), '课程 / AI')
  assert.equal(getSelectedGroupPathLabel(options, null, '未分类'), '未分类')
  assert.equal(getSelectedGroupPathLabel(options, 99, '未分类'), '未分类')
})

test('getFloatingDropdownFrame positions dropdown without growing parent scroll area', () => {
  assert.deepEqual(
    getFloatingDropdownFrame({ top: 100, bottom: 140, left: 20, width: 320 }, 800),
    { top: 144, left: 20, width: 320, maxHeight: 220 },
  )
  assert.deepEqual(
    getFloatingDropdownFrame({ top: 650, bottom: 690, left: 20, width: 320 }, 800),
    { top: 426, left: 20, width: 320, maxHeight: 220 },
  )
})

test('normalizeVideoGroupName trims input and rejects blank names', () => {
  assert.equal(normalizeVideoGroupName('  课程  '), '课程')
  assert.equal(normalizeVideoGroupName('   '), '')
})

test('getProgressPercentLabel clamps and rounds download progress', () => {
  assert.equal(getProgressPercentLabel(undefined), '0%')
  assert.equal(getProgressPercentLabel(12.4), '12%')
  assert.equal(getProgressPercentLabel(100.8), '100%')
  assert.equal(getProgressPercentLabel(-1), '0%')
})

test('download tool helpers detect missing yt-dlp before queue starts', () => {
  const missing = {
    ytDlp: { ok: false, path: 'yt-dlp', error: 'spawn yt-dlp ENOENT' },
  }
  const available = {
    ytDlp: { ok: true, path: '/opt/bin/yt-dlp', version: '2025.10.14' },
  }

  assert.equal(isYtDlpAvailable(missing), false)
  assert.equal(isYtDlpAvailable(available), true)
  assert.match(getMissingDownloaderMessage(missing), /yt-dlp|ENOENT/)
})

test('getDownloadFailureToastData keeps the failure reason for user-facing toasts', () => {
  assert.deepEqual(getDownloadFailureToastData('Video title', 'HTTP Error 412'), {
    title: 'Video title',
    error: 'HTTP Error 412',
  })
  assert.deepEqual(getDownloadFailureToastData('Video title', ''), {
    title: 'Video title',
    error: 'Unknown error',
  })
})

test('getPlaybackOverlayChrome avoids the macOS window controls and drag region', () => {
  const macChrome = getPlaybackOverlayChrome(true)
  assert.equal(macChrome.topInset, 38)
  assert.equal(macChrome.headerAppRegion, 'no-drag')

  const otherChrome = getPlaybackOverlayChrome(false)
  assert.equal(otherChrome.topInset, 0)
  assert.equal(otherChrome.headerAppRegion, 'no-drag')
})

test('getChipStyle returns stable distinct chip colors', () => {
  assert.deepEqual(getChipStyle('AI'), getChipStyle('AI'))
  assert.notDeepEqual(getChipStyle('AI'), getChipStyle('美食'))
})

test('nextVideoDrawerState opens details and closes on outside click', () => {
  assert.deepEqual(nextVideoDrawerState({ open: false }, 'open-details'), {
    open: true,
  })
  assert.deepEqual(nextVideoDrawerState({ open: true }, 'outside-click'), {
    open: false,
  })
})

test('getVideoDrawerTitleKey returns details title after queue drawer removal', () => {
  assert.equal(getVideoDrawerTitleKey(), 'videos.details_title')
})

test('getVideoDetailsSaveSuccessFeedback closes the drawer and shows a details saved toast', () => {
  assert.deepEqual(getVideoDetailsSaveSuccessFeedback(), {
    drawerAction: 'close',
    toastKey: 'videos.toast_video_details_saved',
  })
})

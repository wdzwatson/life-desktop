import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyParsedVideoMetadataDefaults,
  canEditVideoDetails,
  canPlayVideoRecord,
  buildParsedVideoTitle,
  createBulkMetadataEditPlan,
  createVideoBatchKey,
  getBulkMetadataActionLabels,
  getBulkTagEditButtonLabels,
  getDefaultVideoSortRank,
  getParseResultActionLabels,
  isBulkMetadataWriteResultSuccess,
  parseBulkGroupPickerValue,
  parseParsedVideoImportTagDraft,
  getStatusBadgeTone,
  getSortDirectionIconName,
  getVideoRowDownloadAction,
  getVideoRowStyle,
  shouldCreateBulkTagRecord,
  sortVideoRecords,
  toggleSortDirection,
} from '../src/views/videoStateUtils.ts'
import type { VideoRecord } from '../src/views/videoTypes.ts'

const base = (overrides: Partial<VideoRecord>): VideoRecord => ({
  id: 1,
  title: 'Video',
  status: 'not_downloaded',
  ...overrides,
})

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
  assert.equal(getStatusBadgeTone('queued'), 'neutral')
  assert.equal(getStatusBadgeTone('invalid'), 'muted')
})

test('sortVideoRecords default order prioritizes active work then batch ordering', () => {
  const records: VideoRecord[] = [
    base({ id: 1, title: 'Downloaded', status: 'downloaded', created_at: '2026-01-01T00:00:00Z' }),
    base({ id: 2, title: 'Failed', status: 'download_failed', download_batch_created_at: '2026-01-03T00:00:00Z' }),
    base({
      id: 3,
      title: 'Active 2',
      status: 'downloading',
      download_batch_id: 9,
      download_batch_order: 2,
      download_batch_created_at: '2026-01-04T00:00:00Z',
    }),
    base({
      id: 7,
      title: 'Queued',
      status: 'queued',
      download_batch_id: 9,
      download_batch_order: 3,
      download_batch_created_at: '2026-01-04T00:00:00Z',
    }),
    base({ id: 4, title: 'Invalid', status: 'invalid' }),
    base({
      id: 5,
      title: 'Active 1',
      status: 'downloading',
      download_batch_id: 9,
      download_batch_order: 1,
      download_batch_created_at: '2026-01-04T00:00:00Z',
    }),
    base({ id: 6, title: 'Pending', status: 'not_downloaded', created_at: '2026-01-05T00:00:00Z' }),
  ]

  assert.deepEqual(sortVideoRecords(records, { key: 'default', direction: 'desc' }).map((video) => video.id), [
    5,
    3,
    7,
    2,
    6,
    1,
    4,
  ])
  assert.equal(getDefaultVideoSortRank('downloading'), 0)
  assert.equal(getDefaultVideoSortRank('queued'), 1)
  assert.equal(getDefaultVideoSortRank('invalid'), 5)
})

test('sortVideoRecords supports title and duration ordering', () => {
  const records: VideoRecord[] = [
    base({ id: 1, title: 'Beta', duration_seconds: 300 }),
    base({ id: 2, title: 'Alpha', duration_seconds: 100 }),
  ]

  assert.deepEqual(sortVideoRecords(records, { key: 'title', direction: 'asc' }).map((video) => video.id), [2, 1])
  assert.deepEqual(sortVideoRecords(records, { key: 'duration', direction: 'desc' }).map((video) => video.id), [1, 2])
})

test('getSortDirectionIconName maps sort direction to compact icon names', () => {
  assert.equal(getSortDirectionIconName('asc'), 'sort-asc')
  assert.equal(getSortDirectionIconName('desc'), 'sort-desc')
})

test('toggleSortDirection switches between descending and ascending order', () => {
  assert.equal(toggleSortDirection('desc'), 'asc')
  assert.equal(toggleSortDirection('asc'), 'desc')
})

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

test('applyParsedVideoMetadataDefaults attaches optional import group and tags', () => {
  assert.deepEqual(
    applyParsedVideoMetadataDefaults(
      { title: 'Part 1', source: 'bilibili' },
      { groupId: 12, tagNames: ['AI', 'Course', 'AI', ''] },
    ),
    { title: 'Part 1', source: 'bilibili', group_id: 12, tags: ['AI', 'Course'] },
  )

  assert.deepEqual(
    applyParsedVideoMetadataDefaults(
      { title: 'Part 2', group_id: 7, tags: ['Existing'] },
      { groupId: null, tagNames: [] },
    ),
    { title: 'Part 2', group_id: 7, tags: ['Existing'] },
  )

  assert.deepEqual(
    applyParsedVideoMetadataDefaults(
      { title: 'Part 3', tags: ['Existing'] },
      { tagNames: ['AI', 'Existing'] },
    ),
    { title: 'Part 3', group_id: undefined, tags: ['Existing', 'AI'] },
  )
})

test('parseParsedVideoImportTagDraft derives tags from a preserved comma draft', () => {
  assert.deepEqual(parseParsedVideoImportTagDraft('AI, Course,'), ['AI', 'Course'])
  assert.deepEqual(parseParsedVideoImportTagDraft('AI,, Course, AI'), ['AI', 'Course'])
})

test('buildParsedVideoTitle prefixes multipart Bilibili parts with editable playlist title', () => {
  assert.equal(buildParsedVideoTitle('LangChain Course', { title: 'P1 Introduction' }), 'LangChain Course - P1 Introduction')
  assert.equal(buildParsedVideoTitle('  LangChain Course  ', { title: '  P2 Setup  ' }), 'LangChain Course - P2 Setup')
  assert.equal(buildParsedVideoTitle('', { title: 'P3 Download' }), 'P3 Download')
})

test('createBulkMetadataEditPlan separates editable and skipped bulk metadata records', () => {
  const selected = [
    base({ id: 1, status: 'not_downloaded' }),
    base({ id: 2, status: 'downloaded' }),
    base({ id: 3, status: 'download_failed' }),
    base({ id: 4, status: 'downloading' }),
    base({ id: 5, status: 'invalid' }),
  ]

  assert.deepEqual(createBulkMetadataEditPlan(selected), {
    editableIds: [1, 2, 3],
    skippedIds: [4, 5],
    editableCount: 3,
    skippedCount: 2,
  })
})

test('getBulkMetadataActionLabels keeps the contextual bar sparse', () => {
  assert.deepEqual(getBulkMetadataActionLabels(), {
    selectedCount: 'videos.bulk_selected_count',
    group: 'videos.bulk_group',
    tags: 'videos.bulk_tags',
    more: 'videos.bulk_more',
    cancel: 'videos.bulk_cancel',
  })
})

test('parseBulkGroupPickerValue keeps choosing and clearing group distinct', () => {
  assert.equal(parseBulkGroupPickerValue('__choose__'), undefined)
  assert.equal(parseBulkGroupPickerValue('__none__'), null)
  assert.equal(parseBulkGroupPickerValue('12'), 12)
})

test('shouldCreateBulkTagRecord only creates missing tags while adding', () => {
  assert.equal(shouldCreateBulkTagRecord('add'), true)
  assert.equal(shouldCreateBulkTagRecord('remove'), false)
})

test('isBulkMetadataWriteResultSuccess treats missing or failed db results as failures', () => {
  assert.equal(isBulkMetadataWriteResultSuccess({ success: true }), true)
  assert.equal(isBulkMetadataWriteResultSuccess({ success: false }), false)
  assert.equal(isBulkMetadataWriteResultSuccess(undefined), false)
})

test('getBulkTagEditButtonLabels exposes accessible add and remove labels', () => {
  assert.deepEqual(getBulkTagEditButtonLabels(), {
    add: 'videos.bulk_add_tags',
    remove: 'videos.bulk_remove_tags',
  })
})

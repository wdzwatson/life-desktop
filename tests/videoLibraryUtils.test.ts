import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canPlayVideo,
  filterVideos,
  formatDuration,
  parseTagInput,
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

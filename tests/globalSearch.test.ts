import test from 'node:test'
import assert from 'node:assert/strict'
import { getGlobalSearchOpenEvent } from '../src/globalSearch'

test('global search deep-link events map modules to stable entity ids', () => {
  assert.deepEqual(getGlobalSearchOpenEvent('tasks', 7), {
    name: 'lifeos:open-tasks',
    detail: { taskId: 7 },
  })
  assert.deepEqual(getGlobalSearchOpenEvent('notes', 8), {
    name: 'lifeos:open-notes',
    detail: { noteId: 8 },
  })
  assert.deepEqual(getGlobalSearchOpenEvent('books', 9), {
    name: 'lifeos:open-books',
    detail: { bookId: 9 },
  })
  assert.deepEqual(getGlobalSearchOpenEvent('videos', 10), {
    name: 'lifeos:open-videos',
    detail: { videoId: 10 },
  })
})

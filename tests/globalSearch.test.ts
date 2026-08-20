import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getGlobalSearchOpenEvent,
  getGlobalSearchOptionId,
  getNextGlobalSearchIndex,
} from '../src/globalSearch'

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

test('global search keyboard navigation wraps and supports Home/End', () => {
  assert.equal(getNextGlobalSearchIndex(-1, 'ArrowDown', 3), 0)
  assert.equal(getNextGlobalSearchIndex(0, 'ArrowDown', 3), 1)
  assert.equal(getNextGlobalSearchIndex(0, 'ArrowUp', 3), 2)
  assert.equal(getNextGlobalSearchIndex(2, 'ArrowDown', 3), 0)
  assert.equal(getNextGlobalSearchIndex(1, 'Home', 3), 0)
  assert.equal(getNextGlobalSearchIndex(1, 'End', 3), 2)
  assert.equal(getNextGlobalSearchIndex(0, 'ArrowDown', 0), -1)
})

test('global search option ids are stable and unique by index', () => {
  assert.equal(getGlobalSearchOptionId(0), 'global-search-option-0')
  assert.equal(getGlobalSearchOptionId(4), 'global-search-option-4')
})

test('global search exposes keyboard and accessibility contracts in the UI', () => {
  const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8')
  const topbarSource = readFileSync(join(process.cwd(), 'src', 'components', 'Topbar.tsx'), 'utf8')
  assert.match(appSource, /role="combobox"/)
  assert.match(appSource, /role="listbox"/)
  assert.match(appSource, /role="option"/)
  assert.match(appSource, /getNextGlobalSearchIndex\(/)
  assert.match(appSource, /event\.key/)
  assert.match(appSource, /event\.key === 'Escape'/)
  assert.match(topbarSource, /aria-label=\{t\('topbar\.search_accessible_label'\)\}/)
  assert.match(topbarSource, /searchButtonRef/)
})

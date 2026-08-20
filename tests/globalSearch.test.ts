import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getGlobalSearchOpenEvent,
  getGlobalSearchOptionId,
  getNextGlobalSearchIndex,
  groupGlobalSearchResults,
  rankGlobalSearchResults,
  type GlobalSearchResult,
} from '../src/globalSearch'

const noop = () => undefined

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

test('global search ranking prioritizes exact, prefix, title and secondary-field matches', () => {
  const candidates: GlobalSearchResult[] = [
    { id: 1, module: 'tasks', type: 'tasks', title: 'Plan search work', action: noop },
    { id: 2, module: 'notes', type: 'notes', title: 'Search', action: noop },
    { id: 3, module: 'books', type: 'books', title: 'Searching well', action: noop },
    {
      id: 4,
      module: 'videos',
      type: 'videos',
      title: 'Productivity',
      searchableFields: { URL: 'https://example.test/search' },
      action: noop,
    },
  ]

  const ranked = rankGlobalSearchResults('search', candidates)
  assert.deepEqual(
    ranked.map((result) => result.id),
    [2, 3, 1, 4],
  )
  assert.deepEqual(
    ranked.map((result) => result.score),
    [400, 300, 200, 100],
  )
  assert.equal(ranked[3].matchedField, 'URL')
  assert.match(ranked[3].snippet || '', /search/)
})

test('global search ranking uses updated time and stable fields as tie breakers', () => {
  const candidates: GlobalSearchResult[] = [
    {
      id: 2,
      module: 'tasks',
      type: 'tasks',
      title: '中文查询 B',
      updatedAt: '2026-01-01',
      action: noop,
    },
    {
      id: 1,
      module: 'tasks',
      type: 'tasks',
      title: '中文查询 A',
      updatedAt: '2026-01-02',
      action: noop,
    },
    {
      id: 3,
      module: 'tasks',
      type: 'tasks',
      title: '中文查询 C',
      updatedAt: '2026-01-02',
      action: noop,
    },
  ]
  const first = rankGlobalSearchResults('中文', candidates)
  const second = rankGlobalSearchResults('中文', candidates)
  assert.deepEqual(
    first.map((result) => result.id),
    [1, 3, 2],
  )
  assert.deepEqual(
    second.map((result) => result.id),
    [1, 3, 2],
  )
})

test('global search groups expose counts and truncation without losing module order', () => {
  const results: GlobalSearchResult[] = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: index,
      module: 'tasks' as const,
      type: 'tasks',
      title: `Task ${index}`,
      totalCount: 9,
      action: noop,
    })),
    { id: 10, module: 'notes', type: 'notes', title: 'Note', action: noop },
  ]
  const groups = groupGlobalSearchResults(results, 3)
  assert.deepEqual(
    groups.map((group) => group.module),
    ['tasks', 'notes'],
  )
  assert.equal(groups[0].totalCount, 9)
  assert.equal(groups[0].items.length, 3)
  assert.equal(groups[0].hasMore, true)
  assert.equal(groups[1].hasMore, false)
})

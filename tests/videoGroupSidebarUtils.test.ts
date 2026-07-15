import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCreateVideoGroupStatements,
  buildDeleteVideoGroupStatements,
  buildUpdateVideoGroupTranslationsStatements,
  buildVideoGroupTree,
  findSiblingVideoGroupNameConflict,
  flattenVisibleVideoGroupTree,
  getContextMenuPosition,
  getDirectVideoGroupCounts,
  getNextMenuFocusIndex,
  getVideoGroupAncestorIds,
  getVideoGroupDeleteImpact,
  getVideoGroupDisplayName,
  getVideoGroupIdAfterDelete,
  normalizeVideoGroupDisplayName,
} from '../src/views/videoGroupSidebarUtils.ts'
import type {
  VideoGroupRecord,
  VideoGroupTranslation,
  VideoGroupTreeNode,
  VideoTagRecord,
} from '../src/views/videoTypes.ts'

const groups: VideoGroupRecord[] = [
  { id: 1, name: 'Courses', parent_id: null, sort_order: 1 },
  { id: 2, name: 'AI', parent_id: 1, sort_order: 1 },
  { id: 3, name: 'Agents', parent_id: 2, sort_order: 1 },
  { id: 4, name: 'Music', parent_id: null, sort_order: 2 },
]

const translations: VideoGroupTranslation[] = [
  { group_id: 1, locale: 'zh-CN', translation: '课程' },
  { group_id: 2, locale: 'zh-CN', translation: '人工智能' },
]

test('video group types describe translations, tags, and tree nodes', () => {
  const tag: VideoTagRecord = { id: 1, name: 'Favorite', color: '#f00' }
  const node: VideoGroupTreeNode = {
    ...groups[0],
    displayName: '课程',
    depth: 0,
    path: '课程',
    children: [],
  }

  assert.equal(tag.color, '#f00')
  assert.equal(node.displayName, '课程')
})

test('normalizeVideoGroupDisplayName trims values and safely handles nullish input', () => {
  assert.equal(normalizeVideoGroupDisplayName('  AI  '), 'AI')
  assert.equal(normalizeVideoGroupDisplayName(null), '')
  assert.equal(normalizeVideoGroupDisplayName(undefined), '')
  assert.equal(normalizeVideoGroupDisplayName(42), '42')
})

test('video group display names use a nonblank current translation then canonical fallback', () => {
  assert.equal(getVideoGroupDisplayName(groups[0], translations, 'zh-CN'), '课程')
  assert.equal(getVideoGroupDisplayName(groups[2], translations, 'zh-CN'), 'Agents')
  assert.equal(
    getVideoGroupDisplayName(
      groups[0],
      [...translations, { group_id: 1, locale: 'ja-JP', translation: '   ' }],
      'ja-JP',
    ),
    'Courses',
  )
})

test('tree construction orders siblings and produces translated depths and paths', () => {
  const sortableGroups: VideoGroupRecord[] = [
    ...groups,
    { id: 5, name: 'Zeta', parent_id: null, sort_order: 1 },
    { id: 6, name: 'Alpha', parent_id: null, sort_order: 1 },
  ]
  const tree = buildVideoGroupTree(sortableGroups, translations, 'zh-CN')

  assert.deepEqual(tree.map((node) => node.id), [6, 5, 1, 4])
  assert.deepEqual(tree[2].children.map((node) => node.id), [2])
  assert.deepEqual(tree[2].children[0].children.map((node) => node.id), [3])
  assert.deepEqual(
    flattenVisibleVideoGroupTree(tree, new Set([1, 2])).map(({ id, depth, path }) => ({
      id,
      depth,
      path,
    })),
    [
      { id: 6, depth: 0, path: 'Alpha' },
      { id: 5, depth: 0, path: 'Zeta' },
      { id: 1, depth: 0, path: '课程' },
      { id: 2, depth: 1, path: '课程 / 人工智能' },
      { id: 3, depth: 2, path: '课程 / 人工智能 / Agents' },
      { id: 4, depth: 0, path: 'Music' },
    ],
  )
})

test('tree flattening keeps roots visible and hides descendants below collapsed ancestors', () => {
  const tree = buildVideoGroupTree(groups, translations, 'zh-CN')

  assert.deepEqual(flattenVisibleVideoGroupTree(tree, new Set()).map((row) => row.id), [1, 4])
  assert.deepEqual(flattenVisibleVideoGroupTree(tree, new Set([1])).map((row) => row.id), [1, 2, 4])
})

test('tree construction surfaces orphaned and cyclic groups exactly once without recursive cycles', () => {
  const malformed: VideoGroupRecord[] = [
    { id: 1, name: 'Cycle A', parent_id: 2 },
    { id: 2, name: 'Cycle B', parent_id: 1 },
    { id: 3, name: 'Orphan', parent_id: 99 },
    { id: 4, name: 'Orphan child', parent_id: 3 },
    { id: 5, name: 'Self cycle', parent_id: 5 },
  ]
  const tree = buildVideoGroupTree(malformed, [], 'en-US')
  const rows = flattenVisibleVideoGroupTree(tree, new Set(malformed.map((group) => group.id)))

  assert.deepEqual(rows.map((row) => row.id).sort((a, b) => a - b), [1, 2, 3, 4, 5])
  assert.equal(new Set(rows.map((row) => row.id)).size, malformed.length)
  assert.deepEqual(tree.map((node) => node.id).sort((a, b) => a - b), [1, 2, 3, 5])
})

test('getVideoGroupAncestorIds returns root-to-parent ancestors and stops at cycles', () => {
  assert.deepEqual(getVideoGroupAncestorIds(groups, 3), [1, 2])
  assert.deepEqual(getVideoGroupAncestorIds(groups, 1), [])
  assert.deepEqual(getVideoGroupAncestorIds(groups, 99), [])
  assert.deepEqual(
    getVideoGroupAncestorIds(
      [
        { id: 1, name: 'A', parent_id: 2 },
        { id: 2, name: 'B', parent_id: 1 },
      ],
      1,
    ),
    [2],
  )
})

test('direct counts ignore ungrouped videos and delete impact does not include descendants', () => {
  const videos = [
    { id: 1, group_id: 1 },
    { id: 2, group_id: 1 },
    { id: 3, group_id: 2 },
    { id: 4, group_id: null },
    { id: 5 },
  ]

  assert.deepEqual(getDirectVideoGroupCounts(videos), new Map([[1, 2], [2, 1]]))
  assert.deepEqual(getVideoGroupDeleteImpact(groups, videos, 1), {
    directVideoCount: 2,
    directChildCount: 1,
  })
})

test('getVideoGroupIdAfterDelete resets only the active deleted group', () => {
  assert.equal(getVideoGroupIdAfterDelete(2, 2), 'all')
  assert.equal(getVideoGroupIdAfterDelete(1, 2), 1)
  assert.equal(getVideoGroupIdAfterDelete(null, 2), null)
  assert.equal(getVideoGroupIdAfterDelete('all', 2), 'all')
})

test('name conflicts are normalized, locale-aware, sibling-scoped, and excludable', () => {
  assert.equal(
    findSiblingVideoGroupNameConflict({
      groups,
      translations,
      parentId: 1,
      locale: 'zh-CN',
      name: ' 人工智能 ',
    })?.id,
    2,
  )
  assert.equal(
    findSiblingVideoGroupNameConflict({
      groups,
      translations,
      parentId: 1,
      locale: 'en-US',
      name: ' ai ',
    })?.id,
    2,
  )
  assert.equal(
    findSiblingVideoGroupNameConflict({
      groups,
      translations,
      parentId: null,
      locale: 'zh-CN',
      name: '人工智能',
    }),
    null,
  )
  assert.equal(
    findSiblingVideoGroupNameConflict({
      groups,
      translations,
      parentId: 1,
      locale: 'zh-CN',
      name: '人工智能',
      excludeGroupId: 2,
    }),
    null,
  )
})

test('create statements insert the canonical group and current locale translation', () => {
  assert.deepEqual(buildCreateVideoGroupStatements('  AI  ', 1, 'en-US', 4), [
    {
      sql: 'INSERT INTO video_groups (name, parent_id, sort_order) VALUES (?, ?, ?)',
      params: ['AI', 1, 4],
    },
    {
      sql: `INSERT INTO video_group_translations (group_id, locale, translation)
            VALUES (last_insert_rowid(), ?, ?)`,
      params: ['en-US', 'AI'],
    },
  ])
})

test('translation statements insert nonblank values and delete blank values in entry order', () => {
  const statements = buildUpdateVideoGroupTranslationsStatements(2, {
    'en-US': '  AI  ',
    'ja-JP': '   ',
    'zh-CN': '人工智能',
  })

  assert.equal(statements.length, 3)
  assert.deepEqual(
    statements.map((statement) => statement.sql.trim().replace(/\s+/g, ' ')),
    [
      'INSERT OR REPLACE INTO video_group_translations (group_id, locale, translation) VALUES (?, ?, ?)',
      'DELETE FROM video_group_translations WHERE group_id = ? AND locale = ?',
      'INSERT OR REPLACE INTO video_group_translations (group_id, locale, translation) VALUES (?, ?, ?)',
    ],
  )
  assert.deepEqual(statements.map((statement) => statement.params), [
    [2, 'en-US', 'AI'],
    [2, 'ja-JP'],
    [2, 'zh-CN', '人工智能'],
  ])
})

test('delete statements detach videos, promote children, delete translations, then delete the group', () => {
  assert.deepEqual(buildDeleteVideoGroupStatements(2, 1), [
    { sql: 'UPDATE videos SET group_id = NULL WHERE group_id = ?', params: [2] },
    { sql: 'UPDATE video_groups SET parent_id = ? WHERE parent_id = ?', params: [1, 2] },
    { sql: 'DELETE FROM video_group_translations WHERE group_id = ?', params: [2] },
    { sql: 'DELETE FROM video_groups WHERE id = ?', params: [2] },
  ])
})

test('context menu position stays inside the viewport with the default margin', () => {
  assert.deepEqual(
    getContextMenuPosition({
      clientX: 795,
      clientY: 595,
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 196,
      menuHeight: 166,
    }),
    { left: 596, top: 426 },
  )
  assert.deepEqual(
    getContextMenuPosition({
      clientX: 2,
      clientY: 3,
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 196,
      menuHeight: 166,
    }),
    { left: 8, top: 8 },
  )
})

test('menu focus movement wraps and safely handles no active item or empty menus', () => {
  assert.equal(getNextMenuFocusIndex(0, 4, 'ArrowUp'), 3)
  assert.equal(getNextMenuFocusIndex(3, 4, 'ArrowDown'), 0)
  assert.equal(getNextMenuFocusIndex(-1, 4, 'ArrowDown'), 0)
  assert.equal(getNextMenuFocusIndex(-1, 4, 'ArrowUp'), 3)
  assert.equal(getNextMenuFocusIndex(0, 0, 'ArrowDown'), -1)
})

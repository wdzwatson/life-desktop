import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCreateVideoGroupStatements,
  buildDeleteVideoGroupStatements,
  buildUpdateVideoGroupTranslationsStatements,
  buildVideoGroupTree,
  expandVideoGroupWithAncestors,
  findSiblingCanonicalNameConflict,
  findSiblingDisplayNameConflict,
  flattenVisibleVideoGroupTree,
  getContextMenuPosition,
  getDirectVideoGroupCounts,
  getNextMenuFocusIndex,
  getVideoGroupCollapseEditorAction,
  getVideoGroupMutationFailureFocusTarget,
  getVideoGroupTreeKeyboardAction,
  getVideoGroupAncestorIds,
  getVideoGroupDeleteImpact,
  getVideoGroupDisplayName,
  getVideoGroupIdAfterDelete,
  getVideoGroupTranslationDraft,
  isVideoGroupInSubtree,
  localizeVideoGroups,
  localizeVideoRecords,
  normalizeVideoGroupDisplayName,
  repairVideoGroupSelection,
  resolveVideoGroupRovingFocusId,
  toggleExpandedVideoGroup,
} from '../src/views/videoGroupSidebarUtils.ts'
import type {
  VideoGroupRecord,
  VideoGroupTranslation,
  VideoGroupTreeNode,
  VideoRecord,
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

test('localizeVideoGroups clones groups with current display names without mutating canonical input', () => {
  const canonicalGroups = groups.slice(0, 3).map((group) => ({ ...group }))
  const originalGroups = canonicalGroups.map((group) => ({ ...group }))

  const localizedGroups = localizeVideoGroups(canonicalGroups, translations, 'zh-CN')

  assert.deepEqual(
    localizedGroups.map((group) => group.name),
    ['课程', '人工智能', 'Agents'],
  )
  assert.deepEqual(canonicalGroups, originalGroups)
  assert.notEqual(localizedGroups[0], canonicalGroups[0])
})

test('localizeVideoRecords projects localized group names without mutating canonical videos', () => {
  const canonicalVideos: VideoRecord[] = [
    { id: 1, title: 'Course', group_id: 1, group_name: 'Courses' },
    { id: 2, title: 'Agent', group_id: 3, group_name: 'Agents' },
    { id: 3, title: 'Orphan', group_id: 99, group_name: 'Stale group' },
    { id: 4, title: 'Ungrouped', group_id: null, group_name: null },
  ]
  const originalVideos = canonicalVideos.map((video) => ({ ...video }))
  const localizedGroups = localizeVideoGroups(groups, translations, 'zh-CN')

  const localizedVideos = localizeVideoRecords(canonicalVideos, localizedGroups)

  assert.deepEqual(
    localizedVideos.map((video) => video.group_name),
    ['课程', 'Agents', null, null],
  )
  assert.deepEqual(canonicalVideos, originalVideos)
  assert.notEqual(localizedVideos[0], canonicalVideos[0])
})

test('repairVideoGroupSelection keeps valid and special selections and repairs invalid numeric ids', () => {
  const validGroupIds = [1, 2, 3]

  assert.equal(repairVideoGroupSelection(2, validGroupIds, 'all'), 2)
  assert.equal(repairVideoGroupSelection(99, validGroupIds, 'all'), 'all')
  assert.equal(repairVideoGroupSelection('all', validGroupIds, 'all'), 'all')
  assert.equal(repairVideoGroupSelection(null, validGroupIds, 'all'), null)
  assert.equal(repairVideoGroupSelection(99, validGroupIds, null), null)
  assert.equal(repairVideoGroupSelection(null, validGroupIds, null), null)
})

test('translation drafts use only exact rows and keep missing current locale blank', () => {
  assert.deepEqual(
    getVideoGroupTranslationDraft(
      groups[0],
      [
        { group_id: 1, locale: 'en-US', translation: 'Courses translated' },
        { group_id: 2, locale: 'zh-CN', translation: '其他分组' },
      ],
      [{ code: 'zh-CN' }, { code: 'en-US' }, { code: 'ja-JP' }],
    ),
    {
      'zh-CN': '',
      'en-US': 'Courses translated',
      'ja-JP': '',
    },
  )
})

test('tree construction orders siblings and produces translated depths and paths', () => {
  const sortableGroups: VideoGroupRecord[] = [
    ...groups,
    { id: 5, name: 'Zeta', parent_id: null, sort_order: 1 },
    { id: 6, name: 'Alpha', parent_id: null, sort_order: 1 },
  ]
  const tree = buildVideoGroupTree(sortableGroups, translations, 'zh-CN')

  assert.deepEqual(tree.map((node) => node.id), [1, 6, 5, 4])
  assert.deepEqual(tree[0].children.map((node) => node.id), [2])
  assert.deepEqual(tree[0].children[0].children.map((node) => node.id), [3])
  assert.deepEqual(
    flattenVisibleVideoGroupTree(tree, new Set([1, 2])).map(({ id, depth, path }) => ({
      id,
      depth,
      path,
    })),
    [
      { id: 1, depth: 0, path: '课程' },
      { id: 2, depth: 1, path: '课程 / 人工智能' },
      { id: 3, depth: 2, path: '课程 / 人工智能 / Agents' },
      { id: 6, depth: 0, path: 'Alpha' },
      { id: 5, depth: 0, path: 'Zeta' },
      { id: 4, depth: 0, path: 'Music' },
    ],
  )
})

test('tree construction sorts translated sibling names with the app locale', () => {
  const localizedGroups: VideoGroupRecord[] = [
    { id: 1, name: 'First', parent_id: null, sort_order: 1 },
    { id: 2, name: 'Second', parent_id: null, sort_order: 1 },
  ]
  const localizedTranslations: VideoGroupTranslation[] = [
    { group_id: 1, locale: 'zh-CN', translation: '阿' },
    { group_id: 2, locale: 'zh-CN', translation: '中' },
  ]

  assert.deepEqual(
    buildVideoGroupTree(localizedGroups, localizedTranslations, 'zh-CN').map((node) => node.id),
    [1, 2],
  )
})

test('tree flattening keeps roots visible and hides descendants below collapsed ancestors', () => {
  const tree = buildVideoGroupTree(groups, translations, 'zh-CN')

  assert.deepEqual(flattenVisibleVideoGroupTree(tree, new Set()).map((row) => row.id), [1, 4])
  assert.deepEqual(flattenVisibleVideoGroupTree(tree, new Set([1])).map((row) => row.id), [1, 2, 4])
})

test('tree keyboard navigation moves through visible rows and respects boundaries', () => {
  const rows = flattenVisibleVideoGroupTree(
    buildVideoGroupTree(groups, translations, 'zh-CN'),
    new Set([1, 2]),
  )

  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, new Set([1, 2]), 1, 'ArrowDown'), {
    type: 'focus',
    groupId: 2,
  })
  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, new Set([1, 2]), 1, 'ArrowUp'), {
    type: 'none',
  })
  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, new Set([1, 2]), 2, 'Home'), {
    type: 'focus',
    groupId: 1,
  })
  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, new Set([1, 2]), 2, 'End'), {
    type: 'focus',
    groupId: 4,
  })
})

test('tree keyboard navigation expands, collapses, enters children, returns to parents, and selects', () => {
  const tree = buildVideoGroupTree(groups, translations, 'zh-CN')
  const expanded = new Set([1, 2])
  const rows = flattenVisibleVideoGroupTree(tree, expanded)
  const collapsedRows = flattenVisibleVideoGroupTree(tree, new Set())

  assert.deepEqual(getVideoGroupTreeKeyboardAction(collapsedRows, new Set(), 1, 'ArrowRight'), {
    type: 'expand',
    groupId: 1,
  })
  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, expanded, 1, 'ArrowRight'), {
    type: 'focus',
    groupId: 2,
  })
  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, expanded, 1, 'ArrowLeft'), {
    type: 'collapse',
    groupId: 1,
  })
  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, expanded, 3, 'ArrowLeft'), {
    type: 'focus',
    groupId: 2,
  })
  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, expanded, 3, 'Enter'), {
    type: 'select',
    groupId: 3,
  })
  assert.deepEqual(getVideoGroupTreeKeyboardAction(rows, expanded, 3, ' '), {
    type: 'select',
    groupId: 3,
  })
})

test('roving tree focus keeps current focus before falling back to active, first, or null', () => {
  assert.equal(resolveVideoGroupRovingFocusId([1, 2, 3], 2, 1), 2)
  assert.equal(resolveVideoGroupRovingFocusId([1, 2, 3], 9, 1), 1)
  assert.equal(resolveVideoGroupRovingFocusId([2, 3], 9, 'all'), 2)
  assert.equal(resolveVideoGroupRovingFocusId([], 2, 1), null)
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

test('tree construction and flattening handle a 5,000-node hierarchy without overflowing', () => {
  const nodeCount = 5_000
  const deepGroups: VideoGroupRecord[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: index + 1,
    name: 'G',
    parent_id: index === 0 ? null : index,
    sort_order: 1,
  }))
  const expectedIds = deepGroups.map((group) => group.id)
  const originalLastGroup = { ...deepGroups[nodeCount - 1] }

  const tree = buildVideoGroupTree(deepGroups, [], 'en-US')
  const rows = flattenVisibleVideoGroupTree(tree, new Set(expectedIds))

  assert.deepEqual(rows.map((row) => row.id), expectedIds)
  assert.deepEqual(
    { id: rows[0].id, depth: rows[0].depth, path: rows[0].path },
    { id: 1, depth: 0, path: 'G' },
  )
  assert.deepEqual(
    {
      id: rows[nodeCount - 1].id,
      depth: rows[nodeCount - 1].depth,
      path: rows[nodeCount - 1].path,
    },
    { id: nodeCount, depth: nodeCount - 1, path: `${'G / '.repeat(nodeCount - 1)}G` },
  )
  assert.deepEqual(deepGroups[nodeCount - 1], originalLastGroup)
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

test('subtree membership includes the ancestor, descendants, and remains cycle-safe', () => {
  assert.equal(isVideoGroupInSubtree(groups, 1, 1), true)
  assert.equal(isVideoGroupInSubtree(groups, 1, 3), true)
  assert.equal(isVideoGroupInSubtree(groups, 1, 4), false)
  assert.equal(
    isVideoGroupInSubtree(
      [
        { id: 1, name: 'A', parent_id: 2 },
        { id: 2, name: 'B', parent_id: 1 },
      ],
      1,
      2,
    ),
    true,
  )
})

test('collapse blocks pending hidden editors, cancels idle hidden editors, and ignores visible editors', () => {
  assert.equal(
    getVideoGroupCollapseEditorAction(
      groups,
      1,
      { mode: 'create', parentId: 2 },
      true,
    ),
    'block',
  )
  assert.equal(
    getVideoGroupCollapseEditorAction(
      groups,
      1,
      { mode: 'rename', groupId: 3 },
      false,
    ),
    'cancel',
  )
  assert.equal(
    getVideoGroupCollapseEditorAction(
      groups,
      1,
      { mode: 'rename', groupId: 1 },
      true,
    ),
    'none',
  )
  assert.equal(
    getVideoGroupCollapseEditorAction(
      groups,
      1,
      { mode: 'create', parentId: 4 },
      true,
    ),
    'none',
  )
})

test('mutation failures map to the control that should regain focus', () => {
  assert.equal(getVideoGroupMutationFailureFocusTarget('create'), 'inline')
  assert.equal(getVideoGroupMutationFailureFocusTarget('rename'), 'inline')
  assert.equal(getVideoGroupMutationFailureFocusTarget('translation'), 'translation')
  assert.equal(getVideoGroupMutationFailureFocusTarget('delete'), 'delete-cancel')
})

test('toggleExpandedVideoGroup toggles one group without mutating the current set', () => {
  const current = new Set([1, 4])
  const collapsed = toggleExpandedVideoGroup(current, 1)
  const expanded = toggleExpandedVideoGroup(current, 2)

  assert.notEqual(collapsed, current)
  assert.notEqual(expanded, current)
  assert.deepEqual([...current], [1, 4])
  assert.deepEqual([...collapsed], [4])
  assert.deepEqual([...expanded], [1, 4, 2])
})

test('expandVideoGroupWithAncestors preserves existing ids and adds root-to-parent ancestors', () => {
  const current = new Set([4])
  const expanded = expandVideoGroupWithAncestors(current, groups, 3)

  assert.notEqual(expanded, current)
  assert.deepEqual([...current], [4])
  assert.deepEqual([...expanded], [4, 1, 2])
})

test('expandVideoGroupWithAncestors is cycle-safe', () => {
  const cyclicGroups: VideoGroupRecord[] = [
    { id: 1, name: 'A', parent_id: 2 },
    { id: 2, name: 'B', parent_id: 1 },
  ]

  assert.deepEqual([...expandVideoGroupWithAncestors(new Set([9]), cyclicGroups, 1)], [9, 2])
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

test('canonical name conflicts cannot be masked by current-locale translations', () => {
  assert.equal(
    findSiblingCanonicalNameConflict({
      groups,
      parentId: 1,
      name: ' ai ',
    })?.id,
    2,
  )
  assert.equal(
    findSiblingCanonicalNameConflict({
      groups,
      parentId: null,
      name: ' ai ',
    }),
    null,
  )
  assert.equal(
    findSiblingCanonicalNameConflict({
      groups,
      parentId: 1,
      name: 'AI',
      excludeGroupId: 2,
    }),
    null,
  )
})

test('display name conflicts are normalized, locale-aware, sibling-scoped, and excludable', () => {
  assert.equal(
    findSiblingDisplayNameConflict({
      groups,
      translations,
      parentId: 1,
      locale: 'zh-CN',
      name: ' 人工智能 ',
    })?.id,
    2,
  )
  assert.equal(
    findSiblingDisplayNameConflict({
      groups,
      translations,
      parentId: null,
      locale: 'zh-CN',
      name: '人工智能',
    }),
    null,
  )
  assert.equal(
    findSiblingDisplayNameConflict({
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

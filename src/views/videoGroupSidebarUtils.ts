import type {
  VideoGroupRecord,
  VideoGroupTranslation,
  VideoGroupTreeNode,
} from './videoTypes'

export type VideoGroupFilterId = number | null | 'all'

export type VideoGroupMutationStatement = {
  sql: string
  params?: unknown[]
}

export function normalizeVideoGroupDisplayName(value: unknown) {
  return String(value ?? '').trim()
}

export function getVideoGroupDisplayName(
  group: VideoGroupRecord,
  translations: VideoGroupTranslation[],
  locale: string,
) {
  return (
    normalizeVideoGroupDisplayName(
      translations.find(
        (translation) => translation.group_id === group.id && translation.locale === locale,
      )?.translation,
    ) || group.name
  )
}

function getCyclicVideoGroupIds(groupsById: Map<number, VideoGroupRecord>) {
  const cyclicIds = new Set<number>()

  for (const group of groupsById.values()) {
    const path: number[] = []
    const pathIndexes = new Map<number, number>()
    let current: VideoGroupRecord | undefined = group

    while (current) {
      const existingIndex = pathIndexes.get(current.id)
      if (existingIndex !== undefined) {
        for (const id of path.slice(existingIndex)) cyclicIds.add(id)
        break
      }

      pathIndexes.set(current.id, path.length)
      path.push(current.id)

      const parentId: number | null | undefined = current.parent_id
      current = parentId == null ? undefined : groupsById.get(parentId)
    }
  }

  return cyclicIds
}

function sortVideoGroupNodes(nodes: VideoGroupTreeNode[]) {
  nodes.sort(
    (left, right) =>
      (left.sort_order ?? Number.MAX_SAFE_INTEGER) -
        (right.sort_order ?? Number.MAX_SAFE_INTEGER) ||
      left.displayName.localeCompare(right.displayName),
  )

  for (const node of nodes) sortVideoGroupNodes(node.children)
}

function setVideoGroupNodePaths(
  nodes: VideoGroupTreeNode[],
  depth: number,
  parentPath: string,
  visited: Set<number>,
) {
  for (const node of nodes) {
    if (visited.has(node.id)) continue
    visited.add(node.id)
    node.depth = depth
    node.path = parentPath ? `${parentPath} / ${node.displayName}` : node.displayName
    setVideoGroupNodePaths(node.children, depth + 1, node.path, visited)
  }
}

export function buildVideoGroupTree(
  groups: VideoGroupRecord[],
  translations: VideoGroupTranslation[],
  locale: string,
) {
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const cyclicIds = getCyclicVideoGroupIds(groupsById)
  const nodesById = new Map<number, VideoGroupTreeNode>()

  for (const group of groupsById.values()) {
    const displayName = getVideoGroupDisplayName(group, translations, locale)
    nodesById.set(group.id, {
      ...group,
      displayName,
      depth: 0,
      path: displayName,
      children: [],
    })
  }

  const roots: VideoGroupTreeNode[] = []
  for (const group of groupsById.values()) {
    const node = nodesById.get(group.id)
    const parent = group.parent_id == null ? undefined : nodesById.get(group.parent_id)
    if (!node) continue

    if (parent && !cyclicIds.has(group.id)) parent.children.push(node)
    else roots.push(node)
  }

  sortVideoGroupNodes(roots)
  setVideoGroupNodePaths(roots, 0, '', new Set())
  return roots
}

export function flattenVisibleVideoGroupTree(
  tree: VideoGroupTreeNode[],
  expandedIds: ReadonlySet<number>,
) {
  const rows: VideoGroupTreeNode[] = []
  const visited = new Set<number>()

  const appendVisible = (nodes: VideoGroupTreeNode[]) => {
    for (const node of nodes) {
      if (visited.has(node.id)) continue
      visited.add(node.id)
      rows.push(node)
      if (expandedIds.has(node.id)) appendVisible(node.children)
    }
  }

  appendVisible(tree)
  return rows
}

export function getVideoGroupAncestorIds(groups: VideoGroupRecord[], groupId: number) {
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const group = groupsById.get(groupId)
  if (!group) return []

  const ancestors: number[] = []
  const visited = new Set([groupId])
  let parentId = group.parent_id

  while (parentId != null && !visited.has(parentId)) {
    const parent = groupsById.get(parentId)
    if (!parent) break
    visited.add(parentId)
    ancestors.push(parentId)
    parentId = parent.parent_id
  }

  return ancestors.reverse()
}

export function getDirectVideoGroupCounts(
  videos: Array<{ group_id?: number | null }>,
) {
  const counts = new Map<number, number>()

  for (const video of videos) {
    if (video.group_id == null) continue
    counts.set(video.group_id, (counts.get(video.group_id) ?? 0) + 1)
  }

  return counts
}

export function getVideoGroupDeleteImpact(
  groups: VideoGroupRecord[],
  videos: Array<{ group_id?: number | null }>,
  groupId: number,
) {
  return {
    directVideoCount: getDirectVideoGroupCounts(videos).get(groupId) ?? 0,
    directChildCount: groups.filter((group) => group.parent_id === groupId).length,
  }
}

export function getVideoGroupIdAfterDelete(
  activeGroupId: VideoGroupFilterId,
  deletedGroupId: number,
): VideoGroupFilterId {
  return activeGroupId === deletedGroupId ? 'all' : activeGroupId
}

export function findSiblingVideoGroupNameConflict({
  groups,
  translations,
  parentId,
  locale,
  name,
  excludeGroupId,
}: {
  groups: VideoGroupRecord[]
  translations: VideoGroupTranslation[]
  parentId: number | null
  locale: string
  name: string
  excludeGroupId?: number
}) {
  const normalizedName = normalizeVideoGroupDisplayName(name).toLocaleLowerCase(locale)

  return (
    groups.find(
      (group) =>
        group.id !== excludeGroupId &&
        (group.parent_id ?? null) === parentId &&
        normalizeVideoGroupDisplayName(
          getVideoGroupDisplayName(group, translations, locale),
        ).toLocaleLowerCase(locale) === normalizedName,
    ) ?? null
  )
}

export function getContextMenuPosition({
  clientX,
  clientY,
  viewportWidth,
  viewportHeight,
  menuWidth,
  menuHeight,
  margin = 8,
}: {
  clientX: number
  clientY: number
  viewportWidth: number
  viewportHeight: number
  menuWidth: number
  menuHeight: number
  margin?: number
}) {
  return {
    left: Math.min(
      Math.max(clientX, margin),
      Math.max(margin, viewportWidth - menuWidth - margin),
    ),
    top: Math.min(
      Math.max(clientY, margin),
      Math.max(margin, viewportHeight - menuHeight - margin),
    ),
  }
}

export function getNextMenuFocusIndex(
  currentIndex: number,
  itemCount: number,
  direction: 'ArrowUp' | 'ArrowDown',
) {
  if (itemCount <= 0) return -1
  if (currentIndex < 0 || currentIndex >= itemCount) {
    return direction === 'ArrowDown' ? 0 : itemCount - 1
  }
  return direction === 'ArrowDown'
    ? (currentIndex + 1) % itemCount
    : (currentIndex - 1 + itemCount) % itemCount
}

export function buildCreateVideoGroupStatements(
  name: string,
  parentId: number | null,
  locale: string,
  sortOrder: number,
): VideoGroupMutationStatement[] {
  const normalizedName = name.trim()
  return [
    {
      sql: 'INSERT INTO video_groups (name, parent_id, sort_order) VALUES (?, ?, ?)',
      params: [normalizedName, parentId, sortOrder],
    },
    {
      sql: `INSERT INTO video_group_translations (group_id, locale, translation)
            VALUES (last_insert_rowid(), ?, ?)`,
      params: [locale, normalizedName],
    },
  ]
}

export function buildUpdateVideoGroupTranslationsStatements(
  groupId: number,
  values: Record<string, string>,
): VideoGroupMutationStatement[] {
  return Object.entries(values).map(([locale, rawValue]) => {
    const value = rawValue.trim()
    return value
      ? {
          sql: `INSERT OR REPLACE INTO video_group_translations
                (group_id, locale, translation) VALUES (?, ?, ?)`,
          params: [groupId, locale, value],
        }
      : {
          sql: 'DELETE FROM video_group_translations WHERE group_id = ? AND locale = ?',
          params: [groupId, locale],
        }
  })
}

export function buildDeleteVideoGroupStatements(
  groupId: number,
  parentId: number | null,
): VideoGroupMutationStatement[] {
  return [
    { sql: 'UPDATE videos SET group_id = NULL WHERE group_id = ?', params: [groupId] },
    {
      sql: 'UPDATE video_groups SET parent_id = ? WHERE parent_id = ?',
      params: [parentId, groupId],
    },
    { sql: 'DELETE FROM video_group_translations WHERE group_id = ?', params: [groupId] },
    { sql: 'DELETE FROM video_groups WHERE id = ?', params: [groupId] },
  ]
}

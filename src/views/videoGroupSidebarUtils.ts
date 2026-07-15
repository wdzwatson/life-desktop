import type { DbTransactionStatement } from '../../electron/db/transaction.ts'
import type {
  VideoGroupRecord,
  VideoGroupTranslation,
  VideoGroupTreeNode,
} from './videoTypes'

export type VideoGroupFilterId = number | null | 'all'

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

export function getVideoGroupTranslationDraft(
  group: VideoGroupRecord,
  translations: VideoGroupTranslation[],
  configuredLocales: Array<{ code: string }>,
) {
  return Object.fromEntries(
    configuredLocales.map(({ code }) => [
      code,
      translations.find(
        (translation) => translation.group_id === group.id && translation.locale === code,
      )?.translation ?? '',
    ]),
  )
}

function getCyclicVideoGroupIds(groupsById: Map<number, VideoGroupRecord>) {
  const cyclicIds = new Set<number>()
  const visitStates = new Map<number, 'visiting' | 'visited'>()

  for (const group of groupsById.values()) {
    if (visitStates.has(group.id)) continue

    const path: number[] = []
    const pathIndexes = new Map<number, number>()
    let current: VideoGroupRecord | undefined = group

    while (current && !visitStates.has(current.id)) {
      visitStates.set(current.id, 'visiting')
      pathIndexes.set(current.id, path.length)
      path.push(current.id)

      const parentId: number | null | undefined = current.parent_id
      current = parentId == null ? undefined : groupsById.get(parentId)
    }

    if (current && visitStates.get(current.id) === 'visiting') {
      const cycleStartIndex = pathIndexes.get(current.id)
      if (cycleStartIndex !== undefined) {
        for (let index = cycleStartIndex; index < path.length; index += 1) {
          cyclicIds.add(path[index])
        }
      }
    }

    for (const id of path) visitStates.set(id, 'visited')
  }

  return cyclicIds
}

function sortVideoGroupNodes(nodes: VideoGroupTreeNode[], collator: Intl.Collator) {
  const siblingLists = [nodes]

  while (siblingLists.length > 0) {
    const siblings = siblingLists.pop()
    if (!siblings) continue

    siblings.sort(
      (left, right) =>
        (left.sort_order ?? Number.MAX_SAFE_INTEGER) -
          (right.sort_order ?? Number.MAX_SAFE_INTEGER) ||
        collator.compare(left.displayName, right.displayName),
    )

    for (const node of siblings) siblingLists.push(node.children)
  }
}

function setVideoGroupNodePaths(nodes: VideoGroupTreeNode[]) {
  const visited = new Set<number>()
  const pending = nodes
    .map((node) => ({ node, depth: 0, parentPath: '' }))
    .reverse()

  while (pending.length > 0) {
    const item = pending.pop()
    if (!item) continue
    const { node, depth, parentPath } = item
    if (visited.has(node.id)) continue
    visited.add(node.id)
    node.depth = depth
    node.path = parentPath ? `${parentPath} / ${node.displayName}` : node.displayName

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: node.children[index], depth: depth + 1, parentPath: node.path })
    }
  }
}

function indexVideoGroupTranslations(translations: VideoGroupTranslation[]) {
  const translationsByGroupAndLocale = new Map<number, Map<string, string>>()

  for (const translation of translations) {
    const translationsByLocale =
      translationsByGroupAndLocale.get(translation.group_id) ?? new Map<string, string>()
    translationsByGroupAndLocale.set(translation.group_id, translationsByLocale)
    if (!translationsByLocale.has(translation.locale)) {
      translationsByLocale.set(translation.locale, translation.translation)
    }
  }

  return translationsByGroupAndLocale
}

export function buildVideoGroupTree(
  groups: VideoGroupRecord[],
  translations: VideoGroupTranslation[],
  locale: string,
) {
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const cyclicIds = getCyclicVideoGroupIds(groupsById)
  const nodesById = new Map<number, VideoGroupTreeNode>()
  const translationsByGroupAndLocale = indexVideoGroupTranslations(translations)
  const collator = new Intl.Collator(locale)

  for (const group of groupsById.values()) {
    const displayName =
      normalizeVideoGroupDisplayName(
        translationsByGroupAndLocale.get(group.id)?.get(locale),
      ) || group.name
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

  sortVideoGroupNodes(roots, collator)
  setVideoGroupNodePaths(roots)
  return roots
}

export function flattenVisibleVideoGroupTree(
  tree: VideoGroupTreeNode[],
  expandedIds: ReadonlySet<number>,
) {
  const rows: VideoGroupTreeNode[] = []
  const visited = new Set<number>()
  const pending = [...tree].reverse()

  while (pending.length > 0) {
    const node = pending.pop()
    if (!node || visited.has(node.id)) continue
    visited.add(node.id)
    rows.push(node)

    if (expandedIds.has(node.id)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push(node.children[index])
      }
    }
  }

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

export function toggleExpandedVideoGroup(current: Set<number>, groupId: number) {
  const next = new Set(current)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  return next
}

export function expandVideoGroupWithAncestors(
  current: Set<number>,
  groups: VideoGroupRecord[],
  groupId: number,
) {
  return new Set([...current, ...getVideoGroupAncestorIds(groups, groupId)])
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

export function findSiblingCanonicalNameConflict({
  groups,
  parentId,
  name,
  excludeGroupId,
}: {
  groups: VideoGroupRecord[]
  parentId: number | null
  name: string
  excludeGroupId?: number
}) {
  const normalizedName = normalizeVideoGroupDisplayName(name).toLowerCase()

  return (
    groups.find(
      (group) =>
        group.id !== excludeGroupId &&
        (group.parent_id ?? null) === parentId &&
        normalizeVideoGroupDisplayName(group.name).toLowerCase() === normalizedName,
    ) ?? null
  )
}

export function findSiblingDisplayNameConflict({
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
): DbTransactionStatement[] {
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
): DbTransactionStatement[] {
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
): DbTransactionStatement[] {
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

const reservedBookCategories = new Set([
  '',
  '未分类',
  'Uncategorized',
  'Category',
  '分类',
  'all',
  'uncategorized',
])

function normalizeCategoryId(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const id = String(value).trim()
  return id || null
}

function normalizeCategoryAlias(value: unknown) {
  if (typeof value !== 'string') return null
  const alias = value.trim()
  return alias || null
}

export type DbMutationStatement = {
  sql: string
  params: unknown[]
}

export function buildBookCategoryMigrationStatements(
  aliases: Iterable<string>,
  nextName: string,
): DbMutationStatement[] {
  const normalizedNextName = normalizeCategoryAlias(nextName)
  if (!normalizedNextName) return []

  const uniqueAliases = new Set<string>()
  for (const value of aliases) {
    const alias = normalizeCategoryAlias(value)
    if (alias) uniqueAliases.add(alias)
  }

  return Array.from(uniqueAliases, (alias) => ({
    sql: 'UPDATE books SET category = ? WHERE TRIM(category) = ?',
    params: [normalizedNextName, alias],
  }))
}

export function buildCategoryStorageAliasMap(
  categories: Array<{ id: string | number; name?: unknown }>,
  translations: Array<{
    entity_type?: unknown
    entity_id?: unknown
    translation?: unknown
  }>,
) {
  const aliasesByCategoryId = new Map<string, Set<string>>()
  const canonicalNames = new Set<string>()

  for (const category of categories) {
    const categoryId = normalizeCategoryId(category.id)
    if (!categoryId) continue
    const canonicalName = normalizeCategoryAlias(category.name)
    if (!canonicalName || isReservedBookCategory(canonicalName)) continue

    const aliases = aliasesByCategoryId.get(categoryId) ?? new Set<string>()
    aliasesByCategoryId.set(categoryId, aliases)
    canonicalNames.add(canonicalName)
    aliases.add(canonicalName)
  }

  const translationOwners = new Map<string, Set<string>>()
  for (const translation of translations) {
    if (translation.entity_type !== 'category') continue
    const categoryId = normalizeCategoryId(translation.entity_id)
    const alias = normalizeCategoryAlias(translation.translation)
    if (!categoryId || !alias || !aliasesByCategoryId.has(categoryId)) continue
    if (isReservedBookCategory(alias)) continue
    if (canonicalNames.has(alias)) continue

    const owners = translationOwners.get(alias) ?? new Set<string>()
    owners.add(categoryId)
    translationOwners.set(alias, owners)
  }

  for (const [alias, owners] of translationOwners) {
    if (owners.size !== 1) continue
    const [ownerId] = owners
    aliasesByCategoryId.get(ownerId)?.add(alias)
  }

  return aliasesByCategoryId
}

export function isReservedBookCategory(name?: string | null) {
  return reservedBookCategories.has(name?.trim() ?? '')
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

export function getActiveCategoryAfterDelete(
  activeCategory: string,
  deletedCategoryName: string,
) {
  return activeCategory === deletedCategoryName ? 'uncategorized' : activeCategory
}

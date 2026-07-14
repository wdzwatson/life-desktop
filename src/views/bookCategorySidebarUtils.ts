const reservedBookCategories = new Set([
  '',
  '未分类',
  'Uncategorized',
  'Category',
  '分类',
])

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

export type GlobalSearchModule = 'tasks' | 'notes' | 'books' | 'videos'

export type GlobalSearchState = 'idle' | 'loading' | 'ready' | 'empty' | 'partial-error' | 'error'

export type GlobalSearchResult = {
  id: string | number
  module: GlobalSearchModule | 'command'
  type: string
  title: string
  description?: string
  matchedField?: string
  snippet?: string
  score?: number
  updatedAt?: string
  action: () => void
}

export function getGlobalSearchOptionId(index: number) {
  return `global-search-option-${index}`
}

export function getNextGlobalSearchIndex(currentIndex: number, key: string, resultCount: number) {
  if (resultCount <= 0) return -1
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % resultCount
  if (key === 'ArrowUp') return currentIndex < 0 ? resultCount - 1 : (currentIndex - 1 + resultCount) % resultCount
  if (key === 'Home') return 0
  if (key === 'End') return resultCount - 1
  return currentIndex
}

export type GlobalSearchOpenEvent = {
  name: `lifeos:open-${GlobalSearchModule}`
  detail: Record<string, string | number>
}

export function getGlobalSearchOpenEvent(
  module: GlobalSearchModule,
  id: string | number,
): GlobalSearchOpenEvent {
  const detailKey = {
    tasks: 'taskId',
    notes: 'noteId',
    books: 'bookId',
    videos: 'videoId',
  }[module]

  return {
    name: `lifeos:open-${module}`,
    detail: { [detailKey]: id },
  }
}

export function dispatchGlobalSearchOpen(module: GlobalSearchModule, id: string | number) {
  if (typeof window === 'undefined') return
  const event = getGlobalSearchOpenEvent(module, id)
  window.dispatchEvent(new CustomEvent(event.name, { detail: event.detail }))
}

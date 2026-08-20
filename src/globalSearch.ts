export type GlobalSearchModule = 'tasks' | 'notes' | 'books' | 'videos'

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

export type GlobalSearchModule = 'tasks' | 'notes' | 'books' | 'videos'

export type GlobalSearchCommand = { type: 'task' | 'note'; title: string }

export function parseGlobalSearchCommand(query: string): GlobalSearchCommand | null {
  const normalized = query.trim()
  const match = normalized.match(/^\/(task|note)(?:\s+(.+))?$/i)
  if (!match) return null
  return { type: match[1].toLowerCase() as 'task' | 'note', title: match[2]?.trim() || '' }
}

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
  totalCount?: number
  searchableFields?: Record<string, string | null | undefined>
  action: () => void
}

export type GlobalSearchGroup = {
  module: GlobalSearchResult['module']
  totalCount: number
  hasMore: boolean
  items: GlobalSearchResult[]
}

const SEARCH_MODULE_ORDER: GlobalSearchResult['module'][] = [
  'command',
  'tasks',
  'notes',
  'books',
  'videos',
]

function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
}

function createSearchSnippet(value: string, query: string) {
  const compact = value.replace(/\s+/g, ' ').trim()
  const index = compact.toLocaleLowerCase().indexOf(query)
  if (index < 0) return compact.slice(0, 96)
  const start = Math.max(0, index - 32)
  const end = Math.min(compact.length, index + query.length + 64)
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`
}

export function rankGlobalSearchResults(query: string, results: GlobalSearchResult[]) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return [...results]

  return results
    .map((result) => {
      const title = normalizeSearchText(result.title)
      let score = 0
      let matchedField = result.matchedField
      let snippet = result.snippet

      if (title === normalizedQuery) score = 400
      else if (title.startsWith(normalizedQuery)) score = 300
      else if (title.includes(normalizedQuery)) score = 200

      if (score > 0) {
        matchedField = result.matchedField || 'title'
        snippet = createSearchSnippet(result.title, normalizedQuery)
      } else {
        for (const [field, value] of Object.entries(result.searchableFields || {})) {
          const normalizedValue = normalizeSearchText(value)
          if (!normalizedValue.includes(normalizedQuery)) continue
          score = 100
          matchedField = field
          snippet = createSearchSnippet(String(value ?? ''), normalizedQuery)
          break
        }
      }

      return { ...result, score, matchedField, snippet }
    })
    .sort((left, right) => {
      const scoreDifference = (right.score || 0) - (left.score || 0)
      if (scoreDifference) return scoreDifference
      const updatedDifference = String(right.updatedAt || '').localeCompare(
        String(left.updatedAt || ''),
      )
      if (updatedDifference) return updatedDifference
      const moduleDifference =
        SEARCH_MODULE_ORDER.indexOf(left.module) - SEARCH_MODULE_ORDER.indexOf(right.module)
      if (moduleDifference) return moduleDifference
      const titleDifference = left.title.localeCompare(right.title)
      if (titleDifference) return titleDifference
      return String(left.id).localeCompare(String(right.id))
    })
}

export function groupGlobalSearchResults(results: GlobalSearchResult[], limitPerModule = 3) {
  return SEARCH_MODULE_ORDER.flatMap((module): GlobalSearchGroup[] => {
    const moduleResults = results.filter((result) => result.module === module)
    if (moduleResults.length === 0) return []
    const totalCount = Math.max(
      moduleResults.length,
      ...moduleResults.map((result) => result.totalCount || 0),
    )
    return [
      {
        module,
        totalCount,
        hasMore: totalCount > limitPerModule,
        items: moduleResults.slice(0, limitPerModule),
      },
    ]
  })
}

export function getGlobalSearchOptionId(index: number) {
  return `global-search-option-${index}`
}

export function getNextGlobalSearchIndex(currentIndex: number, key: string, resultCount: number) {
  if (resultCount <= 0) return -1
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % resultCount
  if (key === 'ArrowUp')
    return currentIndex < 0 ? resultCount - 1 : (currentIndex - 1 + resultCount) % resultCount
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

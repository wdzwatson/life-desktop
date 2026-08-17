export type ReaderBookDeepLink =
  | { bookId: number; target: 'book' }
  | { bookId: number; target: 'chapter'; chapter: string }
  | { bookId: number; target: 'annotation'; annotationId: string }

const decodeReaderFragment = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const parseReaderBookDeepLink = (value: unknown): ReaderBookDeepLink | null => {
  if (typeof value !== 'string' || !value.startsWith('book:')) return null
  const rawTarget = value.slice('book:'.length)
  const fragmentIndex = rawTarget.indexOf('#')
  const rawBookId = fragmentIndex >= 0 ? rawTarget.slice(0, fragmentIndex) : rawTarget
  const bookId = Number(rawBookId)
  if (!Number.isInteger(bookId) || bookId < 1) return null
  if (fragmentIndex < 0) return { bookId, target: 'book' }

  const fragment = rawTarget.slice(fragmentIndex + 1)
  if (fragment.startsWith('annotation:')) {
    const annotationId = decodeReaderFragment(fragment.slice('annotation:'.length)).trim()
    return annotationId ? { bookId, target: 'annotation', annotationId } : null
  }
  const chapter = decodeReaderFragment(fragment).trim()
  return chapter ? { bookId, target: 'chapter', chapter } : { bookId, target: 'book' }
}

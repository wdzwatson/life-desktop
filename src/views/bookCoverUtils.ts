export function getBookCoverUrl(coverPath: unknown) {
  if (typeof coverPath !== 'string') return null
  const normalizedPath = coverPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedPath.startsWith('book-covers/')) return null
  const fileName = normalizedPath.slice('book-covers/'.length)
  if (!fileName || fileName.includes('/') || fileName.includes('\0')) return null
  return `life-book-cover://cover/${encodeURIComponent(fileName)}`
}

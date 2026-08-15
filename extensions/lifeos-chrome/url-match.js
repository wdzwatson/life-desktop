export function parseHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hostname = url.hostname.toLowerCase()
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = ''
    }
    return url
  } catch {
    return null
  }
}

function normalizedPathname(url) {
  const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return pathname || '/'
}

function normalizedHref(url) {
  const copy = new URL(url.href)
  copy.pathname = normalizedPathname(copy)
  copy.searchParams.sort()
  return copy.href.replace(/#$/, '')
}

function isPathSegmentPrefix(left, right) {
  if (left === '/' || right === '/') return false
  return right.startsWith(`${left}/`) || left.startsWith(`${right}/`)
}

export function scoreTabUrlMatch(requestedValue, candidateValue) {
  const requested = parseHttpUrl(requestedValue)
  const candidate = parseHttpUrl(candidateValue)
  if (!requested || !candidate || requested.origin !== candidate.origin) return 0
  if (normalizedHref(requested) === normalizedHref(candidate)) return 100

  const requestedPath = normalizedPathname(requested)
  const candidatePath = normalizedPathname(candidate)
  if (requestedPath === candidatePath) return 90
  if (isPathSegmentPrefix(requestedPath, candidatePath)) return 70
  return 0
}

export function rankMatchingTabs(requestedUrl, tabs) {
  return tabs
    .map((tab) => ({ ...tab, matchScore: scoreTabUrlMatch(requestedUrl, tab.url || '') }))
    .filter((tab) => tab.matchScore > 0)
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore
      if (Boolean(right.active) !== Boolean(left.active)) return right.active ? 1 : -1
      return Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0)
    })
}

export function selectMatchingTab(requestedUrl, tabs, preferredTabId) {
  const ranked = rankMatchingTabs(requestedUrl, tabs)
  if (Number.isInteger(preferredTabId)) {
    const preferred = ranked.find((tab) => tab.id === preferredTabId)
    return preferred ? { kind: 'selected', tab: preferred } : { kind: 'invalid_preference', candidates: ranked }
  }
  if (ranked.length === 0) return { kind: 'none', candidates: [] }
  const tied = ranked.filter((tab) => tab.matchScore === ranked[0].matchScore)
  if (tied.length > 1) return { kind: 'ambiguous', candidates: tied }
  return { kind: 'selected', tab: ranked[0] }
}

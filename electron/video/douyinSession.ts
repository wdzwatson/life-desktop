export interface DouyinCookie {
  domain?: string
  name: string
  value?: string
}

export interface DouyinAuthSummary {
  loggedIn: boolean
  cookieCount: number
}

const DOUYIN_LOGIN_COOKIE_NAMES = new Set(['sessionid', 'sessionid_ss'])

export const DOUYIN_LOGIN_URL = 'https://www.douyin.com/'

function normalizeCookieDomain(domain: string | undefined) {
  return String(domain || '').replace(/^#HttpOnly_/, '').replace(/^\./, '').toLowerCase()
}

export function getDouyinLoginPartition(userId: string) {
  const safeUserId = String(userId || 'guest').replace(/[^a-zA-Z0-9_.-]/g, '_')
  return `persist:lifeos-douyin-${safeUserId || 'guest'}`
}

export function isDouyinCookieDomain(domain: string | undefined) {
  const normalized = normalizeCookieDomain(domain)
  return normalized === 'douyin.com' || normalized.endsWith('.douyin.com')
}

export function hasDouyinLoginCookie(cookies: DouyinCookie[]) {
  return cookies.some(
    (cookie) =>
      isDouyinCookieDomain(cookie.domain) &&
      DOUYIN_LOGIN_COOKIE_NAMES.has(String(cookie.name || '').toLowerCase()) &&
      Boolean(cookie.value),
  )
}

export function summarizeDouyinAuth(cookies: DouyinCookie[]): DouyinAuthSummary {
  return {
    loggedIn: hasDouyinLoginCookie(cookies),
    cookieCount: cookies.filter((cookie) => isDouyinCookieDomain(cookie.domain)).length,
  }
}

import type { WebContents } from 'electron'
import { DouyinTimeoutError } from './douyinSyncTimeout'

export interface DouyinFavoriteVideoEntry {
  remoteId: string
  title: string
  sourceUrl: string
  authorName?: string
  thumbnailUrl?: string
}

export interface DouyinFavoriteVideoPage {
  entries: DouyinFavoriteVideoEntry[]
  cursor?: string
  hasMore: boolean
  isNewestFirst?: boolean
}

export interface DouyinOfficialPageExecutor {
  isLoggedIn(): Promise<boolean>
  listFavoriteVideos(input: { cursor?: string }): Promise<DouyinFavoriteVideoPage>
}

export interface DouyinOfficialPageDiagnostic {
  kind: 'page_loading' | 'page_ready' | 'page_failed' | 'triggering' | 'timeout'
  path?: string
  status?: number
}

interface FavoriteVideoDomResult {
  entries: DouyinFavoriteVideoEntry[]
  hasMore: boolean
  complete: boolean
  stopReason: 'explicit_end' | 'round_limit' | 'stalled' | 'source_uncertain'
}

const PAGE_ACTION_TIMEOUT_MS = 35_000
const SCROLL_ROUNDS_PER_PAGE = 24
const SCROLL_SETTLE_MS = 700

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isDouyinVideoUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      (url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com')) &&
      /^\/video\/\d+$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

function normalizeFavoriteVideoDomResult(value: unknown): FavoriteVideoDomResult {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const entries = Array.isArray(source.entries) ? source.entries : []
  const explicitEnd = source.stopReason === 'explicit_end'
  const complete = explicitEnd && source.complete !== false
  const hasMore = source.hasMore === true && !complete
  const unique = new Set<string>()
  return {
    entries: entries.flatMap((value) => {
      const entry =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {}
      const remoteId = text(entry.remoteId)
      const title = text(entry.title)
      const sourceUrl = text(entry.sourceUrl)
      if (!remoteId || !title || !isDouyinVideoUrl(sourceUrl) || unique.has(remoteId)) return []
      unique.add(remoteId)
      return [
        {
          remoteId,
          title,
          sourceUrl,
          ...(text(entry.authorName) ? { authorName: text(entry.authorName) } : {}),
          ...(text(entry.thumbnailUrl) ? { thumbnailUrl: text(entry.thumbnailUrl) } : {}),
        },
      ]
    }),
    hasMore,
    complete,
    stopReason:
      explicitEnd ||
      source.stopReason === 'round_limit' ||
      source.stopReason === 'stalled' ||
      source.stopReason === 'source_uncertain'
        ? source.stopReason
        : hasMore
          ? 'round_limit'
          : 'source_uncertain',
  }
}

/** Reads the visible favorites video list from Douyin's own authenticated page. */
export class DouyinOfficialPageObserver implements DouyinOfficialPageExecutor {
  private readonly favoriteVideoIds = new Set<string>()
  private favoriteVideoPage = 0

  constructor(
    private readonly page: WebContents,
    private readonly onDiagnostic?: (event: DouyinOfficialPageDiagnostic) => void,
    private readonly timeouts: { actionMs?: number } = {},
  ) {}

  notifyPageReady() {
    this.onDiagnostic?.({ kind: 'page_ready' })
  }

  async start() {
    // The DOM reader does not depend on DevTools network interception. Avoid attaching a
    // debugger here because that can prevent a page from finishing initialization on some hosts.
  }

  stop() {
    this.favoriteVideoIds.clear()
    this.favoriteVideoPage = 0
  }

  async isLoggedIn() {
    const loggedOut = await this.withTimeout(
      this.page.executeJavaScript(`
        (() => {
          const pageText = document.body?.innerText || ''
          return pageText.includes('未登录') || pageText.includes('登录后')
        })()
      `),
      'Douyin official page did not complete the login check.',
    )
    return !loggedOut
  }

  async listFavoriteVideos({ cursor }: { cursor?: string }) {
    if (!cursor) {
      this.favoriteVideoIds.clear()
      this.favoriteVideoPage = 0
    }
    this.onDiagnostic?.({ kind: 'triggering', path: '/user/self/favorites/videos' })
    const result = normalizeFavoriteVideoDomResult(
      await this.withTimeout(
        this.page.executeJavaScript(`
          (async () => {
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const waitFor = async (read, timeoutMs) => {
              const startedAt = Date.now()
              while (Date.now() - startedAt < timeoutMs) {
                const value = read()
                if (value) return value
                await delay(250)
              }
              return null
            }
            const exactTab = (label) => Array.from(document.querySelectorAll('[role="tab"]'))
              .find((element) => element.textContent?.trim() === label)
            const activate = async (label) => {
              const tab = await waitFor(() => exactTab(label), 4000)
              if (!tab) throw new Error('Douyin did not expose the ' + label + ' tab.')
              if (tab.getAttribute('aria-selected') !== 'true') {
                tab.click()
              }
              await delay(1000)
              return tab
            }
            if (${cursor ? 'false' : 'true'}) {
              await activate('收藏')
              await activate('视频')
              const resetScroll = (node) => {
                if (!node) return
                node.scrollTo({ top: 0, behavior: 'auto' })
              }
              Array.from(document.querySelectorAll('ul')).forEach((node) => resetScroll(node.parentElement))
              resetScroll(document.scrollingElement || document.documentElement)
            }
            const favoriteList = () => {
              const lists = Array.from(document.querySelectorAll('ul'))
              const findVideoLinks = (list) => Array.from(list.querySelectorAll('a[href]')).filter((anchor) => {
                const rawHref = anchor.getAttribute('href') || ''
                const url = new URL(rawHref, location.href)
                return /^\\/(video|note)\\/\\d+$/.test(url.pathname) && anchor.getClientRects().length > 0
              })
              return lists
                .map((list) => ({ list, count: findVideoLinks(list).length }))
                .sort((left, right) => right.count - left.count)[0]?.list || document.body
            }
            const getScrollTargets = (list) => {
              const targets = []
              let node = list?.parentElement || null
              while (node && node !== document.body) {
                const style = getComputedStyle(node)
                if (node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(style.overflowY)) {
                  targets.push(node)
                }
                node = node.parentElement
              }
              const root = document.scrollingElement || document.documentElement
              if (!targets.includes(root)) targets.push(root)
              return targets
            }
            const readEntries = (list) => {
              const root = list || document
              return Array.from(root.querySelectorAll('a[href]')).filter((anchor) => {
                const rawHref = anchor.getAttribute('href') || ''
                const url = new URL(rawHref, location.href)
                return /^\\/video\\/\\d+$/.test(url.pathname) && anchor.getClientRects().length > 0
              }).flatMap((anchor) => {
              const rawHref = anchor.getAttribute('href') || ''
              const url = new URL(rawHref, location.href)
              const match = url.pathname.match(/^\\/video\\/(\\d+)$/)
              if (!match || !url.hostname.endsWith('douyin.com')) return []
              const imageLabel = anchor.querySelector('img')?.getAttribute('alt')?.trim() || ''
              const image = anchor.querySelector('img')
              const thumbnailUrl = [
                image?.getAttribute('data-original'),
                image?.getAttribute('data-src'),
                image?.getAttribute('src'),
                image?.currentSrc,
              ].find((value) => /^https?:\\/\\//.test(value || '')) || ''
              const title = anchor.querySelector('p')?.textContent?.trim() || imageLabel.split('：').slice(1).join('：').trim() || 'Douyin video ' + match[1]
              const authorName = imageLabel.includes('：') ? imageLabel.split('：')[0].trim() : ''
              return [{ remoteId: match[1], title, sourceUrl: 'https://www.douyin.com/video/' + match[1], ...(authorName ? { authorName } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}) }]
              })
            }
            const listText = (list) => list?.parentElement?.textContent || ''
            const listReady = await waitFor(() => {
              const list = favoriteList()
              const text = listText(list)
              return Boolean(list && readEntries(list).length > 0) || text.includes('暂时没有更多') || text.includes('暂无收藏')
            }, 20000)
            if (!listReady) throw new Error('Douyin favorite video cards did not appear after the page loaded.')
            const collected = new Map()
            let explicitEnd = false
            let observedScrollProgress = false
            for (let round = 0; round < ${SCROLL_ROUNDS_PER_PAGE}; round += 1) {
              const list = favoriteList()
              const scrollTargets = getScrollTargets(list)
              const beforeCount = collected.size
              const beforeScrollState = new Map(scrollTargets.map((target) => [target, {
                top: target.scrollTop,
                height: target.scrollHeight,
              }]))
              readEntries(list).forEach((entry) => collected.set(entry.remoteId, entry))
              for (const scrollTarget of scrollTargets) {
                const step = Math.max(400, Math.floor(scrollTarget.clientHeight * 0.85))
                scrollTarget.scrollBy({ top: step, behavior: 'auto' })
              }
              await delay(${SCROLL_SETTLE_MS})
              const nextList = favoriteList()
              const nextScrollTargets = getScrollTargets(nextList)
              readEntries(nextList).forEach((entry) => collected.set(entry.remoteId, entry))
              const text = listText(nextList)
              explicitEnd = text.includes('暂时没有更多了')
              const moved = nextScrollTargets.some((target) => {
                const before = beforeScrollState.get(target)
                return !before || target.scrollTop !== before.top || target.scrollHeight !== before.height
              })
              const addedEntries = collected.size > beforeCount
              if (addedEntries || moved) observedScrollProgress = true
              if (explicitEnd) break
            }
            const text = listText(favoriteList())
            explicitEnd = explicitEnd || text.includes('暂时没有更多了')
            const stalled = !observedScrollProgress
            return {
              entries: [...collected.values()],
              hasMore: !explicitEnd && !stalled,
              complete: explicitEnd,
              stopReason: explicitEnd ? 'explicit_end' : stalled ? 'stalled' : 'round_limit',
            }
          })()
        `),
        'Douyin did not load the visible favorite video list.',
      ),
    )
    const entries = result.entries.filter((entry) => !this.favoriteVideoIds.has(entry.remoteId))
    for (const entry of entries) this.favoriteVideoIds.add(entry.remoteId)
    this.favoriteVideoPage += 1
    const hasMore = result.hasMore
    return {
      entries,
      ...(hasMore ? { cursor: String(this.favoriteVideoPage) } : {}),
      hasMore,
      complete: result.complete,
      stopReason: result.stopReason,
      isNewestFirst: true,
    }
  }

  private async withTimeout<T>(promise: Promise<T>, message: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            this.onDiagnostic?.({ kind: 'timeout' })
            reject(new DouyinTimeoutError('page_action', message))
          }, this.timeouts.actionMs || PAGE_ACTION_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

}

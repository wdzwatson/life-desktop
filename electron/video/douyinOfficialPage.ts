import type { WebContents } from 'electron'

export interface DouyinFavoriteVideoEntry {
  remoteId: string
  title: string
  sourceUrl: string
  authorName?: string
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
}

const PAGE_ACTION_TIMEOUT_MS = 35_000

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
        },
      ]
    }),
    hasMore: source.hasMore === true,
  }
}

/** Reads the visible favorites video list from Douyin's own authenticated page. */
export class DouyinOfficialPageObserver implements DouyinOfficialPageExecutor {
  private readonly favoriteVideoIds = new Set<string>()
  private favoriteVideoPage = 0
  private emptyFavoriteVideoPages = 0

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
    this.emptyFavoriteVideoPages = 0
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
      this.emptyFavoriteVideoPages = 0
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
            await activate('收藏')
            await activate('视频')
            const cardLinks = () => Array.from(document.querySelectorAll('a[href]')).filter((anchor) => {
              const rawHref = anchor.getAttribute('href') || ''
              const url = new URL(rawHref, location.href)
              return /^\\/(video|note)\\/\\d+$/.test(url.pathname) && Boolean(anchor.closest('li')) && anchor.getClientRects().length > 0
            })
            const favoriteList = () => {
              const lists = Array.from(document.querySelectorAll('ul'))
              return lists
                .map((list) => ({ list, count: cardLinks().filter((anchor) => list.contains(anchor)).length }))
                .sort((left, right) => right.count - left.count)[0]?.list || null
            }
            const listText = () => favoriteList()?.parentElement?.textContent || ''
            const readEntries = () => cardLinks().flatMap((anchor) => {
              const rawHref = anchor.getAttribute('href') || ''
              const url = new URL(rawHref, location.href)
              const match = url.pathname.match(/^\\/video\\/(\\d+)$/)
              if (!match || !url.hostname.endsWith('douyin.com')) return []
              const imageLabel = anchor.querySelector('img')?.getAttribute('alt')?.trim() || ''
              const title = anchor.querySelector('p')?.textContent?.trim() || imageLabel.split('：').slice(1).join('：').trim() || 'Douyin video ' + match[1]
              const authorName = imageLabel.includes('：') ? imageLabel.split('：')[0].trim() : ''
              return [{ remoteId: match[1], title, sourceUrl: 'https://www.douyin.com/video/' + match[1], ...(authorName ? { authorName } : {}) }]
            })
            const listReady = await waitFor(() => {
              const text = listText()
              return cardLinks().length > 0 || text.includes('暂时没有更多') || text.includes('暂无收藏')
            }, 20000)
            if (!listReady) throw new Error('Douyin favorite video cards did not appear after the page loaded.')
            await delay(1000)
            const before = readEntries().length
            const list = favoriteList()
            const scrollTarget = (() => {
              let node = list?.parentElement || null
              while (node && node !== document.body) {
                const style = getComputedStyle(node)
                if (node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(style.overflowY)) return node
                node = node.parentElement
              }
              return document.scrollingElement || document.documentElement
            })()
            scrollTarget.scrollTo({ top: scrollTarget.scrollHeight })
            for (let elapsed = 0; elapsed < 4000; elapsed += 250) {
              await delay(250)
              const text = listText()
              if (readEntries().length > before || text.includes('暂时没有更多') || text.includes('没有更多了')) break
            }
            const text = listText()
            return {
              entries: readEntries(),
              hasMore: !text.includes('暂时没有更多') && !text.includes('没有更多了'),
            }
          })()
        `),
        'Douyin did not load the visible favorite video list.',
      ),
    )
    const entries = result.entries.filter((entry) => !this.favoriteVideoIds.has(entry.remoteId))
    for (const entry of entries) this.favoriteVideoIds.add(entry.remoteId)
    if (entries.length > 0) this.emptyFavoriteVideoPages = 0
    else this.emptyFavoriteVideoPages += 1
    this.favoriteVideoPage += 1
    const hasMore = result.hasMore && this.emptyFavoriteVideoPages < 2
    return {
      entries,
      ...(hasMore ? { cursor: String(this.favoriteVideoPage) } : {}),
      hasMore,
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
            reject(new Error(message))
          }, this.timeouts.actionMs || PAGE_ACTION_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

}

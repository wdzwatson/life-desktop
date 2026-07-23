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
  stopReason: 'explicit_end' | 'source_end' | 'round_limit' | 'stalled' | 'source_uncertain'
}

const PAGE_ACTION_TIMEOUT_MS = 35_000
const SCROLL_ROUNDS_PER_PAGE = 4
const SCROLL_SETTLE_MS = 700
const MAX_IDLE_SCROLL_ROUNDS = 2
const END_STABILITY_MS = 10_000
const END_POLL_MS = 500

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
  const sourceEnded = source.stopReason === 'explicit_end' || source.stopReason === 'source_end'
  const complete = sourceEnded && source.complete !== false
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
      sourceEnded ||
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
            const visible = (element) => {
              const rect = element.getBoundingClientRect()
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < window.innerHeight &&
                rect.left < window.innerWidth
              )
            }
            const exactTab = (label) => Array.from(document.querySelectorAll('[role="tab"]'))
              .find((element) => visible(element) && element.textContent?.trim() === label)
            const activateTab = async (label) => {
              const tab = await waitFor(() => exactTab(label), 10_000)
              if (!tab) throw new Error('Douyin did not expose the ' + label + ' tab.')
              if (tab.getAttribute('aria-selected') !== 'true') tab.click()
              const selected = await waitFor(
                () => tab.getAttribute('aria-selected') === 'true',
                10_000,
              )
              if (!selected) throw new Error('Douyin did not activate the ' + label + ' tab.')
              return tab
            }
            const videoContentRoot = () => {
              const videoTab = exactTab('视频')
              const controlsId = videoTab?.getAttribute('aria-controls')
              const controlled = controlsId ? document.getElementById(controlsId) : null
              if (controlled && visible(controlled)) return controlled
              const tabId = videoTab?.id
              const labelledPanel = tabId
                ? document.querySelector('[role="tabpanel"][aria-labelledby="' + CSS.escape(tabId) + '"]')
                : null
              if (labelledPanel && visible(labelledPanel)) return labelledPanel
              return document
            }
            const favoriteList = () => {
              const contentRoot = videoContentRoot()
              const lists = Array.from(contentRoot.querySelectorAll('ul'))
              const findVideoLinks = (list) => Array.from(list.querySelectorAll('a[href]')).filter((anchor) => {
                const rawHref = anchor.getAttribute('href') || ''
                const url = new URL(rawHref, location.href)
                return /^\\/video\\/\\d+$/.test(url.pathname) && visible(anchor)
              })
              return lists
                .map((list) => ({ list, count: findVideoLinks(list).length }))
                .sort((left, right) => right.count - left.count)[0]?.list || contentRoot
            }
            const readEntries = (list) => {
              const root = list || document
              return Array.from(root.querySelectorAll('a[href]')).filter((anchor) => {
                const rawHref = anchor.getAttribute('href') || ''
                const url = new URL(rawHref, location.href)
                return /^\\/video\\/\\d+$/.test(url.pathname) && visible(anchor)
              }).flatMap((anchor) => {
                const rawHref = anchor.getAttribute('href') || ''
                const url = new URL(rawHref, location.href)
                const match = url.pathname.match(/^\\/video\\/(\\d+)$/)
                if (!match || !url.hostname.endsWith('douyin.com')) return []
                const image = anchor.querySelector('img')
                const imageLabel = image?.getAttribute('alt')?.trim() || ''
                const thumbnailUrl = [
                  image?.getAttribute('data-original'),
                  image?.getAttribute('data-src'),
                  image?.getAttribute('src'),
                  image?.currentSrc,
                ].find((value) => /^https?:\\/\\//.test(value || '')) || ''
                const title = anchor.querySelector('p')?.textContent?.trim() ||
                  imageLabel.split('：').slice(1).join('：').trim() ||
                  'Douyin video ' + match[1]
                const authorName = imageLabel.includes('：') ? imageLabel.split('：')[0].trim() : ''
                return [{
                  remoteId: match[1],
                  title,
                  sourceUrl: 'https://www.douyin.com/video/' + match[1],
                  ...(authorName ? { authorName } : {}),
                  ...(thumbnailUrl ? { thumbnailUrl } : {}),
                }]
              })
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
            const canScrollFurther = (target) =>
              target.scrollTop + target.clientHeight < target.scrollHeight - 2
            if (!${cursor ? 'true' : 'false'}) {
              await activateTab('收藏')
              await activateTab('视频')
              for (const target of getScrollTargets(favoriteList())) {
                target.scrollTo({ top: 0, behavior: 'auto' })
              }
            }
            const listReady = await waitFor(() => {
              const list = favoriteList()
              return Boolean(list && readEntries(list).length > 0)
            }, 30000)
            if (!listReady) throw new Error('Douyin favorite video cards did not appear after the 视频 tab loaded.')

            const list = favoriteList()
            if (!${cursor ? 'true' : 'false'}) {
              return {
                entries: readEntries(list),
                hasMore: true,
                complete: false,
                stopReason: 'round_limit',
              }
            }

            const collected = new Map(readEntries(list).map((entry) => [entry.remoteId, entry]))
            let idleRounds = 0
            let reachedEnd = false
            const hasEndMarker = () =>
              (videoContentRoot().innerText || '').includes('暂时没有更多了')
            const targetHeightSignature = (targets) =>
              targets.map((target) => target.scrollHeight).join(':')
            const probeForEndOrResume = async (initialTargets) => {
              if (hasEndMarker()) {
                return { sourceEnd: true, reason: 'end_marker', waitedMs: 0, targets: initialTargets }
              }
              const startedAt = Date.now()
              const initialHeightSignature = targetHeightSignature(initialTargets)
              let latestTargets = initialTargets
              while (Date.now() - startedAt < ${END_STABILITY_MS}) {
                await delay(${END_POLL_MS})
                const observedList = favoriteList()
                for (const entry of readEntries(observedList)) collected.set(entry.remoteId, entry)
                latestTargets = getScrollTargets(observedList)
                if (hasEndMarker()) {
                  return {
                    sourceEnd: true,
                    reason: 'end_marker',
                    waitedMs: Date.now() - startedAt,
                    targets: latestTargets,
                  }
                }
                if (
                  latestTargets.some(canScrollFurther) ||
                  targetHeightSignature(latestTargets) !== initialHeightSignature
                ) {
                  return {
                    sourceEnd: false,
                    reason: 'content_changed',
                    waitedMs: Date.now() - startedAt,
                    targets: latestTargets,
                  }
                }
              }
              return {
                sourceEnd: true,
                reason: 'height_stable_10s',
                waitedMs: Date.now() - startedAt,
                targets: latestTargets,
              }
            }
            for (let round = 0; round < ${SCROLL_ROUNDS_PER_PAGE}; round += 1) {
              const currentList = favoriteList()
              const targets = getScrollTargets(currentList)
              const before = targets.map((target) => ({
                target,
                top: target.scrollTop,
                height: target.scrollHeight,
              }))
              const scrollableTargets = targets.filter(canScrollFurther)
              if (scrollableTargets.length === 0) {
                const endProbe = await probeForEndOrResume(targets)
                if (endProbe.sourceEnd) {
                  reachedEnd = true
                  break
                }
                continue
              }
              for (const target of scrollableTargets) {
                const step = Math.max(400, Math.floor(target.clientHeight * 0.85))
                target.scrollBy({ top: step, behavior: 'auto' })
              }
              await delay(${SCROLL_SETTLE_MS})
              const nextList = favoriteList()
              for (const entry of readEntries(nextList)) collected.set(entry.remoteId, entry)
              const moved = before.some(({ target, top, height }) =>
                target.scrollTop !== top || target.scrollHeight !== height,
              )
              if (moved) idleRounds = 0
              else idleRounds += 1
              const nextTargets = getScrollTargets(nextList)
              const atBottom = nextTargets.every((target) => !canScrollFurther(target))
              const endProbe = atBottom ? await probeForEndOrResume(nextTargets) : null
              if (endProbe?.sourceEnd) {
                reachedEnd = true
                break
              }
              if (idleRounds >= ${MAX_IDLE_SCROLL_ROUNDS}) break
            }
            return {
              entries: [...collected.values()],
              hasMore: !reachedEnd && idleRounds < ${MAX_IDLE_SCROLL_ROUNDS},
              complete: reachedEnd,
              stopReason: reachedEnd
                ? 'source_end'
                : idleRounds >= ${MAX_IDLE_SCROLL_ROUNDS}
                  ? 'stalled'
                  : 'round_limit',
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

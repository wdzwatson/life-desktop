import {
  DouyinFavoritesError,
  type DouyinAccountProfile,
  type DouyinFavoriteFolderInput,
  type DouyinFavoriteItemInput,
  type DouyinFavoritesClient,
  type DouyinPage,
} from './douyinFavorites'
import type { DouyinOfficialPageExecutor, DouyinOfficialPageResponse } from './douyinOfficialPage'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((entry) => Object.keys(entry).length > 0) : []
}

function firstText(...values: unknown[]) {
  return values.map(text).find(Boolean) || ''
}

function firstArray(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const entries = records(body[key])
    if (entries.length > 0) return entries
  }
  return []
}

export function getDouyinResponseError(response: DouyinOfficialPageResponse) {
  const body = record(response.body)
  const message = firstText(body.status_msg, body.message, body.msg, `Douyin returned HTTP ${response.status}.`)
  const lower = message.toLowerCase()
  if (response.status === 401 || /登录已过期|未登录|not logged in|login required|session expired/.test(lower)) {
    return new DouyinFavoritesError('auth_required', 'Douyin login has expired. Please sign in again.')
  }
  if (/captcha|verify|验证|风控|challenge/.test(lower)) {
    return new DouyinFavoritesError('challenge_required', 'Douyin requires verification in the official web page.')
  }
  if (response.status === 429 || /rate|频繁|too many/.test(lower)) {
    return new DouyinFavoritesError('rate_limited', 'Douyin temporarily limited synchronization. Try again later.')
  }
  return new DouyinFavoritesError(
    'unsupported',
    'Douyin did not expose readable favorites data in its official page. Your login is still saved; reopen Douyin only if it asks you to verify it.',
  )
}

async function requestDouyinPage(
  page: DouyinOfficialPageExecutor,
  pathname: string,
  params: Record<string, string | undefined> = {},
) {
  const response = await page.request(pathname, params)
  if (!response.ok || !response.body) throw getDouyinResponseError(response)
  const body = record(response.body)
  const statusCode = number(body.status_code)
  if (statusCode !== undefined && statusCode !== 0) throw getDouyinResponseError(response)
  return body
}

export function normalizeDouyinAccountProfile(body: Record<string, unknown>): DouyinAccountProfile {
  const user = record(body.user || body.user_info || body.data)
  return {
    ...(firstText(user.sec_uid, user.sec_user_id, user.uid, user.unique_id)
      ? { remoteUserId: firstText(user.sec_uid, user.sec_user_id, user.uid, user.unique_id) }
      : {}),
    ...(firstText(user.nickname, user.name) ? { displayName: firstText(user.nickname, user.name) } : {}),
  }
}

export function normalizeDouyinFolderPage(body: Record<string, unknown>): DouyinPage<DouyinFavoriteFolderInput> {
  const entries = firstArray(body, ['collects_list', 'collection_list', 'list']).map((entry) => ({
    remoteId: firstText(entry.collects_id, entry.collection_id, entry.id),
    title: firstText(entry.collects_name, entry.collection_name, entry.title, entry.name),
    ...(number(entry.aweme_count ?? entry.item_count ?? entry.count) !== undefined
      ? { itemCount: number(entry.aweme_count ?? entry.item_count ?? entry.count) }
      : {}),
  }))
  return {
    entries,
    ...(firstText(body.cursor, body.next_cursor) ? { cursor: firstText(body.cursor, body.next_cursor) } : {}),
    hasMore: body.has_more === true || body.has_more === 1 || body.has_more === '1',
  }
}

function toDurationSeconds(value: unknown) {
  const duration = number(value)
  if (duration === undefined) return undefined
  return duration > 1000 ? Math.round(duration / 1000) : Math.round(duration)
}

function toCollectedAt(value: unknown) {
  const seconds = number(value)
  if (seconds === undefined || seconds <= 0) return undefined
  return new Date(seconds * 1000).toISOString()
}

export function normalizeDouyinFolderItemPage(body: Record<string, unknown>): DouyinPage<DouyinFavoriteItemInput> {
  const entries = firstArray(body, ['aweme_list', 'item_list', 'list']).map((entry) => {
    const author = record(entry.author)
    const video = record(entry.video)
    const cover = record(video.cover)
    const urlList = Array.isArray(cover.url_list) ? cover.url_list : []
    const remoteId = firstText(entry.aweme_id, entry.id)
    return {
      remoteId,
      title: firstText(entry.desc, record(entry.share_info).share_desc, `Douyin video ${remoteId}`),
      sourceUrl: `https://www.douyin.com/video/${remoteId}`,
      ...(firstText(author.uid, author.sec_uid) ? { authorId: firstText(author.uid, author.sec_uid) } : {}),
      ...(firstText(author.nickname) ? { authorName: firstText(author.nickname) } : {}),
      ...(text(urlList[0]) ? { thumbnailUrl: text(urlList[0]) } : {}),
      ...(toDurationSeconds(video.duration) !== undefined ? { durationSeconds: toDurationSeconds(video.duration) } : {}),
      ...(toCollectedAt(entry.create_time) ? { collectedAt: toCollectedAt(entry.create_time) } : {}),
    }
  })
  return {
    entries,
    ...(firstText(body.cursor, body.next_cursor) ? { cursor: firstText(body.cursor, body.next_cursor) } : {}),
    hasMore: body.has_more === true || body.has_more === 1 || body.has_more === '1',
  }
}

export function createDouyinWebFavoritesClient(page: DouyinOfficialPageExecutor): DouyinFavoritesClient {
  return {
    async getAccountProfile() {
      if (!(await page.isLoggedIn())) {
        throw new DouyinFavoritesError('auth_required', 'Douyin login has expired. Please sign in again.')
      }
      return {}
    },
    async listFolders({ cursor }) {
      return normalizeDouyinFolderPage(
        await requestDouyinPage(page, '/aweme/v1/web/collects/list/', { count: '20', cursor }),
      )
    },
    async listFolderItems({ folderRemoteId, cursor }) {
      return normalizeDouyinFolderItemPage(
        await requestDouyinPage(page, '/aweme/v1/web/collects/video/list/', {
          collects_id: folderRemoteId,
          count: '20',
          cursor,
        }),
      )
    },
  }
}

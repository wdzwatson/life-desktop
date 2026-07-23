import type Database from 'better-sqlite3'

export type DouyinSyncErrorCode =
  | 'auth_required'
  | 'challenge_required'
  | 'rate_limited'
  | 'unsupported'
  | 'network_error'
  | 'invalid_response'
  | 'unknown'

export class DouyinFavoritesError extends Error {
  readonly code: DouyinSyncErrorCode

  constructor(code: DouyinSyncErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface DouyinAccountProfile {
  remoteUserId?: string
  displayName?: string
}

export interface DouyinAccountSyncState {
  ever_sync_finished: number
}

export interface DouyinFavoriteFolderInput {
  remoteId: string
  title: string
  itemCount?: number
}

export type DouyinFavoriteContentType = 'video' | 'note' | 'article' | 'unknown'

export interface DouyinFavoriteItemInput {
  remoteId: string
  title: string
  contentType?: DouyinFavoriteContentType
  authorId?: string
  authorName?: string
  sourceUrl: string
  thumbnailUrl?: string
  durationSeconds?: number
  collectedAt?: string
  favoriteAddedAt?: string
}

export interface DouyinPage<T> {
  entries: T[]
  cursor?: string
  hasMore: boolean
  isNewestFirst?: boolean
  complete?: boolean
  stopReason?: string
}

export interface DouyinFavoritesClient {
  getAccountProfile(): Promise<DouyinAccountProfile>
  listFolders(input: { cursor?: string }): Promise<DouyinPage<DouyinFavoriteFolderInput>>
  listFolderItems(input: {
    folderRemoteId: string
    cursor?: string
  }): Promise<DouyinPage<DouyinFavoriteItemInput>>
}

export interface DouyinSyncResult {
  success: boolean
  complete: boolean
  accountId?: number
  foldersSynced: number
  itemsSynced: number
  partialFolders?: number
  failedFolders?: number
  stopReasons?: string[]
  incrementalFolders?: number
  fullFolders?: number
  error?: { code: DouyinSyncErrorCode; message: string }
}

export type DouyinSyncPhase =
  | 'starting'
  | 'checking_login'
  | 'loading_folders'
  | 'writing_folders'
  | 'loading_items'
  | 'writing_items'
  | 'completed'
  | 'failed'

export interface DouyinSyncProgress {
  phase: DouyinSyncPhase
  startedAt: number
  foldersDiscovered: number
  foldersCompleted: number
  itemsSynced: number
  pagesLoaded: number
  currentFolderTitle?: string
}

export interface DouyinFavoriteFolderRecord {
  id: number
  remote_id: string
  title: string
  item_count: number
  sync_status: string
  last_sync_at: string | null
  incremental_capability: 'unknown' | 'available' | 'unavailable'
  last_incremental_added_at: string | null
  last_incremental_remote_id: string | null
  diagnostic_message: string | null
  last_sync_complete: number
  last_sync_stop_reason: string | null
}

export interface DouyinFavoriteItemRecord {
  id: number
  remote_id: string
  title: string
  content_type: DouyinFavoriteContentType
  author_id: string | null
  author_name: string | null
  source_url: string
  thumbnail_url: string | null
  duration_seconds: number | null
  collected_at: string | null
  favorite_added_at: string | null
  position: number
  download_status: 'not_downloaded' | 'downloading' | 'downloaded' | 'failed'
  download_progress: number
  local_path: string | null
  download_error: string | null
}

export interface DouyinFavoriteItemsPage {
  items: DouyinFavoriteItemRecord[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined
}

function isDouyinWebUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'douyin.com' || host.endsWith('.douyin.com')
  } catch {
    return false
  }
}

function contentType(value: unknown, sourceUrl: string): DouyinFavoriteContentType {
  if (value === 'video' || value === 'note' || value === 'article' || value === 'unknown') return value
  try {
    const path = new URL(sourceUrl).pathname
    if (/^\/note\/\d+$/.test(path)) return 'note'
    if (/^\/article\/\d+$/.test(path)) return 'article'
  } catch {
    // The URL itself is validated by the caller.
  }
  return 'video'
}

export function sanitizeDouyinDiagnostic(value: unknown) {
  return text(value)
    .replace(/(sessionid(?:_ss)?|cookie|token|authorization)\s*[=:]\s*[^\s;,]+/gi, '$1=[REDACTED]')
    .slice(0, 500)
}

export function normalizeDouyinFolder(input: DouyinFavoriteFolderInput): DouyinFavoriteFolderInput {
  const remoteId = text(input.remoteId)
  const title = text(input.title)
  if (!remoteId || !title)
    throw new DouyinFavoritesError(
      'invalid_response',
      'A favorite folder is missing its ID or title.',
    )
  return {
    remoteId,
    title,
    ...(positiveInteger(input.itemCount) !== undefined
      ? { itemCount: positiveInteger(input.itemCount) }
      : {}),
  }
}

export function normalizeDouyinFavoriteItem(
  input: DouyinFavoriteItemInput,
): DouyinFavoriteItemInput {
  const remoteId = text(input.remoteId)
  const title = text(input.title)
  const sourceUrl = text(input.sourceUrl)
  if (!remoteId || !title || !isDouyinWebUrl(sourceUrl)) {
    throw new DouyinFavoritesError(
      'invalid_response',
      'A favorite video has incomplete or invalid metadata.',
    )
  }
  const durationSeconds = positiveInteger(input.durationSeconds)
  return {
    remoteId,
    title,
    sourceUrl,
    contentType: contentType(input.contentType, sourceUrl),
    ...(text(input.authorId) ? { authorId: text(input.authorId) } : {}),
    ...(text(input.authorName) ? { authorName: text(input.authorName) } : {}),
    ...(text(input.thumbnailUrl) ? { thumbnailUrl: text(input.thumbnailUrl) } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(text(input.collectedAt) ? { collectedAt: text(input.collectedAt) } : {}),
    ...(text(input.favoriteAddedAt) ? { favoriteAddedAt: text(input.favoriteAddedAt) } : {}),
  }
}

function toSyncError(error: unknown) {
  if (error instanceof DouyinFavoritesError) return error
  if (error instanceof Error)
    return new DouyinFavoritesError(
      'unknown',
      sanitizeDouyinDiagnostic(error.message) || 'Sync failed.',
    )
  return new DouyinFavoritesError('unknown', 'Sync failed.')
}

function upsertAccount(
  db: Database.Database,
  input: {
    sessionPartition: string
    profile: DouyinAccountProfile
    authStatus: string
    diagnosticMessage?: string
  },
) {
  const existing = db
    .prepare('SELECT id FROM douyin_accounts WHERE session_partition = ?')
    .get(input.sessionPartition) as { id: number } | undefined
  if (existing) {
    db.prepare(
      `
      UPDATE douyin_accounts
      SET remote_user_id = COALESCE(?, remote_user_id),
          display_name = COALESCE(?, display_name),
          auth_status = ?,
          diagnostic_message = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
    ).run(
      text(input.profile.remoteUserId) || null,
      text(input.profile.displayName) || null,
      input.authStatus,
      input.diagnosticMessage || null,
      existing.id,
    )
    return existing.id
  }
  return Number(
    db
      .prepare(
        `
        INSERT INTO douyin_accounts (remote_user_id, display_name, session_partition, auth_status, diagnostic_message)
        VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        text(input.profile.remoteUserId) || null,
        text(input.profile.displayName) || null,
        input.sessionPartition,
        input.authStatus,
        input.diagnosticMessage || null,
      ).lastInsertRowid,
  )
}

function upsertFolder(db: Database.Database, accountId: number, folder: DouyinFavoriteFolderInput) {
  db.prepare(
    `
    INSERT INTO douyin_favorite_folders (account_id, remote_id, title, item_count, sync_status, diagnostic_message)
    VALUES (?, ?, ?, ?, 'syncing', NULL)
    ON CONFLICT(account_id, remote_id) DO UPDATE SET
      title = excluded.title,
      item_count = excluded.item_count,
      sync_status = 'syncing',
      diagnostic_message = NULL,
      updated_at = CURRENT_TIMESTAMP
    `,
  ).run(accountId, folder.remoteId, folder.title, folder.itemCount ?? 0)
  return Number(
    (
      db
        .prepare('SELECT id FROM douyin_favorite_folders WHERE account_id = ? AND remote_id = ?')
        .get(accountId, folder.remoteId) as { id: number }
    ).id,
  )
}

function upsertItem(
  db: Database.Database,
  accountId: number,
  item: DouyinFavoriteItemInput,
  lastSeenAt: string,
) {
  db.prepare(
    `
    INSERT INTO douyin_favorite_items (
      account_id, remote_id, title, content_type, author_id, author_name, source_url, thumbnail_url,
      duration_seconds, collected_at, favorite_added_at, availability, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
    ON CONFLICT(account_id, remote_id) DO UPDATE SET
      title = excluded.title,
      content_type = excluded.content_type,
      author_id = excluded.author_id,
      author_name = excluded.author_name,
      source_url = excluded.source_url,
      thumbnail_url = excluded.thumbnail_url,
      duration_seconds = excluded.duration_seconds,
      collected_at = COALESCE(excluded.collected_at, douyin_favorite_items.collected_at),
      favorite_added_at = COALESCE(excluded.favorite_added_at, douyin_favorite_items.favorite_added_at),
      availability = 'available',
      last_seen_at = excluded.last_seen_at,
      updated_at = CURRENT_TIMESTAMP
    `,
  ).run(
    accountId,
    item.remoteId,
    item.title,
    item.contentType || 'video',
    item.authorId || null,
    item.authorName || null,
    item.sourceUrl,
    item.thumbnailUrl || null,
    item.durationSeconds ?? null,
    item.collectedAt || null,
    item.favoriteAddedAt || null,
    lastSeenAt,
  )
  return Number(
    (
      db
        .prepare('SELECT id FROM douyin_favorite_items WHERE account_id = ? AND remote_id = ?')
        .get(accountId, item.remoteId) as { id: number }
    ).id,
  )
}

function upsertFolderItem(
  db: Database.Database,
  input: { folderId: number; itemId: number; position: number; lastSeenAt: string },
) {
  db.prepare(
    `
    INSERT INTO douyin_folder_items (folder_id, item_id, position, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(folder_id, item_id) DO UPDATE SET
      position = excluded.position,
      last_seen_at = excluded.last_seen_at
    `,
  ).run(input.folderId, input.itemId, input.position, input.lastSeenAt)
}

function updateFolderSuccess(db: Database.Database, folderId: number) {
  db.prepare(
    `
    UPDATE douyin_favorite_folders
    SET sync_status = 'synced', last_sync_at = CURRENT_TIMESTAMP, diagnostic_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
  ).run(folderId)
}

function updateFolderSyncState(
  db: Database.Database,
  folderId: number,
  complete: boolean,
  stopReason: string | null,
) {
  db.prepare(
    `
    UPDATE douyin_favorite_folders
    SET item_count = (SELECT COUNT(*) FROM douyin_folder_items WHERE folder_id = ?),
        last_sync_complete = ?, last_sync_stop_reason = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
  ).run(folderId, complete ? 1 : 0, stopReason, folderId)
}

function getAccountSyncState(db: Database.Database, accountId: number): DouyinAccountSyncState {
  return db
    .prepare('SELECT ever_sync_finished FROM douyin_accounts WHERE id = ?')
    .get(accountId) as DouyinAccountSyncState
}

function setAccountEverSyncFinished(db: Database.Database, accountId: number, value: boolean) {
  db.prepare(
    'UPDATE douyin_accounts SET ever_sync_finished = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(value ? 1 : 0, accountId)
}

function countAccountFavoriteItems(db: Database.Database, accountId: number) {
  return Number(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM douyin_favorite_items WHERE account_id = ?')
        .get(accountId) as { count: number }
    ).count,
  )
}

function favoriteItemAlreadyExists(db: Database.Database, accountId: number, remoteId: string) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM douyin_favorite_items WHERE account_id = ? AND remote_id = ?')
      .get(accountId, remoteId),
  )
}

function updateFolderFailure(db: Database.Database, folderId: number, error: DouyinFavoritesError) {
  db.prepare(
    `
    UPDATE douyin_favorite_folders
    SET sync_status = 'failed', diagnostic_message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
  ).run(sanitizeDouyinDiagnostic(error.message), folderId)
}

interface DouyinFolderIncrementalState {
  incremental_capability: 'unknown' | 'available' | 'unavailable'
  last_incremental_added_at: string | null
  last_incremental_remote_id: string | null
}

function getFolderIncrementalState(
  db: Database.Database,
  folderId: number,
): DouyinFolderIncrementalState {
  return db
    .prepare(
      `
      SELECT incremental_capability, last_incremental_added_at, last_incremental_remote_id
      FROM douyin_favorite_folders WHERE id = ?
      `,
    )
    .get(folderId) as DouyinFolderIncrementalState
}

function updateFolderIncrementalState(
  db: Database.Database,
  folderId: number,
  state: DouyinFolderIncrementalState,
) {
  db.prepare(
    `
    UPDATE douyin_favorite_folders
    SET incremental_capability = ?, last_incremental_added_at = ?, last_incremental_remote_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
  ).run(
    state.incremental_capability,
    state.last_incremental_added_at,
    state.last_incremental_remote_id,
    folderId,
  )
}

function canUseIncrementalSync(state: DouyinFolderIncrementalState, mode: 'auto' | 'full') {
  return (
    mode === 'auto' &&
    state.incremental_capability === 'available' &&
    Boolean(state.last_incremental_added_at)
  )
}

function canVerifyIncrementalOrder(page: DouyinPage<DouyinFavoriteItemInput>) {
  return (
    Boolean(page.isNewestFirst) &&
    page.entries.length > 0 &&
    page.entries.every((entry) => text(entry.favoriteAddedAt))
  )
}

function updateLatestWatermark(
  current: { addedAt: string | null; remoteId: string | null },
  entries: DouyinFavoriteItemInput[],
) {
  for (const entry of entries) {
    const addedAt = text(entry.favoriteAddedAt)
    if (!addedAt) continue
    if (current.addedAt && current.addedAt > addedAt) continue
    if (current.addedAt === addedAt && String(current.remoteId || '') >= entry.remoteId) continue
    current.addedAt = addedAt
    current.remoteId = entry.remoteId
  }
}

export async function syncDouyinFavorites(input: {
  db: Database.Database
  sessionPartition: string
  client: DouyinFavoritesClient
  mode?: 'auto' | 'full'
  onProgress?: (progress: DouyinSyncProgress) => void
}): Promise<DouyinSyncResult> {
  let accountId: number | undefined
  let foldersSynced = 0
  let itemsSynced = 0
  let incrementalFolders = 0
  let fullFolders = 0
  let partialFolders = 0
  let syncComplete = true
  const stopReasons = new Set<string>()
  let foldersCompleted = 0
  let pagesLoaded = 0
  let failedFolders = 0
  let lastFolderError: unknown
  const startedAt = Date.now()
  const report = (phase: DouyinSyncPhase, currentFolderTitle?: string) => {
    input.onProgress?.({
      phase,
      startedAt,
      foldersDiscovered: foldersSynced,
      foldersCompleted,
      itemsSynced,
      pagesLoaded,
      ...(currentFolderTitle ? { currentFolderTitle } : {}),
    })
  }
  try {
    report('starting')
    accountId = upsertAccount(input.db, {
      sessionPartition: input.sessionPartition,
      profile: {},
      authStatus: 'syncing',
    })
    const everSyncFinished = getAccountSyncState(input.db, accountId).ever_sync_finished === 1
    let observedExplicitEnd = false
    report('checking_login')
    const profile = await input.client.getAccountProfile()
    accountId = upsertAccount(input.db, {
      sessionPartition: input.sessionPartition,
      profile,
      authStatus: 'syncing',
    })
    let cursor: string | undefined
    const folders = new Map<string, { folder: DouyinFavoriteFolderInput; folderId: number }>()
    for (;;) {
      report('loading_folders')
      const page = await input.client.listFolders({ cursor })
      if (!Array.isArray(page.entries))
        throw new DouyinFavoritesError('invalid_response', 'Favorite folder response is invalid.')
      input.db.transaction(() => {
        for (const entry of page.entries) {
          const folder = normalizeDouyinFolder(entry)
          const alreadyKnown = folders.has(folder.remoteId)
          folders.set(folder.remoteId, {
            folder,
            folderId: upsertFolder(input.db, accountId!, folder),
          })
          if (!alreadyKnown) foldersSynced += 1
        }
      })()
      pagesLoaded += 1
      report('writing_folders')
      if (!page.hasMore) break
      if (!text(page.cursor))
        throw new DouyinFavoritesError(
          'invalid_response',
          'Favorite folder pagination is missing a cursor.',
        )
      cursor = text(page.cursor)
    }

    for (const { folder, folderId } of folders.values()) {
      try {
        let itemCursor: string | undefined
        let position = 0
        const previousIncrementalState = getFolderIncrementalState(input.db, folderId)
        const useIncremental = canUseIncrementalSync(previousIncrementalState, input.mode || 'auto')
        const nextIncrementalState: DouyinFolderIncrementalState = {
          ...previousIncrementalState,
          ...(useIncremental
            ? {}
            : { last_incremental_added_at: null, last_incremental_remote_id: null }),
        }
        const newestSeen = {
          addedAt: previousIncrementalState.last_incremental_added_at,
          remoteId: previousIncrementalState.last_incremental_remote_id,
        }
        let observedItemPage = false
        let verifiedOrdering = true
        let folderComplete = false
        let folderStopReason: string | null = null
        for (;;) {
          report('loading_items', folder.title)
          const page = await input.client.listFolderItems({
            folderRemoteId: folder.remoteId,
            cursor: itemCursor,
          })
          if (!Array.isArray(page.entries))
            throw new DouyinFavoritesError(
              'invalid_response',
              'Favorite video response is invalid.',
            )
          const newItemsOnPage = page.entries.filter(
            (entry) => !favoriteItemAlreadyExists(input.db, accountId!, entry.remoteId),
          ).length
          const pageHasVerifiableOrder = canVerifyIncrementalOrder(page)
          if (page.entries.length > 0) {
            observedItemPage = true
            if (!pageHasVerifiableOrder) verifiedOrdering = false
          }
          if (pageHasVerifiableOrder) updateLatestWatermark(newestSeen, page.entries)
          const lastSeenAt = new Date().toISOString()
          input.db.transaction(() => {
            for (const entry of page.entries) {
              const item = normalizeDouyinFavoriteItem(entry)
              const itemId = upsertItem(input.db, accountId!, item, lastSeenAt)
              upsertFolderItem(input.db, { folderId, itemId, position, lastSeenAt })
              position += 1
            }
          })()
          itemsSynced += newItemsOnPage
          pagesLoaded += 1
          report('writing_items', folder.title)
          // A page without local additions means the visible favorite list has reached
          // already synchronized history. Do not stop on individual known items: a page
          // can legitimately contain both old and newly favorited videos.
          if (page.entries.length > 0 && newItemsOnPage === 0) {
            folderComplete = true
            folderStopReason = 'known_items_page'
            break
          }
          if (!page.hasMore) {
            folderComplete = page.complete !== false
            folderStopReason =
              page.stopReason || (folderComplete ? 'source_end' : 'source_uncertain')
            if (folderStopReason === 'explicit_end' || folderStopReason === 'source_end') {
              observedExplicitEnd = true
            }
            break
          }
          if (!text(page.cursor))
            throw new DouyinFavoritesError(
              'invalid_response',
              'Favorite video pagination is missing a cursor.',
            )
          itemCursor = text(page.cursor)
        }
        updateFolderSuccess(input.db, folderId)
        updateFolderSyncState(input.db, folderId, folderComplete, folderStopReason)
        if (!folderComplete) {
          partialFolders += 1
          syncComplete = false
          if (folderStopReason) stopReasons.add(folderStopReason)
        }
        if (observedItemPage && verifiedOrdering && newestSeen.addedAt) {
          nextIncrementalState.incremental_capability = 'available'
          nextIncrementalState.last_incremental_added_at = newestSeen.addedAt
          nextIncrementalState.last_incremental_remote_id = newestSeen.remoteId
        } else if (observedItemPage && !verifiedOrdering) {
          nextIncrementalState.incremental_capability = 'unavailable'
          nextIncrementalState.last_incremental_added_at = null
          nextIncrementalState.last_incremental_remote_id = null
        }
        updateFolderIncrementalState(input.db, folderId, nextIncrementalState)
        if (
          useIncremental && nextIncrementalState.incremental_capability === 'available'
        )
          incrementalFolders += 1
        else fullFolders += 1
        foldersCompleted += 1
        report('writing_items', folder.title)
      } catch (error) {
        failedFolders += 1
        partialFolders += 1
        syncComplete = false
        stopReasons.add('folder_failed')
        lastFolderError = error
        updateFolderFailure(input.db, folderId, toSyncError(error))
        foldersCompleted += 1
        report('writing_items', folder.title)
      }
    }

    if (folders.size > 0 && failedFolders === folders.size) {
      throw lastFolderError || new DouyinFavoritesError('unknown', 'Favorite video synchronization failed.')
    }

    input.db
      .prepare(
        `
      UPDATE douyin_accounts
      SET auth_status = 'authenticated', last_sync_at = CURRENT_TIMESTAMP, diagnostic_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      )
      .run(accountId)
    const localItemCount = countAccountFavoriteItems(input.db, accountId)
    if (localItemCount === 0) {
      setAccountEverSyncFinished(input.db, accountId, false)
    } else if (observedExplicitEnd && syncComplete) {
      setAccountEverSyncFinished(input.db, accountId, true)
    } else if (!everSyncFinished) {
      setAccountEverSyncFinished(input.db, accountId, false)
    }
    report('completed')
    return {
      success: true,
      complete: syncComplete,
      accountId,
      foldersSynced,
      itemsSynced,
      partialFolders,
      failedFolders,
      stopReasons: [...stopReasons],
      incrementalFolders,
      fullFolders,
    }
  } catch (error) {
    const syncError = toSyncError(error)
    if (accountId) {
      input.db
        .prepare(
          `
        UPDATE douyin_accounts
        SET auth_status = ?, diagnostic_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        )
        .run(
          syncError.code === 'auth_required' ? 'expired' : 'error',
          sanitizeDouyinDiagnostic(syncError.message),
          accountId,
        )
    }
    report('failed')
    return {
      success: false,
      complete: false,
      ...(accountId ? { accountId } : {}),
      foldersSynced,
      itemsSynced,
      error: {
        code: syncError.code,
        message: sanitizeDouyinDiagnostic(syncError.message) || 'Sync failed.',
      },
    }
  }
}

export function listDouyinFavoriteFolders(db: Database.Database): DouyinFavoriteFolderRecord[] {
  return db
    .prepare(
      `
      SELECT id, remote_id, title, item_count, sync_status, last_sync_at, incremental_capability,
             last_incremental_added_at, last_incremental_remote_id, last_sync_complete,
             last_sync_stop_reason, diagnostic_message
      FROM douyin_favorite_folders
      ORDER BY title COLLATE NOCASE ASC, id ASC
      `,
    )
    .all() as DouyinFavoriteFolderRecord[]
}

export function getDouyinAccountSyncStatus(
  db: Database.Database,
  sessionPartition: string,
): { everSyncFinished: boolean } {
  const row = db
    .prepare(
      `
      SELECT ever_sync_finished
      FROM douyin_accounts
      WHERE session_partition = ?
      LIMIT 1
      `,
    )
    .get(sessionPartition) as { ever_sync_finished?: number } | undefined
  return { everSyncFinished: row?.ever_sync_finished === 1 }
}

export function listDouyinFavoriteItems(
  db: Database.Database,
  folderId: number | null,
  options?: { offset?: number; limit?: number; query?: string; contentType?: DouyinFavoriteContentType },
): DouyinFavoriteItemRecord[] | DouyinFavoriteItemsPage {
  const offset = Math.max(0, Math.floor(Number(options?.offset) || 0))
  const limit = Math.min(200, Math.max(1, Math.floor(Number(options?.limit) || 100)))
  const query = typeof options?.query === 'string' ? options.query.trim() : ''
  const contentType =
    options?.contentType === 'video' || options?.contentType === 'note' || options?.contentType === 'article' || options?.contentType === 'unknown'
      ? options.contentType
      : null
  const scopedToFolder = Number.isSafeInteger(folderId) && Number(folderId) > 0
  const conditions: string[] = []
  const params: unknown[] = []
  if (scopedToFolder) {
    conditions.push('fi.folder_id = ?')
    params.push(folderId)
  }
  if (query) {
    conditions.push('(i.title LIKE ? OR i.author_name LIKE ? OR i.remote_id LIKE ?)')
    params.push(`%${query}%`, `%${query}%`, `%${query}%`)
  }
  if (contentType) {
    conditions.push('i.content_type = ?')
    params.push(contentType)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const base = scopedToFolder
    ? `FROM douyin_folder_items fi JOIN douyin_favorite_items i ON i.id = fi.item_id ${where}`
    : `FROM douyin_favorite_items i ${where}`
  const items = db
    .prepare(
      `
      SELECT i.id, i.remote_id, i.title, i.content_type, i.author_id, i.author_name, i.source_url,
             i.thumbnail_url, i.duration_seconds, i.collected_at, i.favorite_added_at,
             ${scopedToFolder ? 'fi.position' : '0 AS position'},
             i.download_status, i.download_progress, i.local_path, i.download_error
      ${base}
      ORDER BY i.favorite_added_at DESC, i.collected_at DESC,
               ${
                 scopedToFolder
                   ? 'fi.position ASC'
                   : 'COALESCE((SELECT MIN(position) FROM douyin_folder_items WHERE item_id = i.id), 2147483647) ASC'
               },
               i.created_at DESC, i.id DESC
      LIMIT ? OFFSET ?
      `,
    )
    .all(...params, limit, offset) as DouyinFavoriteItemRecord[]
  if (!options) return items
  const total = Number(db.prepare(`SELECT COUNT(*) AS count ${base}`).get(...params).count)
  return { items, total, offset, limit, hasMore: offset + items.length < total }
}

export function getDouyinFavoriteItem(db: Database.Database, itemId: number) {
  return db
    .prepare(
      `
      SELECT id, title, content_type, source_url, duration_seconds, download_status
      FROM douyin_favorite_items
      WHERE id = ?
      `,
    )
    .get(itemId) as
    | {
        id: number
        title: string
        content_type: DouyinFavoriteContentType
        source_url: string
        duration_seconds: number | null
        download_status: 'not_downloaded' | 'downloading' | 'downloaded' | 'failed'
      }
    | undefined
}

export function canDownloadDouyinFavorite(item: { content_type: DouyinFavoriteContentType }) {
  return item.content_type === 'video'
}

export function updateDouyinFavoriteDownloadState(
  db: Database.Database,
  itemId: number,
  input: {
    status: 'not_downloaded' | 'downloading' | 'downloaded' | 'failed'
    progress?: number
    localPath?: string | null
    error?: string | null
  },
) {
  db.prepare(
    `
    UPDATE douyin_favorite_items
    SET download_status = ?, download_progress = ?, local_path = ?, download_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
  ).run(
    input.status,
    Math.max(0, Math.min(100, Number(input.progress) || 0)),
    input.localPath ?? null,
    input.error ?? null,
    itemId,
  )
}

export function deleteDouyinFavoriteItems(db: Database.Database, itemIds: number[]) {
  const ids = [...new Set(itemIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (ids.length === 0) return { deleted: 0 }
  const placeholders = ids.map(() => '?').join(', ')
  const deleteItems = db.transaction(() => {
    const existing = db
      .prepare(`SELECT id, account_id FROM douyin_favorite_items WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: number; account_id: number }>
    if (existing.length === 0) return 0
    db.prepare(`DELETE FROM douyin_folder_items WHERE item_id IN (${placeholders})`).run(...ids)
    db.prepare(`DELETE FROM douyin_favorite_items WHERE id IN (${placeholders})`).run(...ids)
    for (const accountId of new Set(existing.map((entry) => entry.account_id))) {
      if (countAccountFavoriteItems(db, accountId) === 0) setAccountEverSyncFinished(db, accountId, false)
    }
    return existing.length
  })
  return { deleted: deleteItems() }
}

export function clearDouyinFavoriteItems(db: Database.Database) {
  const clear = db.transaction(() => {
    const count = Number(db.prepare('SELECT COUNT(*) AS count FROM douyin_favorite_items').get().count)
    db.prepare('DELETE FROM douyin_folder_items').run()
    db.prepare('DELETE FROM douyin_favorite_items').run()
    db.prepare('UPDATE douyin_accounts SET ever_sync_finished = 0, updated_at = CURRENT_TIMESTAMP').run()
    return count
  })
  return { deleted: clear() }
}

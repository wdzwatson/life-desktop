import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { AIConversationService } from './conversationService'
import type { AIMediaService, AIMediaType } from './mediaService'
import { AIServiceError } from './types'

export type AICleanupScope = 'unreferenced' | 'media_type' | 'conversation' | 'capacity' | 'all_media' | 'all_ai'

export type AICleanupInput = {
  scope: AICleanupScope
  mediaType?: AIMediaType
  conversationId?: number
  maxMediaBytes?: number
}

type AssetRow = {
  id: number
  media_type: AIMediaType
  local_path: string | null
  byte_size: number | null
  status: string
  created_at: string
  last_accessed_at: string | null
}

type ScannedFile = {
  path: string
  size: number
  kind: 'managed' | 'orphan' | 'temporary'
}

export type AIStorageServiceDependencies = {
  db: Database.Database
  mediaRoot: string
  media: Pick<AIMediaService, 'deleteAsset'>
  conversations: Pick<AIConversationService, 'deleteConversation'>
  clearCredentials?: () => void
  capacityLimitBytes?: number
}

const ACTIVE_MEDIA_STATUSES = ['queued', 'generating', 'polling', 'downloading', 'processing']
const TERMINAL_MEDIA_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted']
const DEFAULT_CAPACITY_BYTES = 5 * 1024 * 1024 * 1024

function storageError(code: 'invalid_input' | 'not_found' | 'storage_error', message: string) {
  return new AIServiceError({ code, message, retryable: false })
}

function requirePositiveInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1) throw storageError('invalid_input', `Invalid ${field}.`)
  return Number(value)
}

function requireMediaType(value: unknown) {
  if (!['image', 'video', 'audio', 'file'].includes(String(value))) {
    throw storageError('invalid_input', 'Invalid media type.')
  }
  return value as AIMediaType
}

function normalizeCleanupInput(input: AICleanupInput) {
  if (!input || typeof input !== 'object') throw storageError('invalid_input', 'Invalid cleanup request.')
  if (!['unreferenced', 'media_type', 'conversation', 'capacity', 'all_media', 'all_ai'].includes(input.scope)) {
    throw storageError('invalid_input', 'Invalid cleanup scope.')
  }
  return {
    scope: input.scope,
    ...(input.mediaType === undefined ? {} : { mediaType: requireMediaType(input.mediaType) }),
    ...(input.conversationId === undefined ? {} : { conversationId: requirePositiveInteger(input.conversationId, 'conversation ID') }),
    ...(input.maxMediaBytes === undefined ? {} : { maxMediaBytes: requirePositiveInteger(input.maxMediaBytes, 'media capacity') }),
  }
}

export class AIStorageService {
  private readonly capacityLimitBytes: number

  constructor(private readonly dependencies: AIStorageServiceDependencies) {
    this.capacityLimitBytes = dependencies.capacityLimitBytes ?? DEFAULT_CAPACITY_BYTES
    dependencies.db.pragma('foreign_keys = ON')
  }

  async getUsage() {
    const databaseBytes = Number(this.dependencies.db.pragma('page_count', { simple: true }))
      * Number(this.dependencies.db.pragma('page_size', { simple: true }))
    const mediaRows = this.dependencies.db.prepare(`
      SELECT media_type, COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes
      FROM ai_media_assets GROUP BY media_type ORDER BY media_type
    `).all() as Array<{ media_type: AIMediaType; count: number; bytes: number }>
    const counts = this.dependencies.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM ai_conversations) AS conversations,
        (SELECT COUNT(*) FROM ai_messages) AS messages,
        (SELECT COUNT(*) FROM ai_runs) AS runs,
        (SELECT COUNT(*) FROM ai_runs WHERE status IN ('queued', 'running', 'waiting_for_tool', 'waiting_for_approval')) AS active_runs,
        (SELECT COUNT(*) FROM ai_media_assets) AS media,
        (SELECT COUNT(*) FROM ai_media_assets WHERE status IN ('queued', 'generating', 'polling', 'downloading', 'processing')) AS active_media,
        (SELECT COUNT(*) FROM ai_media_assets WHERE status IN ('generating', 'polling', 'downloading', 'processing') AND provider_task_id IS NOT NULL) AS recoverable_media,
        (SELECT schema_version FROM ai_schema_meta WHERE id = 1) AS schema_version
    `).get() as Record<string, number>
    const scanned = await this.scanFiles()
    const managedBytes = scanned.filter((file) => file.kind === 'managed').reduce((sum, file) => sum + file.size, 0)
    const orphanBytes = scanned.filter((file) => file.kind === 'orphan').reduce((sum, file) => sum + file.size, 0)
    const temporaryBytes = scanned.filter((file) => file.kind === 'temporary').reduce((sum, file) => sum + file.size, 0)
    const referenced = Number((this.dependencies.db.prepare(`
      SELECT COUNT(*) AS count FROM ai_media_assets a WHERE ${this.referenceExistsSql('a')}
    `).get() as { count: number }).count)
    const latestImage = this.dependencies.db.prepare(`
      SELECT id FROM ai_media_assets
      WHERE media_type = 'image' AND status = 'completed' AND local_path IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).get() as { id: number } | undefined
    return {
      schemaVersion: counts.schema_version,
      databaseBytes,
      mediaBytes: managedBytes,
      orphanBytes,
      temporaryBytes,
      totalBytes: databaseBytes + managedBytes + orphanBytes + temporaryBytes,
      capacityLimitBytes: this.capacityLimitBytes,
      conversationCount: counts.conversations,
      messageCount: counts.messages,
      runCount: counts.runs,
      activeRunCount: counts.active_runs,
      mediaCount: counts.media,
      activeMediaCount: counts.active_media,
      recoverableMediaCount: counts.recoverable_media,
      referencedMediaCount: referenced,
      unreferencedMediaCount: Math.max(0, counts.media - referenced),
      orphanFileCount: scanned.filter((file) => file.kind === 'orphan').length,
      temporaryFileCount: scanned.filter((file) => file.kind === 'temporary').length,
      latestImageAssetId: latestImage?.id ?? null,
      byType: mediaRows.map((row) => ({ mediaType: row.media_type, count: row.count, bytes: row.bytes })),
    }
  }

  async previewCleanup(inputValue: AICleanupInput) {
    const input = normalizeCleanupInput(inputValue)
    const usage = await this.getUsage()
    const assets = this.selectAssets(input, usage.mediaBytes)
    const scanned = await this.scanFiles()
    const orphanFiles = ['unreferenced', 'capacity', 'all_media', 'all_ai'].includes(input.scope)
      ? scanned.filter((file) => file.kind !== 'managed')
      : []
    const referencedAssetCount = assets.filter((asset) => this.hasReference(asset.id)).length
    const activeAssetCount = assets.filter((asset) => ACTIVE_MEDIA_STATUSES.includes(asset.status)).length
    const activeConversationRunCount = input.scope === 'conversation'
      ? Number((this.dependencies.db.prepare(`
          SELECT COUNT(*) AS count FROM ai_runs
          WHERE conversation_id = ? AND status IN ('queued', 'running', 'waiting_for_tool', 'waiting_for_approval')
        `).get(input.conversationId) as { count: number }).count)
      : 0
    const conversationCount = input.scope === 'all_ai'
      ? usage.conversationCount
      : input.scope === 'conversation' ? 1 : 0
    const bytes = assets.reduce((sum, asset) => sum + (asset.byte_size ?? 0), 0)
      + orphanFiles.reduce((sum, file) => sum + file.size, 0)
    const blockedReason = activeAssetCount > 0
      || activeConversationRunCount > 0
      || (input.scope === 'all_ai' && usage.activeRunCount > 0)
      ? 'active_tasks'
      : null
    const scannedByPath = new Map(scanned.map((file) => [path.resolve(file.path), file]))
    const assetStates = assets.map((asset) => {
      const scannedFile = asset.local_path
        ? scannedByPath.get(path.resolve(this.dependencies.mediaRoot, asset.local_path))
        : undefined
      return {
        id: asset.id,
        byteSize: asset.byte_size,
        fileSize: scannedFile?.size ?? null,
        status: asset.status,
      }
    })
    const orphanStates = orphanFiles
      .map((file) => ({
        path: path.relative(this.dependencies.mediaRoot, file.path),
        size: file.size,
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
    const planPayload = {
      input,
      assetIds: assets.map((asset) => asset.id),
      orphanPaths: orphanStates.map((file) => file.path),
      conversationCount,
      blockedReason,
    }
    const planState = { ...planPayload, assetStates, orphanStates }
    return {
      ...planPayload,
      planHash: crypto.createHash('sha256').update(JSON.stringify(planState)).digest('hex'),
      assetCount: assets.length,
      referencedAssetCount,
      activeAssetCount,
      activeConversationRunCount,
      orphanFileCount: orphanFiles.length,
      bytes,
      estimatedRemainingMediaBytes: Math.max(0, usage.mediaBytes + usage.orphanBytes + usage.temporaryBytes - bytes),
    }
  }

  async cleanup(inputValue: AICleanupInput & { planHash: string }) {
    if (typeof inputValue.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(inputValue.planHash)) {
      throw storageError('invalid_input', 'Cleanup preview confirmation is required.')
    }
    const preview = await this.previewCleanup(inputValue)
    if (preview.planHash !== inputValue.planHash) {
      throw storageError('invalid_input', 'AI storage changed after the cleanup preview. Review the impact again.')
    }
    if (preview.blockedReason) throw storageError('invalid_input', 'Stop active AI tasks before cleaning this data.')

    if (preview.input.scope === 'conversation') {
      this.dependencies.conversations.deleteConversation(preview.input.conversationId as number)
    }
    const deletedAssetIds: number[] = []
    for (const assetId of preview.assetIds) {
      await this.dependencies.media.deleteAsset(assetId)
      deletedAssetIds.push(assetId)
    }
    const deletedOrphanPaths: string[] = []
    for (const relativePath of preview.orphanPaths) {
      await this.deleteOrphanPath(relativePath)
      deletedOrphanPaths.push(relativePath)
    }
    if (preview.input.scope === 'all_ai') {
      this.dependencies.db.transaction(() => {
        this.dependencies.db.prepare('DELETE FROM ai_conversations').run()
        this.dependencies.db.prepare('DELETE FROM ai_agent_mcp_links').run()
        this.dependencies.db.prepare('DELETE FROM ai_agents').run()
        this.dependencies.db.prepare('DELETE FROM ai_mcp_servers').run()
        this.dependencies.db.prepare('DELETE FROM ai_providers').run()
      })()
      this.dependencies.clearCredentials?.()
    }
    return {
      cleaned: true,
      scope: preview.input.scope,
      deletedAssetIds,
      deletedOrphanPaths,
      deletedConversationCount: preview.conversationCount,
      freedBytes: preview.bytes,
      usage: await this.getUsage(),
    }
  }

  async enforceCapacity(maxMediaBytes = this.capacityLimitBytes) {
    const preview = await this.previewCleanup({ scope: 'capacity', maxMediaBytes })
    if (preview.assetCount === 0 && preview.orphanFileCount === 0) return { cleaned: false, preview }
    return this.cleanup({ scope: 'capacity', maxMediaBytes, planHash: preview.planHash })
  }

  private selectAssets(input: ReturnType<typeof normalizeCleanupInput>, currentMediaBytes: number) {
    if (input.scope === 'conversation') return this.conversationAssets(input.conversationId as number)
    if (input.scope === 'media_type') {
      if (!input.mediaType) throw storageError('invalid_input', 'A media type is required for this cleanup.')
      return this.dependencies.db.prepare(`
        SELECT id, media_type, local_path, byte_size, status, created_at, last_accessed_at
        FROM ai_media_assets WHERE media_type = ? ORDER BY id
      `).all(input.mediaType) as AssetRow[]
    }
    if (input.scope === 'all_media' || input.scope === 'all_ai') {
      return this.dependencies.db.prepare(`
        SELECT id, media_type, local_path, byte_size, status, created_at, last_accessed_at
        FROM ai_media_assets ORDER BY id
      `).all() as AssetRow[]
    }
    const unreferenced = this.dependencies.db.prepare(`
      SELECT id, media_type, local_path, byte_size, status, created_at, last_accessed_at
      FROM ai_media_assets a
      WHERE NOT (${this.referenceExistsSql('a')})
        AND status IN (${TERMINAL_MEDIA_STATUSES.map(() => '?').join(', ')})
      ORDER BY COALESCE(last_accessed_at, created_at), id
    `).all(...TERMINAL_MEDIA_STATUSES) as AssetRow[]
    if (input.scope === 'unreferenced') return unreferenced
    const maxMediaBytes = input.maxMediaBytes ?? this.capacityLimitBytes
    let remaining = currentMediaBytes
    const selected: AssetRow[] = []
    for (const asset of unreferenced) {
      if (remaining <= maxMediaBytes) break
      selected.push(asset)
      remaining -= asset.byte_size ?? 0
    }
    return selected
  }

  private conversationAssets(conversationId: number) {
    if (!this.dependencies.db.prepare('SELECT 1 FROM ai_conversations WHERE id = ?').get(conversationId)) {
      throw storageError('not_found', 'AI conversation was not found.')
    }
    const candidates = this.dependencies.db.prepare(`
      SELECT DISTINCT a.id, a.media_type, a.local_path, a.byte_size, a.status, a.created_at, a.last_accessed_at
      FROM ai_media_assets a
      WHERE a.id IN (
        SELECT p.media_asset_id FROM ai_message_parts p
        JOIN ai_messages m ON m.id = p.message_id
        WHERE m.conversation_id = ? AND p.media_asset_id IS NOT NULL
        UNION
        SELECT CAST(json_extract(p.metadata_json, '$.posterAssetId') AS INTEGER)
        FROM ai_message_parts p JOIN ai_messages m ON m.id = p.message_id
        WHERE m.conversation_id = ? AND json_extract(p.metadata_json, '$.posterAssetId') IS NOT NULL
        UNION
        SELECT tc.result_asset_id FROM ai_tool_calls tc
        JOIN ai_runs r ON r.id = tc.run_id
        WHERE r.conversation_id = ? AND tc.result_asset_id IS NOT NULL
      ) ORDER BY a.id
    `).all(conversationId, conversationId, conversationId) as AssetRow[]
    return candidates.filter((asset) => !this.hasReferenceOutsideConversation(asset.id, conversationId))
  }

  private hasReference(assetId: number) {
    return Boolean(this.dependencies.db.prepare(`
      SELECT 1 FROM ai_message_parts WHERE media_asset_id = ?
      UNION ALL
      SELECT 1 FROM ai_tool_calls WHERE result_asset_id = ?
      UNION ALL
      SELECT 1 FROM ai_message_parts
      WHERE CAST(json_extract(metadata_json, '$.posterAssetId') AS INTEGER) = ?
      LIMIT 1
    `).get(assetId, assetId, assetId))
  }

  private hasReferenceOutsideConversation(assetId: number, conversationId: number) {
    return Boolean(this.dependencies.db.prepare(`
      SELECT 1 FROM ai_message_parts p JOIN ai_messages m ON m.id = p.message_id
      WHERE p.media_asset_id = ? AND m.conversation_id != ?
      UNION ALL
      SELECT 1 FROM ai_message_parts p JOIN ai_messages m ON m.id = p.message_id
      WHERE CAST(json_extract(p.metadata_json, '$.posterAssetId') AS INTEGER) = ? AND m.conversation_id != ?
      UNION ALL
      SELECT 1 FROM ai_tool_calls tc JOIN ai_runs r ON r.id = tc.run_id
      WHERE tc.result_asset_id = ? AND r.conversation_id != ?
      LIMIT 1
    `).get(assetId, conversationId, assetId, conversationId, assetId, conversationId))
  }

  private referenceExistsSql(alias: string) {
    return `EXISTS (SELECT 1 FROM ai_message_parts p WHERE p.media_asset_id = ${alias}.id)
      OR EXISTS (SELECT 1 FROM ai_tool_calls tc WHERE tc.result_asset_id = ${alias}.id)
      OR EXISTS (
        SELECT 1 FROM ai_message_parts poster
        WHERE CAST(json_extract(poster.metadata_json, '$.posterAssetId') AS INTEGER) = ${alias}.id
      )`
  }

  private async scanFiles() {
    const root = path.resolve(this.dependencies.mediaRoot)
    const registered = new Set(
      (this.dependencies.db.prepare('SELECT local_path FROM ai_media_assets WHERE local_path IS NOT NULL').all() as Array<{ local_path: string }>)
        .map((row) => path.resolve(root, row.local_path)),
    )
    if (!fs.existsSync(root)) return []
    const results: ScannedFile[] = []
    const stack = [root]
    while (stack.length > 0) {
      const current = stack.pop() as string
      const stats = await fs.promises.lstat(current)
      if (stats.isDirectory()) {
        for (const entry of await fs.promises.readdir(current)) stack.push(path.join(current, entry))
        continue
      }
      const relative = path.relative(root, current)
      const firstSegment = relative.split(path.sep)[0]
      const kind = firstSegment === '.tmp' || firstSegment === '.trash'
        ? 'temporary'
        : registered.has(path.resolve(current)) ? 'managed' : 'orphan'
      results.push({ path: current, size: stats.size, kind })
    }
    return results
  }

  private async deleteOrphanPath(relativePath: string) {
    const root = path.resolve(this.dependencies.mediaRoot)
    const target = path.resolve(root, relativePath)
    const relation = path.relative(root, target)
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
      throw storageError('invalid_input', 'Invalid orphan media path.')
    }
    await fs.promises.rm(target, { force: true })
  }
}

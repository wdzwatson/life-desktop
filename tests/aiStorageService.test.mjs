import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AIConversationService } from '../electron/ai/conversationService.ts'
import { AIMediaService } from '../electron/ai/mediaService.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIStorageService } from '../electron/ai/storageService.ts'
import { AIServiceError } from '../electron/ai/types.ts'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-ai-storage-'))
  const mediaRoot = path.join(dir, 'media')
  const db = new Database(path.join(dir, 'ai.db'))
  initializeAISchema(db)
  const conversations = new AIConversationService(db, () => new Date('2026-07-18T08:00:00.000Z'))
  const media = new AIMediaService({ db, mediaRoot, reserveBytes: 0, createId: () => `id-${Math.random()}` })
  let clearedCredentials = 0
  const storage = new AIStorageService({
    db,
    mediaRoot,
    media,
    conversations,
    clearCredentials: () => { clearedCredentials += 1 },
    capacityLimitBytes: 12,
  })
  return {
    dir,
    mediaRoot,
    db,
    conversations,
    media,
    storage,
    get clearedCredentials() { return clearedCredentials },
    close() {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

function createAsset(context, name, options = {}) {
  const relativePath = path.join(options.mediaType ?? 'image', name)
  const absolutePath = path.join(context.mediaRoot, relativePath)
  const content = Buffer.alloc(options.size ?? 5, options.fill ?? 1)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content)
  const result = context.db.prepare(`
    INSERT INTO ai_media_assets (
      media_type, mime_type, local_path, byte_size, status, created_at, updated_at, last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    options.mediaType ?? 'image',
    options.mimeType ?? 'image/png',
    relativePath,
    content.length,
    options.status ?? 'completed',
    options.createdAt ?? '2026-07-18T08:00:00.000Z',
    options.createdAt ?? '2026-07-18T08:00:00.000Z',
    options.lastAccessedAt ?? null,
  )
  return { id: Number(result.lastInsertRowid), relativePath, absolutePath, size: content.length }
}

function createConversation(context, title = 'Storage chat') {
  return context.conversations.createConversation({ title, agentSnapshot: { version: 1 } })
}

test('usage counts database, managed media, orphan files, temporary files, and poster references', async () => {
  const context = setup()
  try {
    const conversation = createConversation(context)
    const video = createAsset(context, 'video.mp4', { mediaType: 'video', mimeType: 'video/mp4', size: 7 })
    const poster = createAsset(context, 'poster.jpg', { mimeType: 'image/jpeg', size: 3 })
    context.conversations.createMessage({
      conversationId: conversation.id,
      role: 'assistant',
      parts: [{ type: 'video', assetId: video.id, mimeType: 'video/mp4', posterAssetId: poster.id }],
    })
    fs.mkdirSync(path.join(context.mediaRoot, '.tmp'), { recursive: true })
    fs.writeFileSync(path.join(context.mediaRoot, '.tmp', 'partial.part'), Buffer.alloc(2))
    fs.writeFileSync(path.join(context.mediaRoot, 'orphan.bin'), Buffer.alloc(4))

    const usage = await context.storage.getUsage()
    assert.equal(usage.conversationCount, 1)
    assert.equal(usage.messageCount, 1)
    assert.equal(usage.mediaCount, 2)
    assert.equal(usage.referencedMediaCount, 2)
    assert.equal(usage.unreferencedMediaCount, 0)
    assert.equal(usage.mediaBytes, 10)
    assert.equal(usage.orphanBytes, 4)
    assert.equal(usage.temporaryBytes, 2)
    assert.equal(usage.orphanFileCount, 1)
    assert.equal(usage.temporaryFileCount, 1)
    assert.ok(usage.databaseBytes > 0)
  } finally {
    context.close()
  }
})

test('unreferenced cleanup previews exact impact, removes orphan files, and rejects stale plans', async () => {
  const context = setup()
  try {
    const conversation = createConversation(context)
    const referenced = createAsset(context, 'referenced.png')
    const unreferenced = createAsset(context, 'unreferenced.png', { size: 6 })
    context.conversations.createMessage({
      conversationId: conversation.id,
      role: 'assistant',
      parts: [{ type: 'image', assetId: referenced.id, mimeType: 'image/png' }],
    })
    fs.writeFileSync(path.join(context.mediaRoot, 'orphan.bin'), Buffer.alloc(4))
    const preview = await context.storage.previewCleanup({ scope: 'unreferenced' })
    assert.deepEqual(preview.assetIds, [unreferenced.id])
    assert.equal(preview.orphanFileCount, 1)
    assert.equal(preview.bytes, 10)

    createAsset(context, 'changed.png')
    await assert.rejects(
      () => context.storage.cleanup({ scope: 'unreferenced', planHash: preview.planHash }),
      (error) => error instanceof AIServiceError && error.detail.code === 'invalid_input',
    )
    const refreshed = await context.storage.previewCleanup({ scope: 'unreferenced' })
    const result = await context.storage.cleanup({ scope: 'unreferenced', planHash: refreshed.planHash })
    assert.equal(result.deletedAssetIds.includes(unreferenced.id), true)
    assert.equal(fs.existsSync(unreferenced.absolutePath), false)
    assert.equal(fs.existsSync(path.join(context.mediaRoot, 'orphan.bin')), false)
    assert.equal(context.db.prepare('SELECT 1 FROM ai_media_assets WHERE id = ?').get(referenced.id) !== undefined, true)
  } finally {
    context.close()
  }
})

test('cleanup rejects a preview after a selected file changes on disk', async () => {
  const context = setup()
  try {
    const asset = createAsset(context, 'mutable.png', { size: 5 })
    const preview = await context.storage.previewCleanup({ scope: 'unreferenced' })
    fs.writeFileSync(asset.absolutePath, Buffer.alloc(8))
    await assert.rejects(
      () => context.storage.cleanup({ scope: 'unreferenced', planHash: preview.planHash }),
      (error) => error instanceof AIServiceError && error.detail.code === 'invalid_input',
    )
  } finally {
    context.close()
  }
})

test('conversation cleanup removes only media that loses every reference', async () => {
  const context = setup()
  try {
    const first = createConversation(context, 'First')
    const second = createConversation(context, 'Second')
    const shared = createAsset(context, 'shared.png')
    const unique = createAsset(context, 'unique.mp4', { mediaType: 'video', mimeType: 'video/mp4' })
    context.conversations.createMessage({ conversationId: first.id, role: 'assistant', parts: [
      { type: 'image', assetId: shared.id, mimeType: 'image/png' },
      { type: 'video', assetId: unique.id, mimeType: 'video/mp4' },
    ] })
    context.conversations.createMessage({ conversationId: second.id, role: 'assistant', parts: [
      { type: 'image', assetId: shared.id, mimeType: 'image/png' },
    ] })
    const preview = await context.storage.previewCleanup({ scope: 'conversation', conversationId: first.id })
    assert.deepEqual(preview.assetIds, [unique.id])
    const result = await context.storage.cleanup({ scope: 'conversation', conversationId: first.id, planHash: preview.planHash })
    assert.equal(result.deletedConversationCount, 1)
    assert.equal(context.db.prepare('SELECT 1 FROM ai_conversations WHERE id = ?').get(first.id), undefined)
    assert.ok(context.db.prepare('SELECT 1 FROM ai_conversations WHERE id = ?').get(second.id))
    assert.ok(context.db.prepare('SELECT 1 FROM ai_media_assets WHERE id = ?').get(shared.id))
    assert.equal(context.db.prepare('SELECT 1 FROM ai_media_assets WHERE id = ?').get(unique.id), undefined)
    assert.equal(fs.existsSync(unique.absolutePath), false)
  } finally {
    context.close()
  }
})

test('capacity cleanup removes oldest unreferenced assets until the configured limit is met', async () => {
  const context = setup()
  try {
    const oldest = createAsset(context, 'oldest.png', { size: 6, createdAt: '2026-07-18T01:00:00.000Z' })
    const newer = createAsset(context, 'newer.png', { size: 6, createdAt: '2026-07-18T02:00:00.000Z' })
    const newest = createAsset(context, 'newest.png', { size: 6, createdAt: '2026-07-18T03:00:00.000Z' })
    const preview = await context.storage.previewCleanup({ scope: 'capacity', maxMediaBytes: 12 })
    assert.deepEqual(preview.assetIds, [oldest.id])
    await context.storage.cleanup({ scope: 'capacity', maxMediaBytes: 12, planHash: preview.planHash })
    assert.equal(fs.existsSync(oldest.absolutePath), false)
    assert.equal(fs.existsSync(newer.absolutePath), true)
    assert.equal(fs.existsSync(newest.absolutePath), true)
  } finally {
    context.close()
  }
})

test('all media cleanup detaches message references while preserving conversations', async () => {
  const context = setup()
  try {
    const conversation = createConversation(context)
    const asset = createAsset(context, 'result.png')
    const message = context.conversations.createMessage({
      conversationId: conversation.id,
      role: 'assistant',
      parts: [{ type: 'image', assetId: asset.id, mimeType: 'image/png', name: 'Result' }],
    })
    const preview = await context.storage.previewCleanup({ scope: 'all_media' })
    await context.storage.cleanup({ scope: 'all_media', planHash: preview.planHash })
    assert.ok(context.db.prepare('SELECT 1 FROM ai_conversations WHERE id = ?').get(conversation.id))
    assert.equal(context.db.prepare('SELECT media_asset_id FROM ai_message_parts WHERE message_id = ?').get(message.id).media_asset_id, null)
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM ai_media_assets').get().count, 0)
  } finally {
    context.close()
  }
})

test('all AI cleanup clears configuration, conversations, media, and credential storage', async () => {
  const context = setup()
  try {
    const provider = context.db.prepare(`
      INSERT INTO ai_providers (name, protocol, base_url, capabilities_json, text_model)
      VALUES ('Provider', 'openai_compatible', 'https://api.test/v1', '["text"]', 'chat')
    `).run()
    context.db.prepare(`
      INSERT INTO ai_agents (name, text_provider_id, model_params_json, context_json, allowed_tools_json, blocked_tools_json)
      VALUES ('Agent', ?, '{}', '{}', '[]', '[]')
    `).run(provider.lastInsertRowid)
    createConversation(context)
    createAsset(context, 'result.png')
    const preview = await context.storage.previewCleanup({ scope: 'all_ai' })
    await context.storage.cleanup({ scope: 'all_ai', planHash: preview.planHash })
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM ai_providers').get().count, 0)
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM ai_agents').get().count, 0)
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM ai_conversations').get().count, 0)
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM ai_media_assets').get().count, 0)
    assert.equal(context.clearedCredentials, 1)
  } finally {
    context.close()
  }
})

test('asset deletion restores the file when the database refuses deletion', async () => {
  const context = setup()
  try {
    const asset = createAsset(context, 'protected.png')
    context.db.exec(`
      CREATE TRIGGER prevent_ai_asset_delete BEFORE DELETE ON ai_media_assets
      BEGIN SELECT RAISE(ABORT, 'blocked'); END;
    `)
    await assert.rejects(
      () => context.media.deleteAsset(asset.id),
      (error) => error instanceof AIServiceError && error.detail.code === 'storage_error',
    )
    assert.ok(context.db.prepare('SELECT 1 FROM ai_media_assets WHERE id = ?').get(asset.id))
    assert.equal(fs.existsSync(asset.absolutePath), true)
  } finally {
    context.close()
  }
})

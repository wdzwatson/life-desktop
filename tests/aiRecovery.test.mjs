import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AIConversationService } from '../electron/ai/conversationService.ts'
import { AIMediaService } from '../electron/ai/mediaService.ts'
import { AIRecoveryService } from '../electron/ai/recoveryService.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIServiceError } from '../electron/ai/types.ts'
import { AIVideoAssetService } from '../electron/ai/videoAssetService.ts'

const MP4_BYTES = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypisom', 'ascii'),
  Buffer.alloc(64),
])

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-ai-recovery-'))
  const mediaRoot = path.join(dir, 'media')
  const db = new Database(path.join(dir, 'ai.db'))
  initializeAISchema(db)
  const conversations = new AIConversationService(db, () => new Date('2026-07-18T08:00:00.000Z'))
  const providerId = Number(db.prepare(`
    INSERT INTO ai_providers (name, protocol, base_url, capabilities_json, text_model, video_model)
    VALUES ('Provider', 'xai', 'https://api.example.test/v1', '["text","video"]', 'text-1', 'video-1')
  `).run().lastInsertRowid)
  const media = new AIMediaService({
    db,
    mediaRoot,
    reserveBytes: 0,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response(MP4_BYTES, {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': String(MP4_BYTES.length) },
    }),
  })
  return {
    dir,
    mediaRoot,
    db,
    conversations,
    providerId,
    media,
    close() {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

function createRun(context, title) {
  const conversation = context.conversations.createConversation({ title, agentSnapshot: { version: 1 } })
  const user = context.conversations.createMessage({ conversationId: conversation.id, role: 'user', parts: [{ type: 'text', text: title }] })
  const assistant = context.conversations.createMessage({ conversationId: conversation.id, role: 'assistant', status: 'streaming', parts: [{ type: 'media_task', mediaType: 'video', taskId: title, status: 'polling' }] })
  const run = context.conversations.createRun({
    conversationId: conversation.id,
    triggerMessageId: user.id,
    assistantMessageId: assistant.id,
    agentSnapshot: { version: 1 },
    status: 'running',
    currentStage: 'video_generation',
  })
  return { conversation, user, assistant, run }
}

test('startup recovery interrupts text work, resumes linked video tasks, and marks unlinked media interrupted', async () => {
  const context = setup()
  try {
    const text = createRun(context, 'Text run')
    const video = createRun(context, 'Video run')
    const recoverableId = Number(context.db.prepare(`
      INSERT INTO ai_media_assets (
        provider_id, run_id, assistant_message_id, media_type, mime_type, provider_task_id, status
      ) VALUES (?, ?, ?, 'video', 'video/mp4', 'task-recover', 'polling')
    `).run(context.providerId, video.run.id, video.assistant.id).lastInsertRowid)
    const unlinkedId = Number(context.db.prepare(`
      INSERT INTO ai_media_assets (media_type, mime_type, status) VALUES ('image', 'image/png', 'downloading')
    `).run().lastInsertRowid)
    const resumed = []
    const recovery = new AIRecoveryService({
      db: context.db,
      conversations: context.conversations,
      resumeVideo: async (assetId) => {
        resumed.push(assetId)
        context.db.prepare("UPDATE ai_media_assets SET status = 'completed' WHERE id = ?").run(assetId)
        context.conversations.transitionMessage(video.assistant.id, 'completed')
        context.conversations.transitionRun(video.run.id, 'completed')
      },
      now: () => new Date('2026-07-18T09:00:00.000Z'),
    })
    const result = await recovery.recover()
    assert.deepEqual(resumed, [recoverableId])
    assert.deepEqual(result.recoveredAssetIds, [recoverableId])
    assert.deepEqual(result.interruptedAssetIds, [unlinkedId])
    assert.deepEqual(result.interruptedRunIds, [text.run.id])
    assert.equal(context.conversations.getRun(text.run.id).status, 'interrupted')
    assert.equal(context.conversations.getMessage(text.assistant.id).status, 'interrupted')
    assert.equal(context.conversations.getRun(video.run.id).status, 'completed')
    assert.equal(context.db.prepare('SELECT status FROM ai_media_assets WHERE id = ?').get(unlinkedId).status, 'interrupted')

    const repeated = await recovery.recover()
    assert.deepEqual(repeated.recoverableAssetIds, [])
    assert.deepEqual(repeated.interruptedAssetIds, [])
  } finally {
    context.close()
  }
})

test('video asset recovery reuses the saved task, downloads locally, and completes the original message and run', async () => {
  const context = setup()
  try {
    const linked = createRun(context, 'A recovered landscape')
    const assetId = Number(context.db.prepare(`
      INSERT INTO ai_media_assets (
        provider_id, run_id, assistant_message_id, media_type, mime_type, provider_task_id, status
      ) VALUES (?, ?, ?, 'video', 'video/mp4', 'task-resume', 'polling')
    `).run(context.providerId, linked.run.id, linked.assistant.id).lastInsertRowid)
    let resumedInput
    const service = new AIVideoAssetService({
      db: context.db,
      agents: { getSnapshot: () => { throw new Error('unused') } },
      providers: {
        get: () => ({ id: context.providerId, enabled: true, capabilities: ['video'], models: { video: 'video-1' }, baseUrl: 'https://api.example.test/v1', timeoutMs: 5_000 }),
        getCredentialBundle: () => ({ apiKey: 'secret', headers: {} }),
      },
      conversations: context.conversations,
      media: context.media,
      videoTasks: {
        run: async () => { throw new Error('unused') },
        resume: async (input) => {
          resumedInput = input
          return {
            assetId,
            taskId: 'task-resume',
            result: { status: 'completed', url: 'https://cdn.example.test/recovered.mp4?token=temporary', mimeType: 'video/mp4', durationSeconds: 4 },
          }
        },
      },
    })
    const result = await service.resume({ assetId })
    assert.equal(resumedInput.assetId, assetId)
    assert.equal(resumedInput.taskId, 'task-resume')
    assert.equal(result.assetId, assetId)
    assert.equal(context.conversations.getRun(linked.run.id).status, 'completed')
    assert.equal(context.conversations.getMessage(linked.assistant.id).status, 'completed')
    const parts = context.conversations.getMessage(linked.assistant.id).parts
    assert.equal(parts.filter((part) => part.type === 'video').length, 1)
    assert.doesNotMatch(JSON.stringify(parts), /cdn\.example|temporary|secret/)
    assert.equal(context.db.prepare('SELECT status FROM ai_media_assets WHERE id = ?').get(assetId).status, 'completed')
  } finally {
    context.close()
  }
})

test('video recovery resumes local post-processing without polling or downloading again', async () => {
  const context = setup()
  try {
    const linked = createRun(context, 'Resume local processing')
    const relativePath = path.join('video', 'existing.mp4')
    const filePath = path.join(context.mediaRoot, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, MP4_BYTES)
    const assetId = Number(context.db.prepare(`
      INSERT INTO ai_media_assets (
        provider_id, run_id, assistant_message_id, media_type, mime_type,
        local_path, byte_size, sha256, provider_task_id, status
      ) VALUES (?, ?, ?, 'video', 'video/mp4', ?, ?, ?, 'task-processing', 'processing')
    `).run(
      context.providerId,
      linked.run.id,
      linked.assistant.id,
      relativePath,
      MP4_BYTES.length,
      'a'.repeat(64),
    ).lastInsertRowid)
    let providerPolls = 0
    const service = new AIVideoAssetService({
      db: context.db,
      agents: { getSnapshot: () => { throw new Error('unused') } },
      providers: {
        get: () => { throw new Error('unused') },
        getCredentialBundle: () => { throw new Error('unused') },
      },
      conversations: context.conversations,
      media: context.media,
      videoTasks: {
        run: async () => { throw new Error('unused') },
        resume: async () => { providerPolls += 1; throw new Error('unused') },
      },
    })
    const result = await service.resume({ assetId })
    assert.equal(providerPolls, 0)
    assert.equal(result.assetId, assetId)
    assert.equal(context.conversations.getRun(linked.run.id).status, 'completed')
    assert.equal(context.conversations.getMessage(linked.assistant.id).status, 'completed')
    assert.equal(context.db.prepare('SELECT status FROM ai_media_assets WHERE id = ?').get(assetId).status, 'completed')
  } finally {
    context.close()
  }
})

test('pausing video recovery keeps the original message, run, and task recoverable', async () => {
  const context = setup()
  try {
    const linked = createRun(context, 'Pause recovery')
    const assetId = Number(context.db.prepare(`
      INSERT INTO ai_media_assets (
        provider_id, run_id, assistant_message_id, media_type, mime_type, provider_task_id, status
      ) VALUES (?, ?, ?, 'video', 'video/mp4', 'task-paused', 'polling')
    `).run(context.providerId, linked.run.id, linked.assistant.id).lastInsertRowid)
    const controller = new AbortController()
    controller.abort()
    const service = new AIVideoAssetService({
      db: context.db,
      agents: { getSnapshot: () => { throw new Error('unused') } },
      providers: {
        get: () => ({ id: context.providerId, enabled: true, capabilities: ['video'], models: { video: 'video-1' }, baseUrl: 'https://api.example.test/v1', timeoutMs: 5_000 }),
        getCredentialBundle: () => ({ apiKey: 'secret', headers: {} }),
      },
      conversations: context.conversations,
      media: context.media,
      videoTasks: {
        run: async () => { throw new Error('unused') },
        resume: async () => { throw new AIServiceError({ code: 'cancelled', message: 'Recovery paused.', retryable: true }) },
      },
    })
    await assert.rejects(
      () => service.resume({ assetId, signal: controller.signal }),
      (error) => error instanceof AIServiceError && error.detail.code === 'cancelled',
    )
    assert.equal(context.conversations.getRun(linked.run.id).status, 'running')
    assert.equal(context.conversations.getMessage(linked.assistant.id).status, 'streaming')
    assert.equal(context.db.prepare('SELECT status FROM ai_media_assets WHERE id = ?').get(assetId).status, 'polling')
  } finally {
    context.close()
  }
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIMediaService } from '../electron/ai/mediaService.ts'
import { AIVideoAssetService } from '../electron/ai/videoAssetService.ts'
import { AIServiceError } from '../electron/ai/types.ts'

const MP4_BYTES = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypisom', 'ascii'),
  Buffer.alloc(64),
])
const QUICKTIME_BYTES = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypqt  ', 'ascii'),
  Buffer.alloc(64),
])

class FakeConversations {
  messages = []
  runs = []
  selection = null
  messageId = 0
  runId = 0

  getConversation(id) { return { id, agentSnapshot: { chatSelection: { thinkingLevel: 'low' } } } }

  setConversationSelection(id, selection) {
    this.selection = selection
    return { id, agentSnapshot: { chatSelection: selection } }
  }

  createMessage(input) {
    const message = { id: ++this.messageId, status: input.status ?? 'completed', parts: [...(input.parts ?? [])], ...input }
    this.messages.push(message)
    return message
  }

  appendMessageParts(id, parts) {
    const message = this.messages.find((item) => item.id === id)
    message.parts.push(...parts)
    return message
  }

  transitionMessage(id, status) {
    const message = this.messages.find((item) => item.id === id)
    message.status = status
    return message
  }

  createRun(input) {
    const run = { id: ++this.runId, ...input }
    this.runs.push(run)
    return run
  }

  transitionRun(id, status, updates = {}) {
    const run = this.runs.find((item) => item.id === id)
    Object.assign(run, updates, { status })
    return run
  }
}

function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-ai-video-asset-'))
  const mediaRoot = path.join(dir, 'media')
  const db = new Database(path.join(dir, 'ai.db'))
  initializeAISchema(db)
  db.prepare(`
    INSERT INTO ai_providers (name, protocol, base_url, capabilities_json, video_model)
    VALUES ('Video', 'xai', 'https://api.example.test/v1', '["video"]', 'video-1')
  `).run()
  let sequence = 0
  const media = new AIMediaService({
    db,
    mediaRoot,
    createId: () => `video-${++sequence}`,
    reserveBytes: 0,
    now: () => new Date('2026-07-18T08:00:00.000Z'),
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response(options.remoteBytes ?? MP4_BYTES, {
      status: 200,
      headers: {
        'content-type': options.remoteMimeType ?? 'video/mp4',
        'content-length': String((options.remoteBytes ?? MP4_BYTES).length),
      },
    }),
  })
  return {
    dir,
    mediaRoot,
    db,
    media,
    close() {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

function createPendingVideo(db, status = 'downloading') {
  const result = db.prepare(`
    INSERT INTO ai_media_assets (provider_id, media_type, mime_type, provider_task_id, status)
    VALUES (1, 'video', 'video/mp4', 'task-9', ?)
  `).run(status)
  return Number(result.lastInsertRowid)
}

function agentSnapshot() {
  return {
    agentId: 1,
    name: 'Director',
    systemPrompt: '',
    toolApprovalMode: 'confirm_risky',
    maxToolCalls: 8,
    allowedTools: [],
    blockedTools: [],
    modelParams: {},
    context: { maxMessages: 20 },
    providers: {
      text: { id: 1, name: 'Text', model: 'text-1' },
      video: { id: 1, name: 'Video', model: 'video-1' },
    },
    mcpServerIds: [],
    capturedAt: '2026-07-18T08:00:00.000Z',
  }
}

test('remote video download completes the recoverable task asset without changing its ID', async () => {
  const context = setup()
  try {
    const assetId = createPendingVideo(context.db)
    const asset = await context.media.downloadRemoteToAsset({
      assetId,
      mediaType: 'video',
      url: 'https://cdn.example.test/final.mp4?token=temporary',
      declaredMimeType: 'video/mp4',
      durationSeconds: 6,
      originalName: 'generated.mp4',
    })
    assert.equal(asset.id, assetId)
    assert.equal(asset.url, `life-ai-asset://asset/${assetId}`)
    assert.equal(asset.mimeType, 'video/mp4')
    assert.equal(asset.byteSize, MP4_BYTES.length)
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    const row = context.db.prepare(`
      SELECT status, local_path, source_url_redacted, duration_seconds, byte_size, sha256
      FROM ai_media_assets WHERE id = ?
    `).get(assetId)
    assert.equal(row.status, 'completed')
    assert.equal(path.isAbsolute(row.local_path), false)
    assert.equal(row.source_url_redacted, 'https://cdn.example.test/final.mp4')
    assert.equal(row.duration_seconds, 6)
    assert.equal(row.byte_size, MP4_BYTES.length)
    assert.match(row.sha256, /^[a-f0-9]{64}$/)
    assert.equal(fs.readFileSync(path.join(context.mediaRoot, row.local_path)).equals(MP4_BYTES), true)
  } finally {
    context.close()
  }
})

test('remote video download refuses to overwrite a completed asset', async () => {
  const context = setup()
  try {
    const assetId = createPendingVideo(context.db, 'completed')
    await assert.rejects(
      () => context.media.downloadRemoteToAsset({
        assetId,
        mediaType: 'video',
        url: 'https://cdn.example.test/final.mp4',
      }),
      (error) => error instanceof AIServiceError && error.detail.code === 'invalid_input',
    )
  } finally {
    context.close()
  }
})

test('video generation stores a local video message and never exposes the provider result URL', async () => {
  const context = setup()
  const conversations = new FakeConversations()
  try {
    const assetId = createPendingVideo(context.db)
    const service = new AIVideoAssetService({
      db: context.db,
      agents: { getSnapshot: () => agentSnapshot() },
      providers: {
        get: () => ({
          id: 1,
          enabled: true,
          capabilities: ['video'],
          models: { video: 'video-1' },
          baseUrl: 'https://api.example.test/v1',
          timeoutMs: 5_000,
        }),
        getCredentialBundle: () => ({ apiKey: 'secret', headers: {} }),
      },
      conversations,
      media: context.media,
      videoTasks: {
        run: async () => ({
          assetId,
          taskId: 'task-9',
          result: { url: 'https://cdn.example.test/final.mp4?token=temporary', mimeType: 'video/mp4' },
        }),
      },
      probeDurationSeconds: async () => 7.25,
    })
    const result = await service.generate({ conversationId: 1, agentId: 1, prompt: 'A moving landscape' })
    assert.equal(result.assetId, assetId)
    assert.equal(conversations.runs[0].status, 'completed')
    assert.deepEqual(conversations.selection, {
      agentId: 1,
      thinkingLevel: 'low',
      mode: 'video',
      videoProviderId: 1,
      videoModel: 'video-1',
    })
    assert.deepEqual(conversations.runs[0].agentSnapshot.chatSelection, conversations.selection)
    const assistant = conversations.messages[1]
    assert.equal(assistant.status, 'completed')
    const videos = assistant.parts.filter((part) => part.type === 'video')
    assert.deepEqual(videos, [{
      type: 'video',
      assetId,
      mimeType: 'video/mp4',
      name: 'generated-video.mp4',
      alt: 'Generated video for: A moving landscape',
      durationSeconds: 7.25,
      posterAssetId: undefined,
    }])
    assert.doesNotMatch(JSON.stringify(assistant.parts), /cdn\.example|temporary|secret/)
    assert.equal(context.db.prepare('SELECT duration_seconds FROM ai_media_assets WHERE id = ?').get(assetId).duration_seconds, 7.25)
  } finally {
    context.close()
  }
})

test('incompatible QuickTime results retain the source and attach a derived MP4 playback asset', async () => {
  const context = setup({ remoteBytes: QUICKTIME_BYTES, remoteMimeType: 'video/quicktime' })
  const conversations = new FakeConversations()
  const convertedPath = path.join(context.dir, 'converted.mp4')
  fs.writeFileSync(convertedPath, MP4_BYTES)
  try {
    const sourceAssetId = createPendingVideo(context.db)
    let transcodeCalls = 0
    const service = new AIVideoAssetService({
      db: context.db,
      agents: { getSnapshot: () => agentSnapshot() },
      providers: {
        get: () => ({ id: 1, enabled: true, capabilities: ['video'], models: { video: 'video-1' }, baseUrl: 'https://api.example.test/v1', timeoutMs: 5_000 }),
        getCredentialBundle: () => ({ apiKey: 'secret', headers: {} }),
      },
      conversations,
      media: context.media,
      videoTasks: {
        run: async () => ({
          assetId: sourceAssetId,
          taskId: 'task-quicktime',
          result: { url: 'https://cdn.example.test/final.mov?token=temporary', mimeType: 'video/quicktime' },
        }),
      },
      createPlayableAsset: async ({ sourceAsset, providerId, providerTaskId }) => {
        transcodeCalls += 1
        assert.equal(sourceAsset.id, sourceAssetId)
        assert.equal(sourceAsset.mimeType, 'video/quicktime')
        return context.media.storeLocalFile({
          mediaType: 'video',
          filePath: convertedPath,
          declaredMimeType: 'video/mp4',
          providerId,
          providerTaskId,
          originalName: 'generated-video.mp4',
        })
      },
    })
    const result = await service.generate({ conversationId: 1, agentId: 1, prompt: 'Convert this video' })
    assert.equal(transcodeCalls, 1)
    assert.equal(result.sourceAssetId, sourceAssetId)
    assert.notEqual(result.assetId, sourceAssetId)
    assert.deepEqual(
      context.db.prepare('SELECT id, mime_type, status FROM ai_media_assets ORDER BY id').all(),
      [
        { id: sourceAssetId, mime_type: 'video/quicktime', status: 'completed' },
        { id: result.assetId, mime_type: 'video/mp4', status: 'completed' },
      ],
    )
    const video = conversations.messages[1].parts.find((part) => part.type === 'video')
    assert.equal(video.assetId, result.assetId)
    assert.equal(video.mimeType, 'video/mp4')
    assert.doesNotMatch(JSON.stringify(conversations.messages[1].parts), /cdn\.example|temporary/)
  } finally {
    context.close()
  }
})

test('video conversion failures produce one failed terminal state while retaining the verified source', async () => {
  const context = setup({ remoteBytes: QUICKTIME_BYTES, remoteMimeType: 'video/quicktime' })
  const conversations = new FakeConversations()
  try {
    const sourceAssetId = createPendingVideo(context.db)
    const service = new AIVideoAssetService({
      db: context.db,
      agents: { getSnapshot: () => agentSnapshot() },
      providers: {
        get: () => ({ id: 1, enabled: true, capabilities: ['video'], models: { video: 'video-1' }, baseUrl: 'https://api.example.test/v1', timeoutMs: 5_000 }),
        getCredentialBundle: () => ({ apiKey: 'secret', headers: {} }),
      },
      conversations,
      media: context.media,
      videoTasks: {
        run: async () => ({ assetId: sourceAssetId, taskId: 'task-quicktime', result: { url: 'https://cdn.example.test/final.mov' } }),
      },
      createPlayableAsset: async () => {
        throw new AIServiceError({ code: 'media_failed', message: 'FFmpeg is required to convert this generated video.', retryable: false })
      },
    })
    await assert.rejects(
      () => service.generate({ conversationId: 1, agentId: 1, prompt: 'Convert this video' }),
      (error) => error instanceof AIServiceError && error.detail.code === 'media_failed',
    )
    assert.equal(context.db.prepare('SELECT status FROM ai_media_assets WHERE id = ?').get(sourceAssetId).status, 'completed')
    assert.equal(conversations.messages[1].status, 'failed')
    assert.equal(conversations.runs[0].status, 'failed')
    assert.equal(conversations.messages[1].parts.filter((part) => part.type === 'error').length, 1)
  } finally {
    context.close()
  }
})

test('video generation writes one terminal error when media persistence fails', async () => {
  const context = setup()
  const conversations = new FakeConversations()
  try {
    const assetId = createPendingVideo(context.db)
    const service = new AIVideoAssetService({
      db: context.db,
      agents: { getSnapshot: () => agentSnapshot() },
      providers: {
        get: () => ({ id: 1, enabled: true, capabilities: ['video'], models: { video: 'video-1' }, baseUrl: 'https://api.example.test/v1', timeoutMs: 5_000 }),
        getCredentialBundle: () => ({ apiKey: 'secret', headers: {} }),
      },
      conversations,
      media: {
        downloadRemoteToAsset: async () => { throw new AIServiceError({ code: 'media_failed', message: 'Invalid video bytes.', retryable: true }) },
        getRegisteredFilePath: async () => { throw new Error('unused') },
      },
      videoTasks: {
        run: async () => ({ assetId, taskId: 'task-9', result: { url: 'https://cdn.example.test/bad.mp4' } }),
      },
    })
    await assert.rejects(
      () => service.generate({ conversationId: 1, agentId: 1, prompt: 'Bad video' }),
      (error) => error instanceof AIServiceError && error.detail.code === 'media_failed',
    )
    assert.equal(conversations.messages[1].status, 'failed')
    assert.equal(conversations.runs[0].status, 'failed')
    assert.equal(conversations.messages[1].parts.filter((part) => part.type === 'error').length, 1)
  } finally {
    context.close()
  }
})

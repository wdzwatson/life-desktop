import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIVideoAdapter } from '../electron/ai/providers/videoAdapter.ts'
import { AIVideoGenerationService } from '../electron/ai/videoGenerationService.ts'
import { AIServiceError } from '../electron/ai/types.ts'

const config = { baseUrl: 'https://api.example.test/v1', apiKey: 'secret', model: 'video-1', timeoutMs: 5_000 }

test('video adapter creates, polls, and cancels provider tasks', async () => {
  const calls = []
  const adapter = new AIVideoAdapter(config, async (url, init) => {
    calls.push({ url: String(url), method: init.method })
    if (init.method === 'POST') return new Response(JSON.stringify({ task_id: 'task-1' }), { status: 202 })
    if (init.method === 'DELETE') return new Response(JSON.stringify({ cancelled: true }), { status: 200 })
    return new Response(JSON.stringify({ status: 'completed', video_url: 'https://cdn.example.test/video.mp4?token=temp', duration: 8 }), { status: 200 })
  })
  const task = await adapter.create({ prompt: 'A moving landscape' })
  assert.deepEqual(task, { taskId: 'task-1' })
  assert.deepEqual(await adapter.status(task), { status: 'completed', url: 'https://cdn.example.test/video.mp4?token=temp', durationSeconds: 8 })
  assert.deepEqual(await adapter.cancel(task), { cancelled: true })
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'DELETE'])
})

function setup(statuses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-ai-video-task-'))
  const db = new Database(path.join(dir, 'ai.db'))
  initializeAISchema(db)
  db.prepare(`INSERT INTO ai_providers (name, protocol, base_url, capabilities_json, video_model) VALUES ('Video', 'xai', 'https://api.example.test/v1', '["video"]', 'video-1')`).run()
  let pointer = 0
  const adapter = {
    create: async () => ({ taskId: 'task-9' }),
    status: async () => statuses[Math.min(pointer++, statuses.length - 1)],
    cancel: async () => ({ cancelled: true }),
  }
  const service = new AIVideoGenerationService({ db, createAdapter: () => adapter, sleep: async () => undefined, now: () => new Date('2026-07-18T08:00:00.000Z') })
  return { dir, db, service, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

test('video task service persists recoverable task IDs and completed download metadata', async () => {
  const context = setup([{ status: 'queued' }, { status: 'generating', progress: 50 }, { status: 'completed', url: 'https://cdn.example.test/final.mp4?token=temp', mimeType: 'video/mp4', durationSeconds: 6 }])
  try {
    const result = await context.service.run({ providerId: 1, config, prompt: 'Video', pollIntervalMs: 100, maxPolls: 4 })
    assert.equal(result.taskId, 'task-9')
    const row = context.db.prepare('SELECT provider_task_id, status, source_url_redacted, duration_seconds FROM ai_media_assets WHERE id = ?').get(result.assetId)
    assert.deepEqual(row, { provider_task_id: 'task-9', status: 'downloading', source_url_redacted: 'https://cdn.example.test/final.mp4', duration_seconds: 6 })
  } finally { context.close() }
})

test('video task service records provider failure and polling timeout', async () => {
  const failed = setup([{ status: 'failed', message: 'Provider rejected the prompt.' }])
  try {
    await assert.rejects(() => failed.service.run({ providerId: 1, config, prompt: 'Bad', maxPolls: 1, pollIntervalMs: 100 }), (error) => error instanceof AIServiceError && error.detail.code === 'media_failed')
    assert.deepEqual(failed.db.prepare('SELECT status, error_code FROM ai_media_assets').get(), { status: 'failed', error_code: 'media_failed' })
  } finally { failed.close() }
  const timed = setup([{ status: 'queued' }])
  try {
    await assert.rejects(() => timed.service.run({ providerId: 1, config, prompt: 'Slow', maxPolls: 2, pollIntervalMs: 100 }), (error) => error instanceof AIServiceError && error.detail.code === 'timeout')
    assert.equal(timed.db.prepare('SELECT status FROM ai_media_assets').get().status, 'failed')
  } finally { timed.close() }
})

test('video task service cancels active provider tasks and persists cancellation', async () => {
  const context = setup([{ status: 'queued' }])
  try {
    const result = context.db.prepare(`INSERT INTO ai_media_assets (provider_id, media_type, mime_type, provider_task_id, status) VALUES (1, 'video', 'video/mp4', 'task-cancel', 'polling')`).run()
    assert.deepEqual(await context.service.cancel(Number(result.lastInsertRowid), config), { cancelled: true, assetId: Number(result.lastInsertRowid) })
    assert.equal(context.db.prepare('SELECT status FROM ai_media_assets WHERE id = ?').get(result.lastInsertRowid).status, 'cancelled')
  } finally { context.close() }
})

test('video task service resumes polling from a persisted provider task ID', async () => {
  const context = setup([{ status: 'generating', progress: 80 }, { status: 'completed', url: 'https://cdn.example.test/resumed.mp4?token=temp', mimeType: 'video/mp4', durationSeconds: 5 }])
  try {
    const result = context.db.prepare(`
      INSERT INTO ai_media_assets (provider_id, media_type, mime_type, provider_task_id, status)
      VALUES (1, 'video', 'video/mp4', 'task-resume', 'polling')
    `).run()
    const assetId = Number(result.lastInsertRowid)
    const resumed = await context.service.resume({
      assetId,
      providerId: 1,
      taskId: 'task-resume',
      config,
      maxPolls: 3,
      pollIntervalMs: 100,
    })
    assert.equal(resumed.assetId, assetId)
    assert.equal(resumed.taskId, 'task-resume')
    assert.deepEqual(
      context.db.prepare('SELECT status, source_url_redacted, duration_seconds FROM ai_media_assets WHERE id = ?').get(assetId),
      { status: 'downloading', source_url_redacted: 'https://cdn.example.test/resumed.mp4', duration_seconds: 5 },
    )
  } finally { context.close() }
})

test('pausing startup recovery preserves a persisted video task for the next session', async () => {
  const context = setup([{ status: 'generating', progress: 80 }])
  try {
    const result = context.db.prepare(`
      INSERT INTO ai_media_assets (provider_id, media_type, mime_type, provider_task_id, status)
      VALUES (1, 'video', 'video/mp4', 'task-paused', 'polling')
    `).run()
    const assetId = Number(result.lastInsertRowid)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () => context.service.resume({ assetId, providerId: 1, taskId: 'task-paused', config, signal: controller.signal }),
      (error) => error instanceof AIServiceError && error.detail.code === 'cancelled',
    )
    assert.deepEqual(
      context.db.prepare('SELECT status, error_code FROM ai_media_assets WHERE id = ?').get(assetId),
      { status: 'polling', error_code: null },
    )
  } finally { context.close() }
})

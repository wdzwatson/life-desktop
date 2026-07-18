import type Database from 'better-sqlite3'
import { AIVideoAdapter, type AIVideoAdapterConfig, type AIVideoTask } from './providers/videoAdapter'
import { AIServiceError, type AIErrorDetail } from './types'

export type AIVideoGenerationDependencies = {
  db: Database.Database
  createAdapter: (config: AIVideoAdapterConfig) => Pick<AIVideoAdapter, 'create' | 'status' | 'cancel'>
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

function detail(error: unknown): AIErrorDetail {
  return error instanceof AIServiceError ? error.detail : { code: 'internal_error', message: 'Video generation failed unexpectedly.', retryable: false }
}

export class AIVideoGenerationService {
  private readonly now: () => Date
  private readonly sleep: (ms: number) => Promise<void>
  constructor(private readonly dependencies: AIVideoGenerationDependencies) {
    this.now = dependencies.now ?? (() => new Date())
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async run(input: {
    providerId: number
    runId?: number
    assistantMessageId?: number
    config: AIVideoAdapterConfig
    prompt: string
    durationSeconds?: number
    aspectRatio?: string
    pollIntervalMs?: number
    maxPolls?: number
    signal?: AbortSignal
  }) {
    const assetId = Number(this.dependencies.db.prepare(`
      INSERT INTO ai_media_assets (
        provider_id, run_id, assistant_message_id, media_type, mime_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'video', 'video/mp4', 'queued', ?, ?)
    `).run(
      input.providerId,
      input.runId ?? null,
      input.assistantMessageId ?? null,
      this.now().toISOString(),
      this.now().toISOString(),
    ).lastInsertRowid)
    const adapter = this.dependencies.createAdapter(input.config)
    let task: AIVideoTask | undefined
    try {
      this.update(assetId, 'generating')
      task = await adapter.create({ prompt: input.prompt, durationSeconds: input.durationSeconds, aspectRatio: input.aspectRatio, signal: input.signal })
      this.dependencies.db.prepare('UPDATE ai_media_assets SET provider_task_id = ?, status = ?, updated_at = ? WHERE id = ?').run(task.taskId, 'polling', this.now().toISOString(), assetId)
      return await this.pollTask(assetId, adapter, task, input)
    } catch (error) {
      const failure = detail(error)
      const status = failure.code === 'cancelled' ? 'cancelled' : 'failed'
      this.dependencies.db.prepare('UPDATE ai_media_assets SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?').run(status, failure.code, failure.message, this.now().toISOString(), assetId)
      throw error instanceof AIServiceError ? error : new AIServiceError(failure)
    }
  }

  async resume(input: {
    assetId: number
    providerId: number
    taskId: string
    config: AIVideoAdapterConfig
    pollIntervalMs?: number
    maxPolls?: number
    signal?: AbortSignal
  }) {
    const row = this.dependencies.db.prepare(`
      SELECT provider_id, provider_task_id, status FROM ai_media_assets WHERE id = ?
    `).get(input.assetId) as { provider_id: number | null; provider_task_id: string | null; status: string } | undefined
    if (!row || row.provider_id !== input.providerId || row.provider_task_id !== input.taskId) {
      throw new AIServiceError({ code: 'not_found', message: 'Recoverable video task was not found.', retryable: false })
    }
    if (!['generating', 'polling', 'downloading', 'processing'].includes(row.status)) {
      throw new AIServiceError({ code: 'invalid_input', message: 'The video task is not recoverable.', retryable: false })
    }
    const adapter = this.dependencies.createAdapter(input.config)
    try {
      this.update(input.assetId, 'polling')
      return await this.pollTask(input.assetId, adapter, { taskId: input.taskId }, input)
    } catch (error) {
      const failure = detail(error)
      if (!input.signal?.aborted) {
        const status = failure.code === 'cancelled' ? 'cancelled' : 'failed'
        this.dependencies.db.prepare('UPDATE ai_media_assets SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?').run(status, failure.code, failure.message, this.now().toISOString(), input.assetId)
      }
      throw error instanceof AIServiceError ? error : new AIServiceError(failure)
    }
  }

  async cancel(assetId: number, config: AIVideoAdapterConfig, signal?: AbortSignal) {
    const row = this.dependencies.db.prepare('SELECT provider_task_id FROM ai_media_assets WHERE id = ?').get(assetId) as { provider_task_id: string | null } | undefined
    if (!row?.provider_task_id) throw new AIServiceError({ code: 'not_found', message: 'Video task was not found.', retryable: false })
    await this.dependencies.createAdapter(config).cancel({ taskId: row.provider_task_id }, signal)
    this.update(assetId, 'cancelled')
    return { cancelled: true, assetId }
  }

  private update(assetId: number, status: string) {
    this.dependencies.db.prepare('UPDATE ai_media_assets SET status = ?, updated_at = ? WHERE id = ?').run(status, this.now().toISOString(), assetId)
  }

  private async pollTask(
    assetId: number,
    adapter: Pick<AIVideoAdapter, 'status'>,
    task: AIVideoTask,
    input: { pollIntervalMs?: number; maxPolls?: number; signal?: AbortSignal },
  ) {
    const maxPolls = Math.min(Math.max(input.maxPolls ?? 240, 1), 2_000)
    const interval = Math.min(Math.max(input.pollIntervalMs ?? 2_000, 100), 30_000)
    for (let index = 0; index < maxPolls; index += 1) {
      if (input.signal?.aborted) throw new AIServiceError({ code: 'cancelled', message: 'Video generation was cancelled.', retryable: false })
      await this.sleep(interval)
      const status = await adapter.status(task, input.signal)
      if (status.status === 'completed') {
        const redacted = new URL(status.url); redacted.username = ''; redacted.password = ''; redacted.search = ''; redacted.hash = ''
        this.dependencies.db.prepare(`UPDATE ai_media_assets SET status = 'downloading', source_url_redacted = ?, mime_type = ?, duration_seconds = ?, updated_at = ? WHERE id = ?`).run(redacted.toString(), status.mimeType ?? 'video/mp4', status.durationSeconds ?? null, this.now().toISOString(), assetId)
        return { assetId, taskId: task.taskId, result: status }
      }
      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new AIServiceError({ code: status.status === 'cancelled' ? 'cancelled' : 'media_failed', message: status.message, retryable: status.status === 'failed' })
      }
    }
    throw new AIServiceError({ code: 'timeout', message: 'Video generation did not finish before the polling limit.', retryable: true })
  }
}

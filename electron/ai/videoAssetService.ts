import type Database from 'better-sqlite3'
import type { AIAgentService } from './agentService'
import type { AIConversationService } from './conversationService'
import { createAIMediaAssetUrl, type AIMediaService, type AIStoredMediaAsset } from './mediaService'
import type { AIProviderService } from './providerService'
import type { AIVideoAdapterConfig } from './providers/videoAdapter'
import { AIServiceError, type AIErrorDetail } from './types'
import type { AIVideoGenerationService } from './videoGenerationService'

type VideoConversations = Pick<AIConversationService, 'getConversation' | 'createMessage' | 'appendMessageParts' | 'transitionMessage' | 'createRun' | 'transitionRun'>

export type AIVideoAssetServiceDependencies = {
  db: Database.Database
  agents: Pick<AIAgentService, 'getSnapshot'>
  providers: Pick<AIProviderService, 'get' | 'getCredentialBundle'>
  conversations: VideoConversations
  media: Pick<AIMediaService, 'downloadRemoteToAsset' | 'getRegisteredFilePath'>
  videoTasks: Pick<AIVideoGenerationService, 'run' | 'resume'>
  probeDurationSeconds?: (filePath: string) => Promise<number | undefined>
  createPlayableAsset?: (input: {
    sourceAsset: AIStoredMediaAsset
    filePath: string
    providerId: number
    providerTaskId?: string
    signal?: AbortSignal
  }) => Promise<AIStoredMediaAsset | undefined>
  createPoster?: (input: {
    filePath: string
    providerId: number
    providerTaskId?: string
    signal?: AbortSignal
  }) => Promise<AIStoredMediaAsset | undefined>
}

function errorDetail(error: unknown): AIErrorDetail {
  return error instanceof AIServiceError ? error.detail : { code: 'internal_error', message: 'Video generation failed unexpectedly.', retryable: false }
}

function cleanDuration(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export class AIVideoAssetService {
  constructor(private readonly dependencies: AIVideoAssetServiceDependencies) {}

  async generate(input: {
    conversationId: number
    agentId: number
    prompt: string
    durationSeconds?: number
    aspectRatio?: string
    signal?: AbortSignal
  }) {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (!prompt) throw new AIServiceError({ code: 'invalid_input', message: 'A video prompt is required.', retryable: false })
    this.dependencies.conversations.getConversation(input.conversationId)
    const snapshot = this.dependencies.agents.getSnapshot(input.agentId)
    if (!snapshot.providers.video) throw new AIServiceError({ code: 'configuration_incomplete', message: 'This Agent does not have a video provider.', retryable: false })
    const provider = this.dependencies.providers.get(snapshot.providers.video.id)
    if (!provider.enabled || !provider.capabilities.includes('video') || !provider.models.video) {
      throw new AIServiceError({ code: 'configuration_incomplete', message: 'The Agent video provider is not ready.', retryable: false })
    }
    const credentials = this.dependencies.providers.getCredentialBundle(provider.id)
    const user = this.dependencies.conversations.createMessage({
      conversationId: input.conversationId,
      role: 'user',
      parts: [{ type: 'text', text: prompt }],
    })
    const assistant = this.dependencies.conversations.createMessage({
      conversationId: input.conversationId,
      role: 'assistant',
      status: 'pending',
      parentMessageId: user.id,
      parts: [{ type: 'media_task', mediaType: 'video', taskId: `video-${user.id}`, status: 'generating' }],
    })
    const run = this.dependencies.conversations.createRun({
      conversationId: input.conversationId,
      triggerMessageId: user.id,
      assistantMessageId: assistant.id,
      agentSnapshot: snapshot,
      status: 'queued',
      currentStage: 'video_generation',
    })
    this.dependencies.conversations.transitionMessage(assistant.id, 'streaming')
    this.dependencies.conversations.transitionRun(run.id, 'running', { currentStage: 'video_provider_request' })
    try {
      const config: AIVideoAdapterConfig = {
        baseUrl: provider.baseUrl,
        apiKey: credentials.apiKey,
        headers: credentials.headers,
        model: snapshot.providers.video.model,
        timeoutMs: provider.timeoutMs,
      }
      const task = await this.dependencies.videoTasks.run({
        providerId: provider.id,
        runId: run.id,
        assistantMessageId: assistant.id,
        config,
        prompt,
        durationSeconds: input.durationSeconds,
        aspectRatio: input.aspectRatio,
        signal: input.signal,
      })
      return await this.completeTask({
        conversationId: input.conversationId,
        runId: run.id,
        triggerMessageId: user.id,
        assistantMessageId: assistant.id,
        providerId: provider.id,
        providerTimeoutMs: provider.timeoutMs,
        prompt,
        task,
        signal: input.signal,
      })
    } catch (error) {
      this.failTask(assistant.id, run.id, error)
      throw error instanceof AIServiceError ? error : new AIServiceError(errorDetail(error))
    }
  }

  async resume(input: { assetId: number; signal?: AbortSignal }) {
    const row = this.dependencies.db.prepare(`
      SELECT a.provider_id, a.provider_task_id, a.run_id, a.assistant_message_id,
        a.status, a.local_path, a.mime_type, a.byte_size, a.width, a.height,
        a.duration_seconds, a.sha256, a.original_name, a.source_url_redacted,
        r.conversation_id, r.trigger_message_id
      FROM ai_media_assets a
      JOIN ai_runs r ON r.id = a.run_id
      WHERE a.id = ?
        AND a.status IN ('generating', 'polling', 'downloading', 'processing')
        AND a.provider_task_id IS NOT NULL
        AND a.assistant_message_id IS NOT NULL
    `).get(input.assetId) as {
      provider_id: number
      provider_task_id: string
      run_id: number
      assistant_message_id: number
      status: string
      local_path: string | null
      mime_type: string
      byte_size: number | null
      width: number | null
      height: number | null
      duration_seconds: number | null
      sha256: string | null
      original_name: string | null
      source_url_redacted: string | null
      conversation_id: number
      trigger_message_id: number | null
    } | undefined
    if (!row) throw new AIServiceError({ code: 'not_found', message: 'Recoverable video task was not found.', retryable: false })
    const promptRow = row.trigger_message_id === null
      ? undefined
      : this.dependencies.db.prepare(`
          SELECT text_content FROM ai_message_parts
          WHERE message_id = ? AND content_type = 'text'
          ORDER BY position LIMIT 1
        `).get(row.trigger_message_id) as { text_content: string | null } | undefined
    const prompt = promptRow?.text_content?.trim() || 'Recovered video task'
    try {
      if (row.status === 'processing' && row.local_path) {
        const sourceAsset: AIStoredMediaAsset = {
          id: input.assetId,
          mediaType: 'video',
          mimeType: row.mime_type,
          byteSize: row.byte_size ?? 0,
          width: row.width ?? undefined,
          height: row.height ?? undefined,
          durationSeconds: row.duration_seconds ?? undefined,
          sha256: row.sha256 ?? '',
          originalName: row.original_name ?? undefined,
          sourceUrlRedacted: row.source_url_redacted ?? undefined,
          url: createAIMediaAssetUrl(input.assetId),
          status: 'completed',
        }
        return await this.completeStoredTask({
          conversationId: row.conversation_id,
          runId: row.run_id,
          triggerMessageId: row.trigger_message_id ?? undefined,
          assistantMessageId: row.assistant_message_id,
          providerId: row.provider_id,
          prompt,
          taskId: row.provider_task_id,
          sourceAsset,
          sourceFilePath: await this.dependencies.media.getRegisteredFilePath(input.assetId, true),
          durationSeconds: row.duration_seconds ?? undefined,
          signal: input.signal,
          recovering: true,
        })
      }
      const provider = this.dependencies.providers.get(row.provider_id)
      if (!provider.enabled || !provider.capabilities.includes('video') || !provider.models.video) {
        throw new AIServiceError({ code: 'configuration_incomplete', message: 'The video provider is not available for task recovery.', retryable: true })
      }
      const credentials = this.dependencies.providers.getCredentialBundle(provider.id)
      const task = await this.dependencies.videoTasks.resume({
        assetId: input.assetId,
        providerId: provider.id,
        taskId: row.provider_task_id,
        config: {
          baseUrl: provider.baseUrl,
          apiKey: credentials.apiKey,
          headers: credentials.headers,
          model: provider.models.video,
          timeoutMs: provider.timeoutMs,
        },
        signal: input.signal,
      })
      return await this.completeTask({
        conversationId: row.conversation_id,
        runId: row.run_id,
        triggerMessageId: row.trigger_message_id ?? undefined,
        assistantMessageId: row.assistant_message_id,
        providerId: provider.id,
        providerTimeoutMs: provider.timeoutMs,
        prompt,
        task,
        signal: input.signal,
        recovering: true,
      })
    } catch (error) {
      if (!input.signal?.aborted) this.failTask(row.assistant_message_id, row.run_id, error)
      throw error instanceof AIServiceError ? error : new AIServiceError(errorDetail(error))
    }
  }

  private async completeTask(input: {
    conversationId: number
    runId: number
    triggerMessageId?: number
    assistantMessageId: number
    providerId: number
    providerTimeoutMs: number
    prompt: string
    task: Awaited<ReturnType<AIVideoGenerationService['run']>>
    signal?: AbortSignal
    recovering?: boolean
  }) {
    const asset = await this.dependencies.media.downloadRemoteToAsset({
        assetId: input.task.assetId,
        mediaType: 'video',
        url: input.task.result.url,
        providerTaskId: input.task.taskId,
        declaredMimeType: input.task.result.mimeType,
        durationSeconds: input.task.result.durationSeconds,
        originalName: 'generated-video.mp4',
        timeoutMs: input.providerTimeoutMs,
        signal: input.signal,
        preserveOnAbort: input.recovering,
      })
    this.dependencies.db.prepare(`
      UPDATE ai_media_assets SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(asset.id)
    return this.completeStoredTask({
      conversationId: input.conversationId,
      runId: input.runId,
      triggerMessageId: input.triggerMessageId,
      assistantMessageId: input.assistantMessageId,
      providerId: input.providerId,
      prompt: input.prompt,
      taskId: input.task.taskId,
      sourceAsset: asset,
      sourceFilePath: await this.dependencies.media.getRegisteredFilePath(asset.id, true),
      durationSeconds: input.task.result.durationSeconds,
      signal: input.signal,
      recovering: input.recovering,
    })
  }

  private async completeStoredTask(input: {
    conversationId: number
    runId: number
    triggerMessageId?: number
    assistantMessageId: number
    providerId: number
    prompt: string
    taskId: string
    sourceAsset: AIStoredMediaAsset
    sourceFilePath: string
    durationSeconds?: number
    signal?: AbortSignal
    recovering?: boolean
  }) {
    try {
      const playableAsset = await this.dependencies.createPlayableAsset?.({
        sourceAsset: input.sourceAsset,
        filePath: input.sourceFilePath,
        providerId: input.providerId,
        providerTaskId: input.taskId,
        signal: input.signal,
      }) ?? input.sourceAsset
      const filePath = playableAsset.id === input.sourceAsset.id
        ? input.sourceFilePath
        : await this.dependencies.media.getRegisteredFilePath(playableAsset.id)
      const probedDuration = cleanDuration(input.durationSeconds) ?? await this.dependencies.probeDurationSeconds?.(filePath).catch(() => undefined)
      if (probedDuration !== undefined) {
        this.dependencies.db.prepare('UPDATE ai_media_assets SET duration_seconds = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(probedDuration, playableAsset.id)
      }
      let poster: AIStoredMediaAsset | undefined
      try {
        poster = await this.dependencies.createPoster?.({
          filePath,
          providerId: input.providerId,
          providerTaskId: input.taskId,
          signal: input.signal,
        })
      } catch (error) {
        if (input.signal?.aborted) throw error
      }
      if (input.signal?.aborted) {
        throw new AIServiceError({ code: 'cancelled', message: 'Video recovery was paused.', retryable: true })
      }
      this.dependencies.conversations.appendMessageParts(input.assistantMessageId, [{
        type: 'video',
        assetId: playableAsset.id,
        mimeType: playableAsset.mimeType,
        name: playableAsset.originalName ?? 'Generated video',
        alt: `Generated video for: ${input.prompt.slice(0, 500)}`,
        durationSeconds: probedDuration,
        posterAssetId: poster?.id,
      }])
      this.dependencies.conversations.transitionMessage(input.assistantMessageId, 'completed')
      this.dependencies.conversations.transitionRun(input.runId, 'completed', { currentStage: 'completed' })
      this.dependencies.db.prepare(`
        UPDATE ai_media_assets SET status = 'completed', error_code = NULL, error_message = NULL,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(input.sourceAsset.id)
      return {
        conversationId: input.conversationId,
        runId: input.runId,
        triggerMessageId: input.triggerMessageId,
        messageId: input.assistantMessageId,
        assetId: playableAsset.id,
        sourceAssetId: playableAsset.id === input.sourceAsset.id ? undefined : input.sourceAsset.id,
        posterAssetId: poster?.id,
      }
    } catch (error) {
      if (!(input.recovering && input.signal?.aborted)) {
        this.dependencies.db.prepare(`
          UPDATE ai_media_assets SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(input.sourceAsset.id)
      }
      throw error
    }
  }

  private failTask(assistantMessageId: number, runId: number, error: unknown) {
    const detail = errorDetail(error)
    this.dependencies.conversations.appendMessageParts(assistantMessageId, [{ type: 'error', code: detail.code, message: detail.message, retryable: detail.retryable }])
    const status = detail.code === 'cancelled' ? 'cancelled' : 'failed'
    this.dependencies.conversations.transitionMessage(assistantMessageId, status)
    this.dependencies.conversations.transitionRun(runId, status, { currentStage: status, errorCode: detail.code, errorMessage: detail.message })
  }
}

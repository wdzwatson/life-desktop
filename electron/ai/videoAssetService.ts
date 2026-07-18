import type Database from 'better-sqlite3'
import type { AIAgentService } from './agentService'
import type { AIConversationService } from './conversationService'
import type { AIMediaService, AIStoredMediaAsset } from './mediaService'
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
  videoTasks: Pick<AIVideoGenerationService, 'run'>
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
        config,
        prompt,
        durationSeconds: input.durationSeconds,
        aspectRatio: input.aspectRatio,
        signal: input.signal,
      })
      const asset = await this.dependencies.media.downloadRemoteToAsset({
        assetId: task.assetId,
        mediaType: 'video',
        url: task.result.url,
        providerTaskId: task.taskId,
        declaredMimeType: task.result.mimeType,
        durationSeconds: task.result.durationSeconds,
        originalName: 'generated-video.mp4',
        timeoutMs: provider.timeoutMs,
        signal: input.signal,
      })
      const sourceFilePath = await this.dependencies.media.getRegisteredFilePath(asset.id)
      const playableAsset = await this.dependencies.createPlayableAsset?.({
        sourceAsset: asset,
        filePath: sourceFilePath,
        providerId: provider.id,
        providerTaskId: task.taskId,
        signal: input.signal,
      }) ?? asset
      const filePath = playableAsset.id === asset.id
        ? sourceFilePath
        : await this.dependencies.media.getRegisteredFilePath(playableAsset.id)
      const probedDuration = cleanDuration(task.result.durationSeconds) ?? await this.dependencies.probeDurationSeconds?.(filePath).catch(() => undefined)
      if (probedDuration !== undefined) {
        this.dependencies.db.prepare('UPDATE ai_media_assets SET duration_seconds = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(probedDuration, playableAsset.id)
      }
      const poster = await this.dependencies.createPoster?.({
        filePath,
        providerId: provider.id,
        providerTaskId: task.taskId,
        signal: input.signal,
      }).catch(() => undefined)
      this.dependencies.conversations.appendMessageParts(assistant.id, [{
        type: 'video',
        assetId: playableAsset.id,
        mimeType: playableAsset.mimeType,
        name: playableAsset.originalName ?? 'Generated video',
        alt: `Generated video for: ${prompt.slice(0, 500)}`,
        durationSeconds: probedDuration,
        posterAssetId: poster?.id,
      }])
      this.dependencies.conversations.transitionMessage(assistant.id, 'completed')
      this.dependencies.conversations.transitionRun(run.id, 'completed', { currentStage: 'completed' })
      return {
        conversationId: input.conversationId,
        runId: run.id,
        triggerMessageId: user.id,
        messageId: assistant.id,
        assetId: playableAsset.id,
        sourceAssetId: playableAsset.id === asset.id ? undefined : asset.id,
        posterAssetId: poster?.id,
      }
    } catch (error) {
      const detail = errorDetail(error)
      this.dependencies.conversations.appendMessageParts(assistant.id, [{ type: 'error', code: detail.code, message: detail.message, retryable: detail.retryable }])
      const status = detail.code === 'cancelled' ? 'cancelled' : 'failed'
      this.dependencies.conversations.transitionMessage(assistant.id, status)
      this.dependencies.conversations.transitionRun(run.id, status, { currentStage: status, errorCode: detail.code, errorMessage: detail.message })
      throw error instanceof AIServiceError ? error : new AIServiceError(detail)
    }
  }
}

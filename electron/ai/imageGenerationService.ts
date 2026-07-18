import type { AIAgentService } from './agentService'
import type { AIConversationService } from './conversationService'
import type { AIMediaService } from './mediaService'
import type { AIProviderService } from './providerService'
import { AIImageAdapter, type AIImageAdapterConfig } from './providers/imageAdapter'
import { AIServiceError, type AIErrorDetail } from './types'

type ImageConversations = Pick<AIConversationService, 'getConversation' | 'createMessage' | 'appendMessageParts' | 'transitionMessage' | 'createRun' | 'transitionRun'>

export type AIImageGenerationDependencies = {
  agents: Pick<AIAgentService, 'getSnapshot'>
  providers: Pick<AIProviderService, 'get' | 'getCredentialBundle'>
  conversations: ImageConversations
  media: Pick<AIMediaService, 'storeBase64' | 'downloadRemote'>
  createAdapter?: (config: AIImageAdapterConfig) => Pick<AIImageAdapter, 'generate'>
}

function errorDetail(error: unknown): AIErrorDetail {
  return error instanceof AIServiceError ? error.detail : { code: 'internal_error', message: 'Image generation failed unexpectedly.', retryable: false }
}

export class AIImageGenerationService {
  private readonly createAdapter: NonNullable<AIImageGenerationDependencies['createAdapter']>

  constructor(private readonly dependencies: AIImageGenerationDependencies) {
    this.createAdapter = dependencies.createAdapter ?? ((config) => new AIImageAdapter(config))
  }

  async generate(input: { conversationId: number; agentId: number; prompt: string; count?: number; size?: string; signal?: AbortSignal }) {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (!prompt) throw new AIServiceError({ code: 'invalid_input', message: 'An image prompt is required.', retryable: false })
    this.dependencies.conversations.getConversation(input.conversationId)
    const snapshot = this.dependencies.agents.getSnapshot(input.agentId)
    if (!snapshot.providers.image) throw new AIServiceError({ code: 'configuration_incomplete', message: 'This Agent does not have an image provider.', retryable: false })
    const provider = this.dependencies.providers.get(snapshot.providers.image.id)
    if (!provider.enabled || !provider.capabilities.includes('image') || !provider.models.image) {
      throw new AIServiceError({ code: 'configuration_incomplete', message: 'The Agent image provider is not ready.', retryable: false })
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
      parts: [{ type: 'media_task', mediaType: 'image', taskId: `image-${user.id}`, status: 'generating' }],
    })
    const run = this.dependencies.conversations.createRun({
      conversationId: input.conversationId,
      triggerMessageId: user.id,
      assistantMessageId: assistant.id,
      agentSnapshot: snapshot,
      status: 'queued',
      currentStage: 'image_generation',
    })
    this.dependencies.conversations.transitionMessage(assistant.id, 'streaming')
    this.dependencies.conversations.transitionRun(run.id, 'running', { currentStage: 'image_provider_request' })
    try {
      const adapter = this.createAdapter({
        baseUrl: provider.baseUrl,
        apiKey: credentials.apiKey,
        headers: credentials.headers,
        model: snapshot.providers.image.model,
        timeoutMs: provider.timeoutMs,
      })
      const generated = await adapter.generate({ prompt, count: input.count, size: input.size, signal: input.signal })
      const assets = []
      for (const [index, result] of generated.results.entries()) {
        const stored = result.kind === 'base64'
          ? await this.dependencies.media.storeBase64({
            mediaType: 'image',
            base64: result.data,
            declaredMimeType: result.mimeType,
            providerId: provider.id,
            providerTaskId: generated.taskId,
            originalName: `generated-${index + 1}.png`,
          })
          : await this.dependencies.media.downloadRemote({
            mediaType: 'image',
            url: result.url,
            providerId: provider.id,
            providerTaskId: generated.taskId,
            originalName: `generated-${index + 1}.png`,
            timeoutMs: provider.timeoutMs,
            signal: input.signal,
          })
        assets.push(stored)
      }
      if (assets.length === 0) throw new AIServiceError({ code: 'media_failed', message: 'The image provider returned no usable images.', retryable: true })
      this.dependencies.conversations.appendMessageParts(assistant.id, assets.map((asset, index) => ({
        type: 'image' as const,
        assetId: asset.id,
        mimeType: asset.mimeType,
        name: asset.originalName ?? `Generated image ${index + 1}`,
        alt: `Generated image for: ${prompt.slice(0, 500)}`,
      })))
      this.dependencies.conversations.transitionMessage(assistant.id, 'completed')
      this.dependencies.conversations.transitionRun(run.id, 'completed', { currentStage: 'completed' })
      return { conversationId: input.conversationId, runId: run.id, triggerMessageId: user.id, messageId: assistant.id, assets }
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

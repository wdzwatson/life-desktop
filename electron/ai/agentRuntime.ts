import type { AIAgentSnapshot } from './agentService'
import type { AIConversationService } from './conversationService'
import type { AIProviderService } from './providerService'
import {
  OpenAICompatibleAdapter,
  type OpenAICompatibleDelta,
  type OpenAICompatibleMessage,
  type OpenAICompatibleRequest,
} from './providers/openAiCompatible'
import { AIRunEventPublisher, type AIRunEvent } from './runEvents'
import {
  AIServiceError,
  type AIErrorDetail,
  type AIMessageContentBlock,
  type AIStartRunInput,
} from './types'

type AgentRuntimeConversationService = Pick<
  AIConversationService,
  | 'getConversation'
  | 'listMessages'
  | 'createMessage'
  | 'appendMessageParts'
  | 'transitionMessage'
  | 'createRun'
  | 'transitionRun'
>

type AgentRuntimeAgentService = {
  getSnapshot: (id: number) => AIAgentSnapshot
}

type AgentRuntimeProviderService = Pick<AIProviderService, 'get' | 'getCredentialBundle'>

type AgentRuntimeAdapter = {
  streamChat: (request: OpenAICompatibleRequest) => AsyncIterable<OpenAICompatibleDelta>
}

export type AIAgentRuntimeServices = {
  agents: AgentRuntimeAgentService
  providers: AgentRuntimeProviderService
  conversations: AgentRuntimeConversationService
}

export type AIAgentRuntimeDependencies = {
  getServices: () => AIAgentRuntimeServices
  emit: (event: AIRunEvent) => void
  createAdapter?: (config: ConstructorParameters<typeof OpenAICompatibleAdapter>[0]) => AgentRuntimeAdapter
  now?: () => Date
  flushIntervalMs?: number
  flushCharacterThreshold?: number
}

type ActiveRun = {
  conversationId: number
  runId: number
  triggerMessageId: number
  messageId: number
  controller: AbortController
  conversations: AgentRuntimeConversationService
  adapter: AgentRuntimeAdapter
  request: OpenAICompatibleRequest
  publisher: AIRunEventPublisher
  pendingText: string
  flushTimer?: ReturnType<typeof setTimeout>
  usage: Record<string, number>
  providerRequestId?: string
  finishReason?: string
  terminalStatus?: 'completed' | 'failed' | 'cancelled' | 'interrupted'
}

function runtimeError(code: AIErrorDetail['code'], message: string, retryable = false) {
  return new AIServiceError({ code, message, retryable })
}

function requireId(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw runtimeError('invalid_input', `Invalid ${field}.`)
  }
  return Number(value)
}

function parseStartInput(value: unknown): AIStartRunInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw runtimeError('invalid_input', 'Invalid AI run input.')
  }
  const input = value as Partial<AIStartRunInput>
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!text || text.length > 1_000_000) {
    throw runtimeError('invalid_input', 'AI run text must contain between 1 and 1,000,000 characters.')
  }
  if (!Array.isArray(input.attachmentAssetIds) || input.attachmentAssetIds.some((id) => !Number.isInteger(id) || id < 1)) {
    throw runtimeError('invalid_input', 'Invalid AI run attachments.')
  }
  if (input.attachmentAssetIds.length > 0) {
    throw runtimeError('unsupported', 'Text Agent attachments are not available in this runtime yet.')
  }
  return {
    conversationId: requireId(input.conversationId, 'conversation ID'),
    agentId: requireId(input.agentId, 'agent ID'),
    text,
    attachmentAssetIds: [],
  }
}

function toErrorDetail(error: unknown): AIErrorDetail {
  if (error instanceof AIServiceError) return error.detail
  return {
    code: 'internal_error',
    message: 'The AI conversation run failed unexpectedly.',
    retryable: false,
  }
}

function textFromParts(parts: AIMessageContentBlock[]) {
  return parts
    .filter(
      (part): part is Extract<AIMessageContentBlock, { type: 'text' | 'markdown' | 'code' }> =>
        part.type === 'text' || part.type === 'markdown' || part.type === 'code',
    )
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function toProviderMessage(message: ReturnType<AgentRuntimeConversationService['listMessages']>[number]) {
  if (message.status !== 'completed') return undefined
  const content = textFromParts(message.parts)
  if (!content) return undefined
  return {
    role: message.role,
    content,
  } satisfies OpenAICompatibleMessage
}

export class AIAgentRuntime {
  private readonly activeByConversation = new Map<number, ActiveRun>()
  private readonly createAdapter: NonNullable<AIAgentRuntimeDependencies['createAdapter']>
  private readonly now: () => Date
  private readonly flushIntervalMs: number
  private readonly flushCharacterThreshold: number
  private disposed = false

  constructor(private readonly dependencies: AIAgentRuntimeDependencies) {
    this.createAdapter = dependencies.createAdapter ?? ((config) => new OpenAICompatibleAdapter(config))
    this.now = dependencies.now ?? (() => new Date())
    this.flushIntervalMs = dependencies.flushIntervalMs ?? 250
    this.flushCharacterThreshold = dependencies.flushCharacterThreshold ?? 2_000
  }

  start(value: unknown) {
    if (this.disposed) throw runtimeError('configuration_incomplete', 'The AI runtime is not available.')
    const input = parseStartInput(value)
    if (this.activeByConversation.has(input.conversationId)) {
      throw runtimeError('invalid_input', 'This conversation already has an active Agent run.')
    }

    const services = this.dependencies.getServices()
    services.conversations.getConversation(input.conversationId)
    const snapshot = services.agents.getSnapshot(input.agentId)
    const provider = services.providers.get(snapshot.providers.text.id)
    if (!provider.enabled || !provider.capabilities.includes('text') || !provider.models.text) {
      throw runtimeError('configuration_incomplete', 'The Agent text provider is not ready.')
    }
    const credentials = services.providers.getCredentialBundle(provider.id)
    const adapter = this.createAdapter({
      baseUrl: provider.baseUrl,
      apiKey: credentials.apiKey,
      headers: credentials.headers,
      model: snapshot.providers.text.model,
      timeoutMs: provider.timeoutMs,
    })
    const history = this.loadHistory(
      services.conversations,
      input.conversationId,
      Math.max(snapshot.context.maxMessages - 1, 0),
    )
    const triggerMessage = services.conversations.createMessage({
      conversationId: input.conversationId,
      role: 'user',
      parts: [{ type: 'text', text: input.text }],
    })
    const assistantMessage = services.conversations.createMessage({
      conversationId: input.conversationId,
      role: 'assistant',
      status: 'pending',
      parentMessageId: triggerMessage.id,
    })
    const run = services.conversations.createRun({
      conversationId: input.conversationId,
      triggerMessageId: triggerMessage.id,
      assistantMessageId: assistantMessage.id,
      agentSnapshot: snapshot,
      status: 'queued',
      currentStage: 'preparing',
    })
    const messages: OpenAICompatibleMessage[] = [
      ...(snapshot.systemPrompt.trim()
        ? [{ role: 'system' as const, content: snapshot.systemPrompt.trim() }]
        : []),
      ...history,
      { role: 'user', content: input.text },
    ]
    const controller = new AbortController()
    const active: ActiveRun = {
      conversationId: input.conversationId,
      runId: run.id,
      triggerMessageId: triggerMessage.id,
      messageId: assistantMessage.id,
      controller,
      conversations: services.conversations,
      adapter,
      request: {
        messages,
        temperature: snapshot.modelParams.temperature,
        maxOutputTokens: snapshot.context.maxOutputTokens,
        signal: controller.signal,
      },
      publisher: new AIRunEventPublisher(
        { conversationId: input.conversationId, runId: run.id, messageId: assistantMessage.id },
        this.dependencies.emit,
        this.now,
      ),
      pendingText: '',
      usage: {},
    }

    this.activeByConversation.set(input.conversationId, active)
    try {
      services.conversations.transitionMessage(assistantMessage.id, 'streaming')
      services.conversations.transitionRun(run.id, 'running', { currentStage: 'provider_request' })
      active.publisher.publish({ type: 'started', triggerMessageId: triggerMessage.id })
      void this.consume(active)
    } catch (error) {
      this.finalize(active, 'failed', toErrorDetail(error))
      throw error
    }

    return {
      conversationId: input.conversationId,
      runId: run.id,
      triggerMessageId: triggerMessage.id,
      messageId: assistantMessage.id,
      status: 'running' as const,
    }
  }

  cancel(conversationIdValue: unknown, runIdValue?: unknown) {
    const conversationId = requireId(conversationIdValue, 'conversation ID')
    const runId = runIdValue === undefined ? undefined : requireId(runIdValue, 'run ID')
    const active = this.activeByConversation.get(conversationId)
    if (!active || (runId !== undefined && active.runId !== runId)) {
      throw runtimeError('not_found', 'No matching active Agent run was found.')
    }
    this.finalize(active, 'cancelled')
    return { cancelled: true, conversationId, runId: active.runId }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const active of [...this.activeByConversation.values()]) {
      this.finalize(active, 'interrupted')
    }
  }

  isConversationActive(conversationId: number) {
    return this.activeByConversation.has(conversationId)
  }

  private async consume(active: ActiveRun) {
    try {
      for await (const delta of active.adapter.streamChat(active.request)) {
        if (active.terminalStatus) break
        this.acceptDelta(active, delta)
      }
      if (!active.terminalStatus) this.finalize(active, 'completed')
    } catch (error) {
      if (active.terminalStatus) return
      const detail = toErrorDetail(error)
      if (detail.code === 'cancelled') {
        this.finalize(active, 'cancelled')
      } else {
        this.finalize(active, 'failed', detail)
      }
    }
  }

  private acceptDelta(active: ActiveRun, delta: OpenAICompatibleDelta) {
    if (delta.type === 'text') {
      active.pendingText += delta.text
      active.publisher.publish({ type: 'text_delta', delta: delta.text })
      if (active.pendingText.length >= this.flushCharacterThreshold) this.flush(active)
      else this.scheduleFlush(active)
      return
    }
    if (delta.type === 'usage') {
      active.usage = { ...active.usage, ...delta.usage }
      active.publisher.publish({ type: 'usage', usage: delta.usage })
      return
    }
    if (delta.type === 'done') {
      active.finishReason = delta.finishReason
      active.providerRequestId = delta.providerRequestId
      return
    }
    if (delta.type === 'tool_call') {
      throw runtimeError('unsupported', 'This Agent requested a tool before the MCP tool runtime was available.')
    }
  }

  private scheduleFlush(active: ActiveRun) {
    if (active.flushTimer || !active.pendingText) return
    active.flushTimer = setTimeout(() => {
      active.flushTimer = undefined
      if (!active.terminalStatus) this.flush(active)
    }, this.flushIntervalMs)
  }

  private flush(active: ActiveRun) {
    if (active.flushTimer) clearTimeout(active.flushTimer)
    active.flushTimer = undefined
    if (!active.pendingText) return
    const text = active.pendingText
    active.pendingText = ''
    active.conversations.appendMessageParts(active.messageId, [{ type: 'markdown', text }])
  }

  private finalize(
    active: ActiveRun,
    status: NonNullable<ActiveRun['terminalStatus']>,
    error?: AIErrorDetail,
  ) {
    if (active.terminalStatus) return false
    active.terminalStatus = status
    if (status === 'cancelled' || status === 'interrupted') active.controller.abort()
    this.flush(active)
    if (status === 'failed' && error) {
      active.conversations.appendMessageParts(active.messageId, [
        { type: 'error', code: error.code, message: error.message, retryable: error.retryable },
      ])
    }
    active.conversations.transitionMessage(
      active.messageId,
      status,
      active.providerRequestId,
    )
    active.conversations.transitionRun(active.runId, status, {
      currentStage: status,
      providerRequestId: active.providerRequestId,
      usage: active.usage,
      ...(error ? { errorCode: error.code, errorMessage: error.message } : {}),
    })
    this.activeByConversation.delete(active.conversationId)
    if (status === 'completed') {
      active.publisher.publish({
        type: 'completed',
        ...(active.finishReason ? { finishReason: active.finishReason } : {}),
      })
    } else if (status === 'failed') {
      active.publisher.publish({ type: 'failed', error: error as AIErrorDetail })
    } else {
      active.publisher.publish({ type: status })
    }
    return true
  }

  private loadHistory(
    conversations: AgentRuntimeConversationService,
    conversationId: number,
    maxMessages: number,
  ) {
    const collected: ReturnType<AgentRuntimeConversationService['listMessages']> = []
    if (maxMessages < 1) return []
    let beforeId: number | undefined
    while (collected.length < maxMessages) {
      const remaining = maxMessages - collected.length
      const page = conversations.listMessages(conversationId, {
        ...(beforeId ? { beforeId } : {}),
        limit: Math.min(remaining, 200),
      })
      if (page.length === 0) break
      collected.unshift(...page)
      beforeId = page[0].id
      if (page.length < Math.min(remaining, 200)) break
    }
    return collected
      .slice(-maxMessages)
      .map(toProviderMessage)
      .filter((message): message is OpenAICompatibleMessage => Boolean(message))
  }
}

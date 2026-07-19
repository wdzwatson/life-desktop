import type { AIAgentSnapshot } from './agentService'
import type { AIConversationService } from './conversationService'
import type { AIMcpConfigService } from './mcpConfigService'
import type { AIMcpManager } from './mcpManager'
import type { AIMediaService } from './mediaService'
import type { AIProviderService } from './providerService'
import {
  OpenAICompatibleAdapter,
  type OpenAICompatibleDelta,
  type OpenAICompatibleMessage,
  type OpenAICompatibleRequest,
} from './providers/openAiCompatible'
import { AIRunEventPublisher, type AIRunEvent } from './runEvents'
import {
  aggregateAIToolCallFragments,
  buildAIProviderToolRegistry,
  normalizeAIMcpToolResult,
  parseAIToolArguments,
  summarizeAIToolArguments,
  type AIProviderToolBinding,
} from './toolLoop'
import { shouldApproveAITool } from './toolPolicy'
import {
  AIServiceError,
  type AIErrorDetail,
  type AIMessageContentBlock,
  type AIStartRunInput,
  type AIToolApprovalInput,
  type AIToolCallStatus,
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
  | 'createToolCall'
  | 'transitionToolCall'
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
  mcp?: Pick<AIMcpManager, 'listTools' | 'callTool'>
  mcpConfig?: Pick<AIMcpConfigService, 'get'>
  media?: Pick<AIMediaService, 'storeBase64' | 'downloadRemote'>
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
  snapshot: AIAgentSnapshot
  tools: Map<string, AIProviderToolBinding>
  approvedForSession: Set<string>
  pendingApprovals: Map<string, (decision: AIToolApprovalInput['decision'] | 'cancelled') => void>
  toolCalls: Map<string, { id: number; status: AIToolCallStatus }>
  toolCallCount: number
  runStatus: 'running' | 'waiting_for_tool' | 'waiting_for_approval'
  mcp?: Pick<AIMcpManager, 'listTools' | 'callTool'>
  mcpConfig?: Pick<AIMcpConfigService, 'get'>
  media?: Pick<AIMediaService, 'storeBase64' | 'downloadRemote'>
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
  const thinkingLevel = input.thinkingLevel
  if (thinkingLevel !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(thinkingLevel)) {
    throw runtimeError('invalid_input', 'Invalid thinking level.')
  }
  return {
    conversationId: requireId(input.conversationId, 'conversation ID'),
    agentId: requireId(input.agentId, 'agent ID'),
    text,
    attachmentAssetIds: [],
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
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
      requestBody: provider.requestBody,
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
        ...(input.thinkingLevel ? { reasoningEffort: input.thinkingLevel } : {}),
        signal: controller.signal,
      },
      publisher: new AIRunEventPublisher(
        { conversationId: input.conversationId, runId: run.id, messageId: assistantMessage.id },
        this.dependencies.emit,
        this.now,
      ),
      pendingText: '',
      usage: {},
      snapshot,
      tools: new Map(),
      approvedForSession: new Set(),
      pendingApprovals: new Map(),
      toolCalls: new Map(),
      toolCallCount: 0,
      runStatus: 'running',
      mcp: services.mcp,
      mcpConfig: services.mcpConfig,
      media: services.media,
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

  approve(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw runtimeError('invalid_input', 'Invalid tool approval input.')
    }
    const input = value as Partial<AIToolApprovalInput>
    const runId = requireId(input.runId, 'run ID')
    const toolCallId = typeof input.toolCallId === 'string' ? input.toolCallId.trim() : ''
    if (!toolCallId || toolCallId.length > 300) throw runtimeError('invalid_input', 'Invalid tool call ID.')
    if (!['approve_once', 'approve_session', 'reject'].includes(String(input.decision))) {
      throw runtimeError('invalid_input', 'Invalid tool approval decision.')
    }
    const active = [...this.activeByConversation.values()].find((candidate) => candidate.runId === runId)
    const resolver = active?.pendingApprovals.get(toolCallId)
    if (!active || !resolver) throw runtimeError('not_found', 'No matching tool approval request was found.')
    active.pendingApprovals.delete(toolCallId)
    resolver(input.decision as AIToolApprovalInput['decision'])
    return { accepted: true, runId, toolCallId, decision: input.decision }
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
      if (active.mcp && active.snapshot.mcpServerIds.length > 0 && active.snapshot.maxToolCalls > 0) {
        await this.prepareTools(active)
      }
      while (!active.terminalStatus) {
        const toolDeltas: OpenAICompatibleDelta[] = []
        let turnText = ''
        active.finishReason = undefined
        active.providerRequestId = undefined
        for await (const delta of active.adapter.streamChat(active.request)) {
          if (active.terminalStatus) break
          if (delta.type === 'tool_call') toolDeltas.push(delta)
          else {
            if (delta.type === 'text') turnText += delta.text
            this.acceptDelta(active, delta)
          }
        }
        if (active.terminalStatus) break
        const calls = aggregateAIToolCallFragments(toolDeltas)
        if (calls.length === 0) {
          this.finalize(active, 'completed')
          break
        }
        this.flush(active)
        const providerCalls = calls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.providerName, arguments: call.argumentsJson },
        }))
        active.request.messages.push({
          role: 'assistant',
          content: turnText || null,
          tool_calls: providerCalls,
        })
        for (const call of calls) {
          if (active.terminalStatus) break
          const result = await this.processToolCall(active, call)
          active.request.messages.push({ role: 'tool', content: result, tool_call_id: call.id })
        }
        if (active.toolCallCount >= active.snapshot.maxToolCalls) {
          active.request.tools = undefined
          active.request.toolChoice = 'none'
        }
      }
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
      for (const [key, value] of Object.entries(delta.usage)) {
        if (typeof value === 'number') active.usage[key] = (active.usage[key] ?? 0) + value
      }
      active.publisher.publish({ type: 'usage', usage: { ...active.usage } })
      return
    }
    if (delta.type === 'done') {
      active.finishReason = delta.finishReason
      active.providerRequestId = delta.providerRequestId
      return
    }
  }

  private async prepareTools(active: ActiveRun) {
    if (!active.mcp || active.snapshot.mcpServerIds.length === 0 || active.snapshot.maxToolCalls === 0) return
    const discovered = await active.mcp.listTools(active.snapshot.mcpServerIds)
    const riskOverrides = new Map<number, Record<string, 'read' | 'write' | 'command' | 'external_side_effect'>>()
    for (const serverId of active.snapshot.mcpServerIds) {
      const overrides = active.mcpConfig?.get(serverId).riskOverrides
      if (overrides) riskOverrides.set(serverId, overrides)
    }
    const registry = buildAIProviderToolRegistry({
      tools: discovered,
      blockedTools: active.snapshot.blockedTools,
      riskOverrides,
    })
    active.tools = registry.byProviderName
    if (registry.definitions.length > 0) {
      active.request.tools = registry.definitions
      active.request.toolChoice = 'auto'
    }
  }

  private async processToolCall(
    active: ActiveRun,
    call: ReturnType<typeof aggregateAIToolCallFragments>[number],
  ) {
    const binding = active.tools.get(call.providerName)
    if (!binding) throw runtimeError('permission_denied', 'The model requested an unavailable or blocked tool.')
    if (active.toolCallCount >= active.snapshot.maxToolCalls) {
      return `Tool call rejected: the Agent reached its limit of ${active.snapshot.maxToolCalls} tool calls.`
    }
    active.toolCallCount += 1
    let args: Record<string, unknown>
    try {
      args = parseAIToolArguments(call.argumentsJson)
    } catch (error) {
      const detail = toErrorDetail(error)
      const record = active.conversations.createToolCall({
        runId: active.runId,
        toolCallKey: call.id,
        mcpServerId: binding.serverId,
        toolName: binding.qualifiedName,
        riskLevel: binding.risk,
        input: {},
      })
      active.conversations.transitionToolCall(record.id, 'failed', {
        errorCode: detail.code,
        errorMessage: detail.message,
      })
      this.persistToolCallPart(active, binding, call.id, '{}', 'failed')
      active.conversations.appendMessageParts(active.messageId, [{ type: 'tool_result', toolCallId: call.id, summary: detail.message }])
      active.publisher.publish({ type: 'tool_failed', toolCallId: call.id, error: detail })
      return `Tool call failed: ${detail.message}`
    }
    const argumentsSummary = summarizeAIToolArguments(args)
    const needsApproval = !active.approvedForSession.has(binding.qualifiedName) && shouldApproveAITool({
      mode: active.snapshot.toolApprovalMode,
      risk: binding.risk,
      qualifiedToolName: binding.qualifiedName,
      allowedTools: active.snapshot.allowedTools,
    })
    const record = active.conversations.createToolCall({
      runId: active.runId,
      toolCallKey: call.id,
      mcpServerId: binding.serverId,
      toolName: binding.qualifiedName,
      riskLevel: binding.risk,
      approvalStatus: needsApproval ? 'waiting' : 'not_required',
      input: args,
    })
    active.toolCalls.set(call.id, { id: record.id, status: 'proposed' })
    this.persistToolCallPart(
      active,
      binding,
      call.id,
      argumentsSummary,
      needsApproval ? 'waiting_for_approval' : 'proposed',
    )
    active.publisher.publish({
      type: 'tool_proposed',
      toolCallId: call.id,
      serverId: binding.serverId,
      serverName: binding.serverName,
      toolName: binding.toolName,
      risk: binding.risk,
      argumentsSummary,
      status: needsApproval ? 'waiting_for_approval' : 'proposed',
    })
    if (needsApproval) {
      active.conversations.transitionToolCall(record.id, 'waiting_for_approval', { approvalStatus: 'waiting' })
      active.toolCalls.set(call.id, { id: record.id, status: 'waiting_for_approval' })
      this.transitionRunStage(active, 'waiting_for_approval', 'tool_approval')
      active.publisher.publish({
        type: 'approval_required',
        toolCallId: call.id,
        serverId: binding.serverId,
        serverName: binding.serverName,
        toolName: binding.toolName,
        risk: binding.risk,
        argumentsSummary,
      })
      const decision = await new Promise<AIToolApprovalInput['decision'] | 'cancelled'>((resolve) => {
        active.pendingApprovals.set(call.id, resolve)
      })
      if (active.terminalStatus || decision === 'cancelled') throw runtimeError('cancelled', 'The tool approval was cancelled.')
      if (decision === 'reject') {
        const summary = 'The user rejected this tool call.'
        active.conversations.transitionToolCall(record.id, 'rejected', {
          approvalStatus: 'rejected',
          resultSummary: summary,
        })
        active.toolCalls.set(call.id, { id: record.id, status: 'rejected' })
        this.persistToolCallPart(active, binding, call.id, argumentsSummary, 'rejected')
        active.conversations.appendMessageParts(active.messageId, [{ type: 'tool_result', toolCallId: call.id, summary }])
        this.transitionRunStage(active, 'running', 'provider_request')
        active.publisher.publish({ type: 'tool_rejected', toolCallId: call.id, summary })
        return `${summary} Continue the conversation without executing it.`
      }
      if (decision === 'approve_session') active.approvedForSession.add(binding.qualifiedName)
      active.conversations.transitionToolCall(record.id, 'approved', {
        approvalStatus: decision === 'approve_session' ? 'approved_session' : 'approved_once',
      })
      active.toolCalls.set(call.id, { id: record.id, status: 'approved' })
    }
    this.transitionRunStage(active, 'waiting_for_tool', 'tool_execution')
    active.conversations.transitionToolCall(record.id, 'running')
    active.toolCalls.set(call.id, { id: record.id, status: 'running' })
    active.publisher.publish({ type: 'tool_running', toolCallId: call.id })
    try {
      const raw = await active.mcp?.callTool(
        { serverId: binding.serverId, toolName: binding.toolName, arguments: args },
        { signal: active.controller.signal },
      )
      if (!active.mcp) throw runtimeError('mcp_unavailable', 'The MCP runtime is unavailable.', true)
      const result = normalizeAIMcpToolResult(raw)
      const mediaAssets = []
      for (const [index, resource] of result.resources.entries()) {
        if (!active.media) break
        if (resource.type === 'image' && resource.data) {
          mediaAssets.push(await active.media.storeBase64({
            mediaType: 'image',
            base64: resource.data,
            declaredMimeType: resource.mimeType,
            originalName: resource.name ?? `tool-image-${index + 1}.png`,
          }))
        } else if (resource.type === 'resource' && resource.uri && resource.mimeType?.startsWith('image/')) {
          mediaAssets.push(await active.media.downloadRemote({
            mediaType: 'image',
            url: resource.uri,
            originalName: resource.name ?? `tool-image-${index + 1}.png`,
            signal: active.controller.signal,
          }))
        }
      }
      const status = result.isError ? 'failed' : 'completed'
      active.conversations.transitionToolCall(record.id, status, {
        resultSummary: result.summary,
        ...(mediaAssets[0] ? { resultAssetId: mediaAssets[0].id } : {}),
        ...(result.isError ? { errorCode: 'tool_failed', errorMessage: result.summary } : {}),
      })
      active.toolCalls.set(call.id, { id: record.id, status })
      this.persistToolCallPart(active, binding, call.id, argumentsSummary, status)
      active.conversations.appendMessageParts(active.messageId, [{
        type: 'tool_result',
        toolCallId: call.id,
        summary: result.summary,
      }])
      if (mediaAssets.length > 0) {
        active.conversations.appendMessageParts(active.messageId, mediaAssets.map((asset, index) => ({
          type: 'image' as const,
          assetId: asset.id,
          mimeType: asset.mimeType,
          name: asset.originalName ?? `Tool image ${index + 1}`,
          alt: `Image returned by ${binding.qualifiedName}`,
        })))
      }
      this.transitionRunStage(active, 'running', 'provider_request')
      if (result.isError) {
        active.publisher.publish({
          type: 'tool_failed',
          toolCallId: call.id,
          error: { code: 'tool_failed', message: result.summary, retryable: true },
        })
      } else active.publisher.publish({ type: 'tool_completed', toolCallId: call.id, summary: result.summary })
      return result.modelContent
    } catch (error) {
      if (active.terminalStatus || active.controller.signal.aborted) throw error
      const detail = toErrorDetail(error)
      active.conversations.transitionToolCall(record.id, 'failed', {
        errorCode: detail.code,
        errorMessage: detail.message,
        resultSummary: detail.message,
      })
      active.toolCalls.set(call.id, { id: record.id, status: 'failed' })
      this.persistToolCallPart(active, binding, call.id, argumentsSummary, 'failed')
      active.conversations.appendMessageParts(active.messageId, [{ type: 'tool_result', toolCallId: call.id, summary: detail.message }])
      this.transitionRunStage(active, 'running', 'provider_request')
      active.publisher.publish({ type: 'tool_failed', toolCallId: call.id, error: detail })
      return `Tool call failed: ${detail.message}`
    }
  }

  private transitionRunStage(
    active: ActiveRun,
    status: ActiveRun['runStatus'],
    currentStage: string,
  ) {
    if (active.runStatus === status) return
    active.conversations.transitionRun(active.runId, status, { currentStage })
    active.runStatus = status
  }

  private persistToolCallPart(
    active: ActiveRun,
    binding: AIProviderToolBinding,
    toolCallId: string,
    argumentsSummary: string,
    status: AIToolCallStatus,
  ) {
    active.conversations.appendMessageParts(active.messageId, [{
      type: 'tool_call',
      toolCallId,
      serverId: binding.serverId,
      serverName: binding.serverName,
      toolName: binding.toolName,
      risk: binding.risk,
      argumentsSummary,
      status,
    }])
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
    for (const resolve of active.pendingApprovals.values()) resolve('cancelled')
    active.pendingApprovals.clear()
    for (const [toolCallId, toolCall] of active.toolCalls) {
      if (!['completed', 'failed', 'rejected', 'cancelled'].includes(toolCall.status)) {
        try {
          active.conversations.transitionToolCall(toolCall.id, 'cancelled', {
            errorCode: status,
            errorMessage: `Tool call ${status}.`,
          })
          active.toolCalls.set(toolCallId, { ...toolCall, status: 'cancelled' })
        } catch {
          // Terminal run persistence must not be blocked by best-effort tool cleanup.
        }
      }
    }
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

import { AIAgentRuntime } from '../electron/ai/agentRuntime.ts'
import type { AIMcpToolSummary } from '../electron/ai/mcpManager.ts'
import type { OpenAICompatibleDelta, OpenAICompatibleRequest } from '../electron/ai/providers/openAiCompatible.ts'
import type { AIRunEvent } from '../electron/ai/runEvents.ts'
import type { AIAgentSnapshot } from '../electron/ai/agentService.ts'

class ToolConversationService {
  messages: any[] = []
  runs: any[] = []
  toolCalls: any[] = []
  terminalRunWrites = 0
  private nextMessageId = 1
  private nextRunId = 1
  private nextToolCallId = 1

  getConversation(id: number) { return { id } }
  listMessages() { return [] }
  createMessage(input: any) {
    const message = {
      id: this.nextMessageId++,
      conversationId: input.conversationId,
      role: input.role,
      status: input.status ?? 'completed',
      parentMessageId: input.parentMessageId ?? null,
      providerMessageId: null,
      parts: [...(input.parts ?? [])],
      createdAt: '2026-07-18T00:00:00.000Z',
      startedAt: null,
      completedAt: null,
    }
    this.messages.push(message)
    return { ...message, parts: [...message.parts] }
  }
  appendMessageParts(id: number, parts: any[]) {
    const message = this.messages.find((item) => item.id === id)
    message.parts.push(...parts)
    return message
  }
  transitionMessage(id: number, status: string, providerMessageId?: string) {
    const message = this.messages.find((item) => item.id === id)
    message.status = status
    if (providerMessageId) message.providerMessageId = providerMessageId
    return message
  }
  createRun(input: any) {
    const run = { id: this.nextRunId++, ...input }
    this.runs.push(run)
    return run
  }
  transitionRun(id: number, status: string, updates: any = {}) {
    const run = this.runs.find((item) => item.id === id)
    Object.assign(run, updates, { status })
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status)) this.terminalRunWrites += 1
    return run
  }
  createToolCall(input: any) {
    const toolCall = { id: this.nextToolCallId++, status: input.status ?? 'proposed', ...input }
    this.toolCalls.push(toolCall)
    return { ...toolCall }
  }
  transitionToolCall(id: number, status: string, updates: any = {}) {
    const toolCall = this.toolCalls.find((item) => item.id === id)
    Object.assign(toolCall, updates, { status })
    return { ...toolCall }
  }
}

export function tool(overrides: Partial<AIMcpToolSummary> = {}): AIMcpToolSummary {
  return {
    serverId: 12,
    serverName: 'Workspace',
    name: 'search_files',
    description: 'Search local files',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    annotations: { readOnlyHint: true },
    ...overrides,
  }
}

function snapshot(overrides: Partial<AIAgentSnapshot> = {}): AIAgentSnapshot {
  return {
    agentId: 7,
    name: 'Tool Agent',
    systemPrompt: '',
    toolApprovalMode: 'confirm_risky',
    maxToolCalls: 8,
    allowedTools: [],
    blockedTools: [],
    modelParams: {},
    context: { maxMessages: 20, maxOutputTokens: 500 },
    providers: { text: { id: 3, name: 'Provider', model: 'chat-model' } },
    mcpServerIds: [12],
    capturedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  }
}

export function setupToolRuntime(input: {
  stream: (request: OpenAICompatibleRequest, turn: number) => AsyncIterable<OpenAICompatibleDelta>
  tools?: AIMcpToolSummary[]
  snapshot?: Partial<AIAgentSnapshot>
  callTool?: (input: any, options: any) => unknown | Promise<unknown>
  riskOverrides?: Record<string, 'read' | 'write' | 'command' | 'external_side_effect'>
  media?: { storeBase64: (input: any) => Promise<any>; downloadRemote: (input: any) => Promise<any> }
}) {
  const conversations = new ToolConversationService()
  const events: AIRunEvent[] = []
  const requests: OpenAICompatibleRequest[] = []
  const mcpCalls: any[] = []
  let turn = 0
  const runtime = new AIAgentRuntime({
    getServices: () => ({
      agents: { getSnapshot: () => snapshot(input.snapshot) },
      providers: {
        get: () => ({
          id: 3,
          baseUrl: 'https://api.test/v1',
          enabled: true,
          capabilities: ['text', 'streaming', 'tool_calling'],
          models: { text: 'chat-model' },
          timeoutMs: 5_000,
        }) as any,
        getCredentialBundle: () => ({}),
      },
      conversations: conversations as any,
      mcp: {
        listTools: async () => input.tools ?? [tool()],
        callTool: async (callInput: any, options: any) => {
          mcpCalls.push(callInput)
          return input.callTool
            ? input.callTool(callInput, options)
            : { content: [{ type: 'text', text: 'Matched file.txt' }] }
        },
      },
      mcpConfig: {
        get: () => ({ riskOverrides: input.riskOverrides ?? {} }) as any,
      },
      ...(input.media ? { media: input.media } : {}),
    }),
    createAdapter: () => ({
      streamChat: (request) => {
        turn += 1
        requests.push({ ...request, messages: request.messages.map((message) => ({ ...message })) })
        return input.stream(request, turn)
      },
    }),
    emit: (event) => events.push(event),
    now: () => new Date('2026-07-18T08:00:00.000Z'),
    flushIntervalMs: 10_000,
    flushCharacterThreshold: 10_000,
  })
  const started = runtime.start({ conversationId: 1, agentId: 7, text: 'Use a tool', attachmentAssetIds: [] })
  return { runtime, conversations, events, requests, mcpCalls, started }
}

export async function waitForRunEvent(
  events: AIRunEvent[],
  predicate: (event: AIRunEvent) => boolean,
) {
  for (let index = 0; index < 300; index += 1) {
    const event = events.find(predicate)
    if (event) return event
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for AI run event.')
}

export function waitForTerminalRun(events: AIRunEvent[]) {
  return waitForRunEvent(events, (event) =>
    ['completed', 'failed', 'cancelled', 'interrupted'].includes(event.type),
  )
}

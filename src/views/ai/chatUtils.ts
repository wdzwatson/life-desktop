export type AIChatConversation = {
  id: number
  title: string
  agentId: number | null
  agentSnapshot: Record<string, unknown>
  isPinned: boolean
  isArchived: boolean
  messageCount: number
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}

export type AIChatMediaPart = {
  type: 'image' | 'video' | 'audio' | 'file'
  assetId: number
  mimeType: string
  name?: string
  alt?: string
  posterAssetId?: number
  durationSeconds?: number
}

export type AIChatMessagePart =
  | { type: 'text' | 'markdown' | 'code'; text: string; language?: string }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | {
      type: 'tool_call'
      toolCallId: string
      serverId: number
      serverName?: string
      toolName: string
      risk?: 'read' | 'write' | 'command' | 'external_side_effect'
      argumentsSummary?: string
      status: 'proposed' | 'waiting_for_approval' | 'approved' | 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled'
    }
  | { type: 'tool_result'; toolCallId: string; summary: string; attachmentAssetId?: number }
  | {
      type: 'media_task'
      mediaType: 'image' | 'video'
      taskId: string
      status: 'queued' | 'generating' | 'polling' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
      progress?: number
    }
  | AIChatMediaPart
  | Record<string, unknown>

export type AIChatMessage = {
  id: number
  conversationId: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  status: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  parentMessageId: number | null
  providerMessageId: string | null
  parts: AIChatMessagePart[]
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  streamText?: string
}

export type AIChatRunEvent = {
  type:
    | 'started'
    | 'text_delta'
    | 'usage'
    | 'tool_proposed'
    | 'approval_required'
    | 'tool_running'
    | 'tool_completed'
    | 'tool_failed'
    | 'tool_rejected'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
  conversationId: number
  runId: number
  messageId: number
  sequence: number
  timestamp: string
  triggerMessageId?: number
  delta?: string
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  finishReason?: string
  error?: { code: string; message: string; retryable: boolean }
  toolCallId?: string
  serverId?: number
  serverName?: string
  toolName?: string
  risk?: 'read' | 'write' | 'command' | 'external_side_effect'
  argumentsSummary?: string
  status?: Extract<AIChatMessagePart, { type: 'tool_call' }>['status']
  summary?: string
}

export type AIChatToolApproval = {
  conversationId: number
  runId: number
  messageId: number
  toolCallId: string
  serverId: number
  serverName: string
  toolName: string
  risk: 'read' | 'write' | 'command' | 'external_side_effect'
  argumentsSummary: string
}

export type AIChatRunState = {
  conversationId: number
  runId: number
  messageId: number
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  sequence: number
  startedAt: string
  updatedAt: string
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  finishReason?: string
  error?: { code: string; message: string; retryable: boolean }
}

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function compareAIChatMessageOrder(left: AIChatMessage, right: AIChatMessage) {
  const leftTemporary = left.id < 0
  const rightTemporary = right.id < 0
  if (leftTemporary !== rightTemporary) return leftTemporary ? 1 : -1
  if (!leftTemporary) return left.id - right.id

  const timeDifference = timestamp(left.createdAt) - timestamp(right.createdAt)
  return timeDifference || right.id - left.id
}

export function sortAIConversations(conversations: AIChatConversation[]) {
  return [...conversations].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1
    const timeDifference =
      timestamp(right.lastMessageAt ?? right.updatedAt) -
      timestamp(left.lastMessageAt ?? left.updatedAt)
    return timeDifference || right.id - left.id
  })
}

export function createAIConversationTitle(text: string, maxLength = 54) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const firstSentence = normalized.split(/(?<=[。！？.!?])\s*/u)[0] || normalized
  return Array.from(firstSentence).slice(0, maxLength).join('').trim()
}

export function mergeAIChatMessages(
  current: AIChatMessage[],
  incoming: AIChatMessage[],
  mode: 'replace' | 'prepend' | 'append' = 'replace',
) {
  const ordered = mode === 'prepend' ? [...incoming, ...current] : mode === 'append' ? [...current, ...incoming] : incoming
  const currentById = new Map(current.map((message) => [message.id, message]))
  const deduplicated = new Map<number, AIChatMessage>()
  for (const message of ordered) {
    const previous = currentById.get(message.id)
    deduplicated.set(message.id, {
      ...previous,
      ...message,
      parts: message.parts,
      ...(previous?.streamText && message.status === 'streaming'
        ? { streamText: previous.streamText }
        : {}),
    })
  }
  return [...deduplicated.values()].sort(compareAIChatMessageOrder)
}

export async function loadAllAIChatMessages(
  loadPage: (options: { beforeId?: number; limit: number }) => Promise<AIChatMessage[]>,
  pageSize = 200,
) {
  const collected: AIChatMessage[] = []
  let beforeId: number | undefined

  while (true) {
    const page = await loadPage({ ...(beforeId ? { beforeId } : {}), limit: pageSize })
    if (page.length === 0) break
    collected.unshift(...page)
    if (page.length < pageSize) break

    const nextBeforeId = page[0]?.id
    if (!nextBeforeId || nextBeforeId === beforeId) {
      throw new Error('AI message pagination did not advance.')
    }
    beforeId = nextBeforeId
  }

  return mergeAIChatMessages([], collected)
}

export function createOptimisticRunMessages(input: {
  conversationId: number
  triggerMessageId: number
  messageId: number
  text: string
  timestamp: string
}) {
  const user: AIChatMessage = {
    id: input.triggerMessageId,
    conversationId: input.conversationId,
    role: 'user',
    status: 'completed',
    parentMessageId: null,
    providerMessageId: null,
    parts: [{ type: 'text', text: input.text }],
    createdAt: input.timestamp,
    startedAt: null,
    completedAt: input.timestamp,
  }
  const assistant: AIChatMessage = {
    id: input.messageId,
    conversationId: input.conversationId,
    role: 'assistant',
    status: 'streaming',
    parentMessageId: input.triggerMessageId,
    providerMessageId: null,
    parts: [],
    streamText: '',
    createdAt: input.timestamp,
    startedAt: input.timestamp,
    completedAt: null,
  }
  return [user, assistant]
}

export function createOptimisticMediaMessages(input: {
  conversationId: number
  mediaType: 'image' | 'video'
  text: string
  timestamp: string
  temporaryUserId: number
}) {
  const user: AIChatMessage = {
    id: input.temporaryUserId,
    conversationId: input.conversationId,
    role: 'user',
    status: 'completed',
    parentMessageId: null,
    providerMessageId: null,
    parts: [{ type: 'text', text: input.text }],
    createdAt: input.timestamp,
    startedAt: input.timestamp,
    completedAt: input.timestamp,
  }
  const assistantId = input.temporaryUserId - 1
  const assistant: AIChatMessage = {
    id: assistantId,
    conversationId: input.conversationId,
    role: 'assistant',
    status: 'streaming',
    parentMessageId: input.temporaryUserId,
    providerMessageId: null,
    parts: [{
      type: 'media_task',
      mediaType: input.mediaType,
      taskId: `optimistic-${Math.abs(assistantId)}`,
      status: 'generating',
    }],
    createdAt: input.timestamp,
    startedAt: input.timestamp,
    completedAt: null,
  }
  return [user, assistant]
}

export function applyAIChatRunEvent(messages: AIChatMessage[], event: AIChatRunEvent) {
  const terminalStatus =
    event.type === 'completed'
      ? 'completed'
      : event.type === 'failed'
        ? 'failed'
        : event.type === 'cancelled'
          ? 'cancelled'
          : event.type === 'interrupted'
            ? 'interrupted'
            : undefined
  let found = false
  const next = messages.map((message) => {
    if (message.id !== event.messageId) return message
    found = true
    const updateToolStatus = (
      status: Extract<AIChatMessagePart, { type: 'tool_call' }>['status'],
    ) => message.parts.map((part) =>
      part.type === 'tool_call' && part.toolCallId === event.toolCallId ? { ...part, status } : part,
    )
    if (event.type === 'tool_proposed' && event.toolCallId && event.serverId && event.toolName) {
      const exists = message.parts.some((part) => part.type === 'tool_call' && part.toolCallId === event.toolCallId)
      return {
        ...message,
        parts: exists ? message.parts : [...message.parts, {
          type: 'tool_call' as const,
          toolCallId: event.toolCallId,
          serverId: event.serverId,
          serverName: event.serverName,
          toolName: event.toolName,
          risk: event.risk,
          argumentsSummary: event.argumentsSummary,
          status: event.status ?? 'proposed',
        }],
      }
    }
    const toolStatus = event.type === 'approval_required'
      ? 'waiting_for_approval'
      : event.type === 'tool_running'
        ? 'running'
        : event.type === 'tool_completed'
          ? 'completed'
          : event.type === 'tool_failed'
            ? 'failed'
            : event.type === 'tool_rejected'
              ? 'rejected'
              : undefined
    if (toolStatus && event.toolCallId) {
      const parts = updateToolStatus(toolStatus)
      const summary = event.summary ?? (event.type === 'tool_failed' ? event.error?.message : undefined)
      const hasResult = parts.some((part) => part.type === 'tool_result' && part.toolCallId === event.toolCallId)
      return {
        ...message,
        parts: summary && !hasResult
          ? [...parts, { type: 'tool_result' as const, toolCallId: event.toolCallId, summary }]
          : parts,
      }
    }
    return {
      ...message,
      status: terminalStatus ?? (event.type === 'started' ? 'streaming' : message.status),
      streamText:
        event.type === 'text_delta'
          ? `${message.streamText ?? ''}${event.delta ?? ''}`
          : message.streamText,
      completedAt: terminalStatus ? event.timestamp : message.completedAt,
    } as AIChatMessage
  })
  if (found || event.type === 'usage' || event.type.startsWith('tool_') || event.type === 'approval_required') return next
  const placeholder: AIChatMessage = {
    id: event.messageId,
    conversationId: event.conversationId,
    role: 'assistant',
    status: terminalStatus ?? 'streaming',
    parentMessageId: event.triggerMessageId ?? null,
    providerMessageId: null,
    parts: [],
    streamText: event.type === 'text_delta' ? event.delta ?? '' : '',
    createdAt: event.timestamp,
    startedAt: event.timestamp,
    completedAt: terminalStatus ? event.timestamp : null,
  }
  return [...next, placeholder].sort(compareAIChatMessageOrder)
}

export function reduceAIChatRunState(
  current: AIChatRunState | undefined,
  event: AIChatRunEvent,
): AIChatRunState {
  const status =
    event.type === 'completed' ||
    event.type === 'failed' ||
    event.type === 'cancelled' ||
    event.type === 'interrupted'
      ? event.type
      : 'running'
  return {
    conversationId: event.conversationId,
    runId: event.runId,
    messageId: event.messageId,
    status,
    sequence: event.sequence,
    startedAt: current?.startedAt ?? event.timestamp,
    updatedAt: event.timestamp,
    usage: event.usage ? { ...current?.usage, ...event.usage } : current?.usage ?? {},
    ...(event.finishReason ? { finishReason: event.finishReason } : current?.finishReason ? { finishReason: current.finishReason } : {}),
    ...(event.error ? { error: event.error } : current?.error ? { error: current.error } : {}),
  }
}

export function shouldFollowAIChatScroll(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = 96,
) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
}

export function getAIComposerIntent(input: {
  key: string
  shiftKey: boolean
  isComposing: boolean
}) {
  if (input.key !== 'Enter' || input.isComposing) return 'none' as const
  return input.shiftKey ? ('newline' as const) : ('send' as const)
}

function messageText(message: AIChatMessage | undefined) {
  if (!message) return ''
  return message.parts
    .filter((part): part is Extract<AIChatMessagePart, { type: 'text' | 'markdown' | 'code' }> =>
      part.type === 'text' || part.type === 'markdown' || part.type === 'code',
    )
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function isMediaPart(part: AIChatMessagePart): part is AIChatMediaPart {
  return (
    part.type === 'image' ||
    part.type === 'video' ||
    part.type === 'audio' ||
    part.type === 'file'
  )
}

export function getAIChatRetryText(messages: AIChatMessage[], assistantMessageId: number) {
  const index = messages.findIndex((message) => message.id === assistantMessageId)
  if (index < 0) return ''
  const assistant = messages[index]
  if (assistant.parentMessageId) {
    const parent = messages.find((message) => message.id === assistant.parentMessageId)
    if (parent?.role === 'user') return messageText(parent)
  }
  for (let pointer = index - 1; pointer >= 0; pointer -= 1) {
    if (messages[pointer].role === 'user') return messageText(messages[pointer])
  }
  return ''
}

export function buildAIConversationMarkdown(title: string, messages: AIChatMessage[]) {
  const body = messages
    .map((message) => {
      const label = message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'User' : message.role
      const content = `${messageText(message)}${message.streamText ?? ''}`.trim()
      return content ? `## ${label}\n\n${content}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
  const media = messages.flatMap((message) =>
    message.parts
      .filter(isMediaPart)
      .map((part) => {
        const name = part.name ?? `${part.type}-${part.assetId}`
        return `- ${name} (${part.mimeType}, asset ${part.assetId})`
      }),
  )
  const manifest = media.length ? `\n\n## Media manifest\n\n${media.join('\n')}` : ''
  return `# ${title.trim() || 'AI Conversation'}\n\n${body}${manifest}`.trim()
}

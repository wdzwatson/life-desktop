import type { AIErrorDetail, AIToolCallStatus, AIToolRisk } from './types'

export const AI_RUN_EVENT_CHANNEL = 'ai:runs:event'

type AIRunEventBase = {
  conversationId: number
  runId: number
  messageId: number
  sequence: number
  timestamp: string
}

export type AIRunEvent =
  | (AIRunEventBase & { type: 'started'; triggerMessageId: number })
  | (AIRunEventBase & { type: 'text_delta'; delta: string })
  | (AIRunEventBase & {
      type: 'tool_proposed'
      toolCallId: string
      serverId: number
      serverName: string
      toolName: string
      risk: AIToolRisk
      argumentsSummary: string
      status: AIToolCallStatus
    })
  | (AIRunEventBase & {
      type: 'approval_required'
      toolCallId: string
      serverId: number
      serverName: string
      toolName: string
      risk: AIToolRisk
      argumentsSummary: string
    })
  | (AIRunEventBase & { type: 'tool_running'; toolCallId: string })
  | (AIRunEventBase & { type: 'tool_completed'; toolCallId: string; summary: string })
  | (AIRunEventBase & { type: 'tool_failed'; toolCallId: string; error: AIErrorDetail })
  | (AIRunEventBase & { type: 'tool_rejected'; toolCallId: string; summary: string })
  | (AIRunEventBase & {
      type: 'usage'
      usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    })
  | (AIRunEventBase & { type: 'completed'; finishReason?: string })
  | (AIRunEventBase & { type: 'failed'; error: AIErrorDetail })
  | (AIRunEventBase & { type: 'cancelled' })
  | (AIRunEventBase & { type: 'interrupted' })

export type AIRunEventPayload =
  | { type: 'started'; triggerMessageId: number }
  | { type: 'text_delta'; delta: string }
  | {
      type: 'tool_proposed'
      toolCallId: string
      serverId: number
      serverName: string
      toolName: string
      risk: AIToolRisk
      argumentsSummary: string
      status: AIToolCallStatus
    }
  | {
      type: 'approval_required'
      toolCallId: string
      serverId: number
      serverName: string
      toolName: string
      risk: AIToolRisk
      argumentsSummary: string
    }
  | { type: 'tool_running'; toolCallId: string }
  | { type: 'tool_completed'; toolCallId: string; summary: string }
  | { type: 'tool_failed'; toolCallId: string; error: AIErrorDetail }
  | { type: 'tool_rejected'; toolCallId: string; summary: string }
  | {
      type: 'usage'
      usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    }
  | { type: 'completed'; finishReason?: string }
  | { type: 'failed'; error: AIErrorDetail }
  | { type: 'cancelled' }
  | { type: 'interrupted' }

export class AIRunEventPublisher {
  private sequence = 0

  constructor(
    private readonly identity: Pick<AIRunEventBase, 'conversationId' | 'runId' | 'messageId'>,
    private readonly sink: (event: AIRunEvent) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  publish(payload: AIRunEventPayload) {
    const event = {
      ...this.identity,
      ...payload,
      sequence: ++this.sequence,
      timestamp: this.now().toISOString(),
    } as AIRunEvent
    this.sink(event)
    return event
  }
}

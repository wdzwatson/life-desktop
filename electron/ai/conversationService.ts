import type Database from 'better-sqlite3'
import { assertAIRunTransition } from './state'
import {
  AIServiceError,
  type AIErrorCode,
  type AIMessageContentBlock,
  type AIMessageRole,
  type AIRunStatus,
  type AIToolCallStatus,
  type AIToolRisk,
} from './types'

type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
type ToolApprovalStatus = 'not_required' | 'waiting' | 'approved_once' | 'approved_session' | 'rejected'

type ConversationRow = {
  id: number
  title: string
  agent_id: number | null
  agent_snapshot_json: string
  is_pinned: number
  is_archived: number
  created_at: string
  updated_at: string
  last_message_at: string | null
}

type MessageRow = {
  id: number
  conversation_id: number
  role: AIMessageRole
  status: MessageStatus
  parent_message_id: number | null
  provider_message_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

type MessagePartRow = {
  id: number
  message_id: number
  position: number
  content_type: AIMessageContentBlock['type']
  text_content: string | null
  metadata_json: string
  media_asset_id: number | null
  created_at: string
}

type ConversationEventRow = {
  id: number
  conversation_id: number
  event_type: 'model_switch'
  after_message_id: number | null
  payload_json: string
  created_at: string
}

type ModelSwitchEventPayload = {
  fromAgentId: number
  fromProvider: string
  fromModel: string
  toAgentId: number
  toProvider: string
  toModel: string
}

type RunRow = {
  id: number
  conversation_id: number
  trigger_message_id: number | null
  assistant_message_id: number | null
  agent_snapshot_json: string
  status: AIRunStatus
  current_stage: string | null
  provider_request_id: string | null
  usage_json: string
  error_code: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  last_activity_at: string
  created_at: string
}

type ToolCallRow = {
  id: number
  run_id: number
  tool_call_key: string
  mcp_server_id: number | null
  tool_name: string
  risk_level: AIToolRisk
  approval_status: ToolApprovalStatus
  status: AIToolCallStatus
  input_json_redacted: string
  result_summary: string | null
  result_asset_id: number | null
  error_code: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

type MediaAssetRow = {
  id: number
  provider_id: number | null
  run_id: number | null
  assistant_message_id: number | null
  media_type: 'image' | 'video' | 'audio' | 'file'
  mime_type: string
  local_path: string | null
  source_url_redacted: string | null
  provider_task_id: string | null
  original_name: string | null
  byte_size: number | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  sha256: string | null
  status: string
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  last_accessed_at: string | null
}

const MESSAGE_TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  pending: ['streaming', 'completed', 'failed', 'cancelled', 'interrupted'],
  streaming: ['completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
}

const TOOL_CALL_TRANSITIONS: Record<AIToolCallStatus, readonly AIToolCallStatus[]> = {
  proposed: ['waiting_for_approval', 'approved', 'running', 'failed', 'rejected', 'cancelled'],
  waiting_for_approval: ['approved', 'rejected', 'cancelled', 'failed'],
  approved: ['running', 'cancelled', 'failed'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  rejected: [],
  cancelled: [],
}

const MESSAGE_TERMINAL = new Set<MessageStatus>(['completed', 'failed', 'cancelled', 'interrupted'])
const TOOL_CALL_TERMINAL = new Set<AIToolCallStatus>(['completed', 'failed', 'rejected', 'cancelled'])

function isSensitiveKey(key: string) {
  const compact = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return (
    compact === 'authorization' ||
    compact === 'apikey' ||
    compact === 'token' ||
    compact.endsWith('accesstoken') ||
    compact.endsWith('refreshtoken') ||
    compact.endsWith('clientsecret') ||
    compact === 'secret' ||
    compact.endsWith('password') ||
    compact === 'cookie'
  )
}

function serviceError(
  code: 'invalid_input' | 'not_found' | 'configuration_incomplete' | 'storage_error',
  message: string,
  retryable = false,
) {
  return new AIServiceError({ code, message, retryable })
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function requireId(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1) throw serviceError('invalid_input', `Invalid ${field}.`)
  return Number(value)
}

function requireString(value: unknown, field: string, options: { max: number; allowEmpty?: boolean }) {
  if (typeof value !== 'string') throw serviceError('invalid_input', `Invalid ${field}.`)
  const normalized = value.trim()
  if ((!options.allowEmpty && !normalized) || normalized.length > options.max) {
    throw serviceError('invalid_input', `Invalid ${field}.`)
  }
  return normalized
}

function requirePlainObject(value: unknown, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw serviceError('invalid_input', `Invalid ${field}.`)
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  } catch {
    throw serviceError('invalid_input', `Invalid ${field}.`)
  }
}

function redactForStorage(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[TRUNCATED]'
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactForStorage(item, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 500)) {
      result[key] = isSensitiveKey(key) ? '[REDACTED]' : redactForStorage(item, depth + 1)
    }
    return result
  }
  if (typeof value === 'string') return value.length > 20_000 ? `${value.slice(0, 20_000)}…` : value
  return value
}

function redactSourceUrl(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    throw serviceError('invalid_input', 'Invalid media source URL.')
  }
}

export class AIConversationService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db.pragma('foreign_keys = ON')
  }

  listConversations(filters: { search?: string; archived?: boolean; limit?: number; offset?: number } = {}) {
    const search = filters.search?.trim() ?? ''
    const archived = filters.archived === true ? 1 : 0
    const limit = this.requirePageNumber(filters.limit, 'limit', 50, 1, 200)
    const offset = this.requirePageNumber(filters.offset, 'offset', 0, 0, 1_000_000)
    const rows = this.db
      .prepare(
        `
        SELECT c.*
        FROM ai_conversations c
        WHERE c.is_archived = ?
          AND (
            ? = ''
            OR instr(lower(c.title), lower(?)) > 0
            OR EXISTS (
              SELECT 1 FROM ai_messages m
              JOIN ai_message_parts p ON p.message_id = m.id
              WHERE m.conversation_id = c.id
                AND instr(lower(COALESCE(p.text_content, '')), lower(?)) > 0
            )
          )
        ORDER BY c.is_pinned DESC, COALESCE(c.last_message_at, c.updated_at) DESC, c.id DESC
        LIMIT ? OFFSET ?
        `,
      )
      .all(archived, search, search, search, limit, offset) as ConversationRow[]
    return rows.map((row) => this.toConversation(row))
  }

  getConversation(id: number) {
    return this.toConversation(this.requireConversationRow(id))
  }

  createConversation(input: { title: string; agentId?: number; agentSnapshot: unknown }) {
    const title = requireString(input.title, 'conversation title', { max: 300 })
    const agentId = input.agentId === undefined ? null : requireId(input.agentId, 'agent ID')
    if (agentId !== null) this.requireAgent(agentId)
    const snapshot = requirePlainObject(input.agentSnapshot, 'agent snapshot')
    const now = this.now().toISOString()
    try {
      const result = this.db
        .prepare(
          `
          INSERT INTO ai_conversations (
            title, agent_id, agent_snapshot_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(title, agentId, JSON.stringify(redactForStorage(snapshot)), now, now)
      return this.getConversation(Number(result.lastInsertRowid))
    } catch (error) {
      throw this.mapDbError(error, 'Conversation could not be created.')
    }
  }

  renameConversation(id: number, title: string) {
    this.requireConversationRow(id)
    const normalized = requireString(title, 'conversation title', { max: 300 })
    this.db
      .prepare('UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(normalized, this.now().toISOString(), id)
    return this.getConversation(id)
  }

  setConversationPinned(id: number, pinned: boolean) {
    this.requireConversationRow(id)
    if (typeof pinned !== 'boolean') throw serviceError('invalid_input', 'Invalid pinned state.')
    this.db
      .prepare('UPDATE ai_conversations SET is_pinned = ?, updated_at = ? WHERE id = ?')
      .run(pinned ? 1 : 0, this.now().toISOString(), id)
    return this.getConversation(id)
  }

  setConversationArchived(id: number, archived: boolean) {
    this.requireConversationRow(id)
    if (typeof archived !== 'boolean') throw serviceError('invalid_input', 'Invalid archived state.')
    this.db
      .prepare('UPDATE ai_conversations SET is_archived = ?, updated_at = ? WHERE id = ?')
      .run(archived ? 1 : 0, this.now().toISOString(), id)
    return this.getConversation(id)
  }

  deleteConversation(id: number, options: { deleteUnreferencedMedia?: boolean } = {}) {
    this.requireConversationRow(id)
    const mediaRows = this.db
      .prepare(
        `
        SELECT DISTINCT a.* FROM ai_media_assets a
        WHERE a.id IN (
          SELECT p.media_asset_id
          FROM ai_message_parts p
          JOIN ai_messages m ON m.id = p.message_id
          WHERE m.conversation_id = ? AND p.media_asset_id IS NOT NULL
          UNION
          SELECT tc.result_asset_id
          FROM ai_tool_calls tc
          JOIN ai_runs r ON r.id = tc.run_id
          WHERE r.conversation_id = ? AND tc.result_asset_id IS NOT NULL
        )
        ORDER BY a.id
        `,
      )
      .all(id, id) as MediaAssetRow[]

    const deletedAssets: MediaAssetRow[] = []
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id)
      if (!options.deleteUnreferencedMedia) return
      for (const asset of mediaRows) {
        const reference = this.db
          .prepare(
            `
            SELECT 1 FROM ai_message_parts WHERE media_asset_id = ?
            UNION ALL
            SELECT 1 FROM ai_tool_calls WHERE result_asset_id = ?
            LIMIT 1
            `,
          )
          .get(asset.id, asset.id)
        if (!reference) {
          this.db.prepare('DELETE FROM ai_media_assets WHERE id = ?').run(asset.id)
          deletedAssets.push(asset)
        }
      }
    })()
    return {
      deleted: true,
      deletedMediaAssets: deletedAssets.map((row) => this.toMediaAsset(row)),
      preservedMediaCount: mediaRows.length - deletedAssets.length,
    }
  }

  createMessage(input: {
    conversationId: number
    role: AIMessageRole
    status?: MessageStatus
    parentMessageId?: number
    providerMessageId?: string
    parts?: AIMessageContentBlock[]
  }) {
    const conversationId = requireId(input.conversationId, 'conversation ID')
    this.requireConversationRow(conversationId)
    if (!['user', 'assistant', 'tool', 'system'].includes(input.role)) {
      throw serviceError('invalid_input', 'Invalid message role.')
    }
    const status = input.status ?? 'completed'
    if (!Object.hasOwn(MESSAGE_TRANSITIONS, status)) throw serviceError('invalid_input', 'Invalid message status.')
    const parentMessageId = input.parentMessageId === undefined ? null : requireId(input.parentMessageId, 'parent message ID')
    if (parentMessageId !== null) this.requireMessageInConversation(parentMessageId, conversationId)
    const providerMessageId = input.providerMessageId
      ? requireString(input.providerMessageId, 'provider message ID', { max: 1_000 })
      : null
    const parts = input.parts ?? []
    if (!Array.isArray(parts) || parts.length > 1_000) throw serviceError('invalid_input', 'Invalid message parts.')
    const now = this.now().toISOString()
    let messageId = 0
    try {
      this.db.transaction(() => {
        const result = this.db
          .prepare(
            `
            INSERT INTO ai_messages (
              conversation_id, role, status, parent_message_id, provider_message_id,
              created_at, started_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            conversationId,
            input.role,
            status,
            parentMessageId,
            providerMessageId,
            now,
            status === 'streaming' ? now : null,
            MESSAGE_TERMINAL.has(status) ? now : null,
          )
        messageId = Number(result.lastInsertRowid)
        this.insertMessageParts(messageId, parts, 0, now)
        this.touchConversation(conversationId, now)
      })()
      return this.getMessage(messageId)
    } catch (error) {
      throw this.mapDbError(error, 'Message could not be saved.')
    }
  }

  appendMessageParts(messageId: number, parts: AIMessageContentBlock[]) {
    const message = this.requireMessageRow(messageId)
    if (MESSAGE_TERMINAL.has(message.status)) {
      throw serviceError('invalid_input', 'Completed messages cannot be modified.')
    }
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > 1_000) {
      throw serviceError('invalid_input', 'Invalid message parts.')
    }
    const nextPosition = Number(
      (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM ai_message_parts WHERE message_id = ?').get(messageId) as { position: number }).position,
    )
    const now = this.now().toISOString()
    this.db.transaction(() => {
      this.insertMessageParts(messageId, parts, nextPosition, now)
      this.touchConversation(message.conversation_id, now)
    })()
    return this.getMessage(messageId)
  }

  transitionMessage(messageId: number, status: MessageStatus, providerMessageId?: string) {
    const row = this.requireMessageRow(messageId)
    if (!Object.hasOwn(MESSAGE_TRANSITIONS, status) || !MESSAGE_TRANSITIONS[row.status].includes(status)) {
      throw serviceError('invalid_input', `Invalid message transition: ${row.status} -> ${status}`)
    }
    const now = this.now().toISOString()
    const normalizedProviderId = providerMessageId
      ? requireString(providerMessageId, 'provider message ID', { max: 1_000 })
      : row.provider_message_id
    this.db
      .prepare(
        `
        UPDATE ai_messages SET status = ?, provider_message_id = ?,
          started_at = CASE WHEN ? = 'streaming' AND started_at IS NULL THEN ? ELSE started_at END,
          completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled', 'interrupted') THEN ? ELSE completed_at END
        WHERE id = ?
        `,
      )
      .run(status, normalizedProviderId, status, now, status, now, messageId)
    this.touchConversation(row.conversation_id, now)
    return this.getMessage(messageId)
  }

  getMessage(id: number) {
    const row = this.requireMessageRow(id)
    const parts = this.db
      .prepare('SELECT * FROM ai_message_parts WHERE message_id = ? ORDER BY position, id')
      .all(id) as MessagePartRow[]
    return this.toMessage(row, parts)
  }

  listMessages(conversationId: number, options: { beforeId?: number; limit?: number } = {}) {
    this.requireConversationRow(conversationId)
    const beforeId = options.beforeId === undefined ? Number.MAX_SAFE_INTEGER : requireId(options.beforeId, 'before message ID')
    const limit = this.requirePageNumber(options.limit, 'limit', 50, 1, 200)
    const rows = this.db
      .prepare(
        'SELECT * FROM ai_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
      )
      .all(conversationId, beforeId, limit) as MessageRow[]
    const ordered = rows.reverse()
    if (ordered.length === 0) return []
    const ids = ordered.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(',')
    const parts = this.db
      .prepare(`SELECT * FROM ai_message_parts WHERE message_id IN (${placeholders}) ORDER BY message_id, position, id`)
      .all(...ids) as MessagePartRow[]
    const byMessage = new Map<number, MessagePartRow[]>()
    for (const part of parts) {
      const current = byMessage.get(part.message_id) ?? []
      current.push(part)
      byMessage.set(part.message_id, current)
    }
    return ordered.map((row) => this.toMessage(row, byMessage.get(row.id) ?? []))
  }

  listConversationEvents(conversationId: number) {
    const normalizedConversationId = requireId(conversationId, 'conversation ID')
    this.requireConversationRow(normalizedConversationId)
    return (this.db
      .prepare('SELECT * FROM ai_conversation_events WHERE conversation_id = ? ORDER BY id')
      .all(normalizedConversationId) as ConversationEventRow[]).map((row) => this.toConversationEvent(row))
  }

  upsertModelSwitchEvent(input: {
    conversationId: number
    afterMessageId?: number | null
    payload: ModelSwitchEventPayload
  }) {
    const conversationId = requireId(input.conversationId, 'conversation ID')
    this.requireConversationRow(conversationId)
    const afterMessageId = input.afterMessageId === undefined || input.afterMessageId === null
      ? null
      : requireId(input.afterMessageId, 'after message ID')
    if (afterMessageId !== null) this.requireMessageInConversation(afterMessageId, conversationId)
    const payload = this.requireModelSwitchEventPayload(input.payload)
    const now = this.now().toISOString()
    try {
      this.db.prepare(`
        INSERT INTO ai_conversation_events (
          conversation_id, event_type, after_message_id, payload_json, created_at
        ) VALUES (?, 'model_switch', ?, ?, ?)
        ON CONFLICT DO UPDATE SET
          payload_json = excluded.payload_json,
          created_at = excluded.created_at
      `).run(conversationId, afterMessageId, JSON.stringify(payload), now)
      const row = this.db.prepare(`
        SELECT * FROM ai_conversation_events
        WHERE conversation_id = ? AND event_type = 'model_switch'
          AND COALESCE(after_message_id, 0) = COALESCE(?, 0)
      `).get(conversationId, afterMessageId) as ConversationEventRow
      return this.toConversationEvent(row)
    } catch (error) {
      throw this.mapDbError(error, 'Conversation event could not be saved.')
    }
  }

  deleteModelSwitchEvent(conversationId: number, afterMessageId?: number | null) {
    const normalizedConversationId = requireId(conversationId, 'conversation ID')
    this.requireConversationRow(normalizedConversationId)
    const normalizedMessageId = afterMessageId === undefined || afterMessageId === null
      ? null
      : requireId(afterMessageId, 'after message ID')
    const result = this.db.prepare(`
      DELETE FROM ai_conversation_events
      WHERE conversation_id = ? AND event_type = 'model_switch'
        AND COALESCE(after_message_id, 0) = COALESCE(?, 0)
    `).run(normalizedConversationId, normalizedMessageId)
    return { deleted: result.changes > 0 }
  }

  createRun(input: {
    conversationId: number
    triggerMessageId?: number
    assistantMessageId?: number
    agentSnapshot: unknown
    status?: AIRunStatus
    currentStage?: string
  }) {
    const conversationId = requireId(input.conversationId, 'conversation ID')
    this.requireConversationRow(conversationId)
    const triggerMessageId = input.triggerMessageId === undefined ? null : requireId(input.triggerMessageId, 'trigger message ID')
    const assistantMessageId = input.assistantMessageId === undefined ? null : requireId(input.assistantMessageId, 'assistant message ID')
    if (triggerMessageId !== null) this.requireMessageInConversation(triggerMessageId, conversationId)
    if (assistantMessageId !== null) this.requireMessageInConversation(assistantMessageId, conversationId)
    const snapshot = requirePlainObject(input.agentSnapshot, 'agent snapshot')
    const status = input.status ?? 'queued'
    if (!['queued', 'running'].includes(status)) throw serviceError('invalid_input', 'Invalid initial run status.')
    const stage = input.currentStage
      ? requireString(input.currentStage, 'run stage', { max: 300 })
      : null
    const now = this.now().toISOString()
    const result = this.db
      .prepare(
        `
        INSERT INTO ai_runs (
          conversation_id, trigger_message_id, assistant_message_id, agent_snapshot_json,
          status, current_stage, started_at, last_activity_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        conversationId,
        triggerMessageId,
        assistantMessageId,
        JSON.stringify(redactForStorage(snapshot)),
        status,
        stage,
        status === 'running' ? now : null,
        now,
        now,
      )
    return this.getRun(Number(result.lastInsertRowid))
  }

  getRun(id: number) {
    return this.toRun(this.requireRunRow(id))
  }

  listRuns(conversationId: number, limit = 50) {
    this.requireConversationRow(conversationId)
    const normalizedLimit = this.requirePageNumber(limit, 'limit', 50, 1, 200)
    return (this.db
      .prepare('SELECT * FROM ai_runs WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
      .all(conversationId, normalizedLimit) as RunRow[]).map((row) => this.toRun(row))
  }

  interruptUnfinishedRuns(options: { excludeRunIds?: Iterable<number> } = {}) {
    const now = this.now().toISOString()
    const excluded = new Set(options.excludeRunIds ?? [])
    const rows = (this.db
      .prepare(
        `
        SELECT id, assistant_message_id
        FROM ai_runs
        WHERE status IN ('queued', 'running', 'waiting_for_tool', 'waiting_for_approval')
        ORDER BY id
        `,
      )
      .all() as Array<{ id: number; assistant_message_id: number | null }>)
      .filter((row) => !excluded.has(row.id))
    if (rows.length === 0) return { interruptedRunIds: [], interruptedMessageIds: [] }
    const interruptedMessageIds: number[] = []
    this.db.transaction(() => {
      for (const row of rows) {
        this.db
          .prepare(
            `
            UPDATE ai_runs SET status = 'interrupted', current_stage = 'interrupted',
              error_code = 'cancelled', error_message = 'The previous application session ended before this run completed.',
              completed_at = ?, last_activity_at = ?
            WHERE id = ?
            `,
          )
          .run(now, now, row.id)
        if (row.assistant_message_id === null) continue
        const result = this.db
          .prepare(
            `
            UPDATE ai_messages SET status = 'interrupted', completed_at = ?
            WHERE id = ? AND status IN ('pending', 'streaming')
            `,
          )
          .run(now, row.assistant_message_id)
        if (result.changes > 0) interruptedMessageIds.push(row.assistant_message_id)
      }
    })()
    return { interruptedRunIds: rows.map((row) => row.id), interruptedMessageIds }
  }

  transitionRun(
    id: number,
    status: AIRunStatus,
    updates: {
      currentStage?: string
      providerRequestId?: string
      usage?: Record<string, unknown>
      errorCode?: AIErrorCode
      errorMessage?: string
    } = {},
  ) {
    const row = this.requireRunRow(id)
    try {
      assertAIRunTransition(row.status, status)
    } catch (error) {
      throw serviceError('invalid_input', error instanceof Error ? error.message : 'Invalid AI run transition.')
    }
    const now = this.now().toISOString()
    const stage = updates.currentStage === undefined
      ? row.current_stage
      : requireString(updates.currentStage, 'run stage', { max: 300, allowEmpty: true }) || null
    const requestId = updates.providerRequestId === undefined
      ? row.provider_request_id
      : requireString(updates.providerRequestId, 'provider request ID', { max: 1_000, allowEmpty: true }) || null
    const usage = updates.usage === undefined ? row.usage_json : JSON.stringify(redactForStorage(requirePlainObject(updates.usage, 'run usage')))
    const errorMessage = updates.errorMessage === undefined
      ? row.error_message
      : requireString(updates.errorMessage, 'run error message', { max: 20_000, allowEmpty: true }) || null
    this.db
      .prepare(
        `
        UPDATE ai_runs SET status = ?, current_stage = ?, provider_request_id = ?, usage_json = ?,
          error_code = ?, error_message = ?,
          started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
          completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled', 'interrupted') THEN ? ELSE completed_at END,
          last_activity_at = ?
        WHERE id = ?
        `,
      )
      .run(
        status,
        stage,
        requestId,
        usage,
        updates.errorCode ?? row.error_code,
        errorMessage,
        status,
        now,
        status,
        now,
        now,
        id,
      )
    return this.getRun(id)
  }

  createToolCall(input: {
    runId: number
    toolCallKey: string
    mcpServerId?: number
    toolName: string
    riskLevel: AIToolRisk
    approvalStatus?: ToolApprovalStatus
    status?: AIToolCallStatus
    input: unknown
  }) {
    const runId = requireId(input.runId, 'run ID')
    this.requireRunRow(runId)
    const toolCallKey = requireString(input.toolCallKey, 'tool call key', { max: 300 })
    const toolName = requireString(input.toolName, 'tool name', { max: 300 })
    if (!['read', 'write', 'command', 'external_side_effect'].includes(input.riskLevel)) {
      throw serviceError('invalid_input', 'Invalid tool risk level.')
    }
    const approvalStatus = input.approvalStatus ?? 'not_required'
    if (!['not_required', 'waiting', 'approved_once', 'approved_session', 'rejected'].includes(approvalStatus)) {
      throw serviceError('invalid_input', 'Invalid tool approval status.')
    }
    const status = input.status ?? 'proposed'
    if (!Object.hasOwn(TOOL_CALL_TRANSITIONS, status)) throw serviceError('invalid_input', 'Invalid tool call status.')
    const mcpServerId = input.mcpServerId === undefined ? null : requireId(input.mcpServerId, 'MCP server ID')
    if (mcpServerId !== null) this.requireMcpServer(mcpServerId)
    const redactedInput = JSON.stringify(redactForStorage(requirePlainObject(input.input, 'tool input')))
    const now = this.now().toISOString()
    try {
      const result = this.db
        .prepare(
          `
          INSERT INTO ai_tool_calls (
            run_id, tool_call_key, mcp_server_id, tool_name, risk_level,
            approval_status, status, input_json_redacted, started_at, completed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          runId,
          toolCallKey,
          mcpServerId,
          toolName,
          input.riskLevel,
          approvalStatus,
          status,
          redactedInput,
          status === 'running' ? now : null,
          TOOL_CALL_TERMINAL.has(status) ? now : null,
          now,
        )
      return this.getToolCall(Number(result.lastInsertRowid))
    } catch (error) {
      throw this.mapDbError(error, 'Tool call could not be saved.')
    }
  }

  transitionToolCall(
    id: number,
    status: AIToolCallStatus,
    updates: {
      approvalStatus?: ToolApprovalStatus
      resultSummary?: string
      resultAssetId?: number
      errorCode?: string
      errorMessage?: string
    } = {},
  ) {
    const row = this.requireToolCallRow(id)
    if (!Object.hasOwn(TOOL_CALL_TRANSITIONS, status) || !TOOL_CALL_TRANSITIONS[row.status].includes(status)) {
      throw serviceError('invalid_input', `Invalid tool call transition: ${row.status} -> ${status}`)
    }
    if (updates.resultAssetId !== undefined) this.requireMediaAsset(updates.resultAssetId)
    const approvalStatus = updates.approvalStatus ?? row.approval_status
    if (!['not_required', 'waiting', 'approved_once', 'approved_session', 'rejected'].includes(approvalStatus)) {
      throw serviceError('invalid_input', 'Invalid tool approval status.')
    }
    const summary = updates.resultSummary === undefined
      ? row.result_summary
      : requireString(updates.resultSummary, 'tool result summary', { max: 20_000, allowEmpty: true }) || null
    const errorMessage = updates.errorMessage === undefined
      ? row.error_message
      : requireString(updates.errorMessage, 'tool error message', { max: 20_000, allowEmpty: true }) || null
    const now = this.now().toISOString()
    this.db
      .prepare(
        `
        UPDATE ai_tool_calls SET status = ?, approval_status = ?, result_summary = ?,
          result_asset_id = ?, error_code = ?, error_message = ?,
          started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
          completed_at = CASE WHEN ? IN ('completed', 'failed', 'rejected', 'cancelled') THEN ? ELSE completed_at END
        WHERE id = ?
        `,
      )
      .run(
        status,
        approvalStatus,
        summary,
        updates.resultAssetId ?? row.result_asset_id,
        updates.errorCode ?? row.error_code,
        errorMessage,
        status,
        now,
        status,
        now,
        id,
      )
    return this.getToolCall(id)
  }

  getToolCall(id: number) {
    return this.toToolCall(this.requireToolCallRow(id))
  }

  listToolCalls(runId: number) {
    this.requireRunRow(runId)
    return (this.db
      .prepare('SELECT * FROM ai_tool_calls WHERE run_id = ? ORDER BY id')
      .all(runId) as ToolCallRow[]).map((row) => this.toToolCall(row))
  }

  createMediaAssetRecord(input: {
    providerId?: number
    mediaType: 'image' | 'video' | 'audio' | 'file'
    mimeType: string
    localPath?: string
    sourceUrl?: string
    providerTaskId?: string
    originalName?: string
    status?: string
  }) {
    if (!['image', 'video', 'audio', 'file'].includes(input.mediaType)) {
      throw serviceError('invalid_input', 'Invalid media type.')
    }
    const providerId = input.providerId === undefined ? null : requireId(input.providerId, 'provider ID')
    if (providerId !== null) this.requireProvider(providerId)
    const mimeType = requireString(input.mimeType, 'media MIME type', { max: 300 })
    const localPath = input.localPath
      ? requireString(input.localPath, 'media local path', { max: 8_000 })
      : null
    const sourceUrl = redactSourceUrl(input.sourceUrl) ?? null
    const providerTaskId = input.providerTaskId
      ? requireString(input.providerTaskId, 'provider task ID', { max: 1_000 })
      : null
    const originalName = input.originalName
      ? requireString(input.originalName, 'media original name', { max: 1_000 })
      : null
    const status = input.status ?? 'queued'
    if (!['queued', 'generating', 'polling', 'downloading', 'processing', 'completed', 'failed', 'cancelled', 'interrupted'].includes(status)) {
      throw serviceError('invalid_input', 'Invalid media status.')
    }
    const now = this.now().toISOString()
    const result = this.db
      .prepare(
        `
        INSERT INTO ai_media_assets (
          provider_id, media_type, mime_type, local_path, source_url_redacted,
          provider_task_id, original_name, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(providerId, input.mediaType, mimeType, localPath, sourceUrl, providerTaskId, originalName, status, now, now)
    return this.getMediaAsset(Number(result.lastInsertRowid))
  }

  getMediaAsset(id: number) {
    return this.toMediaAsset(this.requireMediaAsset(id))
  }

  private insertMessageParts(messageId: number, parts: AIMessageContentBlock[], startPosition: number, now: string) {
    const insert = this.db.prepare(
      `
      INSERT INTO ai_message_parts (
        message_id, position, content_type, text_content, metadata_json, media_asset_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    parts.forEach((part, index) => {
      const serialized = this.serializeMessagePart(part)
      insert.run(
        messageId,
        startPosition + index,
        part.type,
        serialized.textContent,
        JSON.stringify(serialized.metadata),
        serialized.mediaAssetId,
        now,
      )
    })
  }

  private serializeMessagePart(part: AIMessageContentBlock) {
    if (!part || typeof part !== 'object' || !('type' in part)) throw serviceError('invalid_input', 'Invalid message part.')
    if (['text', 'markdown', 'code'].includes(part.type)) {
      const block = part as Extract<AIMessageContentBlock, { type: 'text' | 'markdown' | 'code' }>
      if (typeof block.text !== 'string' || block.text.length > 1_000_000) throw serviceError('invalid_input', 'Invalid message text.')
      return { textContent: block.text, metadata: block.language ? { language: block.language } : {}, mediaAssetId: null }
    }
    if (['image', 'video', 'audio', 'file'].includes(part.type)) {
      const block = part as Extract<AIMessageContentBlock, { type: 'image' | 'video' | 'audio' | 'file' }>
      const assetId = requireId(block.assetId, 'media asset ID')
      this.requireMediaAsset(assetId)
      const posterAssetId = block.posterAssetId === undefined ? undefined : requireId(block.posterAssetId, 'poster media asset ID')
      if (posterAssetId) this.requireMediaAsset(posterAssetId)
      return {
        textContent: null,
        metadata: {
          mimeType: block.mimeType,
          name: block.name,
          alt: block.alt,
          posterAssetId,
          durationSeconds: block.durationSeconds,
        },
        mediaAssetId: assetId,
      }
    }
    if (part.type === 'tool_call') {
      return { textContent: null, metadata: redactForStorage(part), mediaAssetId: null }
    }
    if (part.type === 'tool_result') {
      if (typeof part.summary !== 'string' || part.summary.length > 20_000) {
        throw serviceError('invalid_input', 'Invalid tool result summary.')
      }
      if (part.attachmentAssetId) this.requireMediaAsset(part.attachmentAssetId)
      return {
        textContent: part.summary,
        metadata: { toolCallId: part.toolCallId },
        mediaAssetId: part.attachmentAssetId ?? null,
      }
    }
    if (part.type === 'media_task') {
      return { textContent: null, metadata: redactForStorage(part), mediaAssetId: null }
    }
    if (part.type === 'error') {
      if (typeof part.message !== 'string' || part.message.length > 20_000) {
        throw serviceError('invalid_input', 'Invalid message error.')
      }
      return {
        textContent: part.message,
        metadata: { code: part.code, retryable: part.retryable },
        mediaAssetId: null,
      }
    }
    throw serviceError('invalid_input', 'Unsupported message part type.')
  }

  private deserializeMessagePart(row: MessagePartRow): AIMessageContentBlock {
    const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {})
    if (row.content_type === 'text' || row.content_type === 'markdown' || row.content_type === 'code') {
      return {
        type: row.content_type,
        text: row.text_content ?? '',
        ...(typeof metadata.language === 'string' ? { language: metadata.language } : {}),
      }
    }
    if (row.content_type === 'image' || row.content_type === 'video' || row.content_type === 'audio' || row.content_type === 'file') {
      return {
        type: row.content_type,
        assetId: row.media_asset_id as number,
        mimeType: typeof metadata.mimeType === 'string' ? metadata.mimeType : 'application/octet-stream',
        ...(typeof metadata.name === 'string' ? { name: metadata.name } : {}),
        ...(typeof metadata.alt === 'string' ? { alt: metadata.alt } : {}),
        ...(Number.isInteger(metadata.posterAssetId) && Number(metadata.posterAssetId) > 0 ? { posterAssetId: Number(metadata.posterAssetId) } : {}),
        ...(typeof metadata.durationSeconds === 'number' && Number.isFinite(metadata.durationSeconds) ? { durationSeconds: metadata.durationSeconds } : {}),
      }
    }
    if (row.content_type === 'tool_result') {
      return {
        type: 'tool_result',
        toolCallId: String(metadata.toolCallId ?? ''),
        summary: row.text_content ?? '',
        ...(row.media_asset_id ? { attachmentAssetId: row.media_asset_id } : {}),
      }
    }
    if (row.content_type === 'error') {
      return {
        type: 'error',
        code: String(metadata.code ?? 'internal_error') as AIErrorCode,
        message: row.text_content ?? '',
        retryable: metadata.retryable === true,
      }
    }
    return { ...metadata, type: row.content_type } as AIMessageContentBlock
  }

  private toConversation(row: ConversationRow) {
    const messageCount = Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM ai_messages WHERE conversation_id = ?').get(row.id) as { count: number }).count,
    )
    return {
      id: row.id,
      title: row.title,
      agentId: row.agent_id,
      agentSnapshot: parseJson<Record<string, unknown>>(row.agent_snapshot_json, {}),
      isPinned: Boolean(row.is_pinned),
      isArchived: Boolean(row.is_archived),
      messageCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at,
    }
  }

  private toConversationEvent(row: ConversationEventRow) {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      eventType: row.event_type,
      afterMessageId: row.after_message_id,
      payload: parseJson<ModelSwitchEventPayload>(row.payload_json, {
        fromAgentId: 0,
        fromProvider: '',
        fromModel: '',
        toAgentId: 0,
        toProvider: '',
        toModel: '',
      }),
      createdAt: row.created_at,
    }
  }

  private toMessage(row: MessageRow, parts: MessagePartRow[]) {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      status: row.status,
      parentMessageId: row.parent_message_id,
      providerMessageId: row.provider_message_id,
      parts: parts.map((part) => this.deserializeMessagePart(part)),
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }
  }

  private toRun(row: RunRow) {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      triggerMessageId: row.trigger_message_id,
      assistantMessageId: row.assistant_message_id,
      agentSnapshot: parseJson<Record<string, unknown>>(row.agent_snapshot_json, {}),
      status: row.status,
      currentStage: row.current_stage,
      providerRequestId: row.provider_request_id,
      usage: parseJson<Record<string, unknown>>(row.usage_json, {}),
      error: row.error_code || row.error_message ? { code: row.error_code, message: row.error_message } : null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
    }
  }

  private toToolCall(row: ToolCallRow) {
    return {
      id: row.id,
      runId: row.run_id,
      toolCallKey: row.tool_call_key,
      mcpServerId: row.mcp_server_id,
      toolName: row.tool_name,
      riskLevel: row.risk_level,
      approvalStatus: row.approval_status,
      status: row.status,
      input: parseJson<Record<string, unknown>>(row.input_json_redacted, {}),
      resultSummary: row.result_summary,
      resultAssetId: row.result_asset_id,
      error: row.error_code || row.error_message ? { code: row.error_code, message: row.error_message } : null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    }
  }

  private toMediaAsset(row: MediaAssetRow) {
    return {
      id: row.id,
      providerId: row.provider_id,
      runId: row.run_id,
      assistantMessageId: row.assistant_message_id,
      mediaType: row.media_type,
      mimeType: row.mime_type,
      localPath: row.local_path,
      sourceUrlRedacted: row.source_url_redacted,
      providerTaskId: row.provider_task_id,
      originalName: row.original_name,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      durationSeconds: row.duration_seconds,
      sha256: row.sha256,
      status: row.status,
      error: row.error_code || row.error_message ? { code: row.error_code, message: row.error_message } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at,
    }
  }

  private touchConversation(id: number, at: string) {
    this.db
      .prepare('UPDATE ai_conversations SET updated_at = ?, last_message_at = ? WHERE id = ?')
      .run(at, at, id)
  }

  private requireConversationRow(id: number) {
    const normalized = requireId(id, 'conversation ID')
    const row = this.db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(normalized) as ConversationRow | undefined
    if (!row) throw serviceError('not_found', 'AI conversation was not found.')
    return row
  }

  private requireMessageRow(id: number) {
    const normalized = requireId(id, 'message ID')
    const row = this.db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(normalized) as MessageRow | undefined
    if (!row) throw serviceError('not_found', 'AI message was not found.')
    return row
  }

  private requireRunRow(id: number) {
    const normalized = requireId(id, 'run ID')
    const row = this.db.prepare('SELECT * FROM ai_runs WHERE id = ?').get(normalized) as RunRow | undefined
    if (!row) throw serviceError('not_found', 'AI run was not found.')
    return row
  }

  private requireToolCallRow(id: number) {
    const normalized = requireId(id, 'tool call ID')
    const row = this.db.prepare('SELECT * FROM ai_tool_calls WHERE id = ?').get(normalized) as ToolCallRow | undefined
    if (!row) throw serviceError('not_found', 'AI tool call was not found.')
    return row
  }

  private requireMediaAsset(id: number) {
    const normalized = requireId(id, 'media asset ID')
    const row = this.db.prepare('SELECT * FROM ai_media_assets WHERE id = ?').get(normalized) as MediaAssetRow | undefined
    if (!row) throw serviceError('not_found', 'AI media asset was not found.')
    return row
  }

  private requireMessageInConversation(messageId: number, conversationId: number) {
    const message = this.requireMessageRow(messageId)
    if (message.conversation_id !== conversationId) {
      throw serviceError('invalid_input', 'Message does not belong to the conversation.')
    }
    return message
  }

  private requireModelSwitchEventPayload(value: unknown): ModelSwitchEventPayload {
    const payload = requirePlainObject(value, 'model switch payload')
    return {
      fromAgentId: requireId(payload.fromAgentId, 'source agent ID'),
      fromProvider: requireString(payload.fromProvider, 'source provider', { max: 300 }),
      fromModel: requireString(payload.fromModel, 'source model', { max: 1_000 }),
      toAgentId: requireId(payload.toAgentId, 'target agent ID'),
      toProvider: requireString(payload.toProvider, 'target provider', { max: 300 }),
      toModel: requireString(payload.toModel, 'target model', { max: 1_000 }),
    }
  }

  private requireAgent(id: number) {
    if (!this.db.prepare('SELECT 1 FROM ai_agents WHERE id = ?').get(id)) {
      throw serviceError('not_found', 'AI agent was not found.')
    }
  }

  private requireProvider(id: number) {
    if (!this.db.prepare('SELECT 1 FROM ai_providers WHERE id = ?').get(id)) {
      throw serviceError('not_found', 'AI provider was not found.')
    }
  }

  private requireMcpServer(id: number) {
    if (!this.db.prepare('SELECT 1 FROM ai_mcp_servers WHERE id = ?').get(id)) {
      throw serviceError('not_found', 'MCP server was not found.')
    }
  }

  private requirePageNumber(value: number | undefined, field: string, fallback: number, min: number, max: number) {
    if (value === undefined) return fallback
    if (!Number.isInteger(value) || value < min || value > max) throw serviceError('invalid_input', `Invalid ${field}.`)
    return value
  }

  private mapDbError(error: unknown, message: string) {
    if (error instanceof AIServiceError) return error
    const detail = error instanceof Error ? error.message : String(error)
    if (/UNIQUE constraint failed/i.test(detail)) return serviceError('invalid_input', 'AI record already exists.')
    if (/FOREIGN KEY constraint failed/i.test(detail)) return serviceError('configuration_incomplete', 'AI record references missing data.')
    return serviceError('storage_error', message, true)
  }
}

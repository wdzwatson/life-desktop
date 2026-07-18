import type Database from 'better-sqlite3'
import { AIServiceError, type AIAgentConfigInput, type AIProviderCapability } from './types'
import { parseAIAgentConfigInput } from './validation'

type AgentRow = {
  id: number
  name: string
  description: string
  system_prompt: string
  text_provider_id: number
  image_provider_id: number | null
  video_provider_id: number | null
  model_params_json: string
  context_json: string
  allowed_tools_json: string
  blocked_tools_json: string
  tool_approval_mode: AIAgentConfigInput['toolApprovalMode']
  max_tool_calls: number
  enabled: number
  is_default: number
  configuration_status: 'ready' | 'incomplete'
  created_at: string
  updated_at: string
}

type ProviderDependencyRow = {
  id: number
  name: string
  enabled: number
  capabilities_json: string
  text_model: string | null
  image_model: string | null
  video_model: string | null
}

export type AIAgentSummary = {
  id: number
  name: string
  description: string
  systemPrompt: string
  providers: { text: number; image?: number; video?: number }
  mcpServerIds: number[]
  allowedTools: string[]
  blockedTools: string[]
  toolApprovalMode: AIAgentConfigInput['toolApprovalMode']
  maxToolCalls: number
  temperature?: number
  context: AIAgentConfigInput['context']
  enabled: boolean
  isDefault: boolean
  configurationStatus: 'ready' | 'incomplete'
  issues: string[]
  createdAt: string
  updatedAt: string
}

export type AIAgentSnapshot = {
  agentId: number
  name: string
  systemPrompt: string
  toolApprovalMode: AIAgentConfigInput['toolApprovalMode']
  maxToolCalls: number
  allowedTools: string[]
  blockedTools: string[]
  modelParams: { temperature?: number }
  context: AIAgentConfigInput['context']
  providers: {
    text: { id: number; name: string; model: string }
    image?: { id: number; name: string; model: string }
    video?: { id: number; name: string; model: string }
  }
  mcpServerIds: number[]
  capturedAt: string
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

export class AIAgentService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db.pragma('foreign_keys = ON')
  }

  list() {
    return (this.db.prepare('SELECT * FROM ai_agents ORDER BY is_default DESC, name COLLATE NOCASE, id').all() as AgentRow[]).map(
      (row) => this.toSummary(row),
    )
  }

  get(id: number) {
    return this.toSummary(this.requireRow(id))
  }

  create(value: unknown) {
    const input = parseAIAgentConfigInput(value)
    this.assertToolSets(input)
    const evaluation = this.evaluateConfiguration(input)
    if (input.isDefault && (!input.enabled || evaluation.status !== 'ready')) {
      throw serviceError(
        'configuration_incomplete',
        `Default agent must be enabled and ready.${evaluation.issues.length ? ` ${evaluation.issues.join(' ')}` : ''}`,
      )
    }
    try {
      const id = this.db.transaction(() => {
        if (input.isDefault) this.db.prepare('UPDATE ai_agents SET is_default = 0 WHERE is_default = 1').run()
        const result = this.db
          .prepare(
            `
            INSERT INTO ai_agents (
              name, description, system_prompt, text_provider_id, image_provider_id,
              video_provider_id, model_params_json, context_json, allowed_tools_json,
              blocked_tools_json, tool_approval_mode, max_tool_calls, enabled,
              is_default, configuration_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            input.name,
            input.description,
            input.systemPrompt,
            input.textProviderId,
            input.imageProviderId ?? null,
            input.videoProviderId ?? null,
            JSON.stringify({ temperature: input.temperature }),
            JSON.stringify(input.context),
            JSON.stringify(input.allowedTools),
            JSON.stringify(input.blockedTools),
            input.toolApprovalMode,
            input.maxToolCalls,
            input.enabled ? 1 : 0,
            input.isDefault ? 1 : 0,
            evaluation.status,
          )
        const agentId = Number(result.lastInsertRowid)
        this.replaceMcpLinks(agentId, input.mcpServerIds)
        return agentId
      })()
      return this.get(id)
    } catch (error) {
      throw this.mapDbError(error)
    }
  }

  update(id: number, value: unknown) {
    this.requireRow(id)
    const input = parseAIAgentConfigInput(value)
    this.assertToolSets(input)
    const evaluation = this.evaluateConfiguration(input)
    if (input.isDefault && (!input.enabled || evaluation.status !== 'ready')) {
      throw serviceError(
        'configuration_incomplete',
        `Default agent must be enabled and ready.${evaluation.issues.length ? ` ${evaluation.issues.join(' ')}` : ''}`,
      )
    }
    try {
      this.db.transaction(() => {
        if (input.isDefault) this.db.prepare('UPDATE ai_agents SET is_default = 0 WHERE is_default = 1 AND id != ?').run(id)
        this.db
          .prepare(
            `
            UPDATE ai_agents SET
              name = ?, description = ?, system_prompt = ?, text_provider_id = ?,
              image_provider_id = ?, video_provider_id = ?, model_params_json = ?,
              context_json = ?, allowed_tools_json = ?, blocked_tools_json = ?,
              tool_approval_mode = ?, max_tool_calls = ?, enabled = ?, is_default = ?,
              configuration_status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
          )
          .run(
            input.name,
            input.description,
            input.systemPrompt,
            input.textProviderId,
            input.imageProviderId ?? null,
            input.videoProviderId ?? null,
            JSON.stringify({ temperature: input.temperature }),
            JSON.stringify(input.context),
            JSON.stringify(input.allowedTools),
            JSON.stringify(input.blockedTools),
            input.toolApprovalMode,
            input.maxToolCalls,
            input.enabled ? 1 : 0,
            input.isDefault ? 1 : 0,
            evaluation.status,
            id,
          )
        this.replaceMcpLinks(id, input.mcpServerIds)
      })()
      return this.get(id)
    } catch (error) {
      throw this.mapDbError(error)
    }
  }

  copy(id: number, requestedName?: string) {
    const agent = this.get(id)
    return this.create({
      name: requestedName?.trim() || this.nextCopyName(agent.name),
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      textProviderId: agent.providers.text,
      imageProviderId: agent.providers.image,
      videoProviderId: agent.providers.video,
      mcpServerIds: agent.mcpServerIds,
      allowedTools: agent.allowedTools,
      blockedTools: agent.blockedTools,
      toolApprovalMode: agent.toolApprovalMode,
      maxToolCalls: agent.maxToolCalls,
      temperature: agent.temperature,
      context: agent.context,
      enabled: false,
      isDefault: false,
    })
  }

  setDefault(id: number) {
    const agent = this.get(id)
    if (!agent.enabled || agent.configurationStatus !== 'ready') {
      throw serviceError('configuration_incomplete', 'Default agent must be enabled and ready.')
    }
    this.db.transaction(() => {
      this.db.prepare('UPDATE ai_agents SET is_default = 0 WHERE is_default = 1').run()
      this.db.prepare('UPDATE ai_agents SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
    })()
    return this.get(id)
  }

  setEnabled(id: number, enabled: boolean) {
    const agent = this.get(id)
    if (!enabled && agent.isDefault) {
      throw serviceError('configuration_incomplete', 'Default agent cannot be disabled before selecting a replacement.')
    }
    const evaluation = this.evaluateConfiguration(this.toInput(agent, enabled))
    this.db
      .prepare('UPDATE ai_agents SET enabled = ?, configuration_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(enabled ? 1 : 0, evaluation.status, id)
    return this.get(id)
  }

  recomputeConfigurationStatus(id: number) {
    const agent = this.get(id)
    const evaluation = this.evaluateConfiguration(this.toInput(agent, agent.enabled))
    this.db
      .prepare('UPDATE ai_agents SET configuration_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(evaluation.status, id)
    return this.get(id)
  }

  repairAllConfigurationStatuses() {
    return this.list().map((agent) => this.recomputeConfigurationStatus(agent.id))
  }

  getSnapshot(id: number): AIAgentSnapshot {
    const agent = this.get(id)
    if (!agent.enabled || agent.configurationStatus !== 'ready') {
      throw serviceError('configuration_incomplete', 'Agent configuration is incomplete.')
    }
    const text = this.requireProvider(agent.providers.text, 'text')
    const image = agent.providers.image ? this.requireProvider(agent.providers.image, 'image') : undefined
    const video = agent.providers.video ? this.requireProvider(agent.providers.video, 'video') : undefined
    return {
      agentId: agent.id,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      toolApprovalMode: agent.toolApprovalMode,
      maxToolCalls: agent.maxToolCalls,
      allowedTools: [...agent.allowedTools],
      blockedTools: [...agent.blockedTools],
      modelParams: { temperature: agent.temperature },
      context: { ...agent.context },
      providers: {
        text: { id: text.id, name: text.name, model: text.text_model as string },
        ...(image ? { image: { id: image.id, name: image.name, model: image.image_model as string } } : {}),
        ...(video ? { video: { id: video.id, name: video.name, model: video.video_model as string } } : {}),
      },
      mcpServerIds: [...agent.mcpServerIds],
      capturedAt: this.now().toISOString(),
    }
  }

  delete(id: number) {
    const agent = this.get(id)
    if (agent.isDefault) {
      const replacement = this.list().find(
        (candidate) => candidate.id !== id && candidate.enabled && candidate.configurationStatus === 'ready',
      )
      if (!replacement) {
        throw serviceError('configuration_incomplete', 'Default agent cannot be deleted without a ready replacement.')
      }
      this.db.transaction(() => {
        this.db.prepare('UPDATE ai_agents SET is_default = 0 WHERE id = ?').run(id)
        this.db.prepare('UPDATE ai_agents SET is_default = 1 WHERE id = ?').run(replacement.id)
        this.db.prepare('DELETE FROM ai_agents WHERE id = ?').run(id)
      })()
      return true
    }
    this.db.prepare('DELETE FROM ai_agents WHERE id = ?').run(id)
    return true
  }

  private toSummary(row: AgentRow): AIAgentSummary {
    const mcpServerIds = (
      this.db.prepare('SELECT mcp_server_id FROM ai_agent_mcp_links WHERE agent_id = ? ORDER BY mcp_server_id').all(row.id) as Array<{
        mcp_server_id: number
      }>
    ).map((link) => link.mcp_server_id)
    const modelParams = parseJson<{ temperature?: number }>(row.model_params_json, {})
    const context = parseJson<AIAgentConfigInput['context']>(row.context_json, { maxMessages: 50 })
    const input = {
      textProviderId: row.text_provider_id,
      imageProviderId: row.image_provider_id ?? undefined,
      videoProviderId: row.video_provider_id ?? undefined,
      mcpServerIds,
    }
    const evaluation = this.evaluateReferences(input)
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      systemPrompt: row.system_prompt,
      providers: {
        text: row.text_provider_id,
        ...(row.image_provider_id ? { image: row.image_provider_id } : {}),
        ...(row.video_provider_id ? { video: row.video_provider_id } : {}),
      },
      mcpServerIds,
      allowedTools: parseJson<string[]>(row.allowed_tools_json, []),
      blockedTools: parseJson<string[]>(row.blocked_tools_json, []),
      toolApprovalMode: row.tool_approval_mode,
      maxToolCalls: row.max_tool_calls,
      temperature: modelParams.temperature,
      context,
      enabled: Boolean(row.enabled),
      isDefault: Boolean(row.is_default),
      configurationStatus: evaluation.issues.length === 0 ? row.configuration_status : 'incomplete',
      issues: evaluation.issues,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private toInput(agent: AIAgentSummary, enabled: boolean): AIAgentConfigInput {
    return {
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      textProviderId: agent.providers.text,
      imageProviderId: agent.providers.image,
      videoProviderId: agent.providers.video,
      mcpServerIds: agent.mcpServerIds,
      allowedTools: agent.allowedTools,
      blockedTools: agent.blockedTools,
      toolApprovalMode: agent.toolApprovalMode,
      maxToolCalls: agent.maxToolCalls,
      temperature: agent.temperature,
      context: agent.context,
      enabled,
      isDefault: agent.isDefault,
    }
  }

  private evaluateConfiguration(input: Pick<AIAgentConfigInput, 'textProviderId' | 'imageProviderId' | 'videoProviderId' | 'mcpServerIds'>) {
    const evaluation = this.evaluateReferences(input)
    return { status: evaluation.issues.length === 0 ? ('ready' as const) : ('incomplete' as const), issues: evaluation.issues }
  }

  private evaluateReferences(input: {
    textProviderId: number
    imageProviderId?: number
    videoProviderId?: number
    mcpServerIds: number[]
  }) {
    const issues: string[] = []
    this.checkProvider(input.textProviderId, 'text', issues)
    if (input.imageProviderId) this.checkProvider(input.imageProviderId, 'image', issues)
    if (input.videoProviderId) this.checkProvider(input.videoProviderId, 'video', issues)
    for (const serverId of input.mcpServerIds) {
      const server = this.db.prepare('SELECT enabled FROM ai_mcp_servers WHERE id = ?').get(serverId) as { enabled: number } | undefined
      if (!server) issues.push(`MCP server ${serverId} does not exist.`)
      else if (!server.enabled) issues.push(`MCP server ${serverId} is disabled.`)
    }
    return { issues }
  }

  private checkProvider(id: number, capability: 'text' | 'image' | 'video', issues: string[]) {
    const provider = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as ProviderDependencyRow | undefined
    if (!provider) {
      issues.push(`${capability} provider ${id} does not exist.`)
      return
    }
    const capabilities = parseJson<AIProviderCapability[]>(provider.capabilities_json, [])
    const model = provider[`${capability}_model`]
    if (!provider.enabled) issues.push(`${capability} provider ${provider.name} is disabled.`)
    if (!capabilities.includes(capability) || !model) issues.push(`${capability} provider ${provider.name} lacks ${capability} capability.`)
  }

  private requireProvider(id: number, capability: 'text' | 'image' | 'video') {
    const issues: string[] = []
    this.checkProvider(id, capability, issues)
    if (issues.length > 0) throw serviceError('configuration_incomplete', issues.join(' '))
    return this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as ProviderDependencyRow
  }

  private replaceMcpLinks(agentId: number, serverIds: number[]) {
    this.db.prepare('DELETE FROM ai_agent_mcp_links WHERE agent_id = ?').run(agentId)
    const insert = this.db.prepare('INSERT INTO ai_agent_mcp_links (agent_id, mcp_server_id) VALUES (?, ?)')
    for (const serverId of serverIds) {
      const exists = this.db.prepare('SELECT 1 FROM ai_mcp_servers WHERE id = ?').get(serverId)
      if (!exists) throw serviceError('configuration_incomplete', `MCP server ${serverId} does not exist.`)
      insert.run(agentId, serverId)
    }
  }

  private assertToolSets(input: AIAgentConfigInput) {
    const blocked = new Set(input.blockedTools)
    const overlap = input.allowedTools.find((tool) => blocked.has(tool))
    if (overlap) throw serviceError('invalid_input', `Tool cannot be both allowed and blocked: ${overlap}`)
  }

  private requireRow(id: number) {
    if (!Number.isInteger(id) || id < 1) throw serviceError('invalid_input', 'Invalid AI agent ID.')
    const row = this.db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(id) as AgentRow | undefined
    if (!row) throw serviceError('not_found', 'AI agent was not found.')
    return row
  }

  private nextCopyName(name: string) {
    const base = `${name} Copy`
    let candidate = base
    let suffix = 2
    while (this.db.prepare('SELECT 1 FROM ai_agents WHERE name = ? COLLATE NOCASE').get(candidate)) {
      candidate = `${base} ${suffix++}`
    }
    return candidate
  }

  private mapDbError(error: unknown) {
    if (error instanceof AIServiceError) return error
    const message = error instanceof Error ? error.message : String(error)
    if (/UNIQUE constraint failed: ai_agents\.name/i.test(message)) {
      return serviceError('invalid_input', 'An AI agent with this name already exists.')
    }
    return serviceError('storage_error', 'AI agent configuration could not be saved.', true)
  }
}

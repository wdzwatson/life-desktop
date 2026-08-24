export type AgentApprovalMode = 'confirm_all' | 'confirm_risky' | 'allow_selected' | 'allow_all'

export type AgentSummary = {
  id: number
  name: string
  description: string
  systemPrompt: string
  providers: { text: number; image?: number; video?: number }
  textModel: string
  mcpServerIds: number[]
  allowedTools: string[]
  blockedTools: string[]
  toolApprovalMode: AgentApprovalMode
  maxToolCalls: number
  temperature?: number
  context: { maxMessages: number; maxOutputTokens?: number }
  enabled: boolean
  isDefault: boolean
  configurationStatus: 'ready' | 'incomplete'
  issues: string[]
  createdAt: string
  updatedAt: string
}

export type AgentDraft = {
  name: string
  description: string
  systemPrompt: string
  textProviderId: string
  textModel: string
  imageProviderId: string
  videoProviderId: string
  mcpServerIds: number[]
  allowedToolsText: string
  blockedToolsText: string
  toolApprovalMode: AgentApprovalMode
  maxToolCalls: string
  temperature: string
  maxMessages: string
  maxOutputTokens: string
  enabled: boolean
  isDefault: boolean
}

export function agentToDraft(agent: AgentSummary): AgentDraft {
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    textProviderId: String(agent.providers.text),
    textModel: agent.textModel ?? '',
    imageProviderId: agent.providers.image ? String(agent.providers.image) : '',
    videoProviderId: agent.providers.video ? String(agent.providers.video) : '',
    mcpServerIds: [...agent.mcpServerIds],
    allowedToolsText: agent.allowedTools.join('\n'),
    blockedToolsText: agent.blockedTools.join('\n'),
    toolApprovalMode: agent.toolApprovalMode,
    maxToolCalls: String(agent.maxToolCalls),
    temperature: agent.temperature === undefined ? '' : String(agent.temperature),
    maxMessages: String(agent.context.maxMessages),
    maxOutputTokens:
      agent.context.maxOutputTokens === undefined ? '' : String(agent.context.maxOutputTokens),
    enabled: agent.enabled,
    isDefault: agent.isDefault,
  }
}

export function parseAgentToolNames(value: string) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value.split(/[\n,]/)) {
    const normalized = item.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function parseRequiredInteger(value: string, field: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer.`)
  return parsed
}

export function buildAgentPayload(draft: AgentDraft) {
  const textProviderId = parseRequiredInteger(draft.textProviderId, 'Text provider')
  const allowedTools = parseAgentToolNames(draft.allowedToolsText)
  const blockedTools = parseAgentToolNames(draft.blockedToolsText)
  const blocked = new Set(blockedTools)
  const overlap = allowedTools.find((tool) => blocked.has(tool))
  if (overlap) throw new Error(`Tool cannot be both allowed and blocked: ${overlap}`)

  const temperature = draft.temperature.trim() ? Number(draft.temperature) : undefined
  if (temperature !== undefined && !Number.isFinite(temperature)) {
    throw new Error('Temperature must be a number.')
  }
  const maxOutputTokens = draft.maxOutputTokens.trim()
    ? parseRequiredInteger(draft.maxOutputTokens, 'Maximum output tokens')
    : undefined

  return {
    name: draft.name,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    textProviderId,
    ...((draft.textModel ?? '').trim() ? { textModel: draft.textModel.trim() } : {}),
    ...(draft.imageProviderId ? { imageProviderId: Number(draft.imageProviderId) } : {}),
    ...(draft.videoProviderId ? { videoProviderId: Number(draft.videoProviderId) } : {}),
    mcpServerIds: draft.mcpServerIds,
    allowedTools,
    blockedTools,
    toolApprovalMode: draft.toolApprovalMode,
    maxToolCalls: parseRequiredInteger(draft.maxToolCalls, 'Maximum tool calls'),
    ...(temperature === undefined ? {} : { temperature }),
    context: {
      maxMessages: parseRequiredInteger(draft.maxMessages, 'Maximum history messages'),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    },
    enabled: draft.enabled,
    isDefault: draft.isDefault,
  }
}

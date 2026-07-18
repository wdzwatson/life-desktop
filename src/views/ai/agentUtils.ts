import type { ProviderSummary } from './providerUtils'

export type AgentApprovalMode = 'confirm_all' | 'confirm_risky' | 'allow_selected' | 'allow_all'

export type AgentSummary = {
  id: number
  name: string
  description: string
  systemPrompt: string
  providers: { text: number; image?: number; video?: number }
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

export type AgentMcpSummary = {
  id: number
  name: string
  enabled: boolean
  transport: 'streamable_http' | 'sse' | 'stdio'
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'failed'
  toolCount: number
}

export type AgentDraft = {
  name: string
  description: string
  systemPrompt: string
  textProviderId: string
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

export function getAgentProviderOptions(
  providers: ProviderSummary[],
  capability: 'text' | 'image' | 'video',
) {
  return providers
    .filter((provider) => provider.capabilities.includes(capability) && provider.models[capability])
    .sort((left, right) => {
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
      if (left.defaults[capability] !== right.defaults[capability]) {
        return left.defaults[capability] ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
}

export function createAgentDraft(textProviderId?: number, isDefault = false): AgentDraft {
  return {
    name: '',
    description: '',
    systemPrompt: '',
    textProviderId: textProviderId ? String(textProviderId) : '',
    imageProviderId: '',
    videoProviderId: '',
    mcpServerIds: [],
    allowedToolsText: '',
    blockedToolsText: '',
    toolApprovalMode: 'confirm_risky',
    maxToolCalls: '8',
    temperature: '0.2',
    maxMessages: '50',
    maxOutputTokens: '4000',
    enabled: true,
    isDefault,
  }
}

export function agentToDraft(agent: AgentSummary): AgentDraft {
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    textProviderId: String(agent.providers.text),
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

export function toggleAgentMcpServer(serverIds: number[], serverId: number) {
  return serverIds.includes(serverId)
    ? serverIds.filter((item) => item !== serverId)
    : [...serverIds, serverId].sort((left, right) => left - right)
}

export function getAgentProviderNames(agent: AgentSummary, providers: ProviderSummary[]) {
  const byId = new Map(providers.map((provider) => [provider.id, provider.name]))
  return {
    text: byId.get(agent.providers.text) ?? `#${agent.providers.text}`,
    ...(agent.providers.image
      ? { image: byId.get(agent.providers.image) ?? `#${agent.providers.image}` }
      : {}),
    ...(agent.providers.video
      ? { video: byId.get(agent.providers.video) ?? `#${agent.providers.video}` }
      : {}),
  }
}

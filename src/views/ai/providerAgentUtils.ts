import { createAgentDraft, type AgentDraft } from './agentUtils'

export type ProviderAgentPresetId = 'general' | 'writing' | 'research' | 'coding'

export type ProviderAgentPreset = {
  id: ProviderAgentPresetId
  nameKey: string
  descriptionKey: string
  systemPrompt: string
}

export const PROVIDER_AGENT_PRESETS: readonly ProviderAgentPreset[] = Object.freeze([
  {
    id: 'general',
    nameKey: 'aiChat.providers.agent_general_name',
    descriptionKey: 'aiChat.providers.agent_general_desc',
    systemPrompt: 'You are a reliable general assistant. Give clear, practical, and concise answers. Ask only when missing information would materially change the result.',
  },
  {
    id: 'writing',
    nameKey: 'aiChat.providers.agent_writing_name',
    descriptionKey: 'aiChat.providers.agent_writing_desc',
    systemPrompt: 'You are a writing assistant. Improve structure, clarity, tone, and accuracy while preserving the author intent and avoiding unsupported claims.',
  },
  {
    id: 'research',
    nameKey: 'aiChat.providers.agent_research_name',
    descriptionKey: 'aiChat.providers.agent_research_desc',
    systemPrompt: 'You are a research assistant. Separate evidence from inference, identify uncertainty, compare alternatives, and produce traceable conclusions.',
  },
  {
    id: 'coding',
    nameKey: 'aiChat.providers.agent_coding_name',
    descriptionKey: 'aiChat.providers.agent_coding_desc',
    systemPrompt: 'You are a software engineering assistant. Diagnose before changing code, prefer maintainable solutions, preserve existing behavior, and verify every implementation.',
  },
])

export function toggleProviderAgentPreset(
  selected: ProviderAgentPresetId[],
  presetId: ProviderAgentPresetId,
) {
  return selected.includes(presetId)
    ? selected.filter((item) => item !== presetId)
    : [...selected, presetId]
}

export function appendCustomAgentName(
  current: string[],
  value: string,
  unavailableNames: string[] = [],
) {
  const name = value.trim()
  if (!name) return current
  const normalized = name.toLocaleLowerCase()
  if ([...current, ...unavailableNames].some((item) => item.trim().toLocaleLowerCase() === normalized)) {
    return current
  }
  return [...current, name]
}

export function createProviderLinkedAgentDraft(input: {
  providerId: number
  name: string
  description: string
  systemPrompt: string
  capabilities: Array<'text' | 'image' | 'video' | string>
  textModel: string
  enabled: boolean
  isDefault: boolean
}): AgentDraft {
  return {
    ...createAgentDraft(input.providerId, input.isDefault, input.textModel),
    name: input.name.trim(),
    description: input.description.trim(),
    systemPrompt: input.systemPrompt,
    imageProviderId: input.capabilities.includes('image') ? String(input.providerId) : '',
    videoProviderId: input.capabilities.includes('video') ? String(input.providerId) : '',
    enabled: input.enabled,
  }
}

export function createCustomAgentSystemPrompt(name: string) {
  return `You are ${name.trim()}, a dedicated assistant. Follow the user's request carefully, state important assumptions, and provide a clear actionable result.`
}

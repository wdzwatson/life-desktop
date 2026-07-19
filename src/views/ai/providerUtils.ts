export type ProviderCapability = 'text' | 'image' | 'video' | 'streaming' | 'tool_calling' | 'vision'

export type ProviderSummary = {
  id: number
  name: string
  protocol: 'openai_compatible' | 'xai' | 'custom_http'
  baseUrl: string
  credentialConfigured: boolean
  headerNames: string[]
  requestBody: Record<string, unknown>
  capabilities: ProviderCapability[]
  models: {
    text?: string
    textOptions?: string[]
    image?: string
    imageOptions?: string[]
    video?: string
    videoOptions?: string[]
  }
  timeoutMs: number
  allowLocalNetwork: boolean
  enabled: boolean
  defaults: { text: boolean; image: boolean; video: boolean }
  connectionStatus: 'untested' | 'testing' | 'connected' | 'failed'
  lastTestedAt: string | null
}

export type ProviderDraft = {
  name: string
  protocol: ProviderSummary['protocol']
  baseUrl: string
  apiKey: string
  headersJson: string
  requestBodyJson: string
  replaceHeaders: boolean
  capabilities: ProviderCapability[]
  textModel: string
  textModels: string[]
  imageModel: string
  imageModels: string[]
  videoModel: string
  videoModels: string[]
  timeoutSeconds: string
  allowLocalNetwork: boolean
  enabled: boolean
}

export const PROVIDER_CAPABILITIES: ProviderCapability[] = [
  'text',
  'image',
  'video',
  'streaming',
  'tool_calling',
  'vision',
]

export function createProviderDraft(): ProviderDraft {
  return {
    name: '',
    protocol: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
    headersJson: '{}',
    requestBodyJson: '{}',
    replaceHeaders: true,
    capabilities: ['text', 'streaming'],
    textModel: '',
    textModels: [],
    imageModel: '',
    imageModels: [],
    videoModel: '',
    videoModels: [],
    timeoutSeconds: '60',
    allowLocalNetwork: false,
    enabled: true,
  }
}

export function providerToDraft(provider: ProviderSummary): ProviderDraft {
  return {
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey: '',
    headersJson: '{}',
    requestBodyJson: JSON.stringify(provider.requestBody ?? {}, null, 2),
    replaceHeaders: false,
    capabilities: [...provider.capabilities],
    textModel: provider.models.text ?? '',
    textModels: provider.models.textOptions?.length
      ? [...provider.models.textOptions]
      : (provider.models.text ? [provider.models.text] : []),
    imageModel: provider.models.image ?? '',
    imageModels: provider.models.imageOptions?.length
      ? [...provider.models.imageOptions]
      : (provider.models.image ? [provider.models.image] : []),
    videoModel: provider.models.video ?? '',
    videoModels: provider.models.videoOptions?.length
      ? [...provider.models.videoOptions]
      : (provider.models.video ? [provider.models.video] : []),
    timeoutSeconds: String(provider.timeoutMs / 1000),
    allowLocalNetwork: provider.allowLocalNetwork,
    enabled: provider.enabled,
  }
}

export function parseProviderHeaders(value: string) {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object.')
  }
  const headers: Record<string, string> = {}
  for (const [name, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== 'string') throw new Error(`Header ${name} must be a string.`)
    headers[name] = headerValue
  }
  return headers
}

export function parseProviderRequestBody(value: string) {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

export function buildProviderPayload(draft: ProviderDraft) {
  const timeoutSeconds = Number(draft.timeoutSeconds)
  if (!Number.isFinite(timeoutSeconds)) throw new Error('Timeout must be a number.')
  const defaultTextModel = draft.textModel.trim()
  const textOptions = normalizeProviderTextModels(
    draft.textModels.length > 0 ? draft.textModels : (defaultTextModel ? [defaultTextModel] : []),
  )
  if (draft.capabilities.includes('text') && (!defaultTextModel || !textOptions.includes(defaultTextModel))) {
    throw new Error('Select a default text model from the available text models.')
  }
  const imageOptions = normalizeProviderTextModels(
    draft.imageModels.length > 0 ? draft.imageModels : (draft.imageModel.trim() ? [draft.imageModel] : []),
  )
  const videoOptions = normalizeProviderTextModels(
    draft.videoModels.length > 0 ? draft.videoModels : (draft.videoModel.trim() ? [draft.videoModel] : []),
  )
  if (draft.capabilities.includes('image') && (!draft.imageModel.trim() || !imageOptions.includes(draft.imageModel.trim()))) {
    throw new Error('Select a default image model from the available image models.')
  }
  if (draft.capabilities.includes('video') && (!draft.videoModel.trim() || !videoOptions.includes(draft.videoModel.trim()))) {
    throw new Error('Select a default video model from the available video models.')
  }
  return {
    name: draft.name,
    protocol: draft.protocol,
    baseUrl: draft.baseUrl,
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    defaultHeaders: draft.replaceHeaders ? parseProviderHeaders(draft.headersJson) : {},
    requestBody: parseProviderRequestBody(draft.requestBodyJson),
    capabilities: draft.capabilities,
    models: {
      ...(defaultTextModel ? { text: defaultTextModel, textOptions } : {}),
      ...(draft.imageModel.trim() ? { image: draft.imageModel.trim(), imageOptions } : {}),
      ...(draft.videoModel.trim() ? { video: draft.videoModel.trim(), videoOptions } : {}),
    },
    timeoutMs: Math.round(timeoutSeconds * 1000),
    allowLocalNetwork: draft.allowLocalNetwork,
    enabled: draft.enabled,
  }
}

export function normalizeProviderTextModels(models: string[]) {
  const seen = new Set<string>()
  return models.map((model) => model.trim()).filter((model) => {
    if (!model || seen.has(model)) return false
    seen.add(model)
    return true
  })
}

export function appendProviderTextModel(models: string[], value: string) {
  return normalizeProviderTextModels([...models, value])
}

export function toggleProviderTextModel(models: string[], value: string) {
  return models.includes(value)
    ? models.filter((model) => model !== value)
    : appendProviderTextModel(models, value)
}

export function toggleProviderCapability(
  capabilities: ProviderCapability[],
  capability: ProviderCapability,
) {
  return capabilities.includes(capability)
    ? capabilities.filter((item) => item !== capability)
    : [...capabilities, capability]
}

export function formatProviderLastTestedAt(value: string | null, locale: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

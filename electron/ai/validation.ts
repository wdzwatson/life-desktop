import type {
  AIAgentConfigInput,
  AIContextStrategy,
  AIMcpServerInput,
  AIProviderCapability,
  AIProviderConfigInput,
  AIProviderModels,
  AIStartRunInput,
  AIToolApprovalInput,
} from './types'

export type AIValidationIssue = {
  path: string
  message: string
}

export class AIValidationError extends Error {
  readonly issues: AIValidationIssue[]

  constructor(issues: AIValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    this.name = 'AIValidationError'
    this.issues = issues
  }
}

const PROVIDER_PROTOCOLS = new Set(['openai_compatible', 'xai', 'custom_http'])
const PROVIDER_CAPABILITIES = new Set([
  'text',
  'image',
  'video',
  'streaming',
  'tool_calling',
  'vision',
])
const TOOL_APPROVAL_MODES = new Set([
  'confirm_all',
  'confirm_risky',
  'allow_selected',
  'allow_all',
])
const MCP_TRANSPORTS = new Set(['streamable_http', 'sse', 'stdio'])
const TOOL_APPROVAL_DECISIONS = new Set(['approve_once', 'approve_session', 'reject'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requireObject(value: unknown, path: string) {
  if (!isPlainObject(value)) throw new AIValidationError([{ path, message: 'must be an object' }])
  return value
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) {
    throw new AIValidationError(
      unknown.map((key) => ({ path: `${path}.${key}`, message: 'unknown field' })),
    )
  }
}

function readString(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; optional?: boolean; singleLine?: boolean } = {},
) {
  if (value === undefined && options.optional) return undefined
  if (typeof value !== 'string') throw new AIValidationError([{ path, message: 'must be a string' }])
  const normalized = value.trim()
  const min = options.min ?? 1
  const max = options.max ?? 10_000
  if (normalized.length < min || normalized.length > max) {
    throw new AIValidationError([{ path, message: `length must be between ${min} and ${max}` }])
  }
  if (/\0/.test(normalized) || (options.singleLine && /[\r\n]/.test(normalized))) {
    throw new AIValidationError([{ path, message: 'must not contain control line breaks' }])
  }
  return normalized
}

function readBoolean(value: unknown, path: string, fallback?: boolean) {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'boolean') throw new AIValidationError([{ path, message: 'must be a boolean' }])
  return value
}

function readInteger(
  value: unknown,
  path: string,
  options: { min: number; max: number; optional?: boolean },
) {
  if (value === undefined && options.optional) return undefined
  if (!Number.isInteger(value) || Number(value) < options.min || Number(value) > options.max) {
    throw new AIValidationError([
      { path, message: `must be an integer between ${options.min} and ${options.max}` },
    ])
  }
  return Number(value)
}

function readNumber(
  value: unknown,
  path: string,
  options: { min: number; max: number; optional?: boolean },
) {
  if (value === undefined && options.optional) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < options.min || value > options.max) {
    throw new AIValidationError([{ path, message: `must be between ${options.min} and ${options.max}` }])
  }
  return value
}

function readStringArray(
  value: unknown,
  path: string,
  options: { maxItems: number; itemMax: number },
) {
  if (!Array.isArray(value) || value.length > options.maxItems) {
    throw new AIValidationError([{ path, message: `must contain at most ${options.maxItems} items` }])
  }
  const normalized = value.map((item, index) =>
    readString(item, `${path}[${index}]`, { max: options.itemMax }),
  )
  return [...new Set(normalized)]
}

function readPositiveIdArray(value: unknown, path: string, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AIValidationError([{ path, message: `must contain at most ${maxItems} items` }])
  }
  const ids = value.map((item, index) => readInteger(item, `${path}[${index}]`, { min: 1, max: 2_147_483_647 }))
  return [...new Set(ids)]
}

function readHeaders(value: unknown, path: string) {
  const object = requireObject(value, path)
  if (Object.keys(object).length > 50) {
    throw new AIValidationError([{ path, message: 'must contain at most 50 headers' }])
  }
  const result: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(object)) {
    const name = key.trim()
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(name)) {
      throw new AIValidationError([{ path: `${path}.${key}`, message: 'invalid header name' }])
    }
    result[name] = readString(rawValue, `${path}.${key}`, { max: 4_000, singleLine: true }) as string
  }
  return result
}

function readUrl(value: unknown, path: string) {
  const text = readString(value, path, { max: 2_048 }) as string
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new AIValidationError([{ path, message: 'must be a valid URL' }])
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AIValidationError([{ path, message: 'only http and https URLs are allowed' }])
  }
  if (parsed.username || parsed.password) {
    throw new AIValidationError([{ path, message: 'credentials must not be embedded in URLs' }])
  }
  return parsed.toString().replace(/\/$/, '')
}

function readModels(value: unknown): AIProviderModels {
  const object = requireObject(value, 'provider.models')
  rejectUnknownKeys(object, ['text', 'textOptions', 'image', 'video'], 'provider.models')
  const text = readString(object.text, 'provider.models.text', { max: 200, optional: true })
  const textOptions = object.textOptions === undefined
    ? (text ? [text] : [])
    : readStringArray(object.textOptions, 'provider.models.textOptions', { maxItems: 100, itemMax: 200 })
  if (text && !textOptions.includes(text)) {
    throw new AIValidationError([{
      path: 'provider.models.text',
      message: 'must be included in provider.models.textOptions',
    }])
  }
  return {
    text,
    textOptions,
    image: readString(object.image, 'provider.models.image', { max: 200, optional: true }),
    video: readString(object.video, 'provider.models.video', { max: 200, optional: true }),
  }
}

function readContext(value: unknown): AIContextStrategy {
  const object = requireObject(value, 'agent.context')
  rejectUnknownKeys(object, ['maxMessages', 'maxOutputTokens'], 'agent.context')
  return {
    maxMessages: readInteger(object.maxMessages, 'agent.context.maxMessages', { min: 1, max: 1_000 }),
    maxOutputTokens: readInteger(object.maxOutputTokens, 'agent.context.maxOutputTokens', {
      min: 1,
      max: 1_000_000,
      optional: true,
    }),
  }
}

export function parseAIProviderConfigInput(value: unknown): AIProviderConfigInput {
  const object = requireObject(value, 'provider')
  rejectUnknownKeys(
    object,
    [
      'name',
      'protocol',
      'baseUrl',
      'apiKey',
      'defaultHeaders',
      'capabilities',
      'models',
      'timeoutMs',
      'allowLocalNetwork',
      'enabled',
    ],
    'provider',
  )
  const protocol = readString(object.protocol, 'provider.protocol', { max: 50 }) as string
  if (!PROVIDER_PROTOCOLS.has(protocol)) {
    throw new AIValidationError([{ path: 'provider.protocol', message: 'unsupported provider protocol' }])
  }
  const capabilities = readStringArray(object.capabilities, 'provider.capabilities', {
    maxItems: 6,
    itemMax: 30,
  })
  if (capabilities.some((capability) => !PROVIDER_CAPABILITIES.has(capability))) {
    throw new AIValidationError([{ path: 'provider.capabilities', message: 'contains an unsupported capability' }])
  }
  const models = readModels(object.models)
  if (capabilities.includes('text') && (!models.text || !models.textOptions?.length)) {
    throw new AIValidationError([{ path: 'provider.models.textOptions', message: 'requires a default text model and at least one option' }])
  }
  if (capabilities.includes('image') && !models.image) {
    throw new AIValidationError([{ path: 'provider.models.image', message: 'is required for image capability' }])
  }
  if (capabilities.includes('video') && !models.video) {
    throw new AIValidationError([{ path: 'provider.models.video', message: 'is required for video capability' }])
  }
  return {
    name: readString(object.name, 'provider.name', { max: 120 }) as string,
    protocol: protocol as AIProviderConfigInput['protocol'],
    baseUrl: readUrl(object.baseUrl, 'provider.baseUrl'),
    apiKey: readString(object.apiKey, 'provider.apiKey', { max: 8_000, optional: true }),
    defaultHeaders: readHeaders(object.defaultHeaders, 'provider.defaultHeaders'),
    capabilities: capabilities as AIProviderCapability[],
    models,
    timeoutMs: readInteger(object.timeoutMs, 'provider.timeoutMs', { min: 1_000, max: 600_000 }),
    allowLocalNetwork: readBoolean(object.allowLocalNetwork, 'provider.allowLocalNetwork', false),
    enabled: readBoolean(object.enabled, 'provider.enabled', true),
  }
}

export function parseAIAgentConfigInput(value: unknown): AIAgentConfigInput {
  const object = requireObject(value, 'agent')
  rejectUnknownKeys(
    object,
    [
      'name',
      'description',
      'systemPrompt',
      'textProviderId',
      'textModel',
      'imageProviderId',
      'videoProviderId',
      'mcpServerIds',
      'allowedTools',
      'blockedTools',
      'toolApprovalMode',
      'maxToolCalls',
      'temperature',
      'context',
      'enabled',
      'isDefault',
    ],
    'agent',
  )
  const toolApprovalMode = readString(object.toolApprovalMode, 'agent.toolApprovalMode', {
    max: 40,
  }) as string
  if (!TOOL_APPROVAL_MODES.has(toolApprovalMode)) {
    throw new AIValidationError([{ path: 'agent.toolApprovalMode', message: 'unsupported approval mode' }])
  }
  const systemPrompt = readString(object.systemPrompt, 'agent.systemPrompt', {
    min: 0,
    max: 100_000,
  }) as string
  return {
    name: readString(object.name, 'agent.name', { max: 120 }) as string,
    description: readString(object.description, 'agent.description', { min: 0, max: 2_000 }) as string,
    systemPrompt,
    textProviderId: readInteger(object.textProviderId, 'agent.textProviderId', {
      min: 1,
      max: 2_147_483_647,
    }),
    textModel: readString(object.textModel, 'agent.textModel', { max: 200, optional: true }),
    imageProviderId: readInteger(object.imageProviderId, 'agent.imageProviderId', {
      min: 1,
      max: 2_147_483_647,
      optional: true,
    }),
    videoProviderId: readInteger(object.videoProviderId, 'agent.videoProviderId', {
      min: 1,
      max: 2_147_483_647,
      optional: true,
    }),
    mcpServerIds: readPositiveIdArray(object.mcpServerIds, 'agent.mcpServerIds'),
    allowedTools: readStringArray(object.allowedTools, 'agent.allowedTools', {
      maxItems: 500,
      itemMax: 300,
    }),
    blockedTools: readStringArray(object.blockedTools, 'agent.blockedTools', {
      maxItems: 500,
      itemMax: 300,
    }),
    toolApprovalMode: toolApprovalMode as AIAgentConfigInput['toolApprovalMode'],
    maxToolCalls: readInteger(object.maxToolCalls, 'agent.maxToolCalls', { min: 0, max: 32 }),
    temperature: readNumber(object.temperature, 'agent.temperature', {
      min: 0,
      max: 2,
      optional: true,
    }),
    context: readContext(object.context),
    enabled: readBoolean(object.enabled, 'agent.enabled', true),
    isDefault: readBoolean(object.isDefault, 'agent.isDefault', false),
  }
}

export function parseAIMcpServerInput(value: unknown): AIMcpServerInput {
  const object = requireObject(value, 'mcp')
  rejectUnknownKeys(object, ['name', 'description', 'enabled', 'timeoutMs', 'connection'], 'mcp')
  const connection = requireObject(object.connection, 'mcp.connection')
  const transport = readString(connection.transport, 'mcp.connection.transport', { max: 40 }) as string
  if (!MCP_TRANSPORTS.has(transport)) {
    throw new AIValidationError([{ path: 'mcp.connection.transport', message: 'unsupported transport' }])
  }
  let normalizedConnection: AIMcpServerInput['connection']
  if (transport === 'stdio') {
    rejectUnknownKeys(connection, ['transport', 'command', 'args', 'cwd', 'env'], 'mcp.connection')
    normalizedConnection = {
      transport,
      command: readString(connection.command, 'mcp.connection.command', {
        max: 1_024,
        singleLine: true,
      }) as string,
      args: readStringArray(connection.args, 'mcp.connection.args', { maxItems: 100, itemMax: 4_096 }),
      cwd: readString(connection.cwd, 'mcp.connection.cwd', { max: 4_096, optional: true }),
      env: readHeaders(connection.env, 'mcp.connection.env'),
    }
  } else {
    rejectUnknownKeys(connection, ['transport', 'url', 'headers'], 'mcp.connection')
    normalizedConnection = {
      transport,
      url: readUrl(connection.url, 'mcp.connection.url'),
      headers: readHeaders(connection.headers, 'mcp.connection.headers'),
    }
  }
  return {
    name: readString(object.name, 'mcp.name', { max: 120 }) as string,
    description: readString(object.description, 'mcp.description', { min: 0, max: 2_000 }) as string,
    enabled: readBoolean(object.enabled, 'mcp.enabled', true),
    timeoutMs: readInteger(object.timeoutMs, 'mcp.timeoutMs', { min: 1_000, max: 600_000 }),
    connection: normalizedConnection,
  }
}

export function parseAIStartRunInput(value: unknown): AIStartRunInput {
  const object = requireObject(value, 'run')
  rejectUnknownKeys(object, ['conversationId', 'agentId', 'text', 'attachmentAssetIds'], 'run')
  return {
    conversationId: readInteger(object.conversationId, 'run.conversationId', {
      min: 1,
      max: 2_147_483_647,
    }),
    agentId: readInteger(object.agentId, 'run.agentId', { min: 1, max: 2_147_483_647 }),
    text: readString(object.text, 'run.text', { max: 200_000 }) as string,
    attachmentAssetIds: readPositiveIdArray(object.attachmentAssetIds, 'run.attachmentAssetIds', 20),
  }
}

export function parseAIToolApprovalInput(value: unknown): AIToolApprovalInput {
  const object = requireObject(value, 'approval')
  rejectUnknownKeys(object, ['runId', 'toolCallId', 'decision'], 'approval')
  const decision = readString(object.decision, 'approval.decision', { max: 40 }) as string
  if (!TOOL_APPROVAL_DECISIONS.has(decision)) {
    throw new AIValidationError([{ path: 'approval.decision', message: 'unsupported decision' }])
  }
  return {
    runId: readInteger(object.runId, 'approval.runId', { min: 1, max: 2_147_483_647 }),
    toolCallId: readString(object.toolCallId, 'approval.toolCallId', { max: 300 }) as string,
    decision: decision as AIToolApprovalInput['decision'],
  }
}

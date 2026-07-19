export type AIProviderProtocol = 'openai_compatible' | 'xai' | 'custom_http'

export type AIProviderCapability =
  | 'text'
  | 'image'
  | 'video'
  | 'streaming'
  | 'tool_calling'
  | 'vision'

export type AIProviderModels = {
  text?: string
  textOptions?: string[]
  image?: string
  imageOptions?: string[]
  video?: string
  videoOptions?: string[]
}

export type AIProviderConfigInput = {
  name: string
  protocol: AIProviderProtocol
  baseUrl: string
  apiKey?: string
  defaultHeaders: Record<string, string>
  requestBody: Record<string, unknown>
  capabilities: AIProviderCapability[]
  models: AIProviderModels
  timeoutMs: number
  allowLocalNetwork: boolean
  enabled: boolean
}

export type AIToolApprovalMode =
  | 'confirm_all'
  | 'confirm_risky'
  | 'allow_selected'
  | 'allow_all'

export type AIContextStrategy = {
  maxMessages: number
  maxOutputTokens?: number
}

export type AIAgentConfigInput = {
  name: string
  description: string
  systemPrompt: string
  textProviderId: number
  textModel?: string
  imageProviderId?: number
  videoProviderId?: number
  mcpServerIds: number[]
  allowedTools: string[]
  blockedTools: string[]
  toolApprovalMode: AIToolApprovalMode
  maxToolCalls: number
  temperature?: number
  context: AIContextStrategy
  enabled: boolean
  isDefault: boolean
}

export type AIMcpTransport = 'streamable_http' | 'sse' | 'stdio'

export type AIMcpHttpConfig = {
  transport: 'streamable_http' | 'sse'
  url: string
  headers: Record<string, string>
}

export type AIMcpStdioConfig = {
  transport: 'stdio'
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string>
}

export type AIMcpConnectionConfig = AIMcpHttpConfig | AIMcpStdioConfig

export type AIMcpServerInput = {
  name: string
  description: string
  enabled: boolean
  timeoutMs: number
  connection: AIMcpConnectionConfig
}

export type AIMessageRole = 'user' | 'assistant' | 'tool' | 'system'

export type AITextContentBlock = {
  type: 'text' | 'markdown' | 'code'
  text: string
  language?: string
}

export type AIMediaContentBlock = {
  type: 'image' | 'video' | 'audio' | 'file'
  assetId: number
  mimeType: string
  name?: string
  alt?: string
  posterAssetId?: number
  durationSeconds?: number
}

export type AIToolCallContentBlock = {
  type: 'tool_call'
  toolCallId: string
  serverId: number
  serverName?: string
  toolName: string
  risk?: AIToolRisk
  argumentsSummary?: string
  status: AIToolCallStatus
}

export type AIToolResultContentBlock = {
  type: 'tool_result'
  toolCallId: string
  summary: string
  attachmentAssetId?: number
}

export type AIMediaTaskContentBlock = {
  type: 'media_task'
  mediaType: 'image' | 'video'
  taskId: string
  status: AIMediaTaskStatus
  progress?: number
}

export type AIErrorContentBlock = {
  type: 'error'
  code: AIErrorCode
  message: string
  retryable: boolean
}

export type AIMessageContentBlock =
  | AITextContentBlock
  | AIMediaContentBlock
  | AIToolCallContentBlock
  | AIToolResultContentBlock
  | AIMediaTaskContentBlock
  | AIErrorContentBlock

export type AIRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_tool'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type AIToolRisk = 'read' | 'write' | 'command' | 'external_side_effect'

export type AIToolCallStatus =
  | 'proposed'
  | 'waiting_for_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'

export type AIMediaTaskStatus =
  | 'queued'
  | 'generating'
  | 'polling'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type AIStartRunInput = {
  conversationId: number
  agentId: number
  text: string
  attachmentAssetIds: number[]
}

export type AIToolApprovalInput = {
  runId: number
  toolCallId: string
  decision: 'approve_once' | 'approve_session' | 'reject'
}

export type AIErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'configuration_incomplete'
  | 'credential_unavailable'
  | 'authentication_failed'
  | 'permission_denied'
  | 'rate_limited'
  | 'timeout'
  | 'cancelled'
  | 'network_error'
  | 'provider_error'
  | 'protocol_error'
  | 'mcp_unavailable'
  | 'tool_failed'
  | 'media_failed'
  | 'storage_error'
  | 'unsupported'
  | 'internal_error'

export type AIErrorDetail = {
  code: AIErrorCode
  message: string
  retryable: boolean
  requestId?: string
  retryAt?: number
}

export class AIServiceError extends Error {
  readonly detail: AIErrorDetail

  constructor(detail: AIErrorDetail) {
    super(detail.message)
    this.name = 'AIServiceError'
    this.detail = detail
  }
}

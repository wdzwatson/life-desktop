import type Database from 'better-sqlite3'
import type { AIAgentRuntime } from './agentRuntime'
import type { AIMcpManager } from './mcpManager'
import type { AIImageGenerationService } from './imageGenerationService'
import type { AIVideoAssetService } from './videoAssetService'
import type { AIStorageService } from './storageService'
import { AIAgentService } from './agentService'
import { AICredentialService, type AICredentialCryptoAdapter } from './credentialService'
import { AIConversationService } from './conversationService'
import { AIMcpConfigService } from './mcpConfigService'
import { AIProviderService } from './providerService'
import { AIServiceError } from './types'
import { AIValidationError } from './validation'

export const AI_CONFIG_CHANNELS = [
  'ai:providers:list',
  'ai:providers:get',
  'ai:providers:create',
  'ai:providers:update',
  'ai:providers:copy',
  'ai:providers:setEnabled',
  'ai:providers:setDefault',
  'ai:providers:removeCredential',
  'ai:providers:dependencies',
  'ai:providers:delete',
  'ai:agents:list',
  'ai:agents:get',
  'ai:agents:create',
  'ai:agents:update',
  'ai:agents:copy',
  'ai:agents:setEnabled',
  'ai:agents:setDefault',
  'ai:agents:snapshot',
  'ai:agents:delete',
  'ai:mcp:list',
  'ai:mcp:get',
  'ai:mcp:create',
  'ai:mcp:update',
  'ai:mcp:copy',
  'ai:mcp:setEnabled',
  'ai:mcp:setRiskOverride',
  'ai:mcp:dependencies',
  'ai:mcp:delete',
] as const

export const AI_RUNTIME_CHANNELS = ['ai:runs:start', 'ai:runs:cancel', 'ai:runs:approveTool'] as const
export const AI_IMAGE_CHANNELS = ['ai:images:generate', 'ai:images:cancel'] as const
export const AI_VIDEO_CHANNELS = ['ai:videos:generate', 'ai:videos:cancel'] as const
export const AI_STORAGE_CHANNELS = ['ai:storage:usage', 'ai:storage:previewCleanup', 'ai:storage:cleanup'] as const

export const AI_CONVERSATION_CHANNELS = [
  'ai:conversations:list',
  'ai:conversations:get',
  'ai:conversations:create',
  'ai:conversations:rename',
  'ai:conversations:setPinned',
  'ai:conversations:setArchived',
  'ai:conversations:delete',
  'ai:conversations:messages',
  'ai:conversations:runs',
] as const

export const AI_MCP_RUNTIME_CHANNELS = [
  'ai:mcpRuntime:connect',
  'ai:mcpRuntime:disconnect',
  'ai:mcpRuntime:refreshTools',
] as const

type AIConfigChannel = (typeof AI_CONFIG_CHANNELS)[number]
type AIRuntimeChannel = (typeof AI_RUNTIME_CHANNELS)[number]
type AIImageChannel = (typeof AI_IMAGE_CHANNELS)[number]
type AIVideoChannel = (typeof AI_VIDEO_CHANNELS)[number]
type AIStorageChannel = (typeof AI_STORAGE_CHANNELS)[number]
type AIConversationChannel = (typeof AI_CONVERSATION_CHANNELS)[number]
type AIMcpRuntimeChannel = (typeof AI_MCP_RUNTIME_CHANNELS)[number]
type AIHandler = (_event: unknown, payload?: unknown) => unknown | Promise<unknown>

type AIConfigServices = {
  providers: AIProviderService
  agents: AIAgentService
  mcp: AIMcpConfigService
}

export type AIConfigIpcDependencies = {
  getDb: () => Database.Database
  getCredentialFilePath: () => string
  getCredentialCryptoAdapter: () => AICredentialCryptoAdapter
  onMcpChanged?: (
    id: number,
    change: 'updated' | 'disabled' | 'deleted',
  ) => void | Promise<void>
}

export type AIConfigIpcRegistrar = {
  handle: (channel: string, handler: AIHandler) => void
}

export type AIRuntimeIpcDependencies = {
  getRuntime: () => Pick<AIAgentRuntime, 'start' | 'cancel' | 'approve'>
}

export type AIImageIpcDependencies = {
  getService: () => Pick<AIImageGenerationService, 'generate'>
  isConversationActive?: (conversationId: number) => boolean
  createAbortScope?: () => { signal: AbortSignal; abort: () => void; dispose: () => void }
}

export type AIVideoIpcDependencies = {
  getService: () => Pick<AIVideoAssetService, 'generate'>
  isConversationActive?: (conversationId: number) => boolean
  createAbortScope?: () => { signal: AbortSignal; abort: () => void; dispose: () => void }
}

export type AIStorageIpcDependencies = {
  getService: () => Pick<AIStorageService, 'getUsage' | 'previewCleanup' | 'cleanup'>
}

export type AIConversationIpcDependencies = {
  getDb: () => Database.Database
  getRuntime: () => Pick<AIAgentRuntime, 'isConversationActive'>
  deleteConversation?: (id: number, deleteUnreferencedMedia: boolean) => unknown | Promise<unknown>
}

export type AIMcpRuntimeIpcDependencies = {
  getManager: () => Pick<AIMcpManager, 'connect' | 'disconnect' | 'refreshTools'>
}

function serializeError(error: unknown) {
  if (error instanceof AIServiceError) return error.detail
  if (error instanceof AIValidationError) {
    return {
      code: 'invalid_input',
      message: 'AI configuration input is invalid.',
      retryable: false,
      issues: error.issues,
    }
  }
  return {
    code: 'internal_error',
    message: 'AI configuration operation failed.',
    retryable: false,
  }
}

async function respond(action: () => unknown | Promise<unknown>) {
  try {
    return { success: true, data: await action() }
  } catch (error) {
    return { success: false, error: serializeError(error) }
  }
}

function respondWithObject(
  payload: unknown,
  action: (data: Record<string, unknown>) => unknown | Promise<unknown>,
) {
  return respond(() => action(requireObject(payload)))
}

function requireObject(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AIServiceError({
      code: 'invalid_input',
      message: 'Invalid AI IPC payload.',
      retryable: false,
    })
  }
  return payload as Record<string, unknown>
}

function requireId(value: unknown, field = 'id') {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new AIServiceError({
      code: 'invalid_input',
      message: `Invalid ${field}.`,
      retryable: false,
    })
  }
  return Number(value)
}

function requireBoolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') {
    throw new AIServiceError({
      code: 'invalid_input',
      message: `Invalid ${field}.`,
      retryable: false,
    })
  }
  return value
}

function requireString(value: unknown, field: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new AIServiceError({
      code: 'invalid_input',
      message: `Invalid ${field}.`,
      retryable: false,
    })
  }
  return value.trim()
}

function requireOptionalName(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > 120) {
    throw new AIServiceError({
      code: 'invalid_input',
      message: 'Invalid copy name.',
      retryable: false,
    })
  }
  return value.trim()
}

export function createAIConfigHandlers(
  dependencies: AIConfigIpcDependencies,
): Record<AIConfigChannel, AIHandler> {
  const services = (): AIConfigServices => {
    const db = dependencies.getDb()
    const credentials = new AICredentialService(
      dependencies.getCredentialFilePath(),
      dependencies.getCredentialCryptoAdapter(),
    )
    return {
      providers: new AIProviderService(db, credentials),
      agents: new AIAgentService(db),
      mcp: new AIMcpConfigService(db, credentials),
    }
  }

  return {
    'ai:providers:list': (_event, payload) =>
      respond(() => {
        const filters = payload === undefined ? {} : requireObject(payload)
        return services().providers.list(filters)
      }),
    'ai:providers:get': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        return services().providers.get(id)
      }),
    'ai:providers:create': (_event, payload) => respond(() => services().providers.create(payload)),
    'ai:providers:update': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        return services().providers.update(id, data.input, {
          preserveHeaders: data.preserveHeaders === true,
        })
      }),
    'ai:providers:copy': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const name = requireOptionalName(data.name)
        return services().providers.copy(id, name)
      }),
    'ai:providers:setEnabled': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const enabled = requireBoolean(data.enabled, 'enabled')
        return services().providers.setEnabled(id, enabled)
      }),
    'ai:providers:setDefault': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const capability = data.capability
        if (!['text', 'image', 'video'].includes(String(capability))) {
          throw new AIServiceError({
            code: 'invalid_input',
            message: 'Invalid provider capability.',
            retryable: false,
          })
        }
        const id = requireId(data.id)
        return services().providers.setDefault(id, capability as 'text' | 'image' | 'video')
      }),
    'ai:providers:removeCredential': (_event, payload) =>
      respondWithObject(payload, (data) =>
        services().providers.removeCredential(requireId(data.id)),
      ),
    'ai:providers:dependencies': (_event, payload) =>
      respondWithObject(payload, (data) =>
        services().providers.getDependencies(requireId(data.id)),
      ),
    'ai:providers:delete': (_event, payload) =>
      respondWithObject(payload, (data) => services().providers.delete(requireId(data.id))),

    'ai:agents:list': () => respond(() => services().agents.list()),
    'ai:agents:get': (_event, payload) =>
      respondWithObject(payload, (data) => services().agents.get(requireId(data.id))),
    'ai:agents:create': (_event, payload) => respond(() => services().agents.create(payload)),
    'ai:agents:update': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        return services().agents.update(id, data.input)
      }),
    'ai:agents:copy': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const name = requireOptionalName(data.name)
        return services().agents.copy(id, name)
      }),
    'ai:agents:setEnabled': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const enabled = requireBoolean(data.enabled, 'enabled')
        return services().agents.setEnabled(id, enabled)
      }),
    'ai:agents:setDefault': (_event, payload) =>
      respondWithObject(payload, (data) => services().agents.setDefault(requireId(data.id))),
    'ai:agents:snapshot': (_event, payload) =>
      respondWithObject(payload, (data) => services().agents.getSnapshot(requireId(data.id))),
    'ai:agents:delete': (_event, payload) =>
      respondWithObject(payload, (data) => services().agents.delete(requireId(data.id))),

    'ai:mcp:list': () => respond(() => services().mcp.list()),
    'ai:mcp:get': (_event, payload) =>
      respondWithObject(payload, (data) => services().mcp.get(requireId(data.id))),
    'ai:mcp:create': (_event, payload) => respond(() => services().mcp.create(payload)),
    'ai:mcp:update': (_event, payload) =>
      respondWithObject(payload, async (data) => {
        const id = requireId(data.id)
        const result = services().mcp.update(id, data.input, {
          preserveCredentials: data.preserveCredentials === true,
        })
        await dependencies.onMcpChanged?.(id, 'updated')
        return result
      }),
    'ai:mcp:copy': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const name = requireOptionalName(data.name)
        return services().mcp.copy(id, name)
      }),
    'ai:mcp:setEnabled': (_event, payload) =>
      respondWithObject(payload, async (data) => {
        const id = requireId(data.id)
        const enabled = requireBoolean(data.enabled, 'enabled')
        const result = services().mcp.setEnabled(id, enabled)
        if (!enabled) await dependencies.onMcpChanged?.(id, 'disabled')
        return result
      }),
    'ai:mcp:setRiskOverride': (_event, payload) =>
      respondWithObject(payload, (data) => {
        if (typeof data.toolName !== 'string') {
          throw new AIServiceError({
            code: 'invalid_input',
            message: 'Invalid MCP tool name.',
            retryable: false,
          })
        }
        const id = requireId(data.id)
        const toolName = data.toolName
        return services().mcp.setRiskOverride(
          id,
          toolName,
          data.risk as 'read' | 'write' | 'command' | 'external_side_effect' | null,
        )
      }),
    'ai:mcp:dependencies': (_event, payload) =>
      respondWithObject(payload, (data) => services().mcp.getDependencies(requireId(data.id))),
    'ai:mcp:delete': (_event, payload) =>
      respondWithObject(payload, async (data) => {
        const id = requireId(data.id)
        const result = services().mcp.delete(id)
        await dependencies.onMcpChanged?.(id, 'deleted')
        return result
      }),
  }
}

export function registerAIConfigIpc(
  registrar: AIConfigIpcRegistrar,
  dependencies: AIConfigIpcDependencies,
) {
  const handlers = createAIConfigHandlers(dependencies)
  for (const channel of AI_CONFIG_CHANNELS) registrar.handle(channel, handlers[channel])
}

export function createAIRuntimeHandlers(
  dependencies: AIRuntimeIpcDependencies,
): Record<AIRuntimeChannel, AIHandler> {
  return {
    'ai:runs:start': (_event, payload) => respond(() => dependencies.getRuntime().start(payload)),
    'ai:runs:cancel': (_event, payload) =>
      respondWithObject(payload, (data) =>
        dependencies.getRuntime().cancel(
          requireId(data.conversationId, 'conversation ID'),
          data.runId === undefined ? undefined : requireId(data.runId, 'run ID'),
        ),
      ),
    'ai:runs:approveTool': (_event, payload) =>
      respondWithObject(payload, (data) => dependencies.getRuntime().approve(data)),
  }
}

export function registerAIRuntimeIpc(
  registrar: AIConfigIpcRegistrar,
  dependencies: AIRuntimeIpcDependencies,
) {
  const handlers = createAIRuntimeHandlers(dependencies)
  for (const channel of AI_RUNTIME_CHANNELS) registrar.handle(channel, handlers[channel])
}

export function createAIImageHandlers(
  dependencies: AIImageIpcDependencies,
): Record<AIImageChannel, AIHandler> {
  const active = new Map<number, ReturnType<NonNullable<AIImageIpcDependencies['createAbortScope']>> | null>()
  return {
    'ai:images:generate': (_event, payload) => respondWithObject(payload, async (data) => {
      const conversationId = requireId(data.conversationId, 'conversation ID')
      if (active.has(conversationId) || dependencies.isConversationActive?.(conversationId)) {
        throw new AIServiceError({ code: 'invalid_input', message: 'This conversation already has an active AI run.', retryable: false })
      }
      const abortScope = dependencies.createAbortScope?.()
      active.set(conversationId, abortScope ?? null)
      try {
        return await dependencies.getService().generate({
          conversationId,
          agentId: requireId(data.agentId, 'agent ID'),
          prompt: requireString(data.prompt, 'image prompt', 100_000),
          ...(data.count === undefined ? {} : { count: requireId(data.count, 'image count') }),
          ...(typeof data.size === 'string' && data.size.trim() ? { size: data.size.trim().slice(0, 100) } : {}),
          ...(abortScope ? { signal: abortScope.signal } : {}),
        })
      } finally {
        abortScope?.dispose()
        active.delete(conversationId)
      }
    }),
    'ai:images:cancel': (_event, payload) => respondWithObject(payload, (data) => {
      const conversationId = requireId(data.conversationId, 'conversation ID')
      if (!active.has(conversationId)) return { cancelled: false }
      const abortScope = active.get(conversationId)
      abortScope?.abort()
      return { cancelled: Boolean(abortScope) }
    }),
  }
}

export function registerAIImageIpc(registrar: AIConfigIpcRegistrar, dependencies: AIImageIpcDependencies) {
  const handlers = createAIImageHandlers(dependencies)
  for (const channel of AI_IMAGE_CHANNELS) registrar.handle(channel, handlers[channel])
}

export function createAIVideoHandlers(
  dependencies: AIVideoIpcDependencies,
): Record<AIVideoChannel, AIHandler> {
  const active = new Map<number, ReturnType<NonNullable<AIVideoIpcDependencies['createAbortScope']>> | null>()
  return {
    'ai:videos:generate': (_event, payload) => respondWithObject(payload, async (data) => {
      const conversationId = requireId(data.conversationId, 'conversation ID')
      if (active.has(conversationId) || dependencies.isConversationActive?.(conversationId)) {
        throw new AIServiceError({ code: 'invalid_input', message: 'This conversation already has an active AI run.', retryable: false })
      }
      const abortScope = dependencies.createAbortScope?.()
      active.set(conversationId, abortScope ?? null)
      try {
        return await dependencies.getService().generate({
          conversationId,
          agentId: requireId(data.agentId, 'agent ID'),
          prompt: requireString(data.prompt, 'video prompt', 100_000),
          ...(data.durationSeconds === undefined ? {} : { durationSeconds: requireId(data.durationSeconds, 'video duration') }),
          ...(typeof data.aspectRatio === 'string' && data.aspectRatio.trim() ? { aspectRatio: data.aspectRatio.trim().slice(0, 40) } : {}),
          ...(abortScope ? { signal: abortScope.signal } : {}),
        })
      } finally {
        abortScope?.dispose()
        active.delete(conversationId)
      }
    }),
    'ai:videos:cancel': (_event, payload) => respondWithObject(payload, (data) => {
      const conversationId = requireId(data.conversationId, 'conversation ID')
      if (!active.has(conversationId)) return { cancelled: false }
      const abortScope = active.get(conversationId)
      abortScope?.abort()
      return { cancelled: Boolean(abortScope) }
    }),
  }
}

export function registerAIVideoIpc(registrar: AIConfigIpcRegistrar, dependencies: AIVideoIpcDependencies) {
  const handlers = createAIVideoHandlers(dependencies)
  for (const channel of AI_VIDEO_CHANNELS) registrar.handle(channel, handlers[channel])
}

function requireCleanupInput(data: Record<string, unknown>, requirePlanHash = false) {
  const scope = data.scope
  if (!['unreferenced', 'media_type', 'conversation', 'capacity', 'all_media', 'all_ai'].includes(String(scope))) {
    throw new AIServiceError({ code: 'invalid_input', message: 'Invalid cleanup scope.', retryable: false })
  }
  const mediaType = data.mediaType
  if (mediaType !== undefined && !['image', 'video', 'audio', 'file'].includes(String(mediaType))) {
    throw new AIServiceError({ code: 'invalid_input', message: 'Invalid media type.', retryable: false })
  }
  const planHash = data.planHash
  if (requirePlanHash && (typeof planHash !== 'string' || !/^[a-f0-9]{64}$/.test(planHash))) {
    throw new AIServiceError({ code: 'invalid_input', message: 'Cleanup preview confirmation is required.', retryable: false })
  }
  return {
    scope: scope as 'unreferenced' | 'media_type' | 'conversation' | 'capacity' | 'all_media' | 'all_ai',
    ...(mediaType === undefined ? {} : { mediaType: mediaType as 'image' | 'video' | 'audio' | 'file' }),
    ...(data.conversationId === undefined ? {} : { conversationId: requireId(data.conversationId, 'conversation ID') }),
    ...(data.maxMediaBytes === undefined ? {} : { maxMediaBytes: requireId(data.maxMediaBytes, 'media capacity') }),
    ...(typeof planHash === 'string' ? { planHash } : {}),
  }
}

export function createAIStorageHandlers(
  dependencies: AIStorageIpcDependencies,
): Record<AIStorageChannel, AIHandler> {
  return {
    'ai:storage:usage': () => respond(() => dependencies.getService().getUsage()),
    'ai:storage:previewCleanup': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const input = requireCleanupInput(data)
        return dependencies.getService().previewCleanup(input)
      }),
    'ai:storage:cleanup': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const input = requireCleanupInput(data, true) as Parameters<AIStorageService['cleanup']>[0]
        return dependencies.getService().cleanup(input)
      }),
  }
}

export function registerAIStorageIpc(registrar: AIConfigIpcRegistrar, dependencies: AIStorageIpcDependencies) {
  const handlers = createAIStorageHandlers(dependencies)
  for (const channel of AI_STORAGE_CHANNELS) registrar.handle(channel, handlers[channel])
}

export function createAIConversationHandlers(
  dependencies: AIConversationIpcDependencies,
): Record<AIConversationChannel, AIHandler> {
  const services = () => {
    const db = dependencies.getDb()
    return {
      conversations: new AIConversationService(db),
      agents: new AIAgentService(db),
    }
  }
  return {
    'ai:conversations:list': (_event, payload) =>
      respond(() => {
        dependencies.getRuntime()
        return services().conversations.listConversations(payload === undefined ? {} : requireObject(payload))
      }),
    'ai:conversations:get': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        return services().conversations.getConversation(id)
      }),
    'ai:conversations:create': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const agentId = requireId(data.agentId, 'agent ID')
        const serviceSet = services()
        const snapshot = serviceSet.agents.getSnapshot(agentId)
        return serviceSet.conversations.createConversation({
          title: requireString(data.title, 'conversation title', 300),
          agentId,
          agentSnapshot: snapshot,
        })
      }),
    'ai:conversations:rename': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const title = requireString(data.title, 'conversation title', 300)
        return services().conversations.renameConversation(id, title)
      }),
    'ai:conversations:setPinned': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const pinned = requireBoolean(data.pinned, 'pinned')
        return services().conversations.setConversationPinned(id, pinned)
      }),
    'ai:conversations:setArchived': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const archived = requireBoolean(data.archived, 'archived')
        return services().conversations.setConversationArchived(id, archived)
      }),
    'ai:conversations:delete': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        if (dependencies.getRuntime().isConversationActive(id)) {
          throw new AIServiceError({
            code: 'invalid_input',
            message: 'Stop the active Agent run before deleting this conversation.',
            retryable: false,
          })
        }
        const deleteUnreferencedMedia =
          data.deleteUnreferencedMedia === undefined
            ? false
            : requireBoolean(data.deleteUnreferencedMedia, 'media deletion option')
        if (dependencies.deleteConversation) {
          return dependencies.deleteConversation(id, deleteUnreferencedMedia)
        }
        return services().conversations.deleteConversation(id, {
          deleteUnreferencedMedia:
            deleteUnreferencedMedia,
        })
      }),
    'ai:conversations:messages': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const conversationId = requireId(data.conversationId, 'conversation ID')
        const options = {
          ...(data.beforeId === undefined
            ? {}
            : { beforeId: requireId(data.beforeId, 'before message ID') }),
          ...(data.limit === undefined ? {} : { limit: requireId(data.limit, 'message limit') }),
        }
        return services().conversations.listMessages(conversationId, options)
      }),
    'ai:conversations:runs': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const conversationId = requireId(data.conversationId, 'conversation ID')
        const limit = data.limit === undefined ? 50 : requireId(data.limit, 'run limit')
        return services().conversations.listRuns(conversationId, limit)
      }),
  }
}

export function registerAIConversationIpc(
  registrar: AIConfigIpcRegistrar,
  dependencies: AIConversationIpcDependencies,
) {
  const handlers = createAIConversationHandlers(dependencies)
  for (const channel of AI_CONVERSATION_CHANNELS) registrar.handle(channel, handlers[channel])
}

export function createAIMcpRuntimeHandlers(
  dependencies: AIMcpRuntimeIpcDependencies,
): Record<AIMcpRuntimeChannel, AIHandler> {
  return {
    'ai:mcpRuntime:connect': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        return dependencies.getManager().connect(id, { refresh: data.refresh === true })
      }),
    'ai:mcpRuntime:disconnect': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        return dependencies.getManager().disconnect(id)
      }),
    'ai:mcpRuntime:refreshTools': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        return dependencies.getManager().refreshTools(id)
      }),
  }
}

export function registerAIMcpRuntimeIpc(
  registrar: AIConfigIpcRegistrar,
  dependencies: AIMcpRuntimeIpcDependencies,
) {
  const handlers = createAIMcpRuntimeHandlers(dependencies)
  for (const channel of AI_MCP_RUNTIME_CHANNELS) registrar.handle(channel, handlers[channel])
}

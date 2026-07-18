import type Database from 'better-sqlite3'
import type { AIAgentRuntime } from './agentRuntime'
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

export const AI_RUNTIME_CHANNELS = ['ai:runs:start', 'ai:runs:cancel'] as const

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

type AIConfigChannel = (typeof AI_CONFIG_CHANNELS)[number]
type AIRuntimeChannel = (typeof AI_RUNTIME_CHANNELS)[number]
type AIConversationChannel = (typeof AI_CONVERSATION_CHANNELS)[number]
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
}

export type AIConfigIpcRegistrar = {
  handle: (channel: string, handler: AIHandler) => void
}

export type AIRuntimeIpcDependencies = {
  getRuntime: () => Pick<AIAgentRuntime, 'start' | 'cancel'>
}

export type AIConversationIpcDependencies = {
  getDb: () => Database.Database
  getRuntime: () => Pick<AIAgentRuntime, 'isConversationActive'>
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
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        return services().mcp.update(id, data.input, {
          preserveCredentials: data.preserveCredentials === true,
        })
      }),
    'ai:mcp:copy': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const name = requireOptionalName(data.name)
        return services().mcp.copy(id, name)
      }),
    'ai:mcp:setEnabled': (_event, payload) =>
      respondWithObject(payload, (data) => {
        const id = requireId(data.id)
        const enabled = requireBoolean(data.enabled, 'enabled')
        return services().mcp.setEnabled(id, enabled)
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
      respondWithObject(payload, (data) => services().mcp.delete(requireId(data.id))),
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
  }
}

export function registerAIRuntimeIpc(
  registrar: AIConfigIpcRegistrar,
  dependencies: AIRuntimeIpcDependencies,
) {
  const handlers = createAIRuntimeHandlers(dependencies)
  for (const channel of AI_RUNTIME_CHANNELS) registrar.handle(channel, handlers[channel])
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
        return services().conversations.deleteConversation(id, {
          deleteUnreferencedMedia:
            data.deleteUnreferencedMedia === undefined
              ? false
              : requireBoolean(data.deleteUnreferencedMedia, 'media deletion option'),
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

import type Database from 'better-sqlite3'
import { AIAgentService } from './agentService'
import { AICredentialService, type AICredentialCryptoAdapter } from './credentialService'
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

type AIConfigChannel = (typeof AI_CONFIG_CHANNELS)[number]
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
        return services().providers.update(id, data.input)
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
        return services().mcp.update(id, data.input)
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

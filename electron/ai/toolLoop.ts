import type { AIMcpToolSummary } from './mcpManager'
import type { OpenAICompatibleDelta, OpenAICompatibleTool } from './providers/openAiCompatible'
import { AIServiceError, type AIToolRisk } from './types'
import { resolveAIToolRisk } from './toolPolicy'

export type AIProviderToolBinding = {
  providerName: string
  qualifiedName: string
  serverId: number
  serverName: string
  toolName: string
  risk: AIToolRisk
  definition: OpenAICompatibleTool
}

export type AIAggregatedToolCall = {
  index: number
  id: string
  providerName: string
  argumentsJson: string
}

export type AINormalizedToolResult = {
  modelContent: string
  summary: string
  isError: boolean
  resources: Array<{
    type: 'image' | 'audio' | 'resource'
    mimeType?: string
    name?: string
    uri?: string
  }>
}

const MAX_PROVIDER_NAME = 64
const MAX_MODEL_RESULT = 50_000
const MAX_PUBLIC_SUMMARY = 12_000
const SENSITIVE_KEY = /(?:api[_-]?key|authorization|cookie|password|secret|token|credential)/i

function toolLoopError(message: string) {
  return new AIServiceError({ code: 'protocol_error', message, retryable: false })
}

function hashText(value: string) {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function safeProviderSegment(value: string) {
  const normalized = value.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'tool'
}

export function createAIProviderToolName(tool: Pick<AIMcpToolSummary, 'serverId' | 'serverName' | 'name'>) {
  const identity = `${tool.serverId}:${tool.serverName}:${tool.name}`
  const suffix = hashText(identity)
  const prefix = `mcp_${tool.serverId}_`
  const available = MAX_PROVIDER_NAME - prefix.length - suffix.length - 1
  return `${prefix}${safeProviderSegment(tool.name).slice(0, Math.max(available, 1))}_${suffix}`
}

function matchesToolRule(rules: string[], binding: Pick<AIProviderToolBinding, 'qualifiedName' | 'toolName' | 'providerName'>) {
  return rules.some((rule) => {
    const normalized = rule.trim()
    return normalized === binding.qualifiedName || normalized === binding.toolName || normalized === binding.providerName
  })
}

export function buildAIProviderToolRegistry(input: {
  tools: AIMcpToolSummary[]
  blockedTools: string[]
  riskOverrides?: Map<number, Record<string, AIToolRisk>>
}) {
  const byProviderName = new Map<string, AIProviderToolBinding>()
  const definitions: OpenAICompatibleTool[] = []
  for (const tool of input.tools) {
    const providerName = createAIProviderToolName(tool)
    const qualifiedName = `${tool.serverName}.${tool.name}`
    const override = input.riskOverrides?.get(tool.serverId)?.[tool.name]
      ?? input.riskOverrides?.get(tool.serverId)?.[qualifiedName]
    const binding: AIProviderToolBinding = {
      providerName,
      qualifiedName,
      serverId: tool.serverId,
      serverName: tool.serverName,
      toolName: tool.name,
      risk: resolveAIToolRisk(tool, override),
      definition: {
        type: 'function',
        function: {
          name: providerName,
          ...(tool.description ? { description: `${qualifiedName}: ${tool.description}`.slice(0, 4_000) } : {}),
          parameters: tool.inputSchema,
        },
      },
    }
    if (matchesToolRule(input.blockedTools, binding)) continue
    if (byProviderName.has(providerName)) throw toolLoopError('The MCP tool registry contains a provider-name collision.')
    byProviderName.set(providerName, binding)
    definitions.push(binding.definition)
  }
  return { byProviderName, definitions }
}

export function aggregateAIToolCallFragments(deltas: OpenAICompatibleDelta[]) {
  const calls = new Map<number, { id: string; name: string; argumentsJson: string }>()
  for (const delta of deltas) {
    if (delta.type !== 'tool_call') continue
    const current = calls.get(delta.index) ?? { id: '', name: '', argumentsJson: '' }
    if (delta.id && !current.id) current.id = delta.id
    if (delta.name) current.name += delta.name
    if (delta.argumentsDelta) current.argumentsJson += delta.argumentsDelta
    calls.set(delta.index, current)
  }
  return [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => {
      if (!call.id || !call.name) throw toolLoopError('The model returned an incomplete tool call.')
      return {
        index,
        id: call.id.slice(0, 300),
        providerName: call.name,
        argumentsJson: call.argumentsJson || '{}',
      } satisfies AIAggregatedToolCall
    })
}

export function parseAIToolArguments(value: string) {
  if (value.length > 1_000_000) throw toolLoopError('The model returned tool arguments that are too large.')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw toolLoopError('The model returned malformed JSON tool arguments.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw toolLoopError('The model returned tool arguments that are not an object.')
  }
  return parsed as Record<string, unknown>
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]'
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, depth + 1))
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(item, depth + 1)
    }
    return output
  }
  if (typeof value === 'string') {
    return value
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [REDACTED]')
      .replace(/\b(sk|xai)-[A-Za-z0-9_-]{8,}/gi, '[REDACTED]')
      .slice(0, 20_000)
  }
  return value
}

export function summarizeAIToolArguments(value: Record<string, unknown>) {
  const serialized = JSON.stringify(redactValue(value), null, 2)
  return serialized.length <= 8_000 ? serialized : `${serialized.slice(0, 7_900)}\n[Arguments truncated]`
}

function safeUri(value: unknown) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().slice(0, 2_000)
  } catch {
    return value.slice(0, 2_000)
  }
}

function collectToolResult(value: unknown) {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const content = Array.isArray(result.content) ? result.content : []
  const text: string[] = []
  const resources: AINormalizedToolResult['resources'] = []
  for (const item of content.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue
    const block = item as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') text.push(block.text)
    else if (block.type === 'image') {
      resources.push({ type: 'image', ...(typeof block.mimeType === 'string' ? { mimeType: block.mimeType } : {}) })
    } else if (block.type === 'audio') {
      resources.push({ type: 'audio', ...(typeof block.mimeType === 'string' ? { mimeType: block.mimeType } : {}) })
    } else if (block.type === 'resource_link') {
      resources.push({
        type: 'resource',
        ...(typeof block.name === 'string' ? { name: block.name.slice(0, 1_000) } : {}),
        ...(typeof block.mimeType === 'string' ? { mimeType: block.mimeType } : {}),
        ...(safeUri(block.uri) ? { uri: safeUri(block.uri) } : {}),
      })
    } else if (block.type === 'resource' && block.resource && typeof block.resource === 'object') {
      const resource = block.resource as Record<string, unknown>
      if (typeof resource.text === 'string') text.push(resource.text)
      resources.push({
        type: 'resource',
        ...(typeof resource.mimeType === 'string' ? { mimeType: resource.mimeType } : {}),
        ...(safeUri(resource.uri) ? { uri: safeUri(resource.uri) } : {}),
      })
    }
  }
  if (result.structuredContent !== undefined) {
    text.push(JSON.stringify(redactValue(result.structuredContent), null, 2))
  }
  if (text.length === 0) text.push(JSON.stringify(redactValue(value), null, 2))
  return { text: text.filter(Boolean).join('\n\n'), resources, isError: result.isError === true }
}

export function normalizeAIMcpToolResult(value: unknown): AINormalizedToolResult {
  const collected = collectToolResult(value)
  const resourceNote = collected.resources.length
    ? `\n\n[${collected.resources.length} binary or linked resource(s) omitted from inline text]`
    : ''
  const fullText = `${collected.text}${resourceNote}`.trim() || 'The tool returned no textual content.'
  const oversized = fullText.length > MAX_MODEL_RESULT
  const modelContent = oversized
    ? `${fullText.slice(0, MAX_MODEL_RESULT - 120)}\n\n[Tool output summarized because it exceeded the safe context limit.]`
    : fullText
  const summaryBase = fullText.length > MAX_PUBLIC_SUMMARY
    ? `${fullText.slice(0, MAX_PUBLIC_SUMMARY - 100)}\n[Result truncated for display]`
    : fullText
  return {
    modelContent,
    summary: summaryBase,
    isError: collected.isError,
    resources: collected.resources,
  }
}

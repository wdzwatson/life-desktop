import { AIServiceError, type AIErrorCode } from '../types'
import { parseAISseStream } from './streamParser'

export type OpenAICompatibleMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export type OpenAICompatibleTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type OpenAICompatibleConfig = {
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
  model: string
  timeoutMs: number
}

export type OpenAICompatibleRequest = {
  messages: OpenAICompatibleMessage[]
  temperature?: number
  maxOutputTokens?: number
  tools?: OpenAICompatibleTool[]
  toolChoice?: 'auto' | 'none' | 'required'
  signal?: AbortSignal
}

export type OpenAICompatibleDelta =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call'
      index: number
      id?: string
      name?: string
      argumentsDelta?: string
    }
  | { type: 'usage'; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }
  | { type: 'done'; finishReason?: string; providerRequestId?: string }

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

type OpenAIChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

function providerError(code: AIErrorCode, message: string, retryable: boolean, retryAt?: number) {
  return new AIServiceError({ code, message, retryable, ...(retryAt ? { retryAt } : {}) })
}

function buildEndpoint(baseUrl: string) {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function buildHeaders(config: OpenAICompatibleConfig) {
  const headers = new Headers(config.headers)
  headers.set('content-type', 'application/json')
  headers.set('accept', 'text/event-stream')
  if (config.apiKey) headers.set('authorization', `Bearer ${config.apiKey}`)
  return headers
}

function parseRetryAt(response: Response) {
  const value = response.headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? date : undefined
}

function mapHttpError(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return providerError('authentication_failed', 'The model provider rejected the configured credentials.', false)
  }
  if (response.status === 404) {
    return providerError('provider_error', 'The model endpoint or requested model was not found.', false)
  }
  if (response.status === 429) {
    return providerError('rate_limited', 'The model provider rate limit was reached.', true, parseRetryAt(response))
  }
  if (response.status >= 500) {
    return providerError('provider_error', `The model provider returned HTTP ${response.status}.`, true)
  }
  return providerError('provider_error', `The model provider rejected the request with HTTP ${response.status}.`, false)
}

function toUsage(value: NonNullable<OpenAIChunk['usage']>) {
  return {
    ...(Number.isFinite(value.prompt_tokens) ? { inputTokens: value.prompt_tokens } : {}),
    ...(Number.isFinite(value.completion_tokens) ? { outputTokens: value.completion_tokens } : {}),
    ...(Number.isFinite(value.total_tokens) ? { totalTokens: value.total_tokens } : {}),
  }
}

function abortReason(signal: AbortSignal, timedOut: boolean) {
  if (timedOut) return providerError('timeout', 'The model provider request timed out.', true)
  if (signal.aborted) return providerError('cancelled', 'The model provider request was cancelled.', false)
  return providerError('network_error', 'The model provider request failed.', true)
}

export class OpenAICompatibleAdapter {
  constructor(
    private readonly config: OpenAICompatibleConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async *streamChat(request: OpenAICompatibleRequest): AsyncGenerator<OpenAICompatibleDelta> {
    if (!this.config.model.trim()) throw providerError('configuration_incomplete', 'A text model is required.', false)
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw providerError('invalid_input', 'At least one chat message is required.', false)
    }
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('Timed out', 'TimeoutError'))
    }, this.config.timeoutMs)
    const onAbort = () => controller.abort(request.signal?.reason)
    request.signal?.addEventListener('abort', onAbort, { once: true })
    if (request.signal?.aborted) controller.abort(request.signal.reason)
    try {
      let response: Response
      try {
        response = await this.fetchImpl(buildEndpoint(this.config.baseUrl), {
          method: 'POST',
          headers: buildHeaders(this.config),
          body: JSON.stringify({
            model: this.config.model,
            messages: request.messages,
            stream: true,
            stream_options: { include_usage: true },
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
            ...(request.tools?.length ? { tools: request.tools, tool_choice: request.toolChoice ?? 'auto' } : {}),
          }),
          signal: controller.signal,
        })
      } catch {
        if (controller.signal.aborted || request.signal?.aborted) throw abortReason(controller.signal, timedOut)
        throw providerError('network_error', 'The model provider could not be reached.', true)
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined)
        throw mapHttpError(response)
      }
      if (!response.body) throw providerError('protocol_error', 'The model provider returned an empty response body.', true)

      const providerRequestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined
      let finishReason: string | undefined
      let emittedDone = false
      try {
        for await (const event of parseAISseStream(response.body, controller.signal)) {
          if (event.data.trim() === '[DONE]') {
            emittedDone = true
            yield { type: 'done', ...(finishReason ? { finishReason } : {}), ...(providerRequestId ? { providerRequestId } : {}) }
            break
          }
          let chunk: OpenAIChunk
          try {
            chunk = JSON.parse(event.data) as OpenAIChunk
          } catch {
            throw providerError('protocol_error', 'The model provider returned invalid streaming JSON.', false)
          }
          if (chunk.usage) yield { type: 'usage', usage: toUsage(chunk.usage) }
          for (const choice of chunk.choices ?? []) {
            if (choice.finish_reason) finishReason = choice.finish_reason
            if (typeof choice.delta?.content === 'string' && choice.delta.content) {
              yield { type: 'text', text: choice.delta.content }
            }
            for (const toolCall of choice.delta?.tool_calls ?? []) {
              yield {
                type: 'tool_call',
                index: Number.isInteger(toolCall.index) ? Number(toolCall.index) : 0,
                ...(toolCall.id ? { id: toolCall.id } : {}),
                ...(toolCall.function?.name ? { name: toolCall.function.name } : {}),
                ...(toolCall.function?.arguments
                  ? { argumentsDelta: toolCall.function.arguments }
                  : {}),
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof AIServiceError) throw error
        if (controller.signal.aborted || request.signal?.aborted) throw abortReason(controller.signal, timedOut)
        throw providerError('network_error', 'The model provider stream was interrupted.', true)
      }
      if (!emittedDone) {
        yield { type: 'done', ...(finishReason ? { finishReason } : {}), ...(providerRequestId ? { providerRequestId } : {}) }
      }
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', onAbort)
    }
  }
}

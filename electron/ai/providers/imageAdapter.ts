import { AIServiceError, type AIErrorDetail } from '../types'

export type AIImageResult =
  | { kind: 'base64'; data: string; mimeType?: string; revisedPrompt?: string }
  | { kind: 'url'; url: string; revisedPrompt?: string }

export type AIImageGenerationRequest = {
  prompt: string
  count?: number
  size?: string
  signal?: AbortSignal
}

export type AIImageAdapterConfig = {
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
  model: string
  timeoutMs: number
  pollIntervalMs?: number
  maxPolls?: number
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

function imageError(code: AIErrorDetail['code'], message: string, retryable = false) {
  return new AIServiceError({ code, message, retryable })
}

function endpoint(baseUrl: string, suffix = '') {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/images/generations${suffix}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function headers(config: AIImageAdapterConfig) {
  const result = new Headers(config.headers)
  result.set('content-type', 'application/json')
  result.set('accept', 'application/json')
  if (config.apiKey) result.set('authorization', `Bearer ${config.apiKey}`)
  return result
}

function parseResults(value: unknown): AIImageResult[] {
  if (!value || typeof value !== 'object') return []
  const payload = value as Record<string, unknown>
  const candidates = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.images) ? payload.images : []
  return candidates.flatMap((candidate) => {
    if (typeof candidate === 'string') {
      return candidate.startsWith('http') ? [{ kind: 'url' as const, url: candidate }] : [{ kind: 'base64' as const, data: candidate }]
    }
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Record<string, unknown>
    const revisedPrompt = typeof item.revised_prompt === 'string' ? item.revised_prompt.slice(0, 20_000) : undefined
    if (typeof item.b64_json === 'string') {
      return [{ kind: 'base64' as const, data: item.b64_json, ...(typeof item.mime_type === 'string' ? { mimeType: item.mime_type } : {}), ...(revisedPrompt ? { revisedPrompt } : {}) }]
    }
    if (typeof item.base64 === 'string') {
      return [{ kind: 'base64' as const, data: item.base64, ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}), ...(revisedPrompt ? { revisedPrompt } : {}) }]
    }
    if (typeof item.url === 'string') return [{ kind: 'url' as const, url: item.url, ...(revisedPrompt ? { revisedPrompt } : {}) }]
    return []
  })
}

function taskInfo(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const payload = value as Record<string, unknown>
  const id = typeof payload.task_id === 'string' ? payload.task_id : typeof payload.id === 'string' ? payload.id : undefined
  if (!id) return undefined
  return {
    id: id.slice(0, 1_000),
    status: String(payload.status ?? '').toLowerCase(),
    statusUrl: typeof payload.status_url === 'string' ? payload.status_url : undefined,
  }
}

function failureMessage(value: unknown) {
  if (!value || typeof value !== 'object') return 'The image provider reported a failed task.'
  const payload = value as Record<string, unknown>
  const error = payload.error
  if (typeof error === 'string') return error.slice(0, 4_000)
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
    return String((error as Record<string, unknown>).message).slice(0, 4_000)
  }
  return 'The image provider reported a failed task.'
}

export class AIImageAdapter {
  constructor(
    private readonly config: AIImageAdapterConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async generate(request: AIImageGenerationRequest) {
    const prompt = request.prompt.trim()
    if (!prompt || prompt.length > 100_000) throw imageError('invalid_input', 'Image prompt must contain between 1 and 100,000 characters.')
    if (!this.config.model.trim()) throw imageError('configuration_incomplete', 'An image model is required.')
    const count = Math.min(Math.max(request.count ?? 1, 1), 4)
    const response = await this.request(endpoint(this.config.baseUrl), {
      method: 'POST',
      headers: headers(this.config),
      body: JSON.stringify({
        model: this.config.model,
        prompt,
        n: count,
        ...(request.size ? { size: request.size } : {}),
        response_format: 'b64_json',
      }),
      signal: request.signal,
    })
    let payload = await this.readJson(response)
    let results = parseResults(payload)
    if (results.length > 0) return { results: results.slice(0, count) }
    const task = taskInfo(payload)
    if (!task) throw imageError('protocol_error', 'The image provider returned neither images nor a task ID.')
    const pollInterval = Math.min(Math.max(this.config.pollIntervalMs ?? 1_500, 100), 30_000)
    const maxPolls = Math.min(Math.max(this.config.maxPolls ?? 120, 1), 1_000)
    for (let poll = 0; poll < maxPolls; poll += 1) {
      if (request.signal?.aborted) throw imageError('cancelled', 'Image generation was cancelled.')
      await this.sleep(pollInterval)
      let pollUrl = endpoint(this.config.baseUrl, `/${encodeURIComponent(task.id)}`)
      if (task.statusUrl) {
        const candidate = new URL(task.statusUrl, this.config.baseUrl)
        const providerOrigin = new URL(this.config.baseUrl).origin
        if (candidate.origin !== providerOrigin || candidate.username || candidate.password) {
          throw imageError('protocol_error', 'The image provider returned an unsafe task status URL.')
        }
        pollUrl = candidate.toString()
      }
      payload = await this.readJson(await this.request(pollUrl, { method: 'GET', headers: headers(this.config), signal: request.signal }))
      results = parseResults(payload)
      if (results.length > 0) return { results: results.slice(0, count), taskId: task.id }
      const status = String((payload as Record<string, unknown>)?.status ?? '').toLowerCase()
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) throw imageError('media_failed', failureMessage(payload), true)
    }
    throw imageError('timeout', 'Image generation did not finish before the polling limit.', true)
  }

  private async request(url: string, init: RequestInit) {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, this.config.timeoutMs)
    const signal = init.signal
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) controller.abort(signal.reason)
    try {
      let response: Response
      try {
        response = await this.fetchImpl(url, { ...init, signal: controller.signal })
      } catch {
        if (timedOut) throw imageError('timeout', 'The image provider request timed out.', true)
        if (controller.signal.aborted) throw imageError('cancelled', 'Image generation was cancelled.')
        throw imageError('network_error', 'The image provider could not be reached.', true)
      }
      if (response.status === 401 || response.status === 403) throw imageError('authentication_failed', 'The image provider rejected the configured credentials.')
      if (response.status === 429) throw imageError('rate_limited', 'The image provider rate limit was reached.', true)
      if (!response.ok) throw imageError('provider_error', `The image provider returned HTTP ${response.status}.`, response.status >= 500)
      return response
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private async readJson(response: Response) {
    try {
      return await response.json() as unknown
    } catch {
      throw imageError('protocol_error', 'The image provider returned invalid JSON.')
    }
  }
}

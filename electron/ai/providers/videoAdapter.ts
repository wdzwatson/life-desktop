import { AIServiceError, type AIErrorDetail } from '../types'

export type AIVideoTask = { taskId: string; statusUrl?: string }
export type AIVideoTaskStatus =
  | { status: 'queued' | 'generating'; progress?: number }
  | { status: 'completed'; url: string; mimeType?: string; durationSeconds?: number }
  | { status: 'failed' | 'cancelled'; message: string }

export type AIVideoAdapterConfig = {
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
  model: string
  timeoutMs: number
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

function videoError(code: AIErrorDetail['code'], message: string, retryable = false) {
  return new AIServiceError({ code, message, retryable })
}

function baseEndpoint(baseUrl: string) {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/videos/generations`
  url.search = ''
  url.hash = ''
  return url
}

function requestHeaders(config: AIVideoAdapterConfig) {
  const result = new Headers(config.headers)
  result.set('content-type', 'application/json')
  result.set('accept', 'application/json')
  if (config.apiKey) result.set('authorization', `Bearer ${config.apiKey}`)
  return result
}

function taskId(payload: Record<string, unknown>) {
  const value = typeof payload.task_id === 'string' ? payload.task_id : typeof payload.id === 'string' ? payload.id : ''
  if (!value) throw videoError('protocol_error', 'The video provider returned no task ID.')
  return value.slice(0, 1_000)
}

function resultUrl(payload: Record<string, unknown>) {
  if (typeof payload.url === 'string') return payload.url
  if (typeof payload.video_url === 'string') return payload.video_url
  if (payload.output && typeof payload.output === 'object' && typeof (payload.output as Record<string, unknown>).url === 'string') {
    return String((payload.output as Record<string, unknown>).url)
  }
  return undefined
}

export class AIVideoAdapter {
  constructor(private readonly config: AIVideoAdapterConfig, private readonly fetchImpl: FetchLike = fetch) {}

  async create(input: { prompt: string; durationSeconds?: number; aspectRatio?: string; signal?: AbortSignal }): Promise<AIVideoTask> {
    const prompt = input.prompt.trim()
    if (!prompt) throw videoError('invalid_input', 'A video prompt is required.')
    const endpoint = baseEndpoint(this.config.baseUrl)
    const payload = await this.json(endpoint.toString(), {
      method: 'POST',
      headers: requestHeaders(this.config),
      body: JSON.stringify({ model: this.config.model, prompt, ...(input.durationSeconds ? { duration: input.durationSeconds } : {}), ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}) }),
      signal: input.signal,
    })
    const id = taskId(payload)
    const statusUrl = typeof payload.status_url === 'string' ? this.safeTaskUrl(payload.status_url) : undefined
    return { taskId: id, ...(statusUrl ? { statusUrl } : {}) }
  }

  async status(task: AIVideoTask, signal?: AbortSignal): Promise<AIVideoTaskStatus> {
    const url = task.statusUrl ?? `${baseEndpoint(this.config.baseUrl).toString().replace(/\/$/, '')}/${encodeURIComponent(task.taskId)}`
    const payload = await this.json(url, { method: 'GET', headers: requestHeaders(this.config), signal })
    const status = String(payload.status ?? payload.state ?? '').toLowerCase()
    const urlResult = resultUrl(payload)
    if (urlResult && ['completed', 'succeeded', 'success', 'done'].includes(status)) {
      return {
        status: 'completed',
        url: urlResult,
        ...(typeof payload.mime_type === 'string' ? { mimeType: payload.mime_type } : {}),
        ...(typeof payload.duration === 'number' ? { durationSeconds: payload.duration } : {}),
      }
    }
    if (['failed', 'error'].includes(status)) return { status: 'failed', message: String(payload.error ?? 'Video generation failed.').slice(0, 4_000) }
    if (['cancelled', 'canceled'].includes(status)) return { status: 'cancelled', message: 'Video generation was cancelled.' }
    return {
      status: ['queued', 'pending'].includes(status) ? 'queued' : 'generating',
      ...(typeof payload.progress === 'number' ? { progress: Math.min(Math.max(payload.progress, 0), 100) } : {}),
    }
  }

  async cancel(task: AIVideoTask, signal?: AbortSignal) {
    const url = task.statusUrl ?? `${baseEndpoint(this.config.baseUrl).toString().replace(/\/$/, '')}/${encodeURIComponent(task.taskId)}`
    await this.json(url, { method: 'DELETE', headers: requestHeaders(this.config), signal })
    return { cancelled: true }
  }

  private safeTaskUrl(value: string) {
    const candidate = new URL(value, this.config.baseUrl)
    if (candidate.origin !== new URL(this.config.baseUrl).origin || candidate.username || candidate.password) {
      throw videoError('protocol_error', 'The video provider returned an unsafe task URL.')
    }
    return candidate.toString()
  }

  private async json(url: string, init: RequestInit) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.config.timeoutMs)
    const signal = init.signal
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) controller.abort(signal.reason)
    try {
      let response: Response
      try { response = await this.fetchImpl(url, { ...init, signal: controller.signal }) }
      catch {
        if (timedOut) throw videoError('timeout', 'The video provider request timed out.', true)
        if (controller.signal.aborted) throw videoError('cancelled', 'Video generation was cancelled.')
        throw videoError('network_error', 'The video provider could not be reached.', true)
      }
      if (response.status === 401 || response.status === 403) throw videoError('authentication_failed', 'The video provider rejected the configured credentials.')
      if (response.status === 429) throw videoError('rate_limited', 'The video provider rate limit was reached.', true)
      if (!response.ok) throw videoError('provider_error', `The video provider returned HTTP ${response.status}.`, response.status >= 500)
      try { return await response.json() as Record<string, unknown> }
      catch { throw videoError('protocol_error', 'The video provider returned invalid JSON.') }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

import type { WebContents } from 'electron'

export interface DouyinOfficialPageResponse {
  ok: boolean
  status: number
  body: Record<string, unknown> | null
}

export interface DouyinOfficialPageExecutor {
  isLoggedIn(): Promise<boolean>
  request(pathname: string, params?: Record<string, string | undefined>): Promise<DouyinOfficialPageResponse>
}

interface CapturedResponse extends DouyinOfficialPageResponse {
  pathname: string
  params: URLSearchParams
}

const RESPONSE_WAIT_TIMEOUT_MS = 15_000

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function matchesRequest(response: CapturedResponse, pathname: string, params: Record<string, string | undefined>) {
  if (response.pathname !== pathname) return false
  return Object.entries(params).every(([key, value]) => !value || response.params.get(key) === value)
}

function toPageResponse(response: CapturedResponse): DouyinOfficialPageResponse {
  return { ok: response.ok, status: response.status, body: response.body }
}

/** Reads responses initiated by Douyin's own signed web client. */
export class DouyinOfficialPageObserver implements DouyinOfficialPageExecutor {
  private readonly responses: CapturedResponse[] = []
  private readonly folderTitles = new Map<string, string>()
  private readonly pendingResponses = new Map<string, { url: URL; status: number }>()
  private readonly waiters = new Set<{
    pathname: string
    params: Record<string, string | undefined>
    resolve: (value: DouyinOfficialPageResponse) => void
    reject: (reason: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private attached = false

  constructor(private readonly page: WebContents) {}

  async start() {
    if (this.attached) return
    this.page.debugger.attach('1.3')
    this.attached = true
    this.page.debugger.on('message', this.handleDebuggerMessage)
    await this.page.debugger.sendCommand('Network.enable')
  }

  stop() {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Douyin favorites page was closed before it finished loading.'))
    }
    this.waiters.clear()
    this.responses.length = 0
    this.folderTitles.clear()
    this.pendingResponses.clear()
    if (!this.attached) return
    this.page.debugger.removeListener('message', this.handleDebuggerMessage)
    if (this.page.debugger.isAttached()) this.page.debugger.detach()
    this.attached = false
  }

  async isLoggedIn() {
    const loggedOut = await this.page.executeJavaScript(`
      (() => {
        const text = document.body?.innerText || ''
        return text.includes('未登录') || text.includes('登录后')
      })()
    `)
    return !loggedOut
  }

  async request(pathname: string, params: Record<string, string | undefined> = {}) {
    const captured = this.takeResponse(pathname, params)
    if (captured) return captured
    await this.triggerOfficialRequest(pathname, params)
    const afterTrigger = this.takeResponse(pathname, params)
    if (afterTrigger) return afterTrigger
    return new Promise<DouyinOfficialPageResponse>((resolve, reject) => {
      const waiter = {
        pathname,
        params,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error('Douyin did not load readable favorites data in the official page.'))
        }, RESPONSE_WAIT_TIMEOUT_MS),
      }
      this.waiters.add(waiter)
    })
  }

  private takeResponse(pathname: string, params: Record<string, string | undefined>) {
    const index = this.responses.findIndex((response) => matchesRequest(response, pathname, params))
    if (index < 0) return undefined
    return toPageResponse(this.responses.splice(index, 1)[0])
  }

  private async triggerOfficialRequest(pathname: string, params: Record<string, string | undefined>) {
    if (params.cursor) {
      await this.page.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)')
      return
    }
    if (pathname === '/aweme/v1/web/collects/list/') {
      const clicked = await this.clickExactText('收藏')
      if (!clicked) throw new Error('Douyin favorites tab is unavailable in the official page.')
      return
    }
    if (pathname === '/aweme/v1/web/collects/video/list/' && params.collects_id) {
      const clicked = await this.clickExactText(this.folderTitles.get(String(params.collects_id)) || String(params.collects_id))
      if (!clicked) throw new Error('Douyin did not expose this favorite folder in the official page.')
    }
  }

  private async clickExactText(value: string) {
    return this.page.executeJavaScript(`
      (() => {
        const target = ${JSON.stringify(value)}
        const element = Array.from(document.querySelectorAll('button, a, div, span'))
          .find((candidate) => candidate.textContent?.trim() === target)
        if (!element) return false
        element.click()
        return true
      })()
    `)
  }

  private readonly handleDebuggerMessage = (_event: Electron.Event, method: string, params: Record<string, unknown>) => {
    const requestId = typeof params.requestId === 'string' ? params.requestId : ''
    if (!requestId) return
    if (method === 'Network.responseReceived') {
      const response = record(params.response)
      const responseUrl = typeof response?.url === 'string' ? response.url : ''
      let url: URL
      try {
        url = new URL(responseUrl)
      } catch {
        return
      }
      if (!url.pathname.startsWith('/aweme/v1/web/collects/')) return
      this.pendingResponses.set(requestId, { url, status: Number(response?.status) || 0 })
      return
    }
    const response = this.pendingResponses.get(requestId)
    if (!response) return
    this.pendingResponses.delete(requestId)
    if (method === 'Network.loadingFinished') {
      void this.captureResponse(response.url, requestId, response.status)
      return
    }
    if (method === 'Network.loadingFailed') {
      this.publishResponse({ ok: false, status: response.status, body: null, pathname: response.url.pathname, params: response.url.searchParams })
    }
  }

  private async captureResponse(url: URL, requestId: string, status: number) {
    try {
      const result = (await this.page.debugger.sendCommand('Network.getResponseBody', { requestId })) as {
        body?: string
        base64Encoded?: boolean
      }
      const source = result.base64Encoded ? Buffer.from(result.body || '', 'base64').toString('utf8') : result.body || ''
      const body = record(JSON.parse(source))
      this.rememberFolderTitles(body)
      this.publishResponse({ ok: status >= 200 && status < 300, status, body, pathname: url.pathname, params: url.searchParams })
    } catch {
      this.publishResponse({ ok: false, status, body: null, pathname: url.pathname, params: url.searchParams })
    }
  }

  private rememberFolderTitles(body: Record<string, unknown> | null) {
    const folders = body && Array.isArray(body.collects_list) ? body.collects_list : []
    for (const folder of folders) {
      const entry = record(folder)
      const id = typeof entry?.collects_id === 'string' ? entry.collects_id : ''
      const title = typeof entry?.collects_name === 'string' ? entry.collects_name.trim() : ''
      if (id && title) this.folderTitles.set(id, title)
    }
  }

  private publishResponse(response: CapturedResponse) {
    const waiter = Array.from(this.waiters).find((candidate) => matchesRequest(response, candidate.pathname, candidate.params))
    if (!waiter) {
      this.responses.push(response)
      return
    }
    clearTimeout(waiter.timer)
    this.waiters.delete(waiter)
    waiter.resolve(toPageResponse(response))
  }
}

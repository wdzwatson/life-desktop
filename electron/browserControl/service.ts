import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import {
  BROWSER_CONTROL_MAX_MESSAGE_BYTES,
  BROWSER_CONTROL_PROTOCOL_VERSION,
  LIFEOS_CHROME_EXTENSION_ORIGIN,
  WEB_LIKE_REQUEST_TIMEOUT_MS,
} from './constants'
import { JsonLineDecoder } from './framing'
import { getBrowserControlBridgeConfigPath } from './paths'

type BridgeConnection = {
  id: string
  socket: net.Socket
  decoder: JsonLineDecoder
  authenticated: boolean
  extensionReady: boolean
  instanceId: string | null
  extensionVersion: string | null
  connectedAt: number
}

type PendingRequest = {
  connectionId: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export type WebLikeCandidate = {
  tabId: number
  windowId: number
  title: string
  url: string
  active: boolean
  matchScore: number
}

export type WebLikeResult =
  | { status: 'ambiguous'; candidates: WebLikeCandidate[] }
  | {
      status: 'opened' | 'matched'
      tabId: number
      title: string
      url: string
      scriptExecuted: boolean
    }

export class BrowserControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function validateWebLikeUrl(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 8192) {
    throw new BrowserControlError('invalid_url', 'A complete HTTP or HTTPS URL is required.')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new BrowserControlError('invalid_url', 'A complete HTTP or HTTPS URL is required.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BrowserControlError('invalid_url', 'Only HTTP and HTTPS URLs are supported.')
  }
  if (url.username || url.password) {
    throw new BrowserControlError('invalid_url', 'URLs containing embedded credentials are not supported.')
  }
  return url.href
}

export class BrowserControlService {
  private server: net.Server | null = null
  private token = ''
  private readonly connections = new Map<string, BridgeConnection>()
  private readonly pending = new Map<string, PendingRequest>()
  private started = false

  async start() {
    if (this.started) return
    this.token = crypto.randomBytes(32).toString('hex')
    this.server = net.createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      const server = this.server as net.Server
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0 }, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Browser bridge did not receive a local port.')
    const configPath = getBrowserControlBridgeConfigPath()
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    const temporaryPath = `${configPath}.${process.pid}.tmp`
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({
        protocolVersion: BROWSER_CONTROL_PROTOCOL_VERSION,
        port: address.port,
        token: this.token,
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    await fs.rename(temporaryPath, configPath)
    this.started = true
  }

  getStatus() {
    const ready = [...this.connections.values()].filter((connection) => connection.extensionReady)
    return {
      bridgeReady: this.started,
      extensionConnected: ready.length > 0,
      connectionCount: ready.length,
      extensionVersion: ready.at(-1)?.extensionVersion ?? null,
    }
  }

  async executeWebLike(input: { url?: unknown; preferredTabId?: unknown }) {
    const url = validateWebLikeUrl(input?.url)
    const preferredTabId = input?.preferredTabId
    if (preferredTabId !== undefined && (!Number.isInteger(preferredTabId) || Number(preferredTabId) < 0)) {
      throw new BrowserControlError('invalid_tab', 'The selected Chrome tab is invalid.')
    }
    const connection = [...this.connections.values()]
      .filter((candidate) => candidate.extensionReady)
      .sort((left, right) => right.connectedAt - left.connectedAt)[0]
    if (!connection) {
      throw new BrowserControlError('extension_disconnected', 'The LifeOS Chrome extension is not connected.')
    }
    return (await this.request(connection, 'webLike.execute', {
      url,
      ...(preferredTabId === undefined ? {} : { preferredTabId }),
    })) as WebLikeResult
  }

  async dispose() {
    this.started = false
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new BrowserControlError('bridge_closed', 'The browser bridge was closed.'))
    }
    this.pending.clear()
    for (const connection of this.connections.values()) connection.socket.destroy()
    this.connections.clear()
    if (this.server) {
      const server = this.server
      this.server = null
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await fs.unlink(getBrowserControlBridgeConfigPath()).catch(() => undefined)
  }

  private accept(socket: net.Socket) {
    const remote = socket.remoteAddress || ''
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      socket.destroy()
      return
    }
    const id = crypto.randomUUID()
    const connection: BridgeConnection = {
      id,
      socket,
      decoder: new JsonLineDecoder(),
      authenticated: false,
      extensionReady: false,
      instanceId: null,
      extensionVersion: null,
      connectedAt: Date.now(),
    }
    this.connections.set(id, connection)
    socket.setNoDelay(true)
    socket.setTimeout(90_000, () => socket.destroy())
    socket.on('data', (chunk) => {
      try {
        for (const message of connection.decoder.push(chunk)) this.receive(connection, message)
      } catch {
        socket.destroy()
      }
    })
    socket.once('close', () => this.removeConnection(connection))
    socket.once('error', () => this.removeConnection(connection))
  }

  private receive(connection: BridgeConnection, raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      connection.socket.destroy()
      return
    }
    const message = raw as Record<string, unknown>
    if (!connection.authenticated) {
      if (
        message.type !== 'host.hello' ||
        message.protocolVersion !== BROWSER_CONTROL_PROTOCOL_VERSION ||
        message.token !== this.token ||
        message.origin !== LIFEOS_CHROME_EXTENSION_ORIGIN
      ) {
        connection.socket.destroy()
        return
      }
      connection.authenticated = true
      return
    }
    if (message.type === 'extension.hello') {
      if (
        message.protocolVersion !== BROWSER_CONTROL_PROTOCOL_VERSION ||
        typeof message.instanceId !== 'string' ||
        message.instanceId.length > 200
      ) {
        connection.socket.destroy()
        return
      }
      connection.extensionReady = true
      connection.instanceId = message.instanceId
      connection.extensionVersion = typeof message.extensionVersion === 'string' ? message.extensionVersion.slice(0, 50) : null
      connection.connectedAt = Date.now()
      connection.socket.setTimeout(0)
      return
    }
    if (message.type !== 'response' || typeof message.id !== 'string') return
    const request = this.pending.get(message.id)
    if (!request || request.connectionId !== connection.id) return
    this.pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.ok === true) request.resolve(message.data)
    else {
      const error = message.error && typeof message.error === 'object' ? message.error as Record<string, unknown> : {}
      request.reject(
        new BrowserControlError(
          typeof error.code === 'string' ? error.code : 'execution_failed',
          typeof error.message === 'string' ? error.message : 'The Chrome operation failed.',
        ),
      )
    }
  }

  private request(connection: BridgeConnection, method: string, params: Record<string, unknown>) {
    return new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID()
      const serialized = JSON.stringify({ type: 'request', id, method, params })
      if (Buffer.byteLength(serialized, 'utf8') > BROWSER_CONTROL_MAX_MESSAGE_BYTES) {
        reject(new BrowserControlError('message_too_large', 'The browser request is too large.'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BrowserControlError('timeout', 'The Chrome operation timed out.'))
      }, WEB_LIKE_REQUEST_TIMEOUT_MS)
      this.pending.set(id, { connectionId: connection.id, resolve, reject, timer })
      connection.socket.write(`${serialized}\n`, (error) => {
        if (!error) return
        const request = this.pending.get(id)
        if (!request) return
        this.pending.delete(id)
        clearTimeout(request.timer)
        reject(new BrowserControlError('bridge_write_failed', 'The browser request could not be sent.'))
      })
    })
  }

  private removeConnection(connection: BridgeConnection) {
    if (!this.connections.delete(connection.id)) return
    for (const [id, request] of this.pending) {
      if (request.connectionId !== connection.id) continue
      this.pending.delete(id)
      clearTimeout(request.timer)
      request.reject(new BrowserControlError('extension_disconnected', 'The LifeOS Chrome extension disconnected.'))
    }
  }
}

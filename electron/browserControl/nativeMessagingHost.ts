import fs from 'node:fs/promises'
import net from 'node:net'
import {
  BROWSER_CONTROL_MAX_MESSAGE_BYTES,
  BROWSER_CONTROL_PROTOCOL_VERSION,
  LIFEOS_CHROME_EXTENSION_ORIGIN,
} from './constants'
import { encodeNativeMessage, JsonLineDecoder, NativeMessageDecoder } from './framing'
import { getBrowserControlBridgeConfigPath } from './paths'

type BridgeConfig = {
  protocolVersion: number
  port: number
  token: string
}

export function getNativeMessagingOrigin(args: string[] = process.argv) {
  return args.find((arg) => arg === LIFEOS_CHROME_EXTENSION_ORIGIN) ?? null
}

export function isNativeMessagingHostLaunch(args: string[] = process.argv) {
  return getNativeMessagingOrigin(args) !== null
}

function writeNativeMessage(message: unknown) {
  process.stdout.write(encodeNativeMessage(message))
}

async function readBridgeConfig() {
  const raw = await fs.readFile(getBrowserControlBridgeConfigPath(), 'utf8')
  const value = JSON.parse(raw) as Partial<BridgeConfig>
  if (
    value.protocolVersion !== BROWSER_CONTROL_PROTOCOL_VERSION ||
    !Number.isInteger(value.port) ||
    Number(value.port) < 1 ||
    Number(value.port) > 65535 ||
    typeof value.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.token)
  ) {
    throw new Error('LifeOS browser bridge configuration is invalid.')
  }
  return value as BridgeConfig
}

export async function runNativeMessagingHost() {
  const origin = getNativeMessagingOrigin()
  if (!origin) return 2

  let config: BridgeConfig
  try {
    config = await readBridgeConfig()
  } catch (error) {
    writeNativeMessage({
      type: 'bridge.error',
      error: error instanceof Error ? error.message : String(error),
    })
    return 3
  }

  return new Promise<number>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: config.port })
    const nativeDecoder = new NativeMessageDecoder()
    const bridgeDecoder = new JsonLineDecoder()
    let settled = false

    const finish = (code: number) => {
      if (settled) return
      settled = true
      process.stdin.pause()
      socket.destroy()
      resolve(code)
    }

    socket.setNoDelay(true)
    socket.setTimeout(90_000, () => finish(4))
    socket.once('connect', () => {
      socket.setTimeout(0)
      socket.write(`${JSON.stringify({
        type: 'host.hello',
        protocolVersion: BROWSER_CONTROL_PROTOCOL_VERSION,
        token: config.token,
        origin,
      })}\n`)

      process.stdin.on('data', (chunk: Buffer) => {
        try {
          for (const message of nativeDecoder.push(chunk)) {
            const serialized = JSON.stringify(message)
            if (Buffer.byteLength(serialized, 'utf8') > BROWSER_CONTROL_MAX_MESSAGE_BYTES) {
              throw new Error('Extension message is too large.')
            }
            socket.write(`${serialized}\n`)
          }
        } catch (error) {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
          finish(5)
        }
      })
      process.stdin.once('end', () => finish(0))
      process.stdin.resume()
    })

    socket.on('data', (chunk) => {
      try {
        for (const message of bridgeDecoder.push(chunk)) writeNativeMessage(message)
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        finish(6)
      }
    })
    socket.once('error', (error) => {
      if (!settled) {
        writeNativeMessage({ type: 'bridge.error', error: error.message })
        finish(7)
      }
    })
    socket.once('close', () => finish(0))
  })
}

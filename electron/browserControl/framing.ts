import { BROWSER_CONTROL_MAX_MESSAGE_BYTES } from './constants'

export function encodeNativeMessage(message: unknown) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  if (payload.byteLength > BROWSER_CONTROL_MAX_MESSAGE_BYTES) throw new Error('Native message is too large.')
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(payload.byteLength, 0)
  return Buffer.concat([header, payload])
}

export class NativeMessageDecoder {
  private buffered = Buffer.alloc(0)

  push(chunk: Buffer | Uint8Array) {
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)])
    const messages: unknown[] = []
    while (this.buffered.byteLength >= 4) {
      const length = this.buffered.readUInt32LE(0)
      if (length === 0 || length > BROWSER_CONTROL_MAX_MESSAGE_BYTES) {
        throw new Error('Native message length is invalid.')
      }
      if (this.buffered.byteLength < length + 4) break
      const payload = this.buffered.subarray(4, length + 4)
      this.buffered = this.buffered.subarray(length + 4)
      messages.push(JSON.parse(payload.toString('utf8')))
    }
    return messages
  }
}

export class JsonLineDecoder {
  private buffered = ''

  push(chunk: Buffer | Uint8Array) {
    this.buffered += Buffer.from(chunk).toString('utf8')
    if (Buffer.byteLength(this.buffered, 'utf8') > BROWSER_CONTROL_MAX_MESSAGE_BYTES * 2) {
      throw new Error('Bridge message buffer is too large.')
    }
    const messages: unknown[] = []
    let newline = this.buffered.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffered.slice(0, newline)
      this.buffered = this.buffered.slice(newline + 1)
      if (line) messages.push(JSON.parse(line))
      newline = this.buffered.indexOf('\n')
    }
    return messages
  }
}

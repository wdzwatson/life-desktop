import assert from 'node:assert/strict'
import test from 'node:test'
import {
  encodeNativeMessage,
  JsonLineDecoder,
  NativeMessageDecoder,
} from '../electron/browserControl/framing.ts'

test('native messaging decoder handles split and combined frames', () => {
  const first = encodeNativeMessage({ id: 1, text: 'one' })
  const second = encodeNativeMessage({ id: 2, text: 'two' })
  const decoder = new NativeMessageDecoder()
  assert.deepEqual(decoder.push(first.subarray(0, 6)), [])
  assert.deepEqual(decoder.push(Buffer.concat([first.subarray(6), second])), [
    { id: 1, text: 'one' },
    { id: 2, text: 'two' },
  ])
})

test('native messaging decoder rejects invalid frame lengths', () => {
  const invalid = Buffer.alloc(4)
  invalid.writeUInt32LE(0, 0)
  assert.throws(() => new NativeMessageDecoder().push(invalid), /length is invalid/)
})

test('bridge line decoder preserves JSON message boundaries', () => {
  const decoder = new JsonLineDecoder()
  assert.deepEqual(decoder.push(Buffer.from('{"one":1')), [])
  assert.deepEqual(decoder.push(Buffer.from('}\n{"two":2}\n')), [{ one: 1 }, { two: 2 }])
})

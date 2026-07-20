import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import test from 'node:test'
import { OpenAICompatibleAdapter, type OpenAICompatibleDelta } from '../electron/ai/providers/openAiCompatible.ts'
import { parseAISseStream } from '../electron/ai/providers/streamParser.ts'
import { AIServiceError } from '../electron/ai/types.ts'

async function readRequestBody(request: IncomingMessage) {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  return body
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  action: (baseUrl: string) => Promise<void>,
) {
  const server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock server did not start.')
  try {
    await action(`http://127.0.0.1:${address.port}/v1`)
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function collect(adapter: OpenAICompatibleAdapter, signal?: AbortSignal) {
  const deltas: OpenAICompatibleDelta[] = []
  for await (const delta of adapter.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    signal,
  })) {
    deltas.push(delta)
  }
  return deltas
}

test('SSE parser handles UTF-8 chunk boundaries, comments, and multiline data', async () => {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(': keepalive\r\ndata: {"text":"你好"}\r\n\r\ndata: first\ndata: second\n\n')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 27))
      controller.enqueue(bytes.slice(27, 34))
      controller.enqueue(bytes.slice(34))
      controller.close()
    },
  })
  const events = []
  for await (const event of parseAISseStream(stream)) events.push(event)
  assert.deepEqual(events, [
    { data: '{"text":"你好"}' },
    { data: 'first\nsecond' },
  ])
})

test('OpenAI-compatible adapter streams text, tool calls, usage, request ID, and done', async () => {
  let receivedBody: Record<string, unknown> | null = null
  let receivedAuthorization = ''
  await withServer(async (request, response) => {
    receivedAuthorization = String(request.headers.authorization ?? '')
    receivedBody = JSON.parse(await readRequestBody(request)) as Record<string, unknown>
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'x-request-id': 'request-123',
    })
    response.write('data: {"choices":[{"delta":{"content":"Hel')
    response.write('lo"}}]}\n\n')
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":"{\\"q\\":"}}]}}]}\n\n')
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"news\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":8,"completion_tokens":5,"total_tokens":13}}\n\n')
    response.end('data: [DONE]\n\n')
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter({
      baseUrl,
      apiKey: 'test-secret-key',
      headers: { 'x-tenant': 'local', Authorization: 'Bearer stale-key' },
      model: 'chat-model',
      timeoutMs: 1000,
    })
    const deltas = await collect(adapter)
    assert.deepEqual(deltas, [
      { type: 'text', text: 'Hello' },
      { type: 'tool_call', index: 0, id: 'call-1', name: 'search', argumentsDelta: '{"q":' },
      { type: 'usage', usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } },
      { type: 'tool_call', index: 0, argumentsDelta: '"news"}' },
      { type: 'done', finishReason: 'tool_calls', providerRequestId: 'request-123' },
    ])
  })
  assert.equal(receivedAuthorization, 'Bearer test-secret-key')
  assert.equal(receivedBody?.model, 'chat-model')
  assert.equal(receivedBody?.stream, true)
})

test('OpenAI-compatible adapter merges provider request body while protecting runtime fields', async () => {
  let receivedBody: Record<string, unknown> | null = null
  await withServer(async (request, response) => {
    receivedBody = JSON.parse(await readRequestBody(request)) as Record<string, unknown>
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: [DONE]\n\n')
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter({
      baseUrl,
      model: 'runtime-model',
      timeoutMs: 1000,
      requestBody: {
        max_tokens: 1234,
        response_format: { type: 'json_object' },
        model: 'ignored-model',
        messages: [],
        stream: false,
      },
    })
    await collect(adapter)
  })
  assert.equal(receivedBody?.model, 'runtime-model')
  assert.equal(receivedBody?.stream, true)
  assert.equal((receivedBody?.messages as unknown[])?.length, 1)
  assert.equal(receivedBody?.max_tokens, 1234)
  assert.deepEqual(receivedBody?.response_format, { type: 'json_object' })
})

test('OpenAI-compatible adapter gives the selected thinking effort precedence over provider JSON', async () => {
  let receivedBody: Record<string, unknown> | null = null
  await withServer(async (request, response) => {
    receivedBody = JSON.parse(await readRequestBody(request)) as Record<string, unknown>
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: [DONE]\n\n')
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter({
      baseUrl,
      model: 'gpt-5.6-sol',
      timeoutMs: 1000,
      requestBody: { reasoning_effort: 'low' },
    })
    for await (const chunk of adapter.streamChat({
      messages: [{ role: 'user', content: 'Hello' }],
      reasoningEffort: 'max',
    })) {
      assert.ok(chunk)
    }
  })
  assert.equal(receivedBody?.reasoning_effort, 'max')
})

test('OpenAI-compatible adapter maps provider HTTP failures without leaking credentials', async () => {
  const expectations = new Map([
    [401, 'authentication_failed'],
    [404, 'provider_error'],
    [429, 'rate_limited'],
    [500, 'provider_error'],
  ])
  await withServer((request, response) => {
    const status = Number(request.headers['x-test-status'])
    response.writeHead(status, {
      'content-type': 'application/json',
      ...(status === 429 ? { 'retry-after': '1' } : {}),
    })
    response.end(JSON.stringify({ error: { message: 'echo test-secret-key Authorization' } }))
  }, async (baseUrl) => {
    for (const [status, code] of expectations) {
      const adapter = new OpenAICompatibleAdapter({
        baseUrl,
        apiKey: 'test-secret-key',
        headers: { 'x-test-status': String(status) },
        model: 'chat-model',
        timeoutMs: 1000,
      })
      await assert.rejects(
        () => collect(adapter),
        (error) => {
          assert.ok(error instanceof AIServiceError)
          assert.equal(error.detail.code, code)
          assert.doesNotMatch(error.detail.message, /test-secret-key|Authorization/)
          if (status === 429) assert.ok(error.detail.retryAt)
          return true
        },
      )
    }
  })
})

test('OpenAI-compatible adapter rejects invalid streaming JSON as a protocol error', async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: {not-json}\n\ndata: [DONE]\n\n')
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter({ baseUrl, model: 'chat-model', timeoutMs: 1000 })
    await assert.rejects(
      () => collect(adapter),
      (error) => error instanceof AIServiceError && error.detail.code === 'protocol_error',
    )
  })
})

test('OpenAI-compatible adapter aborts the underlying stream when cancelled', async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"Started"}}]}\n\n')
  }, async (baseUrl) => {
    const controller = new AbortController()
    const adapter = new OpenAICompatibleAdapter({ baseUrl, model: 'chat-model', timeoutMs: 1000 })
    const iterator = adapter.streamChat({
      messages: [{ role: 'user', content: 'Cancel' }],
      signal: controller.signal,
    })[Symbol.asyncIterator]()
    assert.deepEqual(await iterator.next(), { done: false, value: { type: 'text', text: 'Started' } })
    controller.abort()
    await assert.rejects(
      () => iterator.next(),
      (error) => error instanceof AIServiceError && error.detail.code === 'cancelled',
    )
  })
})

test('OpenAI-compatible adapter times out stalled requests', async () => {
  await withServer((_request, response) => {
    setTimeout(() => {
      if (response.destroyed) return
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: [DONE]\n\n')
    }, 150)
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter({ baseUrl, model: 'chat-model', timeoutMs: 30 })
    await assert.rejects(
      () => collect(adapter),
      (error) => error instanceof AIServiceError && error.detail.code === 'timeout',
    )
  })
})

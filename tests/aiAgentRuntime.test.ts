import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AIAgentRuntime } from '../electron/ai/agentRuntime.ts'
import type { OpenAICompatibleDelta, OpenAICompatibleRequest } from '../electron/ai/providers/openAiCompatible.ts'
import type { AIRunEvent } from '../electron/ai/runEvents.ts'
import { AIServiceError } from '../electron/ai/types.ts'

type FakeMessage = {
  id: number
  conversationId: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  status: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  parentMessageId: number | null
  providerMessageId: string | null
  parts: any[]
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

class FakeConversationService {
  messages: FakeMessage[] = []
  runs: any[] = []
  appendBatches: Array<{ messageId: number; parts: any[] }> = []
  messageTerminalWrites = 0
  runTerminalWrites = 0
  private nextMessageId = 10
  private nextRunId = 100

  getConversation(id: number) {
    if (id !== 1 && id !== 2) throw new Error('missing conversation')
    return { id }
  }

  createMessage(input: any) {
    const message: FakeMessage = {
      id: this.nextMessageId++,
      conversationId: input.conversationId,
      role: input.role,
      status: input.status ?? 'completed',
      parentMessageId: input.parentMessageId ?? null,
      providerMessageId: input.providerMessageId ?? null,
      parts: [...(input.parts ?? [])],
      createdAt: '2026-07-18T00:00:00.000Z',
      startedAt: null,
      completedAt: null,
    }
    this.messages.push(message)
    return { ...message, parts: [...message.parts] }
  }

  listMessages(conversationId: number, options: { beforeId?: number; limit?: number } = {}) {
    const beforeId = options.beforeId ?? Number.MAX_SAFE_INTEGER
    const limit = options.limit ?? 50
    return this.messages
      .filter((message) => message.conversationId === conversationId && message.id < beforeId)
      .slice(-limit)
      .map((message) => ({ ...message, parts: [...message.parts] }))
  }

  appendMessageParts(messageId: number, parts: any[]) {
    const message = this.messages.find((item) => item.id === messageId)
    if (!message) throw new Error('missing message')
    message.parts.push(...parts)
    this.appendBatches.push({ messageId, parts })
    return { ...message, parts: [...message.parts] }
  }

  transitionMessage(messageId: number, status: FakeMessage['status'], providerMessageId?: string) {
    const message = this.messages.find((item) => item.id === messageId)
    if (!message) throw new Error('missing message')
    message.status = status
    if (providerMessageId) message.providerMessageId = providerMessageId
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status)) {
      this.messageTerminalWrites += 1
    }
    return { ...message, parts: [...message.parts] }
  }

  createRun(input: any) {
    const run = { id: this.nextRunId++, status: input.status ?? 'queued', ...input }
    this.runs.push(run)
    return { ...run }
  }

  transitionRun(id: number, status: string, updates: any = {}) {
    const run = this.runs.find((item) => item.id === id)
    if (!run) throw new Error('missing run')
    Object.assign(run, updates, { status })
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status)) {
      this.runTerminalWrites += 1
    }
    return { ...run }
  }
}

function snapshot() {
  return {
    agentId: 7,
    name: 'Writer',
    systemPrompt: 'Be concise.',
    toolApprovalMode: 'confirm_risky' as const,
    maxToolCalls: 8,
    allowedTools: [],
    blockedTools: [],
    modelParams: { temperature: 0.4 },
    context: { maxMessages: 20, maxOutputTokens: 500 },
    providers: { text: { id: 3, name: 'Provider', model: 'chat-model' } },
    mcpServerIds: [],
    capturedAt: '2026-07-18T00:00:00.000Z',
  }
}

function setup(
  streamChat: (request: OpenAICompatibleRequest) => AsyncIterable<OpenAICompatibleDelta>,
  options: { capabilities?: string[]; media?: Record<string, unknown> } = {},
) {
  const conversations = new FakeConversationService()
  const events: AIRunEvent[] = []
  let receivedRequest: OpenAICompatibleRequest | undefined
  const runtime = new AIAgentRuntime({
    getServices: () => ({
      agents: { getSnapshot: () => snapshot() },
      providers: {
        get: () => ({
          id: 3,
          name: 'Provider',
          protocol: 'openai_compatible',
          baseUrl: 'https://api.test/v1',
          credentialConfigured: true,
          headerNames: ['x-tenant'],
          capabilities: options.capabilities ?? ['text', 'streaming'],
          models: { text: 'chat-model' },
          timeoutMs: 5_000,
          allowLocalNetwork: false,
          enabled: true,
          defaults: { text: true, image: false, video: false },
          connectionStatus: 'connected',
          lastTestedAt: null,
          lastSuccessAt: null,
          createdAt: '',
          updatedAt: '',
        }),
        getCredentialBundle: () => ({ apiKey: 'main-process-only', headers: { 'x-tenant': 'local' } }),
      },
      conversations,
      ...(options.media ? { media: options.media } : {}),
    }) as any,
    createAdapter: () => ({
      streamChat: (request) => {
        receivedRequest = request
        return streamChat(request)
      },
    }),
    emit: (event) => events.push(event),
    now: () => new Date('2026-07-18T08:00:00.000Z'),
    flushIntervalMs: 10_000,
    flushCharacterThreshold: 10_000,
  })
  return { runtime, conversations, events, getRequest: () => receivedRequest }
}

async function waitForTerminal(events: AIRunEvent[]) {
  for (let index = 0; index < 100; index += 1) {
    const terminal = events.find((event) =>
      ['completed', 'failed', 'cancelled', 'interrupted'].includes(event.type),
    )
    if (terminal) return terminal
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for terminal run event.')
}

test('Agent runtime streams text, persists deltas in a batch, and records usage', async () => {
  const context = setup(async function* () {
    yield { type: 'text', text: 'Hello' }
    yield { type: 'text', text: ' ' }
    yield { type: 'text', text: 'world' }
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } }
    yield { type: 'done', finishReason: 'stop', providerRequestId: 'request-1' }
  })
  context.conversations.createMessage({
    conversationId: 1,
    role: 'assistant',
    parts: [{ type: 'text', text: 'Earlier answer' }],
  })
  const started = context.runtime.start({
    conversationId: 1,
    agentId: 7,
    text: 'Continue',
    attachmentAssetIds: [],
  })
  const terminal = await waitForTerminal(context.events)

  assert.equal(terminal.type, 'completed')
  assert.equal(context.conversations.appendBatches.length, 1)
  assert.equal(context.conversations.appendBatches[0].parts[0].text, 'Hello world')
  assert.equal(context.conversations.runs[0].providerRequestId, 'request-1')
  assert.deepEqual(context.conversations.runs[0].usage, {
    inputTokens: 4,
    outputTokens: 2,
    totalTokens: 6,
  })
  assert.deepEqual(context.getRequest()?.messages, [
    { role: 'system', content: 'Be concise.' },
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'user', content: 'Continue' },
  ])
  assert.equal(context.getRequest()?.signal?.aborted, false)
  assert.equal(started.runId, 100)
})

test('runtime persists file attachments and sends vision images as OpenAI-compatible content parts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'life-ai-attachment-'))
  const imagePath = path.join(directory, 'image.png')
  fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71]))
  try {
    const context = setup(async function* () {
      yield { type: 'done', finishReason: 'stop' }
    }, {
      capabilities: ['text', 'streaming', 'vision'],
      media: {
        getAsset: (assetId: number) => assetId === 31
          ? { id: 31, mediaType: 'file', mimeType: 'application/pdf', byteSize: 120, originalName: 'brief.pdf', status: 'completed' }
          : { id: 32, mediaType: 'image', mimeType: 'image/png', byteSize: 4, originalName: 'image.png', status: 'completed' },
        getRegisteredFilePathSync: () => imagePath,
      },
    })
    context.runtime.start({
      conversationId: 1,
      agentId: 7,
      text: 'Review these files',
      attachmentAssetIds: [31, 32],
    })
    await waitForTerminal(context.events)
    assert.deepEqual(context.conversations.messages[0].parts, [
      { type: 'text', text: 'Review these files' },
      { type: 'file', assetId: 31, mimeType: 'application/pdf', name: 'brief.pdf' },
      { type: 'image', assetId: 32, mimeType: 'image/png', name: 'image.png' },
    ])
    const content = context.getRequest()?.messages.at(-1)?.content
    assert.ok(Array.isArray(content))
    assert.deepEqual(content?.slice(0, 2), [
      { type: 'text', text: 'Review these files' },
      { type: 'text', text: '[Attachment: brief.pdf; type: application/pdf; size: 120 bytes]' },
    ])
    assert.match((content?.[2] as { image_url: { url: string } }).image_url.url, /^data:image\/png;base64,/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('cancel aborts the provider signal, preserves partial text, and writes one terminal state', async () => {
  let providerAborted = false
  const context = setup(async function* (request) {
    yield { type: 'text', text: 'Partial' }
    await new Promise<void>((resolve) => {
      request.signal?.addEventListener(
        'abort',
        () => {
          providerAborted = true
          resolve()
        },
        { once: true },
      )
    })
    throw new AIServiceError({ code: 'cancelled', message: 'cancelled', retryable: false })
  })
  const started = context.runtime.start({
    conversationId: 1,
    agentId: 7,
    text: 'Stop this',
    attachmentAssetIds: [],
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  context.runtime.cancel(1, started.runId)
  const terminal = await waitForTerminal(context.events)
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(providerAborted, true)
  assert.equal(terminal.type, 'cancelled')
  assert.equal(context.conversations.appendBatches[0].parts[0].text, 'Partial')
  assert.equal(context.conversations.messageTerminalWrites, 1)
  assert.equal(context.conversations.runTerminalWrites, 1)
})

test('runtime rejects concurrent foreground runs in the same conversation', async () => {
  let release: (() => void) | undefined
  const context = setup(async function* () {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    yield { type: 'done' }
  })
  context.runtime.start({ conversationId: 1, agentId: 7, text: 'First', attachmentAssetIds: [] })
  assert.throws(
    () => context.runtime.start({ conversationId: 1, agentId: 7, text: 'Second', attachmentAssetIds: [] }),
    (error) => error instanceof AIServiceError && error.detail.code === 'invalid_input',
  )
  release?.()
  await waitForTerminal(context.events)
})

test('provider failures persist a failed terminal state and a safe error block', async () => {
  const context = setup(async function* () {
    yield* [] as OpenAICompatibleDelta[]
    throw new AIServiceError({
      code: 'rate_limited',
      message: 'The provider rate limit was reached.',
      retryable: true,
    })
  })
  context.runtime.start({ conversationId: 1, agentId: 7, text: 'Hello', attachmentAssetIds: [] })
  const terminal = await waitForTerminal(context.events)

  assert.equal(terminal.type, 'failed')
  assert.equal(context.conversations.runs[0].status, 'failed')
  assert.equal(context.conversations.runs[0].errorCode, 'rate_limited')
  assert.equal(context.conversations.appendBatches[0].parts[0].type, 'error')
  assert.doesNotMatch(JSON.stringify(context.events), /main-process-only|x-tenant/)
})

test('all run events retain stable IDs, increasing sequences, and one terminal event', async () => {
  const context = setup(async function* () {
    yield { type: 'text', text: 'A' }
    yield { type: 'usage', usage: { outputTokens: 1 } }
    yield { type: 'done' }
  })
  const started = context.runtime.start({
    conversationId: 2,
    agentId: 7,
    text: 'Identity',
    attachmentAssetIds: [],
  })
  await waitForTerminal(context.events)

  assert.ok(context.events.length >= 4)
  assert.deepEqual(context.events.map((event) => event.sequence), [1, 2, 3, 4])
  for (const event of context.events) {
    assert.equal(event.conversationId, 2)
    assert.equal(event.runId, started.runId)
    assert.equal(event.messageId, started.messageId)
    assert.equal(event.timestamp, '2026-07-18T08:00:00.000Z')
  }
  assert.equal(
    context.events.filter((event) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(event.type)).length,
    1,
  )
})

test('disposing the runtime interrupts every active run and aborts its provider request', async () => {
  let signal: AbortSignal | undefined
  const context = setup(async function* (request) {
    signal = request.signal
    await new Promise<void>((resolve) => request.signal?.addEventListener('abort', () => resolve(), { once: true }))
    yield* [] as OpenAICompatibleDelta[]
    throw new AIServiceError({ code: 'cancelled', message: 'cancelled', retryable: false })
  })
  context.runtime.start({ conversationId: 1, agentId: 7, text: 'Running', attachmentAssetIds: [] })
  await new Promise<void>((resolve) => setImmediate(resolve))
  context.runtime.dispose()
  const terminal = await waitForTerminal(context.events)

  assert.equal(signal?.aborted, true)
  assert.equal(terminal.type, 'interrupted')
  assert.equal(context.conversations.runs[0].status, 'interrupted')
  assert.throws(
    () => context.runtime.start({ conversationId: 1, agentId: 7, text: 'Again', attachmentAssetIds: [] }),
    (error) => error instanceof AIServiceError && error.detail.code === 'configuration_incomplete',
  )
})

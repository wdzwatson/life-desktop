import assert from 'node:assert/strict'
import test from 'node:test'
import { AIImageGenerationService } from '../electron/ai/imageGenerationService.ts'
import { AIImageAdapter } from '../electron/ai/providers/imageAdapter.ts'
import { AIServiceError } from '../electron/ai/types.ts'

function config() {
  return { baseUrl: 'https://api.example.test/v1', apiKey: 'main-only', model: 'image-1', timeoutMs: 5_000, pollIntervalMs: 100, maxPolls: 3 }
}

test('image adapter normalizes Base64 and remote URL response forms', async () => {
  const base64 = new AIImageAdapter(config(), async () => new Response(JSON.stringify({
    data: [{ b64_json: 'aW1hZ2U=', mime_type: 'image/png', revised_prompt: 'Refined' }],
  }), { status: 200 }))
  assert.deepEqual(await base64.generate({ prompt: 'A quiet room' }), {
    results: [{ kind: 'base64', data: 'aW1hZ2U=', mimeType: 'image/png', revisedPrompt: 'Refined' }],
  })

  const remote = new AIImageAdapter(config(), async () => new Response(JSON.stringify({
    images: [{ url: 'https://cdn.example.test/temporary.png' }],
  }), { status: 200 }))
  assert.deepEqual(await remote.generate({ prompt: 'A lake' }), {
    results: [{ kind: 'url', url: 'https://cdn.example.test/temporary.png' }],
  })
})

test('image adapter polls same-origin asynchronous tasks and rejects unsafe status URLs', async () => {
  const requests: string[] = []
  const adapter = new AIImageAdapter(config(), async (url) => {
    requests.push(String(url))
    if (requests.length === 1) return new Response(JSON.stringify({ task_id: 'task-1', status: 'queued' }), { status: 202 })
    return new Response(JSON.stringify({ status: 'completed', data: [{ url: 'https://cdn.example.test/final.png' }] }), { status: 200 })
  }, async () => undefined)
  assert.deepEqual(await adapter.generate({ prompt: 'A city' }), {
    results: [{ kind: 'url', url: 'https://cdn.example.test/final.png' }],
    taskId: 'task-1',
  })
  assert.equal(requests[1], 'https://api.example.test/v1/images/generations/task-1')

  const unsafe = new AIImageAdapter(config(), async () => new Response(JSON.stringify({
    task_id: 'task-2',
    status_url: 'https://attacker.example.test/tasks/2',
  }), { status: 202 }), async () => undefined)
  await assert.rejects(
    () => unsafe.generate({ prompt: 'Unsafe' }),
    (error) => error instanceof AIServiceError && error.detail.code === 'protocol_error',
  )
})

class FakeConversations {
  messages: any[] = []
  runs: any[] = []
  private messageId = 0
  private runId = 0
  getConversation(id: number) { return { id } }
  createMessage(input: any) {
    const message = { id: ++this.messageId, status: input.status ?? 'completed', parts: [...(input.parts ?? [])], ...input }
    this.messages.push(message)
    return message
  }
  appendMessageParts(id: number, parts: any[]) {
    const message = this.messages.find((item) => item.id === id)
    message.parts.push(...parts)
    return message
  }
  transitionMessage(id: number, status: string) {
    const message = this.messages.find((item) => item.id === id)
    message.status = status
    return message
  }
  createRun(input: any) {
    const run = { id: ++this.runId, ...input }
    this.runs.push(run)
    return run
  }
  transitionRun(id: number, status: string, updates: any = {}) {
    const run = this.runs.find((item) => item.id === id)
    Object.assign(run, updates, { status })
    return run
  }
}

function setupService(results: any[]) {
  const conversations = new FakeConversations()
  const storedInputs: any[] = []
  let nextAsset = 40
  const service = new AIImageGenerationService({
    agents: { getSnapshot: () => ({
      agentId: 1,
      name: 'Artist',
      systemPrompt: '',
      toolApprovalMode: 'confirm_risky',
      maxToolCalls: 8,
      allowedTools: [],
      blockedTools: [],
      modelParams: {},
      context: { maxMessages: 20 },
      providers: {
        text: { id: 1, name: 'Text', model: 'text-1' },
        image: { id: 2, name: 'Image', model: 'image-1' },
      },
      mcpServerIds: [],
      capturedAt: '',
    }) as any },
    providers: {
      get: () => ({ id: 2, enabled: true, capabilities: ['image'], models: { image: 'image-1' }, baseUrl: 'https://api.example.test/v1', timeoutMs: 5_000 }) as any,
      getCredentialBundle: () => ({ apiKey: 'secret', headers: {} }),
    },
    conversations: conversations as any,
    media: {
      storeBase64: async (input: any) => {
        storedInputs.push(input)
        return { id: ++nextAsset, mediaType: 'image', mimeType: 'image/png', byteSize: 10, sha256: String(nextAsset), originalName: input.originalName, url: `life-ai-asset://asset/${nextAsset}`, status: 'completed' as const }
      },
      downloadRemote: async (input: any) => {
        storedInputs.push(input)
        return { id: ++nextAsset, mediaType: 'image', mimeType: 'image/png', byteSize: 10, sha256: String(nextAsset), originalName: input.originalName, url: `life-ai-asset://asset/${nextAsset}`, status: 'completed' as const }
      },
    },
    createAdapter: () => ({ generate: async () => ({ results, taskId: 'task-9' }) }),
  })
  return { service, conversations, storedInputs }
}

test('image generation persists provider results as local image blocks and never stores temporary URLs in messages', async () => {
  const context = setupService([
    { kind: 'base64', data: 'aW1hZ2U=', mimeType: 'image/png' },
    { kind: 'url', url: 'https://cdn.example.test/expires.png?token=temporary' },
  ])
  const result = await context.service.generate({ conversationId: 1, agentId: 1, prompt: 'Two images', count: 2 })
  assert.equal(result.assets.length, 2)
  assert.equal(context.conversations.runs[0].status, 'completed')
  const assistant = context.conversations.messages[1]
  const images = assistant.parts.filter((part: any) => part.type === 'image')
  assert.deepEqual(images.map((part: any) => part.assetId), [41, 42])
  assert.doesNotMatch(JSON.stringify(assistant.parts), /cdn\.example|temporary/)
  assert.equal(context.storedInputs[1].url, 'https://cdn.example.test/expires.png?token=temporary')
})

test('image generation writes one failed terminal message when media persistence rejects invalid content', async () => {
  const conversations = new FakeConversations()
  const service = new AIImageGenerationService({
    ...setupService([{ kind: 'base64', data: 'bad' }]).service['dependencies'],
    conversations: conversations as any,
    media: {
      storeBase64: async () => { throw new AIServiceError({ code: 'media_failed', message: 'Invalid image bytes.', retryable: true }) },
      downloadRemote: async () => { throw new Error('unused') },
    },
  } as any)
  await assert.rejects(() => service.generate({ conversationId: 1, agentId: 1, prompt: 'Bad image' }))
  assert.equal(conversations.messages[1].status, 'failed')
  assert.equal(conversations.runs[0].status, 'failed')
  assert.equal(conversations.messages[1].parts.filter((part: any) => part.type === 'error').length, 1)
})

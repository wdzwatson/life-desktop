import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AIAgentRuntime } from '../electron/ai/agentRuntime.ts'
import { AIAgentService } from '../electron/ai/agentService.ts'
import { AIConversationService } from '../electron/ai/conversationService.ts'
import { AIProviderService } from '../electron/ai/providerService.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'
import {
  applyAIChatRunEvent,
  createOptimisticRunMessages,
  mergeAIChatMessages,
} from '../src/views/ai/chatUtils.ts'

async function waitForRun(events, runId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (events.some((event) => event.runId === runId && event.type === 'completed')) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`Run ${runId} did not complete.`)
}

test('ten mock conversation rounds stream through the runtime, UI reducer, and database', async () => {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const credentialStore = {
    create: () => { throw new Error('credentials not expected') },
    replace: () => { throw new Error('credentials not expected') },
    reveal: () => { throw new Error('credentials not expected') },
    delete: () => false,
  }
  const providers = new AIProviderService(db, credentialStore)
  const provider = providers.create({
    name: 'Mock text provider',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.test/v1',
    defaultHeaders: {},
    capabilities: ['text', 'streaming'],
    models: { text: 'mock-chat' },
    timeoutMs: 5_000,
    allowLocalNetwork: false,
    enabled: true,
  })
  const agents = new AIAgentService(db)
  const agent = agents.create({
    name: 'Mock Agent',
    description: 'Ten round integration fixture',
    systemPrompt: 'Answer with the round number.',
    textProviderId: provider.id,
    mcpServerIds: [],
    allowedTools: [],
    blockedTools: [],
    toolApprovalMode: 'confirm_risky',
    maxToolCalls: 8,
    temperature: 0.2,
    context: { maxMessages: 50, maxOutputTokens: 200 },
    enabled: true,
    isDefault: true,
  })
  const conversations = new AIConversationService(db)
  const conversation = conversations.createConversation({
    title: 'Round trip',
    agentId: agent.id,
    agentSnapshot: agents.getSnapshot(agent.id),
  })
  const events = []
  const runtime = new AIAgentRuntime({
    getServices: () => ({ agents, providers, conversations }),
    createAdapter: () => ({
      async *streamChat(request) {
        const lastUser = [...request.messages].reverse().find((message) => message.role === 'user')
        yield { type: 'text', text: `Reply: ${lastUser?.content}` }
        yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }
        yield { type: 'done', finishReason: 'stop' }
      },
    }),
    emit: (event) => events.push(event),
    flushCharacterThreshold: 10_000,
    flushIntervalMs: 10_000,
  })

  let uiMessages = []
  for (let round = 1; round <= 10; round += 1) {
    const text = `Question ${round}`
    const result = runtime.start({
      conversationId: conversation.id,
      agentId: agent.id,
      text,
      attachmentAssetIds: [],
    })
    uiMessages = mergeAIChatMessages(
      uiMessages,
      createOptimisticRunMessages({
        conversationId: conversation.id,
        triggerMessageId: result.triggerMessageId,
        messageId: result.messageId,
        text,
        timestamp: new Date().toISOString(),
      }),
      'append',
    )
    await waitForRun(events, result.runId)
    for (const event of events.filter((item) => item.runId === result.runId)) {
      uiMessages = applyAIChatRunEvent(uiMessages, event)
    }
  }

  const persisted = conversations.listMessages(conversation.id, { limit: 50 })
  assert.equal(persisted.length, 20)
  assert.equal(uiMessages.length, 20)
  assert.equal(persisted[0].parts[0].text, 'Question 1')
  assert.equal(persisted[19].parts[0].text, 'Reply: Question 10')
  assert.equal(events.filter((event) => event.type === 'completed').length, 10)
  assert.equal(conversations.listRuns(conversation.id).every((run) => run.status === 'completed'), true)
  runtime.dispose()
  db.close()
})

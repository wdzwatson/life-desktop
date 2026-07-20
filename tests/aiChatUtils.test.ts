import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAIChatRunEvent,
  buildAIConversationMarkdown,
  compareAIChatMessageOrder,
  createAIConversationTitle,
  createOptimisticMediaMessages,
  createOptimisticRunMessages,
  getAIChatRetryText,
  getAIChatConversationSelection,
  getAIComposerIntent,
  loadAllAIChatMessages,
  mergeAIChatMessages,
  reduceAIChatRunState,
  shouldFollowAIChatScroll,
  sortAIConversations,
  type AIChatMessage,
} from '../src/views/ai/chatUtils.ts'

function message(id: number, role: AIChatMessage['role'], text: string): AIChatMessage {
  return {
    id,
    conversationId: 1,
    role,
    status: 'completed',
    parentMessageId: null,
    providerMessageId: null,
    parts: [{ type: 'text', text }],
    createdAt: `2026-07-18T00:00:${String(id).padStart(2, '0')}.000Z`,
    startedAt: null,
    completedAt: null,
  }
}

test('conversation ordering keeps pinned items first and then uses recent activity', () => {
  const ordered = sortAIConversations([
    { id: 1, title: 'Old', agentId: 1, agentSnapshot: {}, isPinned: false, isArchived: false, messageCount: 1, createdAt: '', updatedAt: '2026-07-18T01:00:00Z', lastMessageAt: null },
    { id: 2, title: 'Pinned', agentId: 1, agentSnapshot: {}, isPinned: true, isArchived: false, messageCount: 1, createdAt: '', updatedAt: '2026-07-18T00:00:00Z', lastMessageAt: null },
    { id: 3, title: 'Recent', agentId: 1, agentSnapshot: {}, isPinned: false, isArchived: false, messageCount: 1, createdAt: '', updatedAt: '2026-07-18T02:00:00Z', lastMessageAt: null },
  ])
  assert.deepEqual(ordered.map((item) => item.id), [2, 3, 1])
})

test('conversation selection accepts saved text and media model choices', () => {
  const conversation = {
    id: 1,
    title: 'Saved selection',
    agentId: 2,
    agentSnapshot: { chatSelection: { agentId: 4, thinkingLevel: 'high' } },
    isPinned: false,
    isArchived: false,
    messageCount: 0,
    createdAt: '',
    updatedAt: '',
    lastMessageAt: null,
  }
  assert.deepEqual(getAIChatConversationSelection(conversation), { agentId: 4, thinkingLevel: 'high', mode: 'chat' })
  assert.deepEqual(getAIChatConversationSelection({
    ...conversation,
    agentSnapshot: { chatSelection: { agentId: 4, thinkingLevel: 'high', mode: 'image', imageProviderId: 8, imageModel: 'image-pro' } },
  }), { agentId: 4, thinkingLevel: 'high', mode: 'image', imageProviderId: 8, imageModel: 'image-pro' })
  assert.equal(getAIChatConversationSelection({ ...conversation, agentSnapshot: { chatSelection: { agentId: 4, thinkingLevel: 'invalid' } } }), null)
  assert.deepEqual(getAIChatConversationSelection({
    ...conversation,
    agentSnapshot: { chatSelection: { agentId: 4, thinkingLevel: 'high', mode: 'image', imageProviderId: 8 } },
  }), { agentId: 4, thinkingLevel: 'high', mode: 'chat' })
})

test('message merging deduplicates IDs and preserves live streaming text', () => {
  const current = [{ ...message(2, 'assistant', ''), status: 'streaming' as const, streamText: 'Live' }]
  const merged = mergeAIChatMessages(current, [{ ...message(2, 'assistant', ''), status: 'streaming' }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].streamText, 'Live')
})

test('temporary media messages stay at the end in user then assistant order', () => {
  const existing = [message(1, 'user', 'Earlier'), message(2, 'assistant', 'Earlier response')]
  const createdAt = '2026-07-18T10:00:00.000Z'
  const optimisticUser = { ...message(-100, 'user', 'Create a video'), createdAt }
  const optimisticAssistant = { ...message(-101, 'assistant', ''), status: 'streaming' as const, createdAt }
  const merged = mergeAIChatMessages(existing, [optimisticUser, optimisticAssistant], 'append')

  assert.deepEqual(merged.map((item) => item.id), [1, 2, -100, -101])
  assert.ok(compareAIChatMessageOrder(existing[1], optimisticUser) < 0)
})

test('image and video generation share an immediate visible media task pair', () => {
  for (const mediaType of ['image', 'video'] as const) {
    const optimistic = createOptimisticMediaMessages({
      conversationId: 4,
      mediaType,
      text: `Create ${mediaType}`,
      timestamp: '2026-07-18T10:00:00.000Z',
      temporaryUserId: -200,
    })
    assert.equal(optimistic[0].role, 'user')
    assert.deepEqual(optimistic[1].parts[0], {
      type: 'media_task',
      mediaType,
      taskId: 'optimistic-201',
      status: 'generating',
    })
  }
})

test('run events merge ten rounds without crossing message identities or retaining terminal stream text', () => {
  let messages: AIChatMessage[] = []
  let runState
  for (let round = 1; round <= 10; round += 1) {
    const ids = { triggerMessageId: round * 2 - 1, messageId: round * 2 }
    messages = mergeAIChatMessages(messages, createOptimisticRunMessages({
      conversationId: 1,
      ...ids,
      text: `Question ${round}`,
      timestamp: '2026-07-18T08:00:00.000Z',
    }), 'append')
    for (const [sequence, delta] of ['Answer ', String(round)].entries()) {
      const event = {
        type: 'text_delta' as const,
        conversationId: 1,
        runId: round,
        messageId: ids.messageId,
        sequence: sequence + 1,
        timestamp: '2026-07-18T08:00:00.000Z',
        delta,
      }
      messages = applyAIChatRunEvent(messages, event)
      runState = reduceAIChatRunState(runState, event)
    }
    messages = applyAIChatRunEvent(messages, {
      type: 'completed',
      conversationId: 1,
      runId: round,
      messageId: ids.messageId,
      sequence: 3,
      timestamp: '2026-07-18T08:00:01.000Z',
    })
  }
  assert.equal(messages.length, 20)
  assert.deepEqual(messages.filter((item) => item.role === 'assistant').map((item) => item.streamText),
    Array.from({ length: 10 }, () => undefined))
  assert.equal(runState?.runId, 10)
})

test('composer Enter sends while Shift+Enter inserts a newline and IME composition is ignored', () => {
  assert.equal(getAIComposerIntent({ key: 'Enter', shiftKey: false, isComposing: false }), 'send')
  assert.equal(getAIComposerIntent({ key: 'Enter', shiftKey: true, isComposing: false }), 'newline')
  assert.equal(getAIComposerIntent({ key: 'Enter', shiftKey: false, isComposing: true }), 'none')
})

test('conversation titles use the first prompt sentence and stay compact', () => {
  assert.equal(createAIConversationTitle('  帮我整理今天的任务。 后面这句不应进入标题。  '), '帮我整理今天的任务。')
  assert.equal(createAIConversationTitle('A very long prompt '.repeat(10)).length, 54)
})

test('scroll following stops after the user moves away from the bottom', () => {
  assert.equal(shouldFollowAIChatScroll({ scrollTop: 900, scrollHeight: 1050, clientHeight: 100 }), true)
  assert.equal(shouldFollowAIChatScroll({ scrollTop: 500, scrollHeight: 1050, clientHeight: 100 }), false)
})

test('retry text resolves the parent user message and markdown export retains roles', () => {
  const user = message(1, 'user', 'Try again')
  const assistant = {
    ...message(2, 'assistant', 'No'),
    parentMessageId: 1,
    parts: [
      { type: 'text' as const, text: 'No' },
      { type: 'image' as const, assetId: 9, mimeType: 'image/png', name: 'result.png' },
    ],
  }
  assert.equal(getAIChatRetryText([user, assistant], 2), 'Try again')
  const exported = buildAIConversationMarkdown('Session', [user, assistant])
  assert.match(exported, /# Session[\s\S]*## User[\s\S]*Try again[\s\S]*## Assistant/)
  assert.match(exported, /## Media manifest[\s\S]*result\.png \(image\/png, asset 9\)/)
})

test('complete export pagination loads every message before building Markdown', async () => {
  const source = Array.from({ length: 451 }, (_, index) => message(index + 1, index % 2 ? 'assistant' : 'user', `Message ${index + 1}`))
  const requestedBeforeIds: Array<number | undefined> = []
  const loaded = await loadAllAIChatMessages(async ({ beforeId, limit }) => {
    requestedBeforeIds.push(beforeId)
    const eligible = beforeId ? source.filter((item) => item.id < beforeId) : source
    return eligible.slice(-limit)
  })

  assert.equal(loaded.length, 451)
  assert.deepEqual(loaded.map((item) => item.id), source.map((item) => item.id))
  assert.deepEqual(requestedBeforeIds, [undefined, 252, 52])
})

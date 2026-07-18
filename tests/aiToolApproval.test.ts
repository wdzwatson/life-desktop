import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAIChatRunEvent, type AIChatMessage } from '../src/views/ai/chatUtils.ts'
import { setupToolRuntime, tool, waitForRunEvent, waitForTerminalRun } from './aiToolRuntimeHarness.ts'

const riskyTool = tool({
  name: 'publish_report',
  description: 'Publish a report to an external service',
  annotations: { readOnlyHint: false, openWorldHint: true },
})

test('tool lifecycle events produce a single updateable tool card in the assistant message', () => {
  const message: AIChatMessage = {
    id: 2,
    conversationId: 1,
    role: 'assistant',
    status: 'streaming',
    parentMessageId: 1,
    providerMessageId: null,
    parts: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
  }
  const base = { conversationId: 1, runId: 3, messageId: 2, timestamp: '2026-07-18T00:00:00.000Z' }
  let messages = applyAIChatRunEvent([message], {
    ...base,
    type: 'tool_proposed',
    sequence: 1,
    toolCallId: 'call-ui',
    serverId: 12,
    serverName: 'Workspace',
    toolName: 'publish_report',
    risk: 'external_side_effect',
    argumentsSummary: '{"title":"Release"}',
    status: 'waiting_for_approval',
  })
  messages = applyAIChatRunEvent(messages, {
    ...base,
    type: 'tool_completed',
    sequence: 2,
    toolCallId: 'call-ui',
    summary: 'Published',
  })
  const call = messages[0].parts.find((part) => part.type === 'tool_call') as any
  const result = messages[0].parts.find((part) => part.type === 'tool_result') as any
  assert.equal(call.status, 'completed')
  assert.equal(result.summary, 'Published')
})

test('risky tools wait for approve-once before execution', async () => {
  const context = setupToolRuntime({
    tools: [riskyTool],
    stream: async function* (request, turn) {
      if (turn === 1) {
        yield { type: 'tool_call', index: 0, id: 'call-risky', name: request.tools?.[0].function.name, argumentsDelta: '{"title":"Release"}' }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        yield { type: 'text', text: 'Published after approval.' }
        yield { type: 'done' }
      }
    },
  })
  await waitForRunEvent(context.events, (event) => event.type === 'approval_required')
  assert.equal(context.mcpCalls.length, 0)
  context.runtime.approve({ runId: context.started.runId, toolCallId: 'call-risky', decision: 'approve_once' })
  assert.equal((await waitForTerminalRun(context.events)).type, 'completed')
  assert.equal(context.mcpCalls.length, 1)
  assert.equal(context.conversations.toolCalls[0].approvalStatus, 'approved_once')
})

test('rejection is returned to the model and the conversation continues', async () => {
  const context = setupToolRuntime({
    tools: [riskyTool],
    stream: async function* (request, turn) {
      if (turn === 1) {
        yield { type: 'tool_call', index: 0, id: 'call-reject', name: request.tools?.[0].function.name, argumentsDelta: '{}' }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        assert.match(String(request.messages.at(-1)?.content), /user rejected/i)
        yield { type: 'text', text: 'I will continue without publishing.' }
        yield { type: 'done' }
      }
    },
  })
  await waitForRunEvent(context.events, (event) => event.type === 'approval_required')
  context.runtime.approve({ runId: context.started.runId, toolCallId: 'call-reject', decision: 'reject' })
  assert.equal((await waitForTerminalRun(context.events)).type, 'completed')
  assert.equal(context.mcpCalls.length, 0)
  assert.equal(context.conversations.toolCalls[0].status, 'rejected')
  assert.ok(context.events.some((event) => event.type === 'tool_rejected'))
})

test('approve-session auto-approves the same qualified tool for the rest of the run', async () => {
  const context = setupToolRuntime({
    tools: [riskyTool],
    stream: async function* (request, turn) {
      if (turn <= 2) {
        yield { type: 'tool_call', index: 0, id: `call-session-${turn}`, name: request.tools?.[0].function.name, argumentsDelta: '{}' }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        yield { type: 'text', text: 'Both actions completed.' }
        yield { type: 'done' }
      }
    },
  })
  await waitForRunEvent(context.events, (event) => event.type === 'approval_required')
  context.runtime.approve({ runId: context.started.runId, toolCallId: 'call-session-1', decision: 'approve_session' })
  assert.equal((await waitForTerminalRun(context.events)).type, 'completed')
  assert.equal(context.mcpCalls.length, 2)
  assert.equal(context.events.filter((event) => event.type === 'approval_required').length, 1)
})

test('cancellation and disposal interrupt pending approval without executing the tool', async () => {
  const cancelContext = setupToolRuntime({
    tools: [riskyTool],
    stream: async function* (request) {
      yield { type: 'tool_call', index: 0, id: 'call-cancel', name: request.tools?.[0].function.name, argumentsDelta: '{}' }
      yield { type: 'done', finishReason: 'tool_calls' }
    },
  })
  await waitForRunEvent(cancelContext.events, (event) => event.type === 'approval_required')
  cancelContext.runtime.cancel(1, cancelContext.started.runId)
  assert.equal((await waitForTerminalRun(cancelContext.events)).type, 'cancelled')
  assert.equal(cancelContext.mcpCalls.length, 0)

  const disposeContext = setupToolRuntime({
    tools: [riskyTool],
    stream: async function* (request) {
      yield { type: 'tool_call', index: 0, id: 'call-dispose', name: request.tools?.[0].function.name, argumentsDelta: '{}' }
      yield { type: 'done', finishReason: 'tool_calls' }
    },
  })
  await waitForRunEvent(disposeContext.events, (event) => event.type === 'approval_required')
  disposeContext.runtime.dispose()
  assert.equal((await waitForTerminalRun(disposeContext.events)).type, 'interrupted')
  assert.equal(disposeContext.mcpCalls.length, 0)
})

test('server risk overrides are authoritative even when tool annotations claim read-only', async () => {
  const context = setupToolRuntime({
    riskOverrides: { search_files: 'write' },
    stream: async function* (request, turn) {
      if (turn === 1) {
        yield { type: 'tool_call', index: 0, id: 'call-override', name: request.tools?.[0].function.name, argumentsDelta: '{}' }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        yield { type: 'text', text: 'Completed.' }
        yield { type: 'done' }
      }
    },
  })
  const approval = await waitForRunEvent(context.events, (event) => event.type === 'approval_required')
  assert.equal(approval.type === 'approval_required' ? approval.risk : '', 'write')
  assert.equal(context.mcpCalls.length, 0)
  context.runtime.approve({ runId: context.started.runId, toolCallId: 'call-override', decision: 'approve_once' })
  assert.equal((await waitForTerminalRun(context.events)).type, 'completed')
})

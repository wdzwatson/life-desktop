import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateAIToolCallFragments,
  buildAIProviderToolRegistry,
  createAIProviderToolName,
  normalizeAIMcpToolResult,
} from '../electron/ai/toolLoop.ts'
import { AIServiceError } from '../electron/ai/types.ts'
import { setupToolRuntime, tool, waitForTerminalRun } from './aiToolRuntimeHarness.ts'

test('provider-safe tool names are stable, unique by server, and blocked tools are omitted', () => {
  const first = tool({ serverId: 12, serverName: 'Files', name: '读取 文件 with a very long tool name that exceeds provider limits' })
  const second = { ...first, serverId: 13, serverName: 'Archive' }
  const firstName = createAIProviderToolName(first)
  assert.equal(firstName, createAIProviderToolName(first))
  assert.notEqual(firstName, createAIProviderToolName(second))
  assert.match(firstName, /^[A-Za-z0-9_-]+$/)
  assert.ok(firstName.length <= 64)
  const registry = buildAIProviderToolRegistry({
    tools: [first, second],
    blockedTools: [`${first.serverName}.${first.name}`],
  })
  assert.equal(registry.definitions.length, 1)
  assert.equal([...registry.byProviderName.values()][0].serverId, 13)
})

test('tool fragments aggregate by index and oversized binary results are safely summarized', () => {
  const calls = aggregateAIToolCallFragments([
    { type: 'tool_call', index: 0, id: 'call-1', name: 'mcp_12_search', argumentsDelta: '{"query":' },
    { type: 'tool_call', index: 0, argumentsDelta: '"notes"}' },
  ])
  assert.deepEqual(calls, [{ index: 0, id: 'call-1', providerName: 'mcp_12_search', argumentsJson: '{"query":"notes"}' }])
  const result = normalizeAIMcpToolResult({
    content: [
      { type: 'text', text: 'x'.repeat(80_000) },
      { type: 'image', data: 'private-base64', mimeType: 'image/png' },
    ],
  })
  assert.ok(result.modelContent.length <= 50_000)
  assert.ok(result.summary.length <= 12_000)
  assert.equal(result.resources[0].type, 'image')
  assert.doesNotMatch(result.modelContent, /private-base64/)
})

test('read-only tools auto-execute and their result is returned to the next model turn', async () => {
  let providerName = ''
  const context = setupToolRuntime({
    stream: async function* (request, turn) {
      if (turn === 1) {
        providerName = request.tools?.[0].function.name ?? ''
        yield { type: 'tool_call', index: 0, id: 'call-read', name: providerName, argumentsDelta: '{"query":"file"}' }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        assert.equal(request.messages.at(-1)?.role, 'tool')
        assert.match(String(request.messages.at(-1)?.content), /Matched file\.txt/)
        yield { type: 'text', text: 'I found the file.' }
        yield { type: 'done', finishReason: 'stop' }
      }
    },
  })
  const terminal = await waitForTerminalRun(context.events)
  assert.equal(terminal.type, 'completed')
  assert.equal(context.mcpCalls.length, 1)
  assert.equal(context.mcpCalls[0].serverId, 12)
  assert.equal(context.conversations.toolCalls[0].status, 'completed')
  assert.ok(providerName)
})

test('malformed arguments fail without executing MCP and the model can continue', async () => {
  const context = setupToolRuntime({
    stream: async function* (request, turn) {
      if (turn === 1) {
        yield { type: 'tool_call', index: 0, id: 'call-bad', name: request.tools?.[0].function.name, argumentsDelta: '{bad' }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        assert.match(String(request.messages.at(-1)?.content), /malformed JSON/)
        yield { type: 'text', text: 'The arguments were invalid.' }
        yield { type: 'done' }
      }
    },
  })
  assert.equal((await waitForTerminalRun(context.events)).type, 'completed')
  assert.equal(context.mcpCalls.length, 0)
  assert.equal(context.conversations.toolCalls[0].status, 'failed')
})

test('the eight-call limit disables further tools and preserves one terminal run state', async () => {
  const context = setupToolRuntime({
    stream: async function* (request, turn) {
      if (request.tools?.length) {
        yield {
          type: 'tool_call',
          index: 0,
          id: `call-${turn}`,
          name: request.tools[0].function.name,
          argumentsDelta: '{}',
        }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        yield { type: 'text', text: 'Tool limit reached; here is the final answer.' }
        yield { type: 'done', finishReason: 'stop' }
      }
    },
  })
  assert.equal((await waitForTerminalRun(context.events)).type, 'completed')
  assert.equal(context.mcpCalls.length, 8)
  assert.equal(context.requests.length, 9)
  assert.equal(context.requests.at(-1)?.toolChoice, 'none')
  assert.equal(context.conversations.terminalRunWrites, 1)
})

test('unknown provider tool names cannot select another MCP server', async () => {
  const context = setupToolRuntime({
    stream: async function* () {
      yield { type: 'tool_call', index: 0, id: 'call-forged', name: 'mcp_999_shell', argumentsDelta: '{}' }
      yield { type: 'done', finishReason: 'tool_calls' }
    },
  })
  const terminal = await waitForTerminalRun(context.events)
  assert.equal(terminal.type, 'failed')
  assert.equal(terminal.type === 'failed' ? terminal.error.code : '', 'permission_denied')
  assert.equal(context.mcpCalls.length, 0)
})

test('tool timeouts are returned safely to the model without failing the whole run', async () => {
  const context = setupToolRuntime({
    callTool: () => {
      throw new AIServiceError({ code: 'timeout', message: 'The tool timed out.', retryable: true })
    },
    stream: async function* (request, turn) {
      if (turn === 1) {
        yield { type: 'tool_call', index: 0, id: 'call-timeout', name: request.tools?.[0].function.name, argumentsDelta: '{}' }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        assert.match(String(request.messages.at(-1)?.content), /timed out/i)
        yield { type: 'text', text: 'The tool is unavailable, so I continued safely.' }
        yield { type: 'done' }
      }
    },
  })
  assert.equal((await waitForTerminalRun(context.events)).type, 'completed')
  assert.equal(context.conversations.toolCalls[0].status, 'failed')
  assert.ok(context.events.some((event) => event.type === 'tool_failed'))
})

test('cancelling an active MCP call aborts it and writes one cancelled terminal state', async () => {
  let signal: AbortSignal | undefined
  const context = setupToolRuntime({
    callTool: (_input, options) => new Promise((_, reject) => {
      signal = options.signal
      options.signal.addEventListener('abort', () => reject(
        new AIServiceError({ code: 'cancelled', message: 'cancelled', retryable: false }),
      ), { once: true })
    }),
    stream: async function* (request) {
      yield { type: 'tool_call', index: 0, id: 'call-active', name: request.tools?.[0].function.name, argumentsDelta: '{}' }
      yield { type: 'done', finishReason: 'tool_calls' }
    },
  })
  for (let index = 0; index < 100 && !signal; index += 1) await new Promise<void>((resolve) => setImmediate(resolve))
  context.runtime.cancel(1, context.started.runId)
  assert.equal((await waitForTerminalRun(context.events)).type, 'cancelled')
  assert.equal(signal?.aborted, true)
  assert.equal(context.conversations.terminalRunWrites, 1)
})

test('MCP image content is stored through the media service before entering the message timeline', async () => {
  const stored: any[] = []
  const context = setupToolRuntime({
    callTool: () => ({ content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }] }),
    media: {
      storeBase64: async (input) => {
        stored.push(input)
        return { id: 91, mimeType: 'image/png', originalName: 'tool.png' }
      },
      downloadRemote: async () => { throw new Error('unused') },
    },
    stream: async function* (request, turn) {
      if (turn === 1) {
        yield { type: 'tool_call', index: 0, id: 'call-image', name: request.tools?.[0].function.name, argumentsDelta: '{}' }
        yield { type: 'done', finishReason: 'tool_calls' }
      } else {
        yield { type: 'text', text: 'The image is attached.' }
        yield { type: 'done' }
      }
    },
  })
  assert.equal((await waitForTerminalRun(context.events)).type, 'completed')
  assert.equal(stored[0].base64, 'aW1hZ2U=')
  const assistant = context.conversations.messages.find((message) => message.role === 'assistant')
  assert.ok(assistant.parts.some((part: any) => part.type === 'image' && part.assetId === 91))
})

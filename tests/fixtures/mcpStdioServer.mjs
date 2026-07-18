import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

if (process.argv.includes('--fail')) {
  process.stderr.write(`fixture failed token=${process.env.TEST_SECRET ?? 'missing'}\n`)
  process.exit(2)
}

const server = new McpServer({ name: 'lifeos-stdio-fixture', version: '1.0.0' })

server.registerTool(
  'fixture.echo',
  {
    description: 'Echo text and the exact process arguments.',
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ text }) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ text, argv: process.argv.slice(2), pid: process.pid }),
      },
    ],
  }),
)

server.registerTool(
  'fixture.slow',
  {
    description: 'Wait until the requested delay elapses or the request is cancelled.',
    inputSchema: { delayMs: z.number().int().min(1).max(30_000) },
  },
  async ({ delayMs }, extra) => {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, delayMs)
      extra.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
    return {
      content: [{ type: 'text', text: extra.signal.aborted ? 'cancelled' : 'completed' }],
      isError: extra.signal.aborted,
    }
  },
)

server.registerTool(
  'fixture.terminate',
  {
    description: 'Terminate the fixture after returning a response.',
    inputSchema: {},
  },
  async () => {
    setTimeout(() => process.exit(3), 25).unref()
    return { content: [{ type: 'text', text: 'terminating' }] }
  },
)

await server.connect(new StdioServerTransport())

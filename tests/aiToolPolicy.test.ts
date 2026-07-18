import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyAIToolRisk, resolveAIToolRisk, shouldApproveAITool } from '../electron/ai/toolPolicy.ts'

test('tool risk classification respects annotations and command/write semantics', () => {
  assert.equal(classifyAIToolRisk({ name: 'search', annotations: { readOnlyHint: true } }), 'read')
  assert.equal(classifyAIToolRisk({ name: 'delete_note', annotations: { destructiveHint: true } }), 'write')
  assert.equal(classifyAIToolRisk({ name: 'shell_exec' }), 'command')
  assert.equal(
    classifyAIToolRisk({ name: 'send_email', annotations: { openWorldHint: true, readOnlyHint: false } }),
    'external_side_effect',
  )
  assert.equal(resolveAIToolRisk({ name: 'search' }, 'write'), 'write')
})

test('tool approval modes enforce the configured safety boundary', () => {
  assert.equal(shouldApproveAITool({ mode: 'confirm_all', risk: 'read', qualifiedToolName: 'mcp.search' }), true)
  assert.equal(shouldApproveAITool({ mode: 'confirm_risky', risk: 'read', qualifiedToolName: 'mcp.search' }), false)
  assert.equal(shouldApproveAITool({ mode: 'confirm_risky', risk: 'write', qualifiedToolName: 'mcp.write' }), true)
  assert.equal(
    shouldApproveAITool({
      mode: 'allow_selected',
      risk: 'command',
      qualifiedToolName: 'mcp.exec',
      allowedTools: ['mcp.exec'],
    }),
    false,
  )
  assert.equal(shouldApproveAITool({ mode: 'allow_all', risk: 'external_side_effect', qualifiedToolName: 'mcp.send' }), false)
})

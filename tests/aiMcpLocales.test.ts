import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const localeFiles = ['zh-CN.json', 'en-US.json']
const requiredKeys = [
  'explainer_title', 'explainer_desc', 'use_case_label', 'use_case_desc', 'optional_label',
  'optional_desc', 'safety_label', 'safety_desc',
  'load_failed', 'save_failed', 'action_failed', 'created', 'updated', 'deleted', 'copied',
  'enabled_toast', 'disabled_toast', 'delete_confirm', 'delete_blocked_dependencies',
  'disable_confirm_dependencies', 'search_placeholder', 'search_label',
  'transport_filter', 'status_filter', 'all_transports', 'all_statuses', 'enabled', 'disabled',
  'add', 'empty_title', 'empty_desc', 'add_first', 'no_results', 'connection_disconnected',
  'connection_connecting', 'connection_connected', 'connection_failed', 'tool_count',
  'protocol_version', 'credential_saved', 'last_connected', 'unknown_error', 'risk_read',
  'risk_write', 'risk_command', 'risk_external_side_effect', 'test_pending', 'test_connection',
  'refresh_tools', 'connection_succeeded',
  'edit_name', 'copy_name', 'disable_name', 'enable_name', 'delete_name', 'edit_title',
  'create_title', 'name', 'transport', 'description', 'command', 'arguments',
  'arguments_placeholder', 'cwd', 'url', 'credentials_preserved', 'replace_credentials',
  'env_json', 'headers_json', 'stdio_warning', 'timeout', 'risk_overrides', 'tool_name',
  'save_risk', 'remove_risk_name', 'no_risk_overrides', 'risk_failed', 'risk_saved',
  'risk_removed', 'assistant_access', 'assistant_access_desc', 'no_assistants', 'linked_assistants',
  'saved_with_assistants', 'assistant_link_failed',
]

for (const filename of localeFiles) {
  test(`${filename} contains the complete MCP manager copy`, () => {
    const locale = JSON.parse(readFileSync(new URL(`../src/locales/${filename}`, import.meta.url), 'utf8'))
    const mcp = locale.aiChat?.mcp
    assert.ok(mcp)
    for (const key of requiredKeys) {
      assert.equal(typeof mcp[key], 'string', `Missing aiChat.mcp.${key}`)
      assert.ok(mcp[key].trim(), `Empty aiChat.mcp.${key}`)
    }
    for (const key of ['delete_confirm', 'edit_name', 'copy_name', 'disable_name', 'enable_name', 'delete_name', 'remove_risk_name']) {
      assert.match(mcp[key], /{{name}}/)
    }
    assert.match(mcp.tool_count, /{{count}}/)
    assert.match(mcp.protocol_version, /{{version}}/)
    assert.match(mcp.last_connected, /{{value}}/)
    assert.match(mcp.credentials_preserved, /{{names}}/)
    assert.match(mcp.delete_blocked_dependencies, /{{names}}/)
    assert.match(mcp.disable_confirm_dependencies, /{{names}}/)
    assert.match(mcp.saved_with_assistants, /{{count}}/)
    assert.match(mcp.assistant_link_failed, /{{count}}/)
  })
}

test('MCP manager activates real connection testing without exposing tool execution', () => {
  const source = readFileSync(new URL('../src/views/ai/McpManager.tsx', import.meta.url), 'utf8')
  assert.match(source, /connectAIMcpServer\(server\.id, true\)/)
  assert.match(source, /server\.connectionStatus === 'connected'/)
  assert.doesNotMatch(source, /disabled title=\{t\('aiChat\.mcp\.test_pending'\)\}/)
  assert.doesNotMatch(source, /callAIMcpTool/)
})

test('MCP manager explains optional tool access and assigns connections to assistants', () => {
  const source = readFileSync(new URL('../src/views/ai/McpManager.tsx', import.meta.url), 'utf8')
  assert.match(source, /className="ai-mcp-explainer"/)
  assert.match(source, /className="ai-mcp-agent-picker"/)
  assert.match(source, /api\.updateAIAgent/)
  assert.match(source, /setMcpServerLink/)
})

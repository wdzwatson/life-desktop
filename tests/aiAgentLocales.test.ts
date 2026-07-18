import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const localeFiles = ['zh-CN.json', 'en-US.json']
const requiredKeys = [
  'load_failed', 'save_failed', 'action_failed', 'created', 'updated', 'deleted', 'copied',
  'enabled_toast', 'disabled_toast', 'default_updated', 'delete_confirm', 'search_placeholder',
  'search_label', 'add', 'empty_title', 'empty_desc', 'provider_required', 'add_first',
  'no_results', 'status_ready', 'status_incomplete', 'default', 'disabled', 'text_provider',
  'image_provider', 'video_provider', 'approval_confirm_all', 'approval_confirm_risky',
  'approval_allow_selected', 'approval_allow_all', 'max_calls_summary', 'context_summary',
  'mcp_summary', 'issues_title', 'set_default', 'edit_name', 'copy_name', 'disable_name',
  'enable_name', 'delete_name', 'edit_title', 'create_title', 'name', 'description',
  'system_prompt', 'provider_section', 'select_provider', 'no_provider', 'behavior_section',
  'approval_mode', 'max_tool_calls', 'temperature', 'max_messages', 'max_output_tokens',
  'allow_all_warning', 'mcp_section', 'no_mcp', 'tool_count', 'allowed_tools', 'blocked_tools',
  'tools_placeholder', 'enabled',
]

for (const filename of localeFiles) {
  test(`${filename} contains the complete agent manager copy`, () => {
    const locale = JSON.parse(readFileSync(new URL(`../src/locales/${filename}`, import.meta.url), 'utf8'))
    const agents = locale.aiChat?.agents
    assert.ok(agents)
    for (const key of requiredKeys) {
      assert.equal(typeof agents[key], 'string', `Missing aiChat.agents.${key}`)
      assert.ok(agents[key].trim(), `Empty aiChat.agents.${key}`)
    }
    for (const key of ['delete_confirm', 'edit_name', 'copy_name', 'disable_name', 'enable_name', 'delete_name']) {
      assert.match(agents[key], /{{name}}/)
    }
    for (const key of ['max_calls_summary', 'context_summary', 'mcp_summary', 'tool_count']) {
      assert.match(agents[key], /{{count}}/)
    }
  })
}

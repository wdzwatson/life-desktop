import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const localeFiles = ['zh-CN.json', 'en-US.json']
const requiredKeys = [
  'load_failed',
  'save_failed',
  'action_failed',
  'created',
  'updated',
  'deleted',
  'copied',
  'enabled_toast',
  'disabled_toast',
  'default_updated',
  'delete_confirm',
  'search_placeholder',
  'search_label',
  'all_protocols',
  'custom_http',
  'all_capabilities',
  'all_statuses',
  'enabled',
  'disabled',
  'add',
  'empty_title',
  'empty_desc',
  'add_first',
  'connection_untested',
  'connection_testing',
  'connection_connected',
  'connection_failed',
  'last_tested',
  'capability_text',
  'capability_image',
  'capability_video',
  'capability_streaming',
  'capability_tool_calling',
  'capability_vision',
  'credential_saved',
  'model_text',
  'model_image',
  'model_video',
  'default',
  'default_kind',
  'set_default_kind',
  'edit_name',
  'copy_name',
  'disable_name',
  'enable_name',
  'delete_name',
  'edit_title',
  'create_title',
  'name',
  'protocol',
  'base_url',
  'api_key',
  'api_key_keep',
  'capabilities',
  'timeout',
  'headers_preserved',
  'replace_headers',
  'headers_json',
  'allow_local',
  'agents_section',
  'agents_section_desc',
  'agents_require_text',
  'agent_general_name',
  'agent_general_desc',
  'agent_writing_name',
  'agent_writing_desc',
  'agent_research_name',
  'agent_research_desc',
  'agent_coding_name',
  'agent_coding_desc',
  'agent_already_linked',
  'agent_already_exists',
  'custom_agent_label',
  'custom_agent_placeholder',
  'add_custom_agent',
  'pending_agents',
  'remove_custom_agent',
  'custom_agent_description',
  'linked_agents',
  'saved_with_agents',
  'agents_create_failed',
]

for (const filename of localeFiles) {
  test(`${filename} contains the complete provider manager copy`, () => {
    const locale = JSON.parse(
      readFileSync(new URL(`../src/locales/${filename}`, import.meta.url), 'utf8'),
    )
    const providers = locale.aiChat?.providers
    assert.ok(providers)
    for (const key of requiredKeys) {
      assert.equal(typeof providers[key], 'string', `Missing aiChat.providers.${key}`)
      assert.ok(providers[key].trim(), `Empty aiChat.providers.${key}`)
    }
    assert.match(providers.delete_confirm, /{{name}}/)
    assert.match(providers.default_kind, /{{kind}}/)
    assert.match(providers.set_default_kind, /{{kind}}/)
    assert.match(providers.headers_preserved, /{{names}}/)
    assert.match(providers.last_tested, /{{value}}/)
    assert.match(providers.remove_custom_agent, /{{name}}/)
    assert.match(providers.saved_with_agents, /{{count}}/)
    assert.match(providers.agents_create_failed, /{{count}}/)
  })
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localeDirectory = join(process.cwd(), 'src', 'locales')
const requiredKeys = [
  'navigation_label',
  'view_modes_label',
  'workflow_tools_label',
  'workspace_label',
  'overview_label',
  'stat_open',
  'stat_today',
  'stat_overdue',
  'stat_templates',
  'instances_group_label',
  'automation_group_label',
  'instance_panel_title',
  'instance_panel_desc',
]
const configuredLocales = readdirSync(localeDirectory)
  .filter((filename) => filename.endsWith('.json'))
  .map((filename) => filename.replace(/\.json$/, ''))

for (const locale of configuredLocales) {
  test(`${locale} defines task navigation accessibility copy`, () => {
    const resource = JSON.parse(readFileSync(join(localeDirectory, `${locale}.json`), 'utf8'))
    for (const key of requiredKeys) {
      assert.equal(typeof resource.tasks?.[key], 'string', `missing tasks.${key}`)
      assert.notEqual(resource.tasks[key].trim(), '', `blank tasks.${key}`)
    }
  })
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localeDirectory = join(process.cwd(), 'src', 'locales')
const requiredKeys = [
  'calendar_title',
  'calendar_mode_day',
  'calendar_mode_week',
  'calendar_mode_month',
  'calendar_previous',
  'calendar_next',
  'calendar_today',
  'calendar_empty_title',
  'calendar_empty_description',
  'calendar_more_tasks',
]

const configuredLocales = readdirSync(localeDirectory)
  .filter((filename) => filename.endsWith('.json'))
  .map((filename) => filename.replace(/\.json$/, ''))

for (const locale of configuredLocales) {
  test(`${locale} defines truthful task calendar copy`, () => {
    const resource = JSON.parse(readFileSync(join(localeDirectory, `${locale}.json`), 'utf8'))
    for (const key of requiredKeys) {
      assert.equal(typeof resource.tasks?.[key], 'string', `missing tasks.${key}`)
      assert.notEqual(resource.tasks[key].trim(), '', `blank tasks.${key}`)
    }
    assert.match(resource.tasks.calendar_more_tasks, /\{\{count\}\}/)
  })
}

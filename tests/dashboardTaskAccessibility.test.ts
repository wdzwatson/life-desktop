import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localeDirectory = join(process.cwd(), 'src', 'locales')
const configuredLocales = readdirSync(localeDirectory)
  .filter((filename) => filename.endsWith('.json'))
  .map((filename) => filename.replace(/\.json$/, ''))

for (const locale of configuredLocales) {
  test(`${locale} defines dashboard task action labels`, () => {
    const resource = JSON.parse(readFileSync(join(localeDirectory, `${locale}.json`), 'utf8'))
    for (const key of ['task_complete_action', 'task_reopen_action']) {
      assert.equal(typeof resource.dashboard?.[key], 'string', `missing dashboard.${key}`)
      assert.notEqual(resource.dashboard[key].trim(), '', `blank dashboard.${key}`)
    }
  })
}

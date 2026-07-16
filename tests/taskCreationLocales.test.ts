import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localeDirectory = join(process.cwd(), 'src', 'locales')
const configuredLocales = readdirSync(localeDirectory)
  .filter((filename) => filename.endsWith('.json'))
  .map((filename) => filename.replace(/\.json$/, ''))

for (const locale of configuredLocales) {
  test(`${locale} keeps task creation labels distinct`, () => {
    const resource = JSON.parse(readFileSync(join(localeDirectory, `${locale}.json`), 'utf8'))
    const taskCopy = resource.tasks
    for (const key of [
      'priority_high',
      'priority_mid',
      'priority_low',
      'quick_add_label',
      'quick_add_priority_label',
      'quick_add_submit_label',
    ]) {
      assert.equal(typeof taskCopy?.[key], 'string', `missing tasks.${key}`)
      assert.notEqual(taskCopy[key].trim(), '', `blank tasks.${key}`)
    }
    assert.notEqual(taskCopy.priority_high, taskCopy.priority_mid)
    assert.notEqual(taskCopy.priority_mid, taskCopy.priority_low)
  })
}

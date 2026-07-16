import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localeDirectory = join(process.cwd(), 'src', 'locales')
const configuredLocales = readdirSync(localeDirectory)
  .filter((filename) => filename.endsWith('.json'))
  .map((filename) => filename.replace(/\.json$/, ''))

for (const locale of configuredLocales) {
  test(`${locale} distinguishes dashboard task feedback`, () => {
    const resource = JSON.parse(readFileSync(join(localeDirectory, `${locale}.json`), 'utf8'))
    const dashboard = resource.dashboard
    assert.equal(typeof dashboard?.toast_task_completed, 'string')
    assert.equal(typeof dashboard?.toast_task_reopened, 'string')
    assert.notEqual(dashboard.toast_task_completed, dashboard.toast_task_reopened)
  })
}

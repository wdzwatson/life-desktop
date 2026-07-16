import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localeDirectory = join(process.cwd(), 'src', 'locales')
const configuredLocales = readdirSync(localeDirectory)
  .filter((filename) => filename.endsWith('.json'))
  .map((filename) => filename.replace(/\.json$/, ''))

for (const locale of configuredLocales) {
  test(`${locale} defines recurring rule creation label`, () => {
    const resource = JSON.parse(readFileSync(join(localeDirectory, `${locale}.json`), 'utf8'))
    for (const key of [
      'new_rule_tooltip',
      'holiday_strategy_skip',
      'holiday_strategy_delay',
      'holiday_strategy_advance',
      'btn_run_now',
    ]) {
      assert.equal(typeof resource.tasks?.[key], 'string', `missing tasks.${key}`)
      assert.notEqual(resource.tasks[key].trim(), '', `blank tasks.${key}`)
    }

    assert.notEqual(
      resource.tasks.holiday_strategy_skip,
      resource.tasks.holiday_strategy_delay,
      'holiday strategy options should be distinguishable',
    )
    assert.notEqual(
      resource.tasks.holiday_strategy_delay,
      resource.tasks.holiday_strategy_advance,
      'holiday strategy options should be distinguishable',
    )
  })
}

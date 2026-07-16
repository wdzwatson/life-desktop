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
      'rules_empty_title',
      'rules_empty_description',
      'rules_empty_action',
      'freq_daily',
      'freq_weekday',
      'freq_weekly',
      'freq_monthly',
      'no_cron',
      'freq_cron',
      'cron_hint',
      'cron_placeholder',
      'future_triggers_list',
      'holiday_strategy_skip',
      'holiday_strategy_delay',
      'holiday_strategy_advance',
      'btn_run_now',
      'log_header_name',
      'log_header_type',
      'log_header_freq',
      'log_header_status',
      'log_header_next',
      'log_header_ops',
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

    assert.equal(
      new Set([
        resource.tasks.freq_daily,
        resource.tasks.freq_weekday,
        resource.tasks.freq_weekly,
        resource.tasks.freq_monthly,
      ]).size,
      4,
      'frequency options should be distinguishable',
    )
    assert.equal(
      new Set([
        resource.tasks.log_header_name,
        resource.tasks.log_header_type,
        resource.tasks.log_header_freq,
        resource.tasks.log_header_status,
        resource.tasks.log_header_next,
        resource.tasks.log_header_ops,
      ]).size,
      6,
      'scheduled log headers should be distinguishable',
    )
    assert.notEqual(resource.tasks.freq_cron, resource.tasks.cron_hint)
  })
}

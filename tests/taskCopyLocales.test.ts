import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localeDirectory = join(process.cwd(), 'src', 'locales')
const configuredLocales = readdirSync(localeDirectory)
  .filter((filename) => filename.endsWith('.json'))
  .map((filename) => filename.replace(/\.json$/, ''))

const requiredKeys = [
  'toast_reopened',
  'due_date_not_set',
  'add_subtask_tooltip',
  'subtask_progress_summary',
  'subtask_progress_compact',
  'subtask_expand',
  'subtask_collapse',
  'subtask_detail_region',
  'repeat_summary_daily',
  'repeat_summary_weekday',
  'repeat_summary_weekly',
  'repeat_summary_monthly',
  'repeat_summary_source',
  'details_label_title',
  'details_priority_suffix',
  'details_due_prefix',
  'complete_task_action',
  'reopen_task_action',
  'close_overdue_task_action',
  'confirm_complete_title',
  'confirm_complete_description',
  'confirm_complete_with_subtasks_description',
  'confirm_complete_action',
  'confirm_close_overdue_title',
  'confirm_close_overdue_description',
  'confirm_close_overdue_with_subtasks_description',
  'confirm_close_overdue_action',
  'confirm_reopen_title',
  'confirm_reopen_description',
  'confirm_reopen_action',
]

for (const locale of configuredLocales) {
  test(`${locale} defines task metadata copy`, () => {
    const resource = JSON.parse(readFileSync(join(localeDirectory, `${locale}.json`), 'utf8'))
    for (const key of requiredKeys) {
      assert.equal(typeof resource.tasks?.[key], 'string', `missing tasks.${key}`)
      assert.notEqual(resource.tasks[key].trim(), '', `blank tasks.${key}`)
    }
  })
}

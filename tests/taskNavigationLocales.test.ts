import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localeDirectory = join(process.cwd(), 'src', 'locales')
const requiredKeys = [
  'navigation_label',
  'view_modes_label',
  'workspace_label',
  'overview_label',
  'stat_open',
  'stat_today',
  'stat_overdue',
  'tab_kanban',
  'tab_list',
  'tab_calendar',
  'filter_show_closed',
  'filter_due_date_range',
  'filter_due_date',
  'filter_start_date',
  'filter_end_date',
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

test('task workspace navigation exposes shared task filters alongside execution views', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /task-navigation__views/)
  assert.match(tasksView, /task-navigation__tools/)
  assert.match(tasksView, /<Checkbox[\s\S]*checked=\{showClosedTasks\}/)
  assert.match(tasksView, /checked=\{showClosedTasks\}/)
  assert.match(tasksView, /dueDateFrom/)
  assert.match(tasksView, /dueDateTo/)
  assert.match(tasksView, /portalId="task-filter-datepicker-portal"/)
})

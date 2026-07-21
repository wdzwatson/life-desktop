import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('overdue list rows retain their original due date', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /t\('tasks\.overdue_due_date', \{ date: task\.due_date \}\)/)
})

for (const locale of ['zh-CN', 'en-US']) {
  test(`${locale} labels an overdue task with its due date`, () => {
    const resource = JSON.parse(readFileSync(join(process.cwd(), 'src', 'locales', `${locale}.json`), 'utf8'))
    assert.match(resource.tasks.overdue_due_date, /\{\{date\}\}/)
  })
}

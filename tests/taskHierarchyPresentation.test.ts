import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
const tasksCss = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
const zhLocale = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'locales', 'zh-CN.json'), 'utf8'),
)
const enLocale = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'locales', 'en-US.json'), 'utf8'),
)

test('task pages use the immutable #code for lookup and hierarchy context', () => {
  assert.match(tasksView, /const \[taskQuery, setTaskQuery\] = useState\(''\)/)
  assert.match(tasksView, /placeholder=\{t\('tasks\.search_placeholder'\)\}/)
  assert.match(tasksView, /taskMatchesQuery/)
  assert.match(tasksView, /formatTaskCode\(task\.id\)/)
  assert.match(tasksView, /task-calendar__task-meta/)
  assert.match(tasksView, /task-hierarchy-context/)
  assert.match(tasksView, /task-details-path/)
  assert.match(tasksView, /getTaskAncestorPath\(tasks, activeTask\.id\)/)
})

test('task hierarchy presentation remains compact across views', () => {
  assert.match(tasksCss, /\.task-code\s*\{[\s\S]*font-variant-numeric:\s*tabular-nums/)
  assert.match(tasksCss, /\.task-hierarchy-context\s*\{[\s\S]*max-width:\s*100%/)
  assert.match(tasksCss, /\.task-details-path\s*\{[\s\S]*flex-wrap:\s*wrap/)
  assert.match(tasksCss, /\.task-navigation__search\s*\{[\s\S]*width:\s*190px/)
})

test('task code lookup copy is available in both locales', () => {
  for (const locale of [zhLocale, enLocale]) {
    assert.equal(typeof locale.tasks.search_placeholder, 'string')
    assert.equal(typeof locale.tasks.parent_task_code_placeholder, 'string')
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('list and kanban use the execution task set rather than future tasks', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /const executionTasks[\s\S]*task\.due_date <= todayKey/)
  assert.match(tasksView, /const rootTasks[\s\S]*executionTasks\.filter/)
  assert.match(tasksView, /const laneTasks = executionTasks\.filter/)
})

test('execution views include today recurring projections regardless of scheduler timing', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /const todayProjectedTasks = useMemo/)
  assert.match(tasksView, /todayProjectedTasks\.filter\(\(task\) => task\.is_virtual\)/)
})

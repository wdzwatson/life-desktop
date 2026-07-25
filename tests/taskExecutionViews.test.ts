import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('list includes pending instances while kanban stays scoped to the execution task set', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /const executionTasks[\s\S]*task\.due_date <= todayKey/)
  assert.match(tasksView, /const listProjectedTasks = useMemo/)
  assert.match(tasksView, /end\.setDate\(end\.getDate\(\) \+ 370\)/)
  assert.match(tasksView, /const openRuleIds = new Set/)
  assert.match(tasksView, /task\.status !== TASK_STATUS\.closed/)
  assert.match(tasksView, /openRuleIds\.has\(Number\(task\.recur_rule_id\)\)/)
  assert.match(
    tasksView,
    /const listTasks = useMemo\(\(\) => \[\.\.\.tasks, \.\.\.listProjectedTasks\]/,
  )
  assert.match(tasksView, /const rootTasks[\s\S]*listTasks\.filter/)
  assert.match(tasksView, /const filteredExecutionTasks = useMemo/)
  assert.match(tasksView, /const laneTasks = filteredExecutionTasks\.filter/)
  assert.match(tasksView, /const taskMatchesFilters = useCallback/)
  assert.match(tasksView, /task\.status === TASK_STATUS\.closed/)
  assert.match(tasksView, /task\.due_date < dueDateFrom/)
  assert.match(tasksView, /task\.due_date <= dueDateTo/)
  assert.match(tasksView, /projectCalendarOccurrences[\s\S]*\.filter\(\s*taskMatchesFilters/)
})

test('execution views include today recurring projections regardless of scheduler timing', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /const todayProjectedTasks = useMemo/)
  assert.match(tasksView, /todayProjectedTasks\.filter\(\(task\) => task\.is_virtual\)/)
})

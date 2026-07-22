import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task completion changes require an explicit confirmation', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(
    tasksView,
    /completionConfirmationTask, setCompletionConfirmationTask\] = useState<any \| null>/,
  )
  assert.match(tasksView, /requestTaskCompletionToggle\(child, e\.currentTarget\)/)
  assert.match(tasksView, /requestTaskCompletionToggle\(task, e\.currentTarget\)/)
  assert.match(tasksView, /<AccessibleDialog[\s\S]*role="alertdialog"/)
  assert.match(tasksView, /await toggleTaskDone\(completionConfirmationTask\)/)
  assert.match(tasksView, /tasks\.confirm_complete_with_subtasks_description/)
  assert.match(tasksView, /tasks\.close_overdue_task_action/)
  assert.match(tasksView, /tasks\.confirm_close_overdue_with_subtasks_description/)
})

test('task completion does not conflate completed and explicitly closed states', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(
    tasksView,
    /const nextStatus = task\.status === '已关闭' \? '待处理' : task\.status \|\| '待处理'/,
  )
  assert.match(tasksView, /UPDATE tasks SET is_completed = 1, progress = 100/)
  assert.doesNotMatch(tasksView, /UPDATE tasks SET is_completed = 1, status = \?, progress = 100/)
})

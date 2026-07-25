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

test('task completion follows the review requirement before closing a task', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /task\.requires_review \? TASK_STATUS\.review : TASK_STATUS\.closed/)
  assert.match(tasksView, /status = CASE WHEN requires_review = 1 THEN '待审核' ELSE '已关闭' END/)
  assert.match(tasksView, /const reviewTask = async/)
  assert.match(tasksView, /reviewTask\(task, false\)/)
  assert.match(tasksView, /reviewTask\(task, true\)/)
})

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
  assert.match(tasksView, /const resolveOverdueTask = async/)
  assert.match(tasksView, /TASK_STATUS\.review/)
  assert.match(tasksView, /TASK_STATUS\.closed/)
  assert.match(tasksView, /tasks\.confirm_resolve_overdue_review_action/)
  assert.match(tasksView, /tasks\.confirm_resolve_overdue_close_action/)
})

test('task completion follows the review requirement before closing a task', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  const taskTreeMutation = readFileSync(
    join(process.cwd(), 'src', 'taskTreeMutation.ts'),
    'utf8',
  )

  assert.match(tasksView, /buildCompleteTaskTreeMutation\(task\.id\)/)
  assert.match(taskTreeMutation, /SELECT requires_review FROM tasks WHERE id = \?/)
  assert.match(tasksView, /const reviewTask = async/)
  assert.match(tasksView, /buildResolveTaskTreeMutation\(task\.id, TASK_STATUS\.closed\)/)
  assert.match(tasksView, /buildReopenTaskTreeMutation\(task\.id\)/)
  assert.match(tasksView, /reviewTask\(task, false\)/)
  assert.match(tasksView, /reviewTask\(task, true\)/)
})

test('saving a task at 100 percent uses the descendant completion mutation', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /const isCompletingTask = isCompleted === 1 && activeTask\?\.is_completed !== 1/)
  assert.match(tasksView, /const mutation = buildCompleteTaskTreeMutation\(selectedTaskId\)/)
  assert.match(tasksView, /api\.dbTransaction\('tasks'/)
})

test('overdue task review action is available only when review is required', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(
    tasksView,
    /status === TASK_STATUS\.review && !task\.requires_review/,
  )
  assert.match(
    tasksView,
    /Boolean\(completionConfirmationTask\.requires_review\) && \([\s\S]*?resolveOverdueTask\(TASK_STATUS\.review\)/,
  )
})

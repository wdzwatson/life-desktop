import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task completion changes require an explicit confirmation', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /completionConfirmationTask, setCompletionConfirmationTask\] = useState<any \| null>/)
  assert.match(tasksView, /requestTaskCompletionToggle\(child, e\.currentTarget\)/)
  assert.match(tasksView, /requestTaskCompletionToggle\(task, e\.currentTarget\)/)
  assert.match(tasksView, /<AccessibleDialog[\s\S]*role="alertdialog"/)
  assert.match(tasksView, /await toggleTaskDone\(completionConfirmationTask\)/)
  assert.match(tasksView, /tasks\.confirm_complete_with_subtasks_description/)
})

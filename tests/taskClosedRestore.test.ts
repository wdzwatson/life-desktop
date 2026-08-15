import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('closed tasks remain closed in the task list', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(noteView, /buildCloseTaskTreeMutation\(taskToClose\.id\)/)
  assert.doesNotMatch(tasksView, /const restoreClosedTask = async/)
  assert.doesNotMatch(tasksView, /tasks\.restore_closed_action/)
})

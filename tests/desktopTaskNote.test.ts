import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('desktop task note requires confirmation and closes the complete task tree', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')

  assert.match(noteView, /setTaskToClose\(task\)/)
  assert.match(noteView, /role="alertdialog"/)
  assert.match(noteView, /buildCloseTaskTreeMutation\(taskToClose\.id\)/)
  assert.match(noteView, /buildCompleteTaskTreeMutation\(task\.id\)/)
  assert.match(noteView, /buildReopenTaskTreeMutation\(task\.id\)/)
  assert.doesNotMatch(noteView, /UPDATE tasks SET is_completed = .*已关闭/)
})

test('desktop task note uses the shared execution-date deadline presentation', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')

  assert.match(noteView, /getTaskDuePresentation/)
  assert.match(noteView, /const formatTaskSchedule/)
  assert.match(noteView, /const schedule = formatTaskSchedule\(task, todayKey\)/)
})

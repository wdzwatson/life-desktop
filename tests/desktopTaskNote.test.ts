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
  assert.match(noteView, /status != '已关闭' OR is_completed = 1/)
  assert.doesNotMatch(noteView, /UPDATE tasks SET is_completed = .*已关闭/)
})

test('desktop task note uses the shared execution-date deadline presentation', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')

  assert.match(noteView, /getTaskDuePresentation/)
  assert.match(noteView, /const formatTaskSchedule/)
  assert.match(noteView, /const schedule = formatTaskSchedule\(task, todayKey\)/)
})

test('desktop task note advances its date and reloads tasks after midnight', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')

  assert.match(noteView, /const \[todayKey, setTodayKey\] = useState\(getCurrentUserDateKey\)/)
  assert.match(noteView, /getMillisecondsUntilNextLocalDay\(now\)/)
  assert.match(noteView, /window\.setInterval\(updateTodayKey, 60_000\)/)
  assert.match(noteView, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/)
  assert.match(noteView, /\[api, todayKey\]/)
})

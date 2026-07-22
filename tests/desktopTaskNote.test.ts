import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('desktop task note requires confirmation before closing and preserves completion state', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')

  assert.match(noteView, /setTaskToClose\(task\)/)
  assert.match(noteView, /role="alertdialog"/)
  assert.match(noteView, /closed_from_status = status, status = '已关闭'/)
  assert.doesNotMatch(noteView, /UPDATE tasks SET is_completed = .*已关闭/)
})

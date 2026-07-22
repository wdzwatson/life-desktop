import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('closed tasks preserve their previous status and can be restored from the task list', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(noteView, /closed_from_status = status, status = '已关闭'/)
  assert.match(tasksView, /const restoreClosedTask = async/)
  assert.match(tasksView, /status = COALESCE\(closed_from_status, '待处理'\)/)
  assert.match(tasksView, /tasks\.restore_closed_action/)
})

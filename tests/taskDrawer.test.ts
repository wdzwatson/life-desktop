import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task creation and editing use one right drawer with time and repeat controls', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /task-drawer/)
  assert.match(tasksView, /drawerMode === 'create'/)
  assert.match(tasksView, /type="date"/)
  assert.match(tasksView, /type="time"/)
  assert.match(tasksView, /repeat_label/)
  assert.match(tasksView, /handleSaveDrawer/)
})

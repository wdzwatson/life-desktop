import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
const tasksCss = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
const zhLocale = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'locales', 'zh-CN.json'), 'utf8'),
)
const enLocale = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'locales', 'en-US.json'), 'utf8'),
)

test('task drawer supports parent binding without allowing hierarchy cycles', () => {
  assert.match(tasksView, /parentId: number \| null/)
  assert.match(tasksView, /parentId: task\.parent_id \?\? null/)
  assert.match(tasksView, /drawerDescendantIds/)
  assert.match(tasksView, /!drawerDescendantIds\.has\(task\.id\)/)
  assert.match(tasksView, /ancestor\.id === selectedTaskId/)
  assert.match(tasksView, /parent_task_cycle_error/)
  assert.match(tasksView, /value=\{taskDraft\.parentId \?\? ''\}/)
  assert.match(tasksView, /parent_id = \?/)
})

test('task drawer creates and explains direct subtasks', () => {
  assert.match(tasksView, /pendingSubtaskTitles/)
  assert.match(tasksView, /createPendingSubtasks/)
  assert.match(tasksView, /lastInsertRowid/)
  assert.match(
    tasksView,
    /INSERT INTO tasks \(title, description, priority, status, requires_review, start_date, start_time, due_date, due_time, parent_id, progress\)/,
  )
  assert.match(tasksView, /directDrawerSubtasks\.map/)
  assert.match(tasksView, /subtask_pending_create/)
  assert.match(tasksView, /subtask_inheritance_hint/)
  assert.match(tasksView, /recurring_subtask_instance_hint/)
  assert.match(tasksView, /disabled=\{recurrenceHierarchyLocked\}/)
})

test('subtask drawer layout remains compact and responsive', () => {
  assert.match(tasksCss, /\.task-drawer__hierarchy-section/)
  assert.match(
    tasksCss,
    /\.task-drawer__subtask-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto auto/,
  )
  assert.match(tasksCss, /\.task-drawer__subtask-title\s*\{[\s\S]*text-overflow:\s*ellipsis/)
  assert.match(
    tasksCss,
    /\.task-drawer__subtask-add\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 36px/,
  )
})

test('subtask guidance is available in both locales', () => {
  for (const key of [
    'hierarchy_section_title',
    'parent_task_none',
    'parent_task_select_hint',
    'direct_subtasks_title',
    'subtask_inheritance_hint',
    'recurring_hierarchy_lock_hint',
  ]) {
    assert.equal(typeof zhLocale.tasks[key], 'string', `missing zh-CN tasks.${key}`)
    assert.equal(typeof enLocale.tasks[key], 'string', `missing en-US tasks.${key}`)
  }
})

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
  assert.match(tasksView, /canBindTaskToParent\(tasks, selectedTaskId, taskDraft\.parentId\)/)
  assert.match(tasksView, /parent_task_cycle_error/)
  assert.match(tasksView, /parentTaskCode/)
  assert.match(tasksView, /parseTaskCode\(value\)/)
  assert.match(tasksView, /list="task-parent-options"/)
  assert.match(tasksView, /parent_id = \?/)
})

test('task drawer only configures the parent relationship and peer links', () => {
  assert.doesNotMatch(tasksView, /pendingSubtaskTitles/)
  assert.doesNotMatch(tasksView, /createPendingSubtasks/)
  assert.doesNotMatch(tasksView, /directDrawerSubtasks/)
  assert.match(tasksView, /drawerMode === 'edit'/)
  assert.match(tasksView, /peerTaskIds/)
  assert.match(tasksView, /task_peer_links/)
  assert.match(tasksView, /peer_tasks_title/)
  assert.match(tasksView, /isPeerDropdownOpen/)
  assert.match(tasksView, /peerTaskVisibleCount/)
  assert.match(tasksView, /visiblePeerTasks = filteredPeerTasks\.slice\(0, peerTaskVisibleCount\)/)
  assert.match(tasksView, /selectedPeerTasks/)
  assert.match(tasksView, /tasksById\.get\(peerId\)/)
  assert.match(tasksView, /className="task-drawer__peer-selection"/)
  assert.match(tasksView, /canLoadMorePeerTasks/)
  assert.match(tasksView, /setPeerTaskVisibleCount\(\(count\) => count \+ 20\)/)
  assert.match(tasksView, /task\.parent_id === taskDraft\.parentId/)
  assert.doesNotMatch(tasksView, /disabled=\{recurrenceHierarchyLocked\}/)
})

test('task relation drawer layout remains compact and responsive', () => {
  assert.match(tasksCss, /\.task-drawer__hierarchy-section/)
  assert.match(tasksCss, /\.task-drawer__peer-picker\s*\{[\s\S]*position:\s*relative/)
  assert.match(tasksCss, /\.task-drawer__peer-dropdown\s*\{[\s\S]*position:\s*absolute/)
  assert.match(tasksCss, /\.task-drawer__peer-trigger-values\s*\{[\s\S]*overflow-x:\s*auto/)
  assert.match(
    tasksCss,
    /\.task-drawer__peer-search \.form-field:focus\s*\{[\s\S]*box-shadow:\s*none/,
  )
  assert.match(tasksCss, /\.task-drawer__peer-list\s*\{[\s\S]*max-height:\s*190px/)
  assert.match(
    tasksCss,
    /\.task-drawer__peer-option\s*\{[\s\S]*grid-template-columns:\s*auto auto minmax\(0, 1fr\)/,
  )
})

test('task relationship guidance is available in both locales', () => {
  for (const key of [
    'hierarchy_section_title',
    'parent_task_none',
    'parent_task_code_placeholder',
    'parent_task_select_hint',
    'direct_subtasks_title',
    'peer_tasks_title',
    'peer_tasks_hint',
    'peer_tasks_empty',
  ]) {
    assert.equal(typeof zhLocale.tasks[key], 'string', `missing zh-CN tasks.${key}`)
    assert.equal(typeof enLocale.tasks[key], 'string', `missing en-US tasks.${key}`)
  }
})

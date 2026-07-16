import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldHighlightTopbarNewTask } from '../src/components/topbarUtils.ts'

test('topbar emphasizes new task only in task-oriented screens', () => {
  assert.equal(shouldHighlightTopbarNewTask('dashboard'), true)
  assert.equal(shouldHighlightTopbarNewTask('tasks'), true)
  assert.equal(shouldHighlightTopbarNewTask('notes'), false)
  assert.equal(shouldHighlightTopbarNewTask('books'), false)
  assert.equal(shouldHighlightTopbarNewTask('videos'), false)
})

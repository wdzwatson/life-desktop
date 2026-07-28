import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canBindTaskToParent,
  formatTaskCode,
  getTaskAncestorPath,
  getTaskDescendantIds,
  parseTaskCode,
} from '../src/views/taskHierarchyUtils.ts'

const tasks = [
  { id: 100, title: 'Root', parent_id: null },
  { id: 128, title: 'Plan', parent_id: 100 },
  { id: 151, title: 'Run', parent_id: 128 },
  { id: 154, title: 'Saturday', parent_id: 151 },
  { id: 200, title: 'Other', parent_id: null },
]

test('task codes are stable, human-readable identifiers', () => {
  assert.equal(formatTaskCode(151), '#151')
  assert.equal(parseTaskCode('#151'), 151)
  assert.equal(parseTaskCode(' 151 '), 151)
  assert.equal(parseTaskCode('#0'), null)
  assert.equal(parseTaskCode('#15a'), null)
})

test('hierarchy helpers preserve paths and terminate on malformed cycles', () => {
  assert.deepEqual(
    getTaskAncestorPath(tasks, 154).map((task) => task.id),
    [100, 128, 151, 154],
  )
  assert.deepEqual(
    [...getTaskDescendantIds(tasks, 128)].sort((a, b) => a - b),
    [151, 154],
  )
})

test('parent binding allows arbitrary depth while rejecting self and descendant cycles', () => {
  assert.equal(canBindTaskToParent(tasks, 200, 154), true)
  assert.equal(canBindTaskToParent(tasks, 128, 128), false)
  assert.equal(canBindTaskToParent(tasks, 128, 154), false)
  assert.equal(canBindTaskToParent(tasks, 151, 100), true)
  assert.equal(canBindTaskToParent(tasks, 151, 999), false)
})

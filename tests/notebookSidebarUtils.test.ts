import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNotebookCategoryStorageName } from '../src/views/notebookSidebarUtils.ts'

const options = [
  { storageName: '默认', displayName: 'Default' },
  { storageName: 'Work', displayName: '工作' },
]

test('notebook category selection resolves localized labels to existing storage names', () => {
  assert.equal(resolveNotebookCategoryStorageName('工作', options), 'Work')
  assert.equal(resolveNotebookCategoryStorageName(' work ', options), 'Work')
  assert.equal(resolveNotebookCategoryStorageName(' default ', options), '默认')
})

test('notebook category selection preserves a trimmed new category name', () => {
  assert.equal(resolveNotebookCategoryStorageName('  Personal Projects  ', options), 'Personal Projects')
})

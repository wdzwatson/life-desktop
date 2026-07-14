import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getActiveCategoryAfterDelete,
  getContextMenuPosition,
  isReservedBookCategory,
} from '../src/views/bookCategorySidebarUtils.ts'

test('isReservedBookCategory recognizes reserved category names', () => {
  for (const name of ['', '未分类', 'Uncategorized', 'Category', '分类']) {
    assert.equal(isReservedBookCategory(name), true)
  }

  assert.equal(isReservedBookCategory('技术'), false)
  assert.equal(isReservedBookCategory('Design'), false)
})

test('getContextMenuPosition clamps a menu inside the viewport', () => {
  assert.deepEqual(
    getContextMenuPosition({
      clientX: 790,
      clientY: 590,
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 176,
      menuHeight: 132,
      margin: 8,
    }),
    { left: 616, top: 460 },
  )
})

test('getContextMenuPosition preserves the pointer position when the menu fits', () => {
  assert.deepEqual(
    getContextMenuPosition({
      clientX: 120,
      clientY: 90,
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 176,
      menuHeight: 132,
    }),
    { left: 120, top: 90 },
  )
})

test('getActiveCategoryAfterDelete resets only the active deleted shelf', () => {
  assert.equal(getActiveCategoryAfterDelete('技术', '技术'), 'uncategorized')
  assert.equal(getActiveCategoryAfterDelete('设计', '技术'), '设计')
  assert.equal(getActiveCategoryAfterDelete('all', '技术'), 'all')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCategoryStorageAliasMap,
  getActiveCategoryAfterDelete,
  getContextMenuPosition,
  isReservedBookCategory,
} from '../src/views/bookCategorySidebarUtils.ts'

test('buildCategoryStorageAliasMap keeps only uniquely owned translation aliases', () => {
  const categories = [
    { id: 1, name: '技术' },
    { id: 2, name: 'Design' },
    { id: 3, name: '文学' },
  ]
  const translations = [
    { entity_type: 'category', entity_id: 1, locale: 'en-US', translation: 'Design' },
    { entity_type: 'category', entity_id: 1, locale: 'zh-CN', translation: '技术' },
    { entity_type: 'category', entity_id: 1, locale: 'shared-1', translation: 'Shared' },
    { entity_type: 'category', entity_id: 3, locale: 'shared-3', translation: 'Shared' },
    { entity_type: 'category', entity_id: 2, locale: 'zh-CN', translation: '设计' },
    { entity_type: 'category', entity_id: 3, locale: 'en-US', translation: 'Literature' },
  ]

  const aliases = buildCategoryStorageAliasMap(categories, translations)

  assert.deepEqual([...aliases.get('1')], ['技术'])
  assert.deepEqual([...aliases.get('2')], ['Design', '设计'])
  assert.deepEqual([...aliases.get('3')], ['文学', 'Literature'])
})

test('isReservedBookCategory recognizes reserved category names', () => {
  for (const name of ['', '未分类', 'Uncategorized', 'Category', '分类', 'all', 'uncategorized']) {
    assert.equal(isReservedBookCategory(name), true)
  }

  assert.equal(isReservedBookCategory('  未分类  '), true)
  assert.equal(isReservedBookCategory(null), true)
  assert.equal(isReservedBookCategory(undefined), true)
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

test('getContextMenuPosition applies the default margin at the lower viewport bound', () => {
  assert.deepEqual(
    getContextMenuPosition({
      clientX: 2,
      clientY: 3,
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 176,
      menuHeight: 132,
    }),
    { left: 8, top: 8 },
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

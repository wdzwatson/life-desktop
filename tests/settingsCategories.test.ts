import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const settings = readFileSync(path.resolve('src/views/Settings.tsx'), 'utf8')
const store = readFileSync(path.resolve('src/store/useAppStore.ts'), 'utf8')
const books = readFileSync(path.resolve('src/views/Books.tsx'), 'utf8')

test('book category management is owned by the books page instead of settings', () => {
  assert.doesNotMatch(settings, /menu_categories|activeMenu === 'categories'|handleAddCategory|handleDeleteCategory/)
  assert.doesNotMatch(store, /SettingsMenu = [^\n]*categories/)
  assert.match(books, /BookCategorySidebar/)
})

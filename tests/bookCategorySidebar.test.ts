import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sidebarSource = readFileSync(new URL('../src/views/BookCategorySidebar.tsx', import.meta.url), 'utf8')
const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')

test('book shelf context menu exposes child shelf creation', () => {
  assert.match(sidebarSource, /onClick=\{\(\) => \{\s*startAdd\(contextMenu\.category\.id\)/)
  assert.match(sidebarSource, /t\('books\.add_sub_shelf'\)/)
  assert.match(sidebarSource, /flattenBookCategoryTree\(categories\)/)
})

test('book shelf hierarchy is persisted and deletion reparents children', () => {
  assert.match(booksSource, /createCategory = async \(name: string, parentId: BookShelf\['id'\] \| null\)/)
  assert.match(booksSource, /INSERT INTO categories \(name, parent_id, sort_order\)/)
  assert.match(booksSource, /UPDATE categories SET parent_id = \? WHERE parent_id = \?/)
  assert.match(booksSource, /getBookCategoryDescendantIds\(categories, cat\.id\)/)
})

test('books can be dropped onto a concrete shelf to update their category', () => {
  assert.match(sidebarSource, /application\/x-lifeos-book-id/)
  assert.match(sidebarSource, /onDrop=\{\(event\) => void handleCategoryDrop\(event, category\)\}/)
  assert.match(sidebarSource, /drop-target/)
  assert.match(booksSource, /const moveBookToCategory = async \(bookId: string, category: BookShelf\)/)
  assert.match(booksSource, /UPDATE books SET category = \? WHERE id = \?/)
  assert.match(booksSource, /draggable/)
  assert.match(booksSource, /application\/x-lifeos-book-id/)
})

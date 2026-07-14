import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const requiredKeys = [
  'sidebar_title',
  'to_organize',
  'my_shelves',
  'add_shelf',
  'rename_shelf',
  'edit_shelf_translations',
  'delete_shelf',
  'shelf_name_required',
  'shelf_name_duplicate',
  'toast_category_create_failed',
  'toast_category_update_failed',
  'toast_category_delete_failed',
  'confirm_delete_shelf_title',
  'confirm_delete_shelf_desc',
]

for (const locale of ['zh-CN', 'en-US']) {
  test(`${locale} book category sidebar translations`, async () => {
    const source = await readFile(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')
    const { books } = JSON.parse(source)

    for (const key of requiredKeys) {
      assert.equal(typeof books?.[key], 'string', `missing books.${key}`)
      assert.notEqual(books[key].trim(), '', `empty books.${key}`)
    }
  })
}

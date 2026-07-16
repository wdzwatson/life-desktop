import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

type LocaleResource = {
  notes?: Record<string, unknown>
}

const loadLocale = (filename: string): LocaleResource =>
  JSON.parse(
    readFileSync(new URL(`../src/locales/${filename}`, import.meta.url), 'utf8'),
  ) as LocaleResource

const resources = {
  'zh-CN': loadLocale('zh-CN.json'),
  'en-US': loadLocale('en-US.json'),
}

const sidebarKeys = [
  'notebooks_title',
  'all_notes',
  'default_title',
  'my_notebooks',
  'empty_notebooks',
  'create_notebook',
  'rename_notebook',
  'edit_notebook_translations',
  'notebook_more_actions',
  'current_language_label',
  'delete_notebook',
  'notebook_name_translation_placeholder',
  'notebook_category_translation_placeholder',
  'notebook_category_help',
  'error_reserved_notebook_name',
  'error_notebook_unavailable',
] as const

const requiredTokens: Partial<Record<(typeof sidebarKeys)[number], readonly string[]>> = {
  notebook_more_actions: ['name'],
  current_language_label: ['language'],
  notebook_name_translation_placeholder: ['language'],
  notebook_category_translation_placeholder: ['language'],
}

const extractInterpolationTokens = (value: string) =>
  [...new Set([...value.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((match) => match[1]))].sort()

for (const [locale, resource] of Object.entries(resources)) {
  test(`${locale} defines complete notebook sidebar copy`, () => {
    const notes = resource.notes
    assert.ok(notes, `${locale} must define a notes resource`)

    for (const key of sidebarKeys) {
      const value = notes[key]
      assert.equal(typeof value, 'string', `${locale} notes.${key} must be a string`)
      assert.ok(value.trim(), `${locale} notes.${key} must not be blank`)
    }
  })

  test(`${locale} preserves notebook sidebar interpolation tokens`, () => {
    const notes = resource.notes
    assert.ok(notes, `${locale} must define a notes resource`)

    for (const [key, tokens] of Object.entries(requiredTokens)) {
      const value = notes[key]
      assert.equal(typeof value, 'string', `${locale} notes.${key} must be a string`)
      assert.deepEqual(
        extractInterpolationTokens(value),
        [...tokens].sort(),
        `${locale} notes.${key} must contain exactly the expected interpolation tokens`,
      )
    }
  })
}

test('Chinese and English resources carry localized notebook fixed-entry labels', () => {
  assert.equal(resources['zh-CN'].notes?.all_notes, '全部笔记')
  assert.equal(resources['zh-CN'].notes?.default_title, '未分类')
  assert.equal(resources['zh-CN'].notes?.my_notebooks, '我的笔记本')

  assert.equal(resources['en-US'].notes?.all_notes, 'All Notes')
  assert.equal(resources['en-US'].notes?.default_title, 'Uncategorized')
  assert.equal(resources['en-US'].notes?.my_notebooks, 'My Notebooks')
})

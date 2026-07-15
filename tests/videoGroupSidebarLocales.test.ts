import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

type LocaleResource = {
  videos?: Record<string, unknown>
}

const loadLocale = (filename: string): LocaleResource =>
  JSON.parse(readFileSync(new URL(`../src/locales/${filename}`, import.meta.url), 'utf8')) as LocaleResource

const resources = {
  'zh-CN': loadLocale('zh-CN.json'),
  'en-US': loadLocale('en-US.json'),
}

const sidebarKeys = [
  'sidebar_title',
  'all_videos_sidebar',
  'to_organize',
  'my_groups',
  'add_top_level_group',
  'add_child_group',
  'rename_group',
  'edit_group_translations',
  'delete_group',
  'expand_group',
  'collapse_group',
  'group_name_required',
  'group_name_duplicate',
  'group_translation_duplicate',
  'group_create_failed',
  'group_update_failed',
  'group_delete_failed',
  'confirm_delete_group_title',
  'confirm_delete_group_body',
  'group_unavailable',
  'translation_name_placeholder',
  'toast_group_saved_refresh_failed',
] as const

const requiredTokens: Partial<Record<(typeof sidebarKeys)[number], readonly string[]>> = {
  expand_group: ['name'],
  collapse_group: ['name'],
  group_translation_duplicate: ['language'],
  confirm_delete_group_body: ['name', 'videoCount', 'childCount'],
  translation_name_placeholder: ['language'],
  toast_group_saved_refresh_failed: ['error'],
}

for (const [locale, resource] of Object.entries(resources)) {
  test(`${locale} defines complete video group sidebar copy`, () => {
    const videos = resource.videos
    assert.ok(videos, `${locale} must define a videos resource`)

    for (const key of sidebarKeys) {
      const value = videos[key]
      assert.equal(typeof value, 'string', `${locale} videos.${key} must be a string`)
      assert.ok(value.trim(), `${locale} videos.${key} must not be blank`)
    }
  })

  test(`${locale} preserves required video group sidebar interpolation tokens`, () => {
    const videos = resource.videos
    assert.ok(videos, `${locale} must define a videos resource`)

    for (const [key, tokens] of Object.entries(requiredTokens)) {
      const value = videos[key]
      assert.equal(typeof value, 'string', `${locale} videos.${key} must be a string`)
      for (const token of tokens) {
        assert.ok(
          value.includes(`{{${token}}}`),
          `${locale} videos.${key} must include the {{${token}}} token`,
        )
      }
    }
  })
}

test('Chinese and English resources carry their localized sidebar labels', () => {
  assert.equal(resources['zh-CN'].videos?.all_videos_sidebar, '全部视频')
  assert.equal(resources['zh-CN'].videos?.to_organize, '待整理')
  assert.equal(resources['zh-CN'].videos?.my_groups, '我的分组')

  assert.equal(resources['en-US'].videos?.all_videos_sidebar, 'All Videos')
  assert.equal(resources['en-US'].videos?.to_organize, 'To Organize')
  assert.equal(resources['en-US'].videos?.my_groups, 'My Groups')
})

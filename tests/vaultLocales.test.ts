import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const requiredVaultKeys = [
  'toast_vault_setup_complete',
  'toast_vault_migrated',
  'toast_vault_unlocked',
  'toast_vault_locked',
  'toast_vault_incorrect_password',
  'vault_setup_title',
  'vault_setup_desc',
  'vault_setup_password_placeholder',
  'vault_confirm_password_placeholder',
  'vault_btn_setup',
  'vault_locked_title',
  'vault_locked_desc',
  'vault_password_placeholder',
  'vault_migration_required_title',
  'vault_migration_required_desc',
  'vault_btn_migrate',
  'vault_failed_title',
  'vault_failed_desc',
  'vault_unsupported_title',
  'vault_unsupported_desc',
  'vault_error_generic',
  'vault_error_invalid_password',
  'vault_error_rate_limited',
  'vault_error_password_mismatch',
  'vault_reveal_tooltip',
  'vault_hide_tooltip',
  'vault_copy_tooltip',
  'btn_lock_vault',
]

function readLocale(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as { toolbox: Record<string, string> }
}

test('password vault localization keys exist in Chinese and English', () => {
  for (const path of ['src/locales/zh-CN.json', 'src/locales/en-US.json']) {
    const locale = readLocale(path)
    for (const key of requiredVaultKeys) {
      assert.equal(typeof locale.toolbox[key], 'string', `${path} is missing toolbox.${key}`)
      assert.notEqual(locale.toolbox[key].trim(), '', `${path} has blank toolbox.${key}`)
    }
  }
})

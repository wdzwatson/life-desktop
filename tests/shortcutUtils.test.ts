import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesShortcut, shortcutFromKeyboardEvent } from '../src/shortcutUtils'

const keyboardEvent = (key: string, modifiers: Partial<{
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
})

test('shortcut capture stores browser special keys as Electron accelerators', () => {
  assert.equal(shortcutFromKeyboardEvent(keyboardEvent('ArrowLeft', { ctrlKey: true })), 'CommandOrControl+Left')
  assert.equal(shortcutFromKeyboardEvent(keyboardEvent('Enter', { altKey: true })), 'Alt+Return')
  assert.equal(shortcutFromKeyboardEvent(keyboardEvent('+', { ctrlKey: true, shiftKey: true })), 'CommandOrControl+Shift+Plus')
})

test('reader shortcut matching accepts normalized browser key names', () => {
  assert.equal(matchesShortcut(keyboardEvent('ArrowLeft', { ctrlKey: true }), 'CommandOrControl+Left'), true)
  assert.equal(matchesShortcut(keyboardEvent('ArrowLeft', { ctrlKey: true }), 'CommandOrControl+ArrowLeft'), true)
  assert.equal(matchesShortcut(keyboardEvent('ArrowLeft', { ctrlKey: true, shiftKey: true }), 'CommandOrControl+Left'), false)
  assert.equal(matchesShortcut(keyboardEvent('Escape'), 'Alt+Escape'), false)
})

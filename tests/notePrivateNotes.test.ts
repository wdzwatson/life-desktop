import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const notesView = readFileSync(join(root, 'src', 'views', 'Notes.tsx'), 'utf8')
const mainProcess = readFileSync(join(root, 'electron', 'main.ts'), 'utf8')
const preload = readFileSync(join(root, 'electron', 'preload.ts'), 'utf8')
const schema = readFileSync(join(root, 'electron', 'db', 'schema.ts'), 'utf8')

test('private notes are stored through encrypted note IPC instead of plaintext content writes', () => {
  assert.match(schema, /is_private INTEGER NOT NULL DEFAULT 0/)
  assert.match(schema, /private_salt TEXT/)
  assert.match(schema, /private_iv TEXT/)
  assert.match(schema, /private_tag TEXT/)
  assert.match(mainProcess, /createCipheriv\('aes-256-gcm'/)
  assert.match(mainProcess, /createDecipheriv\(\s*'aes-256-gcm'/)
  assert.match(mainProcess, /scryptAsync\(password, salt/)
  assert.match(preload, /createPrivateNote/)
  assert.match(preload, /unlockPrivateNote/)
  assert.match(preload, /savePrivateNote/)
})

test('private note rows are masked in the renderer until unlocked', () => {
  assert.match(notesView, /Number\(note\.is_private \|\| 0\) === 1 \? \{ \.\.\.note, content: '' \} : note/)
  assert.match(notesView, /setUnlockPromptNote\(note\)/)
  assert.match(notesView, /api\.savePrivateNote/)
  assert.match(notesView, /private_locked_title/)
})

test('note popup and preview image context actions are wired through preload', () => {
  assert.match(preload, /openNoteEditorWindow/)
  assert.match(preload, /onNoteEditorDraft/)
  assert.match(preload, /notifyNoteEditorReady/)
  assert.match(preload, /onNoteEditorCloseRequest/)
  assert.match(preload, /confirmNoteEditorClose/)
  assert.match(mainProcess, /pendingNoteEditorDraft/)
  assert.match(mainProcess, /note:editorWindowReady/)
  assert.match(mainProcess, /note:editorCloseRequested/)
  assert.match(mainProcess, /note:confirmEditorClose/)
  assert.match(preload, /copyNoteImage/)
  assert.match(preload, /saveNoteImage/)
  assert.match(notesView, /note-image-context-menu/)
  assert.match(notesView, /typora-toolbar/)
})

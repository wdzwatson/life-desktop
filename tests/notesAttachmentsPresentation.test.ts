import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const notesSource = readFileSync(new URL('../src/views/Notes.tsx', import.meta.url), 'utf8')

test('markdown notes support pasted images, attached files, and secure preview links', () => {
  assert.match(notesSource, /onPaste=\{\(event\) => void handleEditorPaste\(event\)\}/)
  assert.match(notesSource, /selectNoteAttachments/)
  assert.match(notesSource, /saveNotePastedImage/)
  assert.match(notesSource, /openNoteAttachment/)
  assert.match(notesSource, /life-note-asset:\/\/attachment/)
})

test('note images can persist dimensions and be resized in the preview', () => {
  assert.match(notesSource, /updateNoteImageDimensionsInContent/)
  assert.match(notesSource, /renderSizedNoteImages/)
  assert.match(notesSource, /pointerdown/)
  assert.match(notesSource, /image_resize_hint/)
})

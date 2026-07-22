import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('desktop task note uses a rounded transparent card and exposes the main-window action', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')
  const noteStyle = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.css'), 'utf8')

  assert.match(noteView, />任务</)
  assert.match(noteView, /openMainWindow/)
  assert.match(noteStyle, /border-radius: 16px/)
  assert.match(noteStyle, /background: transparent !important/)
  assert.match(noteStyle, /overflow: hidden/)
})

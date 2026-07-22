import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('desktop task note exposes local appearance controls and Electron settings IPC', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')
  const mainProcess = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8')
  const preload = readFileSync(join(process.cwd(), 'electron', 'preload.ts'), 'utf8')

  assert.match(noteView, /type="range"/)
  assert.match(noteView, /setDesktopTaskNoteSettings/)
  assert.match(mainProcess, /desktopTaskNote:setSettings/)
  assert.match(mainProcess, /setAlwaysOnTop/)
  assert.match(mainProcess, /scheduleDesktopTaskNoteBoundsSave/)
  assert.match(preload, /getDesktopTaskNoteSettings/)
})

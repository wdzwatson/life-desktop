import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const main = readFileSync(path.resolve('electron/main.ts'), 'utf8')
const rendererEntry = readFileSync(path.resolve('src/main.tsx'), 'utf8')

test('Windows application menu is removed and desktop main windows use the themed title bar', () => {
  assert.match(main, /if \(process\.platform !== 'win32'\) return/)
  assert.match(main, /Menu\.setApplicationMenu\(null\)/)
  assert.match(main, /const useCustomTitlebar = \['win32', 'linux'\]\.includes\(process\.platform\)/)
  assert.match(main, /frame: !useCustomTitlebar/)
  assert.match(main, /mainWindow\.setMenuBarVisibility\(false\)/)
  assert.match(main, /function createNoteEditorWindow\(\)[\s\S]*const useCustomTitlebar = \['win32', 'linux'\]\.includes\(process\.platform\)/)
  assert.match(main, /function createNoteEditorWindow\(\)[\s\S]*frame: !useCustomTitlebar/)
  assert.match(main, /function createNoteEditorWindow\(\)[\s\S]*noteEditorWindow\.setMenuBarVisibility\(false\)/)
  assert.match(main, /configureApplicationMenu\(\)/)
  assert.match(rendererEntry, /function NotesPopup\(\)[\s\S]*app-window--custom-titlebar/)
  assert.match(rendererEntry, /<DesktopTitlebar title="LifeOS 笔记编辑" \/>/)
})

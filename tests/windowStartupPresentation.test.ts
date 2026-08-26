import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const main = readFileSync(path.resolve('electron/main.ts'), 'utf8')

test('desktop windows stay hidden until their renderer has painted', () => {
  const createMainWindow = main.slice(
    main.indexOf('function createWindow()'),
    main.indexOf('function createNoteEditorWindow()'),
  )
  const createDesktopNote = main.slice(
    main.indexOf('function createDesktopTaskNoteWindow()'),
    main.indexOf('function ensureApplicationEntryPoints()'),
  )

  assert.match(createMainWindow, /show: false/)
  assert.match(createMainWindow, /backgroundColor: '#fafafa'/)
  assert.match(createMainWindow, /once\('ready-to-show'/)
  assert.match(createMainWindow, /mainWindow\.show\(\)/)
  assert.match(createDesktopNote, /show: false/)
  assert.match(createDesktopNote, /once\('ready-to-show'/)
  assert.match(createDesktopNote, /desktopTaskNoteWindow\.showInactive\(\)/)
})

test('desktop note renderer starts only after the main window is ready', () => {
  assert.match(
    main,
    /const startupMainWindow = createWindow\(\)[\s\S]*startupMainWindow\.once\('ready-to-show', \(\) => createDesktopTaskNoteWindow\(\)\)/,
  )
})

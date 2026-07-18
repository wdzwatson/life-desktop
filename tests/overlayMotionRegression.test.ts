import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const notesSource = readFileSync(new URL('../src/views/Notes.tsx', import.meta.url), 'utf8')
const videosSource = readFileSync(new URL('../src/views/Videos.tsx', import.meta.url), 'utf8')

test('notes export dropdown closes from document events without a fixed backdrop', () => {
  const exportStart = notesSource.indexOf('{/* Export Button & Dropdown */}')
  const exportEnd = notesSource.indexOf('onClick={() => handleDeleteNote(activeNoteId)}', exportStart)
  const exportSource = notesSource.slice(exportStart, exportEnd)

  assert.notEqual(exportStart, -1)
  assert.notEqual(exportEnd, -1)
  assert.match(
    notesSource,
    /document\.addEventListener\('pointerdown', closeOnOutsidePointer, true\)/,
  )
  assert.match(exportSource, /ref=\{exportDropdownRef\}/)
  assert.doesNotMatch(exportSource, /position:\s*'fixed'/)
})

test('video details drawer stays mounted for GSAP enter and exit timelines', () => {
  const drawerStart = videosSource.indexOf('{isDrawerMounted && (')
  const drawerEnd = videosSource.indexOf('{parsedData && (', drawerStart)
  const drawerSource = videosSource.slice(drawerStart, drawerEnd)

  assert.notEqual(drawerStart, -1)
  assert.notEqual(drawerEnd, -1)
  assert.match(videosSource, /useGSAP\(/)
  assert.match(videosSource, /onComplete:\s*\(\) => setIsDrawerMounted\(false\)/)
  assert.match(drawerSource, /ref=\{drawerOverlayRef\}/)
  assert.match(drawerSource, /ref=\{drawerPanelRef\}/)
})

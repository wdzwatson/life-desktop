import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('desktop task note prioritizes active tasks in a compact transparent card', () => {
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')
  const noteStyle = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.css'), 'utf8')

  assert.match(noteView, />今日任务</)
  assert.match(noteView, /openMainWindow/)
  assert.match(noteView, /className="desktop-task-note__active-scroll"/)
  assert.match(noteView, /aria-expanded=\{isCompletedPanelExpanded\}/)
  assert.match(noteView, /activeTasks\.length === 0/)
  assert.match(noteStyle, /border-radius: 10px/)
  assert.match(noteStyle, /background: transparent !important/)
  assert.match(noteStyle, /overflow: hidden/)
  assert.match(noteStyle, /\.desktop-task-note__opacity \.slider\s*\{[\s\S]*min-width: 0;/)
  assert.match(noteStyle, /\.desktop-task-note__active-scroll\s*\{[\s\S]*overflow-y: auto;/)
  assert.match(
    noteStyle,
    /\.desktop-task-note__completed-section\.is-expanded\s*\{[\s\S]*max-height: min\(160px, 40%\);/,
  )
})

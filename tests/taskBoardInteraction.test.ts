import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('kanban task cards provide a hover and focus response', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /className=\{`card task-board-card/)
  assert.match(tasksView, /role="button"/)
  assert.match(tasksView, /tabIndex=\{0\}/)
  assert.match(css, /\.task-board-card:hover,[\s\S]*\.task-board-card:focus-visible/)
  assert.match(css, /\.task-board-card:hover,[\s\S]*background-color:/)
  assert.doesNotMatch(
    css,
    /\.task-board-card:hover,\s*\.task-board-card:focus-visible\s*\{[^}]*transform:/,
  )
})

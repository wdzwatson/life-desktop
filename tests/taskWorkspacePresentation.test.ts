import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task board uses the four workflow lanes without reserving an empty column', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
  assert.match(
    css,
    /\.task-board-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(220px,\s*1fr\)\)/,
  )
})

test('calendar task titles clamp and wrap inside their task card', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
  assert.match(css, /\.task-calendar__task-title\s*\{[\s\S]*max-width:\s*100%/)
  assert.match(css, /\.task-calendar__task-title\s*\{[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(css, /\.task-calendar__task-title\s*\{[\s\S]*-webkit-line-clamp:\s*2/)
  assert.match(
    css,
    /\.task-calendar__month \.task-calendar__task-title\s*\{[\s\S]*-webkit-line-clamp:\s*1/,
  )
})

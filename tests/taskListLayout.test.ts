import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('list keeps editing in the drawer instead of a persistent details column', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
  const appCss = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
  assert.match(appCss, /\.main-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-page\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /\.task-content\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /\.task-list-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-list-layout\s*\{[\s\S]*justify-items:\s*start/)
  assert.match(css, /\.task-list-layout > \.task-details-panel\s*\{\s*display:\s*none/)
  assert.match(css, /\.task-panel--list\s*\{\s*width:\s*min\(100%,\s*920px\)/)
})

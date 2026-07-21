import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('list uses a responsive card grid while editing stays in the drawer', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
  const appCss = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
  assert.match(appCss, /\.main-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-page\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /\.task-content\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /\.task-list-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-list-layout > \.task-details-panel\s*\{\s*display:\s*none/)
  assert.match(css, /\.task-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(300px,\s*1fr\)\)/)
  assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.task-list\s*\{[\s\S]*grid-template-columns:\s*1fr/)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const sidebar = readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8')

test('the primary sidebar does not duplicate task pages as pinned shortcuts', () => {
  assert.doesNotMatch(sidebar, /sidebar\.pinned/)
  assert.doesNotMatch(sidebar, /handleNavClick\('tasks', 'calendar'\)/)
  assert.doesNotMatch(sidebar, /handleNavClick\('tasks', 'recurring'\)/)
  assert.match(sidebar, /handleNavClick\('tasks'\)/)
})

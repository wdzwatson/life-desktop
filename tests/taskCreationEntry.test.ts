import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('topbar opens the unified task drawer entry point', () => {
  const topbar = readFileSync(join(process.cwd(), 'src', 'components', 'Topbar.tsx'), 'utf8')
  assert.match(topbar, /setTimeout\(\(\) => window\.dispatchEvent\(new Event\('task:create'\)\), 0\)/)
  assert.doesNotMatch(topbar, /quickTitle/)
})

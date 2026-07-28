import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dashboardSource = readFileSync(new URL('../src/views/Dashboard.tsx', import.meta.url), 'utf8')
const dashboardStyles = readFileSync(new URL('../src/views/Dashboard.css', import.meta.url), 'utf8')

test('dashboard content titles truncate predictably and keep full-title tooltips', () => {
  assert.match(dashboardSource, /className="dashboard-content-title"\s+title=\{task\.title\}/)
  assert.match(
    dashboardSource,
    /className="dashboard-content-title dashboard-content-title--two-lines"\s+title=\{currentBook\.title\}/,
  )
  assert.match(dashboardSource, /className="dashboard-note-title"/)
  assert.match(dashboardSource, /<span title=\{recentNote\.title\}>\{recentNote\.title\}<\/span>/)
  assert.match(dashboardSource, /className="dashboard-content-title"\s+title=\{recentVideo\.title\}/)
  assert.match(dashboardStyles, /\.dashboard-content-title\s*\{[\s\S]*?text-overflow:\s*ellipsis/)
  assert.match(dashboardStyles, /\.dashboard-content-title--two-lines\s*\{[\s\S]*?-webkit-line-clamp:\s*2/)
  assert.match(dashboardStyles, /\.dashboard-note-title > span\s*\{[\s\S]*?-webkit-line-clamp:\s*2/)
})

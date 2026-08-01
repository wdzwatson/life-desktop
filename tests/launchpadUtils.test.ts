import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getLaunchpadRecommendation,
  normalizeLaunchpadSettings,
  shouldShowLaunchpad,
} from '../src/views/launchpadUtils.ts'

test('launchpad settings only accept recognised startup modes', () => {
  assert.deepEqual(normalizeLaunchpadSettings({ startupMode: 'always' }), { startupMode: 'always' })
  assert.deepEqual(normalizeLaunchpadSettings({ startupMode: 'unexpected' }), { startupMode: 'daily' })
})

test('daily launchpad is shown only once for a local date', () => {
  assert.equal(shouldShowLaunchpad({ startupMode: 'daily' }, '2026-08-01'), true)
  assert.equal(
    shouldShowLaunchpad({ startupMode: 'daily', lastShownDate: '2026-08-01' }, '2026-08-01'),
    false,
  )
  assert.equal(shouldShowLaunchpad({ startupMode: 'always' }, '2026-08-01'), true)
  assert.equal(shouldShowLaunchpad({ startupMode: 'resume' }, '2026-08-01'), false)
})

test('launchpad recommendation prioritises overdue, today, context, empty, then default', () => {
  const base = { hasWorkspaceContent: true, tasks: { overdue: 0, today: 0 } }
  assert.equal(getLaunchpadRecommendation({ ...base, tasks: { overdue: 1, today: 3 } }).kind, 'overdue')
  assert.equal(getLaunchpadRecommendation({ ...base, tasks: { overdue: 0, today: 1 } }).kind, 'today')
  assert.equal(
    getLaunchpadRecommendation({ ...base, context: { screen: 'notes', updatedAt: 1 } }).kind,
    'continue',
  )
  assert.equal(getLaunchpadRecommendation({ ...base, hasWorkspaceContent: false }).kind, 'empty')
  assert.equal(getLaunchpadRecommendation(base).kind, 'default')
})

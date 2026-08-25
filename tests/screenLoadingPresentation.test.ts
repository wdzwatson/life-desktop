import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8')
const styles = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')

test('screen loading mirrors stable page structure instead of empty placeholder cards', () => {
  assert.match(appSource, /screen-loading__header/)
  assert.match(appSource, /screen-loading__tabs/)
  assert.match(appSource, /screen-loading__sidebar/)
  assert.match(appSource, /screen-loading__list/)
  assert.doesNotMatch(appSource, /screen-loading__card/)
})

test('screen loading avoids fast flashes and paper-style dashed outlines', () => {
  assert.match(styles, /animation: screen-loading-enter 180ms[^;]*100ms forwards/)
  assert.match(styles, /\.screen-loading--toolbox \.screen-loading__panel/)
  assert.match(styles, /body\.loading-paper-skeleton \.screen-loading \{/)
  assert.doesNotMatch(
    styles,
    /body\.loading-paper-skeleton[^{]*screen-loading__[^{]*\{[^}]*border-style:\s*dashed/s,
  )
})

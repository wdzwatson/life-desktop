import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf-8')

test('renderer entry declares a Content Security Policy without unsafe eval', () => {
  const cspMatch = indexHtml.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )

  assert.ok(cspMatch, 'index.html should declare a Content-Security-Policy meta tag')
  assert.doesNotMatch(cspMatch[1], /'unsafe-eval'/)
})

test('renderer CSP allows the app video protocol for local playback', () => {
  const cspMatch = indexHtml.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )

  assert.ok(cspMatch, 'index.html should declare a Content-Security-Policy meta tag')
  assert.match(cspMatch[1], /media-src[^;]*life-video:/)
})

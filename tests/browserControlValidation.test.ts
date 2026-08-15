import assert from 'node:assert/strict'
import test from 'node:test'
import { validateWebLikeUrl } from '../electron/browserControl/service.ts'

test('web-like main-process validation allows complete HTTP URLs', () => {
  assert.equal(validateWebLikeUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1')
  assert.throws(() => validateWebLikeUrl('example.com'), /complete HTTP or HTTPS URL/)
  assert.throws(() => validateWebLikeUrl('file:///tmp/a'), /Only HTTP and HTTPS/)
  assert.throws(() => validateWebLikeUrl('https://user:pass@example.com'), /embedded credentials/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_MESSAGE_SANITIZE_CONFIG,
  renderAIMessageMarkdown,
  sanitizeAIMessageHtml,
} from '../src/views/ai/messageSecurity.ts'

function strictTestSanitizer(html: string) {
  return html
    .replace(/<(script|iframe|object|embed|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\s(on\w+|style|srcdoc)=("[^"]*"|'[^']*')/gi, '')
    .replace(/(href|src)=("|')javascript:[\s\S]*?\2/gi, '$1="#"')
}

test('AI message sanitizer policy forbids executable containers and event attributes', () => {
  assert.ok(AI_MESSAGE_SANITIZE_CONFIG.FORBID_TAGS.includes('script'))
  assert.ok(AI_MESSAGE_SANITIZE_CONFIG.FORBID_TAGS.includes('iframe'))
  assert.ok(AI_MESSAGE_SANITIZE_CONFIG.FORBID_TAGS.includes('object'))
  assert.ok(AI_MESSAGE_SANITIZE_CONFIG.FORBID_ATTR.includes('onerror'))
  assert.equal(AI_MESSAGE_SANITIZE_CONFIG.ALLOW_UNKNOWN_PROTOCOLS, false)
})

test('sanitized Markdown removes scripts, inline handlers, and javascript links', () => {
  let receivedConfig: unknown
  const html = renderAIMessageMarkdown(
    '[unsafe](javascript:alert(1))\n\n<img src=x onerror="alert(2)">\n\n<script>alert(3)</script>',
    (value, config) => {
      receivedConfig = config
      return strictTestSanitizer(value)
    },
  )
  assert.equal(receivedConfig, AI_MESSAGE_SANITIZE_CONFIG)
  assert.doesNotMatch(html, /script|onerror|javascript:/i)
})

test('sanitizer receives raw HTML and preserves ordinary readable markup', () => {
  const html = sanitizeAIMessageHtml('<p><strong>Safe</strong></p>', (value) => strictTestSanitizer(value))
  assert.equal(html, '<p><strong>Safe</strong></p>')
})

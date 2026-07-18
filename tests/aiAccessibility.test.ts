import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const workspace = readFileSync(path.resolve('src/views/ai/ChatWorkspace.tsx'), 'utf8')
const approval = readFileSync(path.resolve('src/views/ai/ToolApprovalDialog.tsx'), 'utf8')
const viewer = readFileSync(path.resolve('src/views/ai/MediaViewer.tsx'), 'utf8')
const images = readFileSync(path.resolve('src/views/ai/ImageMessage.tsx'), 'utf8')
const videos = readFileSync(path.resolve('src/views/ai/VideoMessage.tsx'), 'utf8')
const dialog = readFileSync(path.resolve('src/components/AccessibleDialog.tsx'), 'utf8')
const conversationDelete = readFileSync(path.resolve('src/views/ai/ConversationDeleteDialog.tsx'), 'utf8')
const messageRenderer = readFileSync(path.resolve('src/views/ai/MessageRenderer.tsx'), 'utf8')
const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
const appCss = readFileSync(path.resolve('src/index.css'), 'utf8')

test('tool approval and media viewer trap focus, close with Escape, and restore focus', () => {
  assert.match(approval, /<AccessibleDialog[\s\S]*role="alertdialog"[\s\S]*returnFocus=\{returnFocus\}[\s\S]*initialFocusRef=\{rejectRef\}/)
  assert.match(viewer, /<AccessibleDialog[\s\S]*returnFocus=[\s\S]*initialFocusRef=\{closeRef\}/)
  assert.match(dialog, /event\.key === 'Escape'[\s\S]*latestOnCloseRef\.current\(\)/)
  assert.match(dialog, /getTrappedFocusIndex[\s\S]*items\[nextIndex\]\.focus\(\)/)
  assert.match(dialog, /queueMicrotask\(\(\) =>[\s\S]*shouldRestoreDialogFocus\(mountedContent\)[\s\S]*latestReturnFocusRef\.current\?\.\(\)/)
  assert.match(workspace, /returnFocus=\{\(\) => textareaRef\.current\?\.focus\(\)\}/)
})

test('conversation deletion uses one explicit dialog and keeps cancel separate from media cleanup', () => {
  assert.doesNotMatch(workspace, /window\.confirm\(t\('aiChat\.chat\.delete/)
  assert.match(workspace, /<ConversationDeleteDialog[\s\S]*onCancel=[\s\S]*onConfirm=/)
  assert.match(conversationDelete, /type="checkbox"[\s\S]*deleteMedia/)
  assert.match(conversationDelete, /className="btn danger"[\s\S]*common\.delete/)
})

test('completed responses describe retry behavior as sending the prompt again', () => {
  assert.match(messageRenderer, /message\.status === 'completed' \? 'aiChat\.chat\.send_again'/)
  assert.doesNotMatch(messageRenderer, /aiChat\.chat\.regenerate/)
})

test('streaming updates announce run status atomically instead of every token', () => {
  assert.doesNotMatch(workspace, /className="ai-message-timeline"[\s\S]{0,260}aria-live=/)
  assert.match(workspace, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(workspace, /setTimeout\(\(\) =>[\s\S]*announcement_\$\{status\}[\s\S]*}, 240\)/)
  assert.match(workspace, /\[activeRun\?\.runId, activeRun\?\.status, t\]/)
})

test('generated images and videos always expose localized accessible names', () => {
  assert.match(images, /aria-label=\{t\('aiChat\.images\.open_name'/)
  assert.match(images, /alt=\{image\.alt \?\? image\.name \?\? t\('aiChat\.images\.generated_alt'\)\}/)
  assert.match(viewer, /aiChat\.images\.generated_alt/)
  assert.match(videos, /aria-label=\{video\.alt \?\? video\.name \?\? t\('aiChat\.videos\.generated_alt'\)\}/)
})

test('AI controls and run states retain visible keyboard focus and theme-derived contrast', () => {
  assert.match(css, /\.ai-chat-shell :is\(button, a, input, select, textarea, \[tabindex\]\):focus-visible[\s\S]*outline:\s*2px solid/)
  assert.match(css, /--ai-status-success:[\s\S]*--ai-status-warning:[\s\S]*--ai-status-danger:/)
  assert.match(css, /dd\.is-completed[\s\S]*var\(--ai-status-success\)/)
  assert.match(css, /dd\.is-cancelled,[\s\S]*dd\.is-interrupted[\s\S]*var\(--ai-status-warning\)/)
})

test('screen-reader labels stay visually hidden and compact layouts retain the run inspector', () => {
  assert.match(appCss, /\.sr-only\s*\{[\s\S]*position:\s*absolute[\s\S]*clip:\s*rect\(0, 0, 0, 0\)/)
  assert.match(workspace, /className="ai-run-inspector-toggle"[\s\S]*aria-controls="ai-run-inspector"/)
  assert.match(workspace, /id="ai-run-inspector"[\s\S]*showRunInspector \? 'is-open'/)
  assert.match(css, /@media \(max-width: 1120px\)[\s\S]*\.ai-run-inspector-toggle[\s\S]*display:\s*inline-flex/)
  assert.match(css, /\.ai-run-inspector\.is-open[\s\S]*position:\s*absolute[\s\S]*display:\s*flex/)
})

test('daily chat typography and action targets remain readable', () => {
  assert.match(css, /\.ai-message__body\s*\{[\s\S]*font-size:\s*13px/)
  assert.match(css, /\.ai-chat-composer textarea\s*\{[\s\S]*font-size:\s*13px/)
  assert.match(css, /\.ai-conversation-item__actions button\s*\{[\s\S]*width:\s*32px[\s\S]*height:\s*32px/)
  assert.match(css, /\.ai-chat-composer__mode button\s*\{[\s\S]*min-height:\s*32px/)
})

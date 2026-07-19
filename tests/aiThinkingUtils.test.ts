import assert from 'node:assert/strict'
import test from 'node:test'
import { getAIThinkingLevels } from '../src/views/ai/thinkingUtils.ts'

test('thinking levels are hard-coded by model family', () => {
  assert.deepEqual(getAIThinkingLevels('gpt-5.6-sol'), ['none', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(getAIThinkingLevels('claude-fable-5'), ['low', 'medium', 'high'])
  assert.deepEqual(getAIThinkingLevels('gemini-3.5-flash'), ['minimal', 'low', 'medium', 'high'])
  assert.deepEqual(getAIThinkingLevels('grok-4.20'), ['low', 'high'])
})

test('unknown models retain one deterministic default thinking level', () => {
  assert.deepEqual(getAIThinkingLevels('custom-model'), ['medium'])
})

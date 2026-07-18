import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertAIMediaTaskTransition,
  assertAIRunTransition,
  canTransitionAIMediaTask,
  canTransitionAIRun,
  getInterruptedAIMediaTaskStatus,
  getInterruptedAIRunStatus,
  isAIMediaTaskTerminal,
  isAIRunTerminal,
} from '../electron/ai/state.ts'

test('AI run states allow the approved execution lifecycle', () => {
  assert.equal(canTransitionAIRun('queued', 'running'), true)
  assert.equal(canTransitionAIRun('running', 'waiting_for_approval'), true)
  assert.equal(canTransitionAIRun('waiting_for_approval', 'waiting_for_tool'), true)
  assert.equal(canTransitionAIRun('waiting_for_tool', 'running'), true)
  assert.equal(canTransitionAIRun('running', 'completed'), true)
})

test('AI run terminal states cannot be reopened or completed twice', () => {
  assert.equal(isAIRunTerminal('completed'), true)
  assert.equal(isAIRunTerminal('failed'), true)
  assert.equal(isAIRunTerminal('running'), false)
  assert.equal(canTransitionAIRun('completed', 'running'), false)
  assert.equal(canTransitionAIRun('completed', 'completed'), false)
  assert.throws(() => assertAIRunTransition('failed', 'running'), /Invalid AI run transition/)
})

test('AI media tasks support polling, processing, recovery, and terminal safety', () => {
  assert.equal(canTransitionAIMediaTask('queued', 'generating'), true)
  assert.equal(canTransitionAIMediaTask('generating', 'polling'), true)
  assert.equal(canTransitionAIMediaTask('polling', 'polling'), true)
  assert.equal(canTransitionAIMediaTask('polling', 'downloading'), true)
  assert.equal(canTransitionAIMediaTask('downloading', 'processing'), true)
  assert.equal(canTransitionAIMediaTask('processing', 'completed'), true)
  assert.equal(canTransitionAIMediaTask('interrupted', 'polling'), true)
  assert.equal(isAIMediaTaskTerminal('completed'), true)
  assert.equal(isAIMediaTaskTerminal('interrupted'), false)
  assert.throws(() => assertAIMediaTaskTransition('completed', 'processing'), /Invalid AI media transition/)
})

test('restart normalization preserves terminal rows and interrupts active work', () => {
  assert.equal(getInterruptedAIRunStatus('running'), 'interrupted')
  assert.equal(getInterruptedAIRunStatus('completed'), 'completed')
  assert.equal(getInterruptedAIRunStatus('cancelled'), 'cancelled')
  assert.equal(getInterruptedAIMediaTaskStatus('downloading'), 'interrupted')
  assert.equal(getInterruptedAIMediaTaskStatus('completed'), 'completed')
  assert.equal(getInterruptedAIMediaTaskStatus('failed'), 'failed')
})

test('assert transition helpers accept valid state changes', () => {
  assert.doesNotThrow(() => assertAIRunTransition('queued', 'running'))
  assert.doesNotThrow(() => assertAIMediaTaskTransition('downloading', 'completed'))
})

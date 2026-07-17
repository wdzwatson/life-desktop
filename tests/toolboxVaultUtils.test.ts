import assert from 'node:assert/strict'
import test from 'node:test'

import { copySecretWithAutoClear } from '../src/views/toolboxVaultUtils.ts'

test('copySecretWithAutoClear writes the secret and schedules clipboard clearing', async () => {
  const writes: string[] = []
  let scheduledDelay = 0

  await copySecretWithAutoClear(
    (value) => {
      writes.push(value)
    },
    'secret value',
    25,
    (callback, delayMs) => {
      scheduledDelay = delayMs
      callback()
      return 1
    },
  )

  assert.deepEqual(writes, ['secret value', ''])
  assert.equal(scheduledDelay, 25)
})

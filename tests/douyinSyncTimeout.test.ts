import assert from 'node:assert/strict'
import test from 'node:test'
import {
  withDouyinSyncInactivityTimeout,
  withDouyinTimeout,
} from '../electron/video/douyinSyncTimeout.ts'

test('Douyin page timeout rejects a stalled operation', async () => {
  await assert.rejects(
    withDouyinTimeout(new Promise(() => undefined), 5, 'page did not load'),
    /page did not load/,
  )
})

test('Douyin sync inactivity timeout is reset by progress', async () => {
  let reportActivity: (() => void) | undefined
  let complete: ((value: string) => void) | undefined
  const pending = withDouyinSyncInactivityTimeout(
    (report) => {
      reportActivity = report
      return new Promise<string>((resolve) => {
        complete = resolve
      })
    },
    30,
    'sync stalled',
  )

  await new Promise((resolve) => setTimeout(resolve, 15))
  reportActivity?.()
  await new Promise((resolve) => setTimeout(resolve, 15))
  complete?.('complete')

  assert.equal(await pending, 'complete')
})

test('Douyin sync inactivity timeout rejects a stalled operation', async () => {
  await assert.rejects(
    withDouyinSyncInactivityTimeout(() => new Promise(() => undefined), 5, 'sync stalled'),
    /sync stalled/,
  )
})

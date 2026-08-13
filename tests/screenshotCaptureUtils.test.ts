import assert from 'node:assert/strict'
import test from 'node:test'
import { getGifCapturePlan } from '../src/views/screenshotCaptureUtils'

test('GIF capture defaults to approximately eight seconds', () => {
  assert.deepEqual(getGifCapturePlan(8, 700), {
    frameCount: 11,
    interval: 700,
    playbackDuration: 7_700,
  })
})

test('GIF capture adjusts sampling to honor duration within the frame cap', () => {
  assert.deepEqual(getGifCapturePlan(15, 150), {
    frameCount: 20,
    interval: 750,
    playbackDuration: 15_000,
  })
  assert.deepEqual(getGifCapturePlan(2, 3_000), {
    frameCount: 2,
    interval: 1_000,
    playbackDuration: 2_000,
  })
})

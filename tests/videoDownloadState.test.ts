import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyVideoDownloadFailure,
  getInterruptedDownloadMessage,
  normalizeLegacyVideoStatus,
} from '../electron/video/downloadState.ts'

test('normalizeLegacyVideoStatus maps legacy statuses into the stateful video model', () => {
  assert.equal(normalizeLegacyVideoStatus('unclassified'), 'not_downloaded')
  assert.equal(normalizeLegacyVideoStatus('queued'), 'download_failed')
  assert.equal(normalizeLegacyVideoStatus('downloading'), 'download_failed')
  assert.equal(normalizeLegacyVideoStatus('downloaded'), 'downloaded')
  assert.equal(normalizeLegacyVideoStatus('download_failed'), 'download_failed')
  assert.equal(normalizeLegacyVideoStatus('invalid'), 'invalid')
  assert.equal(normalizeLegacyVideoStatus(undefined), 'not_downloaded')
})

test('getInterruptedDownloadMessage gives stale downloading rows a retryable reason', () => {
  assert.match(getInterruptedDownloadMessage(), /interrupted/i)
  assert.match(getInterruptedDownloadMessage(), /retry/i)
})

test('classifyVideoDownloadFailure only marks clearly unavailable sources invalid', () => {
  assert.deepEqual(classifyVideoDownloadFailure('HTTP Error 404: Not Found'), {
    status: 'invalid',
    invalidReason: 'HTTP Error 404: Not Found',
    downloadError: 'HTTP Error 404: Not Found',
  })
  assert.deepEqual(classifyVideoDownloadFailure('Private video'), {
    status: 'invalid',
    invalidReason: 'Private video',
    downloadError: 'Private video',
  })
  assert.deepEqual(classifyVideoDownloadFailure('cookies are missing'), {
    status: 'download_failed',
    invalidReason: null,
    downloadError: 'cookies are missing',
  })
})

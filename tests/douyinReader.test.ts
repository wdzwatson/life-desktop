import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isDouyinReaderNavigationUrl,
  isDouyinReaderSourceUrl,
  normalizeDouyinReaderBounds,
} from '../electron/video/douyinReader.ts'

test('normalizes finite positive reader bounds from renderer input', () => {
  assert.deepEqual(normalizeDouyinReaderBounds({ x: 12.9, y: 48.1, width: 800.8, height: 600.2 }), {
    x: 12,
    y: 48,
    width: 800,
    height: 600,
  })
  assert.equal(normalizeDouyinReaderBounds({ x: -1, y: 0, width: 800, height: 600 }), null)
  assert.equal(normalizeDouyinReaderBounds({ x: 0, y: 0, width: 0, height: 600 }), null)
})

test('accepts only official Douyin note and article URLs as reader sources', () => {
  assert.equal(isDouyinReaderSourceUrl('https://www.douyin.com/note/123456'), true)
  assert.equal(isDouyinReaderSourceUrl('https://www.douyin.com/article/123456?from=web'), true)
  assert.equal(isDouyinReaderSourceUrl('https://www.douyin.com/video/123456'), false)
  assert.equal(isDouyinReaderSourceUrl('https://example.com/note/123456'), false)
  assert.equal(isDouyinReaderSourceUrl('http://www.douyin.com/note/123456'), false)
})

test('keeps reader navigation within official Douyin HTTPS origins', () => {
  assert.equal(isDouyinReaderNavigationUrl('https://www.douyin.com/user/self'), true)
  assert.equal(isDouyinReaderNavigationUrl('https://creator.douyin.com/'), true)
  assert.equal(isDouyinReaderNavigationUrl('https://example.com/'), false)
  assert.equal(isDouyinReaderNavigationUrl('javascript:alert(1)'), false)
})

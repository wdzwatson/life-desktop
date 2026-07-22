import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getDouyinLoginPartition,
  hasDouyinLoginCookie,
  isDouyinCookieDomain,
  summarizeDouyinAuth,
} from '../electron/video/douyinSession.ts'

test('Douyin login partitions are stable and isolated per LifeOS user', () => {
  assert.equal(getDouyinLoginPartition('guest'), 'persist:lifeos-douyin-guest')
  assert.equal(getDouyinLoginPartition('alice@example.com'), 'persist:lifeos-douyin-alice_example.com')
  assert.equal(getDouyinLoginPartition('../../shared'), 'persist:lifeos-douyin-.._.._shared')
})

test('Douyin auth detection only trusts authenticated Douyin session cookies', () => {
  assert.equal(isDouyinCookieDomain('.douyin.com'), true)
  assert.equal(isDouyinCookieDomain('www.douyin.com'), true)
  assert.equal(isDouyinCookieDomain('.notdouyin.com'), false)

  assert.equal(
    hasDouyinLoginCookie([
      { domain: '.douyin.com', name: 'sessionid', value: 'authenticated-session' },
    ]),
    true,
  )
  assert.equal(
    hasDouyinLoginCookie([
      { domain: '.douyin.com', name: 'sessionid', value: '' },
      { domain: '.example.com', name: 'sessionid_ss', value: 'wrong-domain' },
    ]),
    false,
  )
})

test('Douyin auth summaries expose no cookie values', () => {
  const summary = summarizeDouyinAuth([
    { domain: '.douyin.com', name: 'sessionid', value: 'private-token' },
    { domain: '.douyin.com', name: 'ttwid', value: 'private-device-token' },
  ])

  assert.deepEqual(summary, { loggedIn: true, cookieCount: 2 })
  assert.equal(JSON.stringify(summary).includes('private-token'), false)
})

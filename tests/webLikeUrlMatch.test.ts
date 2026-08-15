import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseHttpUrl,
  rankMatchingTabs,
  scoreTabUrlMatch,
  selectMatchingTab,
} from '../extensions/lifeos-chrome/url-match.js'

test('web-like URL parsing accepts complete HTTP URLs only', () => {
  assert.equal(parseHttpUrl('https://Example.com/path')?.hostname, 'example.com')
  assert.equal(parseHttpUrl('file:///tmp/page.html'), null)
  assert.equal(parseHttpUrl('javascript:alert(1)'), null)
  assert.equal(parseHttpUrl('example.com/path'), null)
})

test('web-like matching is fuzzy only within the same origin', () => {
  assert.equal(scoreTabUrlMatch('https://example.com/items?a=1&b=2', 'https://example.com/items?b=2&a=1'), 100)
  assert.equal(scoreTabUrlMatch('https://example.com/items?a=1', 'https://example.com/items?session=2#part'), 90)
  assert.equal(scoreTabUrlMatch('https://example.com/items', 'https://example.com/items/42'), 70)
  assert.equal(scoreTabUrlMatch('https://example.com/items', 'https://example.com.evil.test/items'), 0)
  assert.equal(scoreTabUrlMatch('https://example.com/items', 'http://example.com/items'), 0)
})

test('web-like matching reports tied tabs and accepts an explicit candidate', () => {
  const tabs = [
    { id: 4, url: 'https://example.com/items?one=1', title: 'One', active: false, lastAccessed: 2 },
    { id: 8, url: 'https://example.com/items?two=2', title: 'Two', active: true, lastAccessed: 3 },
  ]
  const ranked = rankMatchingTabs('https://example.com/items', tabs)
  assert.deepEqual(ranked.map((tab) => tab.id), [8, 4])
  assert.equal(selectMatchingTab('https://example.com/items', tabs).kind, 'ambiguous')
  const selected = selectMatchingTab('https://example.com/items', tabs, 4)
  assert.equal(selected.kind, 'selected')
  if (selected.kind === 'selected') assert.equal(selected.tab.id, 4)
})

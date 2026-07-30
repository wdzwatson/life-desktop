import assert from 'node:assert/strict'
import test from 'node:test'
import { joinOcrWords } from '../src/ocrTextUtils'

test('OCR text keeps CJK characters and punctuation continuous', () => {
  assert.equal(joinOcrWords([{ text: '你' }, { text: '好' }, { text: '，' }, { text: '世界' }]), '你好，世界')
  assert.equal(joinOcrWords([{ text: 'OCR' }, { text: '识别' }, { text: '结果' }]), 'OCR识别结果')
  assert.equal(joinOcrWords([{ text: '2026' }, { text: '年' }]), '2026年')
})

test('OCR text retains spaces between ordinary Latin words', () => {
  assert.equal(joinOcrWords([{ text: 'machine' }, { text: 'learning' }]), 'machine learning')
})

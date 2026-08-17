import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOcrPdfOutlineEntries,
  extractOcrOutlineCandidates,
  getActivePdfOutlineNodeId,
  repairPdfOutlineTitle,
} from '../src/services/pdfOutlineEnhancements.ts'

test('same-page outline keeps the section explicitly selected by the reader', () => {
  const nodes = [
    { id: '5.2.9', level: 2, pageNumber: 119 },
    { id: '5.2.10', level: 2, pageNumber: 119 },
    { id: '5.2.11', level: 2, pageNumber: 120 },
  ]
  assert.equal(getActivePdfOutlineNodeId(nodes, 119, '5.2.9'), '5.2.9')
  assert.equal(getActivePdfOutlineNodeId(nodes, 119, '5.2.10'), '5.2.10')
  assert.equal(getActivePdfOutlineNodeId(nodes, 120, '5.2.9'), '5.2.11')
})

test('broken outline glyph is replaced only by one unambiguous text candidate', () => {
  assert.equal(
    repairPdfOutlineTitle('5 Continuity and Di□erentiability', [
      'Unrelated heading',
      '5 Continuity and Differentiability',
    ]),
    '5 Continuity and Differentiability',
  )
  assert.equal(
    repairPdfOutlineTitle('Di□erentiability', ['Differentiability', 'Diserentiability']),
    'Di□erentiability',
  )
})

test('OCR outline rows preserve numbering depth and repeated page targets', () => {
  const words = [
    { text: '5.2.9', x: 0, y: 10, width: 40, height: 12, confidence: 95 },
    { text: 'Continuity', x: 50, y: 10, width: 65, height: 12, confidence: 95 },
    { text: '119', x: 180, y: 10, width: 22, height: 12, confidence: 95 },
    { text: '5.2.10', x: 0, y: 30, width: 45, height: 12, confidence: 95 },
    { text: 'Differentiability', x: 50, y: 30, width: 90, height: 12, confidence: 95 },
    { text: '119', x: 180, y: 30, width: 22, height: 12, confidence: 95 },
    { text: '5.2.10.1', x: 0, y: 50, width: 55, height: 12, confidence: 95 },
    { text: 'Derivative', x: 60, y: 50, width: 70, height: 12, confidence: 95 },
    { text: '120', x: 180, y: 50, width: 22, height: 12, confidence: 95 },
  ]
  const candidates = extractOcrOutlineCandidates(words, 4, 300)
  assert.deepEqual(
    candidates.map(({ title, level, pageNumber }) => ({ title, level, pageNumber })),
    [
      { title: '5.2.9 Continuity', level: 2, pageNumber: 119 },
      { title: '5.2.10 Differentiability', level: 2, pageNumber: 119 },
      { title: '5.2.10.1 Derivative', level: 3, pageNumber: 120 },
    ],
  )
  const entries = buildOcrPdfOutlineEntries(candidates)
  assert.equal(entries.length, 3)
  assert.equal(entries[0]?.analysisSource, 'inferred')
  assert.equal(entries[1]?.pageNumber, 119)
  assert.equal(entries[0]?.level, 0)
  assert.equal(entries[1]?.level, 0)
  assert.equal(entries[2]?.level, 1)
  assert.equal(entries[2]?.parentPathKey, entries[1]?.pathKey)
})

test('OCR outline accepts English and Chinese chapter rows', () => {
  const candidates = extractOcrOutlineCandidates(
    [
      { text: 'Chapter', x: 0, y: 10, width: 50, height: 12, confidence: 95 },
      { text: '5', x: 55, y: 10, width: 10, height: 12, confidence: 95 },
      { text: 'Continuity', x: 70, y: 10, width: 65, height: 12, confidence: 95 },
      { text: '104', x: 180, y: 10, width: 22, height: 12, confidence: 95 },
      { text: '第六章', x: 0, y: 30, width: 50, height: 12, confidence: 95 },
      { text: '积分', x: 55, y: 30, width: 35, height: 12, confidence: 95 },
      { text: '150', x: 180, y: 30, width: 22, height: 12, confidence: 95 },
    ],
    3,
    300,
  )
  assert.deepEqual(
    candidates.map(({ title, level, pageNumber }) => ({ title, level, pageNumber })),
    [
      { title: 'Chapter 5 Continuity', level: 0, pageNumber: 104 },
      { title: '第六章 积分', level: 0, pageNumber: 150 },
    ],
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOcrPdfOutlineEntries,
  extractOcrOutlineCandidates,
  getActivePdfOutlineNodeId,
  normalizePdfOutlineText,
  repairPdfOutlineTitle,
  resolveOcrOutlineCandidatesWithPageLabels,
  resolveOcrOutlinePageNumber,
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
  assert.equal(normalizePdfOutlineText('Dﬀerentiability ﬁﬂow'), 'Dfferentiability fiflow')
  assert.equal(repairPdfOutlineTitle('Dﬀerentiability', []), 'Dfferentiability')
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
      { title: '5.2.9 Continuity', level: 2, pageNumber: 4 },
      { title: '5.2.10 Differentiability', level: 2, pageNumber: 4 },
      { title: '5.2.10.1 Derivative', level: 3, pageNumber: 4 },
    ],
  )
  const entries = buildOcrPdfOutlineEntries(candidates)
  assert.equal(entries.length, 3)
  assert.equal(entries[0]?.analysisSource, 'inferred')
  assert.equal(entries[1]?.pageNumber, 4)
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
      { title: 'Chapter 5 Continuity', level: 0, pageNumber: 3 },
      { title: '第六章 积分', level: 0, pageNumber: 3 },
    ],
  )
})

test('scanned OCR uses PDF sequence by default while retaining printed page metadata', () => {
  const words = [
    { text: '1', x: 0, y: 10, width: 10, height: 12, confidence: 95 },
    { text: 'Introduction', x: 20, y: 10, width: 80, height: 12, confidence: 95 },
    { text: '104', x: 180, y: 10, width: 22, height: 12, confidence: 95 },
  ]
  const [candidate] = extractOcrOutlineCandidates(words, 3, 300)
  assert.equal(candidate?.pageNumber, 3)
  assert.equal(candidate?.printedPageNumber, 104)
  assert.equal(candidate?.pageNumberSource, 'pdf-sequence')
  const [printedCandidate] = extractOcrOutlineCandidates(words, 3, 300, 'printed')
  assert.equal(printedCandidate?.pageNumber, 104)
  assert.equal(printedCandidate?.pageNumberSource, 'printed')
})

test('OCR slash is repaired only for dotted-leader page tokens', () => {
  const words = [
    { text: '1', x: 0, y: 10, width: 10, height: 12, confidence: 95 },
    { text: 'Overview', x: 20, y: 10, width: 60, height: 12, confidence: 95 },
    { text: '...', x: 100, y: 10, width: 24, height: 12, confidence: 95 },
    { text: '/', x: 180, y: 10, width: 8, height: 12, confidence: 95 },
    { text: 'A', x: 0, y: 30, width: 10, height: 12, confidence: 95 },
    { text: '/', x: 20, y: 30, width: 8, height: 12, confidence: 95 },
    { text: 'B', x: 35, y: 30, width: 10, height: 12, confidence: 95 },
  ]
  const [candidate] = extractOcrOutlineCandidates(words, 2, 20)
  assert.equal(candidate?.printedPageNumber, 1)
  assert.equal(candidate?.pageNumber, 2)
})

test('printed page resolution falls back safely when values are invalid', () => {
  assert.equal(
    resolveOcrOutlinePageNumber({
      sourcePageNumber: 3,
      printedPageNumber: 104,
      documentPageCount: 20,
    }),
    3,
  )
  assert.equal(
    resolveOcrOutlinePageNumber({
      sourcePageNumber: 0,
      printedPageNumber: 4,
      documentPageCount: 20,
    }),
    4,
  )
})

test('OCR outline destinations require an unambiguous PDF page-label mapping', () => {
  const candidates = extractOcrOutlineCandidates(
    [
      { text: '1', x: 0, y: 10, width: 10, height: 12, confidence: 95 },
      { text: 'Introduction', x: 20, y: 10, width: 80, height: 12, confidence: 95 },
      { text: '1', x: 180, y: 10, width: 10, height: 12, confidence: 95 },
      { text: '2', x: 0, y: 30, width: 10, height: 12, confidence: 95 },
      { text: 'Methods', x: 20, y: 30, width: 50, height: 12, confidence: 95 },
      { text: '2', x: 180, y: 30, width: 10, height: 12, confidence: 95 },
    ],
    3,
    6,
  )
  const mapped = resolveOcrOutlineCandidatesWithPageLabels(
    candidates,
    ['i', 'ii', 'iii', '1', '2', '3'],
    6,
  )
  assert.deepEqual(
    mapped?.map(({ pageNumber, pageNumberSource }) => ({ pageNumber, pageNumberSource })),
    [
      { pageNumber: 4, pageNumberSource: 'pdf-label' },
      { pageNumber: 5, pageNumberSource: 'pdf-label' },
    ],
  )
  assert.equal(resolveOcrOutlineCandidatesWithPageLabels(candidates, null, 6), null)
  assert.equal(
    resolveOcrOutlineCandidatesWithPageLabels(candidates, ['1', '1', '2', '3', '4', '5'], 6),
    null,
  )
})

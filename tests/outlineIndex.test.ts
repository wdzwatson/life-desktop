import assert from 'node:assert/strict'
import test from 'node:test'
import { createOutlineIndex } from '../src/services/outlineIndex.ts'

test('outline index builds deep path snapshots and prefers the deepest node at the same location', () => {
  const index = createOutlineIndex([
    {
      id: 'part',
      title: 'Part I',
      level: 0,
      pageStart: 1,
      yStart: 0.05,
      source: 'pdf',
    },
    {
      id: 'chapter-1',
      title: 'Chapter 1',
      level: 1,
      parentId: 'part',
      pageStart: 2,
      yStart: 0.1,
      source: 'pdf',
    },
    {
      id: 'section-1',
      title: 'Section 1.1',
      level: 2,
      parentId: 'chapter-1',
      pageStart: 2,
      yStart: 0.4,
      source: 'pdf',
    },
    {
      id: 'subsection-1',
      title: 'Subsection 1.1.1',
      level: 3,
      parentId: 'section-1',
      pageStart: 3,
      yStart: 0.1,
      source: 'pdf',
    },
    {
      id: 'detail-1',
      title: 'Detail 1.1.1.1',
      level: 4,
      parentId: 'subsection-1',
      pageStart: 3,
      yStart: 0.6,
      source: 'pdf',
    },
    {
      id: 'chapter-2',
      title: 'Chapter 2',
      level: 1,
      parentId: 'part',
      sortOrder: 1,
      pageStart: 7,
      yStart: 0.2,
      source: 'pdf',
    },
  ])

  assert.deepEqual(index.rootNodes.map((node) => node.id), ['part'])
  assert.deepEqual(index.childrenByParent.get('part')?.map((node) => node.id), [
    'chapter-1',
    'chapter-2',
  ])
  assert.deepEqual(index.flatIndex.map((node) => node.id), [
    'part',
    'chapter-1',
    'section-1',
    'subsection-1',
    'detail-1',
    'chapter-2',
  ])

  assert.equal(
    index.getPathSnapshot('detail-1')?.pathKey,
    '1-part-i/1-chapter-1/1-section-1-1/1-subsection-1-1-1/1-detail-1-1-1-1',
  )
  assert.deepEqual(index.getPathSnapshot('detail-1')?.nodes.map((node) => node.title), [
    'Part I',
    'Chapter 1',
    'Section 1.1',
    'Subsection 1.1.1',
    'Detail 1.1.1.1',
  ])

  assert.equal(index.findNodeAtPosition({ pageNumber: 3, y: 0.15 })?.id, 'subsection-1')
  assert.equal(index.findNodeAtPosition({ pageNumber: 3 })?.id, 'detail-1')
  assert.equal(index.findNodeAtPosition({ pageNumber: 7, y: 0.25 })?.id, 'chapter-2')

  const selection = index.resolveSelection([
    { pageNumber: 3, y: 0.15 },
    { pageNumber: 7, y: 0.25 },
  ])
  assert.equal(selection.startNode?.id, 'subsection-1')
  assert.equal(selection.endNode?.id, 'chapter-2')
  assert.equal(selection.startPath?.pathKey, '1-part-i/1-chapter-1/1-section-1-1/1-subsection-1-1-1')
  assert.equal(selection.endPath?.pathKey, '1-part-i/2-chapter-2')
  assert.equal(selection.pathKey, selection.startPath?.pathKey)
  assert.equal(selection.isCrossChapter, true)
})

test('outline index keeps page-only fallbacks stable and tolerates empty trees', () => {
  const pageOnlyIndex = createOutlineIndex([
    {
      id: 'page-1',
      title: 'Page 1',
      level: 0,
      pageStart: 1,
      yStart: null,
      source: 'pdf',
    },
  ])

  assert.equal(pageOnlyIndex.findNodeAtPosition({ pageNumber: 1, y: 0.5 })?.id, 'page-1')
  assert.equal(pageOnlyIndex.findNodeAtPosition({ pageNumber: 1 })?.id, 'page-1')
  assert.equal(pageOnlyIndex.getPathSnapshot('page-1')?.pathKey, '1-page-1')
  assert.deepEqual(pageOnlyIndex.resolveSelection([{ pageNumber: 1, y: 0.5 }]).startPath?.nodes.map((node) => node.title), ['Page 1'])

  const emptyIndex = createOutlineIndex([])
  assert.equal(emptyIndex.rootNodes.length, 0)
  assert.equal(emptyIndex.flatIndex.length, 0)
  assert.equal(emptyIndex.findNodeAtPosition({ pageNumber: 1, y: 0.2 }), null)
  assert.deepEqual(emptyIndex.resolveSelection([]), {
    startNode: null,
    endNode: null,
    startPath: null,
    endPath: null,
    pathKey: null,
    isCrossChapter: false,
  })
})

test('outline index handles very deep and cyclic parent chains without overflowing', () => {
  const deepNodes = Array.from({ length: 5_000 }, (_, index) => ({
    id: `level-${index}`,
    title: `Level ${index}`,
    level: index,
    parentId: index === 0 ? null : `level-${index - 1}`,
    pageStart: index + 1,
    source: 'pdf' as const,
  }))
  const deepIndex = createOutlineIndex(deepNodes)

  assert.equal(deepIndex.flatIndex.length, 5_000)
  assert.equal(deepIndex.getPathSnapshot('level-4999')?.nodes.length, 5_000)

  const cyclicIndex = createOutlineIndex([
    { id: 'a', title: 'A', parentId: 'b', source: 'pdf' },
    { id: 'b', title: 'B', parentId: 'a', source: 'pdf' },
    { id: 'child', title: 'Child', parentId: 'b', source: 'pdf' },
  ])
  assert.equal(cyclicIndex.rootNodes.length, 1)
  assert.equal(cyclicIndex.pathSnapshotsById.size, 3)
  assert.deepEqual(cyclicIndex.getPathSnapshot('child')?.nodes.map((node) => node.title), [
    'A',
    'B',
    'Child',
  ])
})

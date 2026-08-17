import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildReaderOutlineTree,
  getReaderOutlineAncestorIds,
} from '../src/components/ReaderOutlineDrawer.tsx'

test('reader outline tree preserves arbitrary depth and explicit parent identity', () => {
  const nodes = Array.from({ length: 6 }, (_, level) => ({
    id: `level-${level}`,
    title: `Level ${level}`,
    level,
    parentId: level === 0 ? null : `level-${level - 1}`,
  }))
  const model = buildReaderOutlineTree(nodes)

  assert.deepEqual(model.roots.map((node) => node.id), ['level-0'])
  assert.deepEqual(model.childrenByParent.get('level-4')?.map((node) => node.id), ['level-5'])
  assert.deepEqual(getReaderOutlineAncestorIds('level-5', model.parentById), [
    'level-0',
    'level-1',
    'level-2',
    'level-3',
    'level-4',
  ])
})

test('reader outline tree infers parents from levels and attaches malformed entries safely', () => {
  const model = buildReaderOutlineTree([
    { id: 'part', title: 'Part', level: 0 },
    { id: 'chapter', title: 'Chapter', level: 1 },
    { id: 'section', title: 'Section', level: 2 },
    { id: 'peer', title: 'Peer chapter', level: 1 },
    { id: 'orphan', title: 'Orphan', level: 3, parentId: 'missing' },
    { id: 'part', title: 'Duplicate', level: 0 },
  ])

  assert.equal(model.nodes.length, 5)
  assert.equal(model.parentById.get('chapter'), 'part')
  assert.equal(model.parentById.get('section'), 'chapter')
  assert.equal(model.parentById.get('peer'), 'part')
  assert.equal(model.parentById.get('orphan'), 'peer')
  assert.deepEqual(getReaderOutlineAncestorIds('orphan', model.parentById), ['part', 'peer'])
})

test('reader outline ancestor lookup stops safely at malformed cycles', () => {
  const parents = new Map<string, string | null>([
    ['a', 'b'],
    ['b', 'a'],
    ['leaf', 'a'],
  ])

  assert.deepEqual(getReaderOutlineAncestorIds('leaf', parents), ['b', 'a'])
})

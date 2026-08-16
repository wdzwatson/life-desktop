import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPdfOutline } from '../src/services/pdfOutlineAdapter.ts'

test('pdf outline adapter flattens nested items and resolves named destinations', async () => {
  const page1Ref = { ref: 'page-1' }
  const page2Ref = { ref: 'page-2' }
  const page3Ref = { ref: 'page-3' }
  const pageMap = new Map<any, number>([
    [page1Ref, 0],
    [page2Ref, 1],
    [page3Ref, 2],
  ])

  const pdfDocument = {
    async getOutline() {
      return [
        {
          title: 'Part I',
          bold: true,
          italic: false,
          color: new Uint8ClampedArray(),
          dest: 'part-one',
          url: null,
          unsafeUrl: undefined,
          newWindow: undefined,
          count: 2,
          items: [
            {
              title: 'Chapter 1',
              bold: false,
              italic: false,
              color: new Uint8ClampedArray(),
              dest: [page2Ref, 'XYZ', 0, 640, null],
              url: null,
              unsafeUrl: undefined,
              newWindow: undefined,
              count: 1,
              items: [
                {
                  title: 'Section 1.1',
                  bold: false,
                  italic: false,
                  color: new Uint8ClampedArray(),
                  dest: [page3Ref, 'XYZ', 0, 520, null],
                  url: null,
                  unsafeUrl: undefined,
                  newWindow: undefined,
                  count: 0,
                  items: [],
                },
              ],
            },
          ],
        },
      ]
    },
    async getDestination(name: string) {
      if (name !== 'part-one') return null
      return [page1Ref, 'XYZ', 0, 700, null]
    },
    async getPageIndex(pageRef: { ref: string }) {
      const value = pageMap.get(pageRef)
      if (value === undefined) throw new Error('missing page ref')
      return value
    },
  }

  const result = await loadPdfOutline(pdfDocument)

  assert.equal(result.status, 'ready')
  assert.equal(result.entries.length, 3)
  assert.deepEqual(
    result.entries.map((entry) => ({
      title: entry.title,
      level: entry.level,
      pageNumber: entry.pageNumber,
      parentPathKey: entry.parentPathKey,
    })),
    [
      { title: 'Part I', level: 0, pageNumber: 1, parentPathKey: null },
      { title: 'Chapter 1', level: 1, pageNumber: 2, parentPathKey: '1-part-i' },
      {
        title: 'Section 1.1',
        level: 2,
        pageNumber: 3,
        parentPathKey: '1-part-i/1-chapter-1',
      },
    ],
  )
  assert.equal(result.entries[2]?.resolved, true)
})

test('pdf outline adapter reports empty and error outlines without throwing', async () => {
  const emptyResult = await loadPdfOutline({
    async getOutline() {
      return []
    },
    async getDestination() {
      return null
    },
    async getPageIndex() {
      return 0
    },
  })
  assert.equal(emptyResult.status, 'empty')

  const errorResult = await loadPdfOutline({
    async getOutline() {
      throw new Error('outline failed')
    },
    async getDestination() {
      return null
    },
    async getPageIndex() {
      return 0
    },
  })
  assert.equal(errorResult.status, 'error')
  assert.match(errorResult.error || '', /outline failed/)
})

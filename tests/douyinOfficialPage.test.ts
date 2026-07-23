import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
import { DouyinOfficialPageObserver } from '../electron/video/douyinOfficialPage.ts'

test('official page observer classifies each visible favorite by its link type', async () => {
  let injectedScript = ''
  const page = {
    executeJavaScript: async (script: string) => {
      injectedScript = script
      return {
      entries: [
        {
          remoteId: '123',
          title: 'Useful video',
          authorName: 'Author',
          thumbnailUrl: 'https://p3.douyinpic.com/cover.jpg',
          favoriteAddedAt: '2026-07-24T08:00:00.000Z',
          sourceUrl: 'https://www.douyin.com/video/123',
        },
        { remoteId: '456', title: 'A note', sourceUrl: 'https://www.douyin.com/note/456' },
        { remoteId: '789', title: 'An article', sourceUrl: 'https://www.douyin.com/article/789' },
        { remoteId: '123', title: 'Duplicate', sourceUrl: 'https://www.douyin.com/video/123' },
      ],
      hasMore: false,
      complete: true,
      stopReason: 'explicit_end',
      }
    },
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)
  await observer.start()

  assert.deepEqual(await observer.listFavoriteVideos({}), {
    entries: [
      {
        remoteId: '123',
        title: 'Useful video',
        authorName: 'Author',
        thumbnailUrl: 'https://p3.douyinpic.com/cover.jpg',
        favoriteAddedAt: '2026-07-24T08:00:00.000Z',
        sourceUrl: 'https://www.douyin.com/video/123',
        contentType: 'video',
      },
      {
        remoteId: '456',
        title: 'A note',
        sourceUrl: 'https://www.douyin.com/note/456',
        contentType: 'note',
      },
      {
        remoteId: '789',
        title: 'An article',
        sourceUrl: 'https://www.douyin.com/article/789',
        contentType: 'article',
      },
    ],
    hasMore: false,
    complete: true,
    stopReason: 'explicit_end',
    isNewestFirst: true,
  })
  assert.equal(injectedScript.includes('(video|note|article)'), true)
  observer.stop()
})

test('official page observer scans only the 视频 tab for the unified collection', async () => {
  let injectedScript = ''
  const page = {
    executeJavaScript: async (script: string) => {
      injectedScript = script
      return {
      entries: [
        {
          remoteId: '789',
          title: 'Useful article',
          authorName: 'Author',
          thumbnailUrl: 'https://p3.douyinpic.com/note-cover.jpg',
          sourceUrl: 'https://www.douyin.com/article/789',
        },
      ],
      hasMore: false,
      complete: true,
      stopReason: 'explicit_end',
      }
    },
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)

  assert.deepEqual(await observer.listFavoriteItems({}), {
    entries: [
      {
        remoteId: '789',
        title: 'Useful article',
        authorName: 'Author',
        thumbnailUrl: 'https://p3.douyinpic.com/note-cover.jpg',
        sourceUrl: 'https://www.douyin.com/article/789',
        contentType: 'article',
      },
    ],
    hasMore: false,
    complete: true,
    stopReason: 'explicit_end',
    isNewestFirst: true,
  })
  assert.equal(injectedScript.includes('["视频"]'), true)
  assert.equal(injectedScript.includes('图文'), false)
})

test('official page observer logs titles for visible cards with unsupported links', async () => {
  const page = {
    executeJavaScript: async () => ({
      entries: [],
      skippedCandidates: [{ title: 'Unsupported favorite', reason: 'unsupported_url' }],
      hasMore: false,
      complete: true,
      stopReason: 'source_end',
    }),
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)
  const warning = console.warn
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => warnings.push(args)
  try {
    await observer.listFavoriteItems({})
  } finally {
    console.warn = warning
    observer.stop()
  }

  assert.deepEqual(warnings, [
    [
      '[DouyinSync] skipped unsynchronized favorite candidate',
      { title: 'Unsupported favorite', contentType: 'unknown', reason: 'unsupported_url' },
    ],
  ])
})

test('official page observer treats an unverified end as partial', async () => {
  const page = {
    executeJavaScript: async () => ({
      entries: [{ remoteId: '123', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' }],
      hasMore: false,
    }),
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)
  await observer.start()

  const result = await observer.listFavoriteVideos({})
  assert.equal(result.complete, false)
  assert.equal(result.hasMore, false)
  assert.equal(result.stopReason, 'source_uncertain')
  observer.stop()
})

test('official page observer stops a source when scrolling produces no new unique works', async () => {
  const page = {
    executeJavaScript: async () => ({
      entries: [
        { remoteId: '123', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' },
      ],
      hasMore: true,
      complete: false,
      stopReason: 'round_limit',
    }),
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)

  await observer.listFavoriteVideos({})
  assert.deepEqual(await observer.listFavoriteVideos({ cursor: '1' }), {
    entries: [],
    hasMore: false,
    complete: false,
    stopReason: 'no_new_items',
    isNewestFirst: true,
  })
})

test('official page observer treats a reached scroll boundary as a complete source end', async () => {
  const page = {
    executeJavaScript: async () => ({
      entries: [
        { remoteId: '123', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' },
      ],
      hasMore: false,
      complete: true,
      stopReason: 'source_end',
    }),
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)
  await observer.start()

  const result = await observer.listFavoriteVideos({})
  assert.equal(result.complete, true)
  assert.equal(result.hasMore, false)
  assert.equal(result.stopReason, 'source_end')
  observer.stop()
})

test('official page observer emits only unseen videos while scrolling', async () => {
  let pageCall = 0
  const page = {
    executeJavaScript: async () => {
      pageCall += 1
      return {
        entries: [
          { remoteId: '123', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' },
        ],
        hasMore: pageCall < 3,
      }
    },
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)
  await observer.start()

  const first = await observer.listFavoriteVideos({})
  const second = await observer.listFavoriteVideos({ cursor: first.cursor })
  assert.equal(first.entries.length, 1)
  assert.equal(second.entries.length, 0)
  assert.equal(second.hasMore, false)
  assert.equal(second.complete, false)
  assert.equal(second.stopReason, 'no_new_items')
  observer.stop()
})

test('official page observer bounds a stalled page action instead of waiting indefinitely', async () => {
  const page = {
    executeJavaScript: async () => new Promise(() => undefined),
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page, undefined, { actionMs: 5 })
  await observer.start()

  await assert.rejects(
    observer.listFavoriteVideos({}),
    /did not load the visible favorite video list/,
  )
  observer.stop()
})

test('official page observer bounds a stalled login check instead of waiting indefinitely', async () => {
  const page = {
    executeJavaScript: async () => new Promise(() => undefined),
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page, undefined, { actionMs: 5 })
  await observer.start()

  await assert.rejects(observer.isLoggedIn(), /did not complete the login check/)
  observer.stop()
})

test('official page observer reports page readiness without requiring a debugger', async () => {
  const diagnostics = []
  const page = {
    executeJavaScript: async () => true,
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page, (event) => diagnostics.push(event))
  await observer.start()

  observer.notifyPageReady()
  assert.deepEqual(diagnostics, [{ kind: 'page_ready' }])
  observer.stop()
})

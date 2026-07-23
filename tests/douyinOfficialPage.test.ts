import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
import { DouyinOfficialPageObserver } from '../electron/video/douyinOfficialPage.ts'

test('official page observer keeps only visible Douyin video favorites', async () => {
  const page = {
    executeJavaScript: async () => ({
      entries: [
        {
          remoteId: '123',
          title: 'Useful video',
          authorName: 'Author',
          thumbnailUrl: 'https://p3.douyinpic.com/cover.jpg',
          sourceUrl: 'https://www.douyin.com/video/123',
        },
        { remoteId: 'note-1', title: 'A note', sourceUrl: 'https://www.douyin.com/note/456' },
        { remoteId: '123', title: 'Duplicate', sourceUrl: 'https://www.douyin.com/video/123' },
      ],
      hasMore: false,
      complete: true,
      stopReason: 'explicit_end',
    }),
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
        sourceUrl: 'https://www.douyin.com/video/123',
        contentType: 'video',
      },
    ],
    hasMore: false,
    complete: true,
    stopReason: 'explicit_end',
    isNewestFirst: true,
  })
  observer.stop()
})

test('official page observer reads visible Douyin image-text favorites from the 图文 tab', async () => {
  const page = {
    executeJavaScript: async () => ({
      entries: [
        {
          remoteId: '456',
          title: 'Useful image-text post',
          authorName: 'Author',
          thumbnailUrl: 'https://p3.douyinpic.com/note-cover.jpg',
          sourceUrl: 'https://www.douyin.com/note/456',
        },
      ],
      hasMore: false,
      complete: true,
      stopReason: 'explicit_end',
    }),
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)

  assert.deepEqual(await observer.listFavoriteNotes({}), {
    entries: [
      {
        remoteId: '456',
        title: 'Useful image-text post',
        authorName: 'Author',
        thumbnailUrl: 'https://p3.douyinpic.com/note-cover.jpg',
        sourceUrl: 'https://www.douyin.com/note/456',
        contentType: 'note',
      },
    ],
    hasMore: false,
    complete: true,
    stopReason: 'explicit_end',
    isNewestFirst: true,
  })
})

test('official page observer treats an unverified end as partial', async () => {
  const page = {
    executeJavaScript: async () => ({
      entries: [
        { remoteId: '123', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' },
      ],
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
  assert.equal(second.hasMore, true)
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

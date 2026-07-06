import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeBilibiliHtmlMetadata } from '../electron/video/bilibiliFallback.ts'

const html = String.raw`<!DOCTYPE html>
<html>
  <head>
    <script>
      window.__INITIAL_STATE__={"aid":116782207605630,"bvid":"BV1G7jJ6nEbV","cid":39265896404,"videoData":{"bvid":"BV1G7jJ6nEbV","aid":116782207605630,"videos":1,"pic":"http:\u002F\u002Fi1.hdslb.com\u002Fbfs\u002Farchive\u002F26d2d0b1296534c91ba758076ba33b2ec047e340.jpg","title":"【漫士】单位距离猜想攻破详解：人类数学家离失业还有多远？","duration":2020,"pages":[{"cid":39265896404,"page":1,"part":"【漫士】单位距离猜想攻破详解：人类数学家离失业还有多远？","duration":2020}]}};(function(){})()
    </script>
  </head>
</html>`

const multipartHtml = String.raw`<!DOCTYPE html>
<html>
  <head>
    <script>
      window.__INITIAL_STATE__={"aid":1,"bvid":"BV1QFTb6nE4L","cid":101,"videoData":{"bvid":"BV1QFTb6nE4L","aid":1,"videos":2,"pic":"http:\u002F\u002Fi1.hdslb.com\u002Fbfs\u002Farchive\u002Fcover.jpg","title":"合集标题","duration":600,"pages":[{"cid":101,"page":1,"part":"第1季「第01集」","duration":300},{"cid":102,"page":2,"part":"第1季「第02集」","duration":300}]}};(function(){})()
    </script>
  </head>
</html>`

test('normalizes Bilibili page HTML when yt-dlp metadata is blocked by 412', () => {
  const result = normalizeBilibiliHtmlMetadata(html, {
    fallbackUrl:
      'https://www.bilibili.com/video/BV1G7jJ6nEbV/?spm_id_from=333.1007.tianma.1-3-3.click&vd_source=f42340e3bdb93c782818cf08ede22786',
  })

  assert.equal(result.kind, 'single')
  assert.equal(result.source, 'bilibili')
  assert.equal(result.sourceId, 'BV1G7jJ6nEbV')
  assert.equal(result.title, '【漫士】单位距离猜想攻破详解：人类数学家离失业还有多远？')
  assert.equal(result.sourceUrl, 'https://www.bilibili.com/video/BV1G7jJ6nEbV/')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].durationSeconds, 2020)
  assert.equal(result.items[0].sourceCid, '39265896404')
  assert.equal(
    result.items[0].thumbnailUrl,
    'http://i1.hdslb.com/bfs/archive/26d2d0b1296534c91ba758076ba33b2ec047e340.jpg',
  )
  assert.equal(result.diagnostics[0].code, 'ok')
})

test('normalizes Bilibili multipart first page to an explicit p=1 item url', () => {
  const result = normalizeBilibiliHtmlMetadata(multipartHtml, {
    fallbackUrl: 'https://www.bilibili.com/video/BV1QFTb6nE4L/',
  })

  assert.equal(result.kind, 'playlist')
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].title, '第1季「第01集」')
  assert.equal(result.items[0].partIndex, 1)
  assert.equal(result.items[0].sourceCid, '101')
  assert.equal(result.items[0].sourceUrl, 'https://www.bilibili.com/video/BV1QFTb6nE4L/?p=1')
  assert.equal(result.items[1].sourceCid, '102')
  assert.equal(result.items[1].sourceUrl, 'https://www.bilibili.com/video/BV1QFTb6nE4L/?p=2')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getNoteImageResizeDragDimensions,
  renderSizedNoteImages,
  updateNoteImageDimensions,
} from '../src/views/noteImageSizing'

const imageUrl = 'life-note-asset://attachment/pasted-image.png'

test('sized note images render with controlled dimensions', () => {
  const html = renderSizedNoteImages(`![Pasted image](${imageUrl}){width=480 height=320}`)

  assert.match(html, /data-note-image="true"/)
  assert.match(html, /width: 480px/)
  assert.match(html, /data-note-height="320"/)
  assert.match(html, /height: auto/)
})

test('image dimensions are persisted, constrained, and can be reset', () => {
  const markdown = `![Pasted image](${imageUrl})`
  const sized = updateNoteImageDimensions(markdown, { url: imageUrl, width: 9999, height: 1 })

  assert.equal(sized, `![Pasted image](${imageUrl}){width=4096 height=48}`)
  assert.equal(
    updateNoteImageDimensions(sized, { url: imageUrl, width: 300, height: 200 }, true),
    markdown,
  )
})

test('drag resizing grows and shrinks from the starting image size', () => {
  assert.deepEqual(
    getNoteImageResizeDragDimensions({
      startWidth: 480,
      startHeight: 320,
      deltaX: 80,
      deltaY: 10,
      maxWidth: 900,
    }),
    { width: 560, height: 373 },
  )
  assert.deepEqual(
    getNoteImageResizeDragDimensions({
      startWidth: 480,
      startHeight: 320,
      deltaX: -80,
      deltaY: -10,
      maxWidth: 900,
    }),
    { width: 400, height: 267 },
  )
  assert.deepEqual(
    getNoteImageResizeDragDimensions({
      startWidth: 480,
      startHeight: 320,
      deltaX: 600,
      deltaY: 600,
      maxWidth: 640,
    }),
    { width: 640, height: 427 },
  )
})

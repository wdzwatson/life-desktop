import assert from 'node:assert/strict'
import test from 'node:test'
import {
  renderSizedNoteImages,
  updateNoteImageDimensions,
} from '../src/views/noteImageSizing'

const imageUrl = 'life-note-asset://attachment/pasted-image.png'

test('sized note images render with controlled dimensions', () => {
  const html = renderSizedNoteImages(`![Pasted image](${imageUrl}){width=480 height=320}`)

  assert.match(html, /data-note-image="true"/)
  assert.match(html, /width: 480px/)
  assert.match(html, /height: 320px/)
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

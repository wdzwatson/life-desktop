import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getNoteAssetUrl, handleNoteAssetProtocolRequest } from '../electron/noteAssetProtocol.ts'

test('note asset protocol serves managed attachments and correctly encodes their URLs', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-note-asset-'))
  try {
    const notesDir = path.join(root, 'notes')
    mkdirSync(notesDir)
    writeFileSync(path.join(notesDir, 'pasted image.png'), 'image-data')

    const url = getNoteAssetUrl('pasted image.png')
    assert.equal(url, 'life-note-asset://attachment/pasted%20image.png')
    const response = await handleNoteAssetProtocolRequest({
      request: new Request(url),
      filesRoot: root,
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(await response.text(), 'image-data')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('note asset protocol rejects path traversal and non-read methods', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-note-asset-'))
  try {
    mkdirSync(path.join(root, 'notes'))
    writeFileSync(path.join(root, 'outside.txt'), 'outside')

    const traversalResponse = await handleNoteAssetProtocolRequest({
      request: new Request('life-note-asset://attachment/%2E%2E%2Foutside.txt'),
      filesRoot: root,
    })
    const methodResponse = await handleNoteAssetProtocolRequest({
      request: new Request('life-note-asset://attachment/example.txt', { method: 'POST' }),
      filesRoot: root,
    })

    assert.equal(getNoteAssetUrl('../outside.txt'), undefined)
    assert.equal(getNoteAssetUrl('nested/example.txt'), undefined)
    assert.equal(getNoteAssetUrl('example.txt:alternate-stream'), undefined)
    assert.equal(traversalResponse.status, 404)
    assert.equal(methodResponse.status, 405)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

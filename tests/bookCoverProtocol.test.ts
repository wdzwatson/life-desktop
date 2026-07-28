import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { handleBookCoverProtocolRequest } from '../electron/bookCoverProtocol.ts'

test('book cover protocol serves supported cover images inside the user cover directory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-book-cover-'))
  try {
    const coversDir = path.join(root, 'book-covers')
    mkdirSync(coversDir)
    writeFileSync(path.join(coversDir, 'cover.png'), 'cover-data')

    const response = await handleBookCoverProtocolRequest({
      request: new Request('life-book-cover://cover/cover.png'),
      filesRoot: root,
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(await response.text(), 'cover-data')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('book cover protocol rejects paths outside the managed cover directory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-book-cover-'))
  try {
    mkdirSync(path.join(root, 'book-covers'))
    writeFileSync(path.join(root, 'outside.png'), 'not-a-cover')

    const response = await handleBookCoverProtocolRequest({
      request: new Request('life-book-cover://cover/%2E%2E%2Foutside.png'),
      filesRoot: root,
    })

    assert.equal(response.status, 404)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

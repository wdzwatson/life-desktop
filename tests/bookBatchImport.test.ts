import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import {
  buildBatchImportItems,
  createManagedBookCover,
  extractEpubCover,
  extractPdfFirstPageCover,
  importBookBatch,
} from '../electron/bookBatchImport.ts'

function createEpubWithCover(filePath: string) {
  const zip = new AdmZip()
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`),
  )
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0"?><package><metadata><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="images/cover.png" media-type="image/png"/></manifest></package>`),
  )
  zip.addFile('OEBPS/images/cover.png', Buffer.from('embedded-cover'))
  zip.writeZip(filePath)
}

function createSimplePdf(filePath: string) {
  const content = '0.2 0.4 0.8 rg\n0 0 400 600 re\nf\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Contents 4 0 R /Resources << >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream\nendobj\n`,
  ]
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  let output = header
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output, 'binary'))
    output += object
  }
  const xrefOffset = Buffer.byteLength(output, 'binary')
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  writeFileSync(filePath, Buffer.from(output, 'binary'))
}

test('batch import matches covers by normalized filename and flags duplicates', () => {
  const items = buildBatchImportItems({
    bookPaths: ['/source/《三体》.epub', '/source/Three Body.pdf', '/source/Three Body.pdf'],
    coverPaths: ['/covers/三体.png', '/covers/Three Body.jpg'],
    existingBookFileNames: ['/books/already.epub'],
  })

  assert.equal(items[0].coverFileName, '三体.png')
  assert.equal(items[1].coverFileName, 'Three Body.jpg')
  assert.equal(items[2].duplicateReason, 'duplicate-in-queue')
})

test('EPUB embedded cover is extracted from the package manifest', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-epub-cover-'))
  try {
    const epubPath = path.join(root, 'Example.epub')
    createEpubWithCover(epubPath)
    const cover = extractEpubCover(epubPath)
    assert.equal(cover?.extension, '.png')
    assert.equal(cover?.data.toString('utf8'), 'embedded-cover')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('PDF first page is rendered into a PNG cover image', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-pdf-cover-'))
  try {
    const pdfPath = path.join(root, 'Example.pdf')
    createSimplePdf(pdfPath)
    const cover = await extractPdfFirstPageCover(pdfPath)
    assert.equal(cover?.extension, '.png')
    assert.deepEqual([...cover!.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('managed cover creation extracts the cover for a single EPUB import', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-single-book-cover-'))
  try {
    const epubPath = path.join(root, 'Example.epub')
    createEpubWithCover(epubPath)
    const coverPath = await createManagedBookCover({
      sourcePath: epubPath,
      format: 'EPUB',
      filesRoot: root,
    })
    assert.ok(coverPath)
    assert.equal(readFileSync(path.join(root, coverPath!.replace(/^\//, '')), 'utf8'), 'embedded-cover')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('batch import persists a book and managed cover, while skipping existing book filenames', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-book-batch-'))
  const sourceDir = path.join(root, 'source')
  mkdirSync(sourceDir)
  const bookPath = path.join(sourceDir, 'Dune.epub')
  const coverPath = path.join(sourceDir, 'Dune.webp')
  writeFileSync(bookPath, 'book-content')
  writeFileSync(coverPath, 'cover-content')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      path TEXT NOT NULL,
      cover TEXT,
      cover_path TEXT,
      category TEXT,
      progress REAL,
      status TEXT
    );
  `)

  try {
    const items = buildBatchImportItems({ bookPaths: [bookPath], coverPaths: [coverPath] })
    const results = await importBookBatch({
      db,
      filesRoot: root,
      category: '技术',
      unknownAuthor: '未知作者',
      items,
    })
    assert.equal(results[0].status, 'success')
    const imported = db.prepare('SELECT title, author, path, cover, cover_path, category FROM books').get() as any
    assert.deepEqual(
      { ...imported, cover_path: typeof imported.cover_path === 'string' },
      {
        title: 'Dune',
        author: '未知作者',
        path: '/books/Dune.epub',
        cover: 'EPUB',
        cover_path: true,
        category: '技术',
      },
    )
    assert.equal(readFileSync(path.join(root, 'books', 'Dune.epub'), 'utf8'), 'book-content')
    assert.ok(existsSync(path.join(root, imported.cover_path.replace(/^\//, ''))))

    const repeated = await importBookBatch({
      db,
      filesRoot: root,
      category: '技术',
      unknownAuthor: '未知作者',
      items,
    })
    assert.equal(repeated[0].status, 'skipped')
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('cover import priority is external image, then EPUB cover, then PDF first page', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-book-cover-priority-'))
  const sourceDir = path.join(root, 'source')
  mkdirSync(sourceDir)
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      path TEXT NOT NULL,
      cover TEXT,
      cover_path TEXT,
      category TEXT,
      progress REAL,
      status TEXT
    );
  `)
  try {
    const embeddedEpubPath = path.join(sourceDir, 'Embedded.epub')
    const externalEpubPath = path.join(sourceDir, 'External.epub')
    const externalCoverPath = path.join(sourceDir, 'External.png')
    const pdfPath = path.join(sourceDir, 'First Page.pdf')
    createEpubWithCover(embeddedEpubPath)
    createEpubWithCover(externalEpubPath)
    writeFileSync(externalCoverPath, 'external-cover')
    createSimplePdf(pdfPath)

    const results = await importBookBatch({
      db,
      filesRoot: root,
      category: '未分类',
      unknownAuthor: '未知作者',
      items: buildBatchImportItems({
        bookPaths: [embeddedEpubPath, externalEpubPath, pdfPath],
        coverPaths: [externalCoverPath],
      }),
    })
    assert.deepEqual(results.map((result) => result.status), ['success', 'success', 'success'])
    const rows = db.prepare('SELECT title, cover_path FROM books ORDER BY id').all() as Array<any>
    assert.equal(readFileSync(path.join(root, rows[0].cover_path.replace(/^\//, '')), 'utf8'), 'embedded-cover')
    assert.equal(readFileSync(path.join(root, rows[1].cover_path.replace(/^\//, '')), 'utf8'), 'external-cover')
    assert.deepEqual(
      [...readFileSync(path.join(root, rows[2].cover_path.replace(/^\//, ''))).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    )
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

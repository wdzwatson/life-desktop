import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyPdfAsync } from '@firecrawl/pdf-inspector'
import AdmZip from 'adm-zip'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { loadPdfOutline } from '../src/services/pdfOutlineAdapter.ts'

const assetUrl = (name: string) =>
  new URL(`../docs/archive/qa/assets/reader-at15/${name}`, import.meta.url)

test('AT-15 PDF fixtures expose text, scanned, and mixed OCR classifications', async () => {
  const cases = [
    ['at15-multicolumn-deep-outline.pdf', 'TextBased', []],
    ['at15-scanned.pdf', 'Scanned', [0]],
    ['at15-mixed.pdf', 'Mixed', [1]],
  ] as const

  for (const [name, expectedType, expectedOcrPages] of cases) {
    const classification = await classifyPdfAsync(readFileSync(assetUrl(name)))
    assert.equal(classification.pdfType, expectedType, name)
    assert.deepEqual(classification.pagesNeedingOcr, expectedOcrPages, name)
  }
})

test('AT-15 hidden OCR fixture renders an image while exposing invisible text', async () => {
  const data = new Uint8Array(readFileSync(assetUrl('at15-hidden-ocr.pdf')))
  const loadingTask = getDocument({ data, disableWorker: true })
  const document = await loadingTask.promise
  try {
    const page = await document.getPage(1)
    const textContent = await page.getTextContent()
    const operatorList = await page.getOperatorList()
    const extractedText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')

    assert.match(extractedText, /invisible OCR text layer/)
    assert.ok(
      operatorList.fnArray.some(
        (operator) =>
          operator === OPS.paintImageXObject || operator === OPS.paintInlineImageXObject,
      ),
    )
  } finally {
    await document.destroy()
  }
})

test('AT-15 multicolumn PDF preserves an eight-level native PDF.js outline', async () => {
  const loadingTask = getDocument({
    data: new Uint8Array(readFileSync(assetUrl('at15-multicolumn-deep-outline.pdf'))),
    disableWorker: true,
  })
  const document = await loadingTask.promise
  try {
    const result = await loadPdfOutline(document)
    assert.equal(document.numPages, 8)
    assert.equal(result.status, 'ready')
    assert.equal(result.entries.length, 8)
    assert.deepEqual(
      result.entries.map((entry) => entry.level),
      [0, 1, 2, 3, 4, 5, 6, 7],
    )
    assert.equal(result.entries.at(-1)?.pathKey.split('/').length, 8)
    assert.deepEqual(
      result.entries.map((entry) => entry.pageNumber),
      [1, 2, 3, 4, 5, 6, 7, 8],
    )
  } finally {
    await document.destroy()
  }
})

test('AT-15 corrupt PDF is rejected by both analysis and rendering paths', async () => {
  const data = readFileSync(assetUrl('at15-corrupt.pdf'))
  await assert.rejects(() => classifyPdfAsync(data), /PDF|structure|parse|invalid/i)
  await assert.rejects(
    () => getDocument({ data: new Uint8Array(data), disableWorker: true }).promise,
    /PDF|document|invalid|missing/i,
  )
})

test('AT-15 EPUB fixture is a valid EPUB3 package with an eight-level navigation tree', () => {
  const archive = new AdmZip(readFileSync(assetUrl('at15-deep-outline.epub')))
  const entries = archive.getEntries()
  assert.equal(entries[0]?.entryName, 'mimetype')
  assert.equal(entries[0]?.header.method, 0)
  assert.equal(archive.readAsText('mimetype'), 'application/epub+zip')

  const container = archive.readAsText('META-INF/container.xml')
  const packageXml = archive.readAsText('OEBPS/content.opf')
  const navigation = archive.readAsText('OEBPS/nav.xhtml')
  assert.match(container, /full-path="OEBPS\/content\.opf"/)
  assert.match(packageXml, /version="3\.0"/)
  assert.equal((packageXml.match(/<itemref\b/g) ?? []).length, 8)
  assert.equal(entries.filter((entry) => /^OEBPS\/chapter-\d+\.xhtml$/.test(entry.entryName)).length, 8)
  assert.equal((navigation.match(/<ol>/g) ?? []).length, 8)
  assert.equal((navigation.match(/<li>/g) ?? []).length, 8)
  for (let level = 1; level <= 8; level += 1) {
    assert.match(navigation, new RegExp(`href="chapter-${level}\\.xhtml"`))
  }
})

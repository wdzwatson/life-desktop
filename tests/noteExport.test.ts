import assert from 'node:assert/strict'
import test from 'node:test'
import AdmZip from 'adm-zip'
import {
  buildNoteExportHtml,
  NOTE_EXPORT_STYLES,
} from '../electron/noteExport.ts'
import { buildNoteExportDocx } from '../electron/noteDocxExport.ts'

test('note export wrapper preserves semantic annotation markup and deep hierarchy', () => {
  const content = [
    '<h3>Part I</h3>',
    '<h6>Level 4</h6>',
    '<ul><li>Level 5<ul><li>Level 6<ul><li>Level 7</li></ul></li></ul></li></ul>',
    '<article class="reader-export-annotation is-translation" data-reader-annotation-kind="translation">',
    '<span class="reader-export-annotation__icon">T</span>',
    '<a href="book:7#annotation:ann-1">Source</a>',
    '</article>',
  ].join('')
  const html = buildNoteExportHtml('A <Book>', content)

  assert.match(html, /<title>A &lt;Book&gt;<\/title>/)
  assert.match(html, /<ul><li>Level 5<ul><li>Level 6/)
  assert.match(html, /data-reader-annotation-kind="translation"/)
  assert.match(html, /href="book:7#annotation:ann-1"/)
  assert.match(NOTE_EXPORT_STYLES, /\.reader-export-annotation\.is-translation/)
  assert.match(NOTE_EXPORT_STYLES, /\.reader-export-annotation\.is-underline/)
  assert.match(NOTE_EXPORT_STYLES, /\.reader-export-annotation\.is-note/)
})

test('Word export creates a real DOCX package with deep annotation content', async () => {
  const buildDeepList = (level: number): string =>
    level > 15 ? '' : `<ul><li>Level ${level}${buildDeepList(level + 1)}</li></ul>`
  const html = buildNoteExportHtml(
    'DOCX Notes',
    [
      '<h6>Level 4</h6>',
      buildDeepList(5),
      '<article class="reader-export-annotation is-translation"><p>Translated text</p></article>',
      '<article class="reader-export-annotation is-underline"><p>Underlined text</p></article>',
      '<article class="reader-export-annotation is-note">',
      '<span class="reader-export-annotation__icon">N</span>',
      '<p>Source annotation <a href="book:7#annotation:ann-1">Open source</a></p>',
      '</article>',
    ].join(''),
  )
  const buffer = await buildNoteExportDocx('DOCX Notes', html)
  const archive = new AdmZip(buffer)
  const contentTypes = archive.readAsText('[Content_Types].xml')
  const documentXml = archive.readAsText('word/document.xml')
  const relationshipsXml = archive.readAsText('word/_rels/document.xml.rels')

  assert.match(contentTypes, /wordprocessingml\.document\.main\+xml/)
  assert.match(documentXml, /DOCX Notes/)
  assert.match(documentXml, /Level 6/)
  assert.match(documentXml, /Level 15/)
  assert.match(documentXml, /w:left="4320"/)
  assert.match(documentXml, /Source annotation/)
  assert.match(documentXml, /T Translation/)
  assert.match(documentXml, /U Underline/)
  assert.match(documentXml, /N Note/)
  assert.match(documentXml, /EFF6FF/)
  assert.match(documentXml, /FFFBEB/)
  assert.match(documentXml, /F0FDF4/)
  assert.match(relationshipsXml, /Target="book:7#annotation:ann-1"/)
})

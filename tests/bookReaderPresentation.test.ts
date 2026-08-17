import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')
const booksStyles = readFileSync(new URL('../src/views/Books.css', import.meta.url), 'utf8')
const pdfAnnotationLayer = readFileSync(
  new URL('../src/components/PdfAnnotationLayer.tsx', import.meta.url),
  'utf8',
)
const readerOutlineDrawer = readFileSync(
  new URL('../src/components/ReaderOutlineDrawer.tsx', import.meta.url),
  'utf8',
)
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

test('book shelf titles support two lines while preserving the full title as a tooltip', () => {
  assert.match(booksSource, /className="book-shelf-card__title"/)
  assert.match(booksSource, /className="book-shelf-card__title"\s+title=\{book\.title\}/)
  assert.match(booksStyles, /\.book-shelf-card__title\s*\{[\s\S]*?-webkit-line-clamp:\s*2/)
})

test('book shelf edit action remains distinct from the card surface on hover', () => {
  assert.match(booksSource, /className="btn sm book-shelf-card__edit-action"/)
  assert.match(booksStyles, /\.book-shelf-card \.book-shelf-card__edit-action\s*\{[\s\S]*?background-color:\s*var\(--color-accent\)/)
  assert.match(booksStyles, /\.book-shelf-card \.book-shelf-card__edit-action:hover:not\(:disabled\)\s*\{[\s\S]*?background-color:\s*var\(--color-accent-hover\)/)
})

test('reader header gives long titles a responsive, non-overlapping layout', () => {
  assert.match(booksSource, /className="book-reader__header"/)
  assert.match(booksSource, /className="book-reader__title"/)
  assert.match(booksSource, /className="book-reader__toolbar"/)
  assert.match(booksStyles, /\.book-reader__title\s*\{[\s\S]*?-webkit-line-clamp:\s*2/)
  assert.match(booksStyles, /@media \(max-width: 1180px\)[\s\S]*?overflow-x:\s*auto/)
})

test('book library defaults to the to-read shelf', () => {
  assert.match(
    booksSource,
    /useState<string>\(TO_READ_BOOK_SHELF_ID\)/,
  )
})

test('reader header top sensor matches the responsive control bar height', () => {
  assert.match(booksSource, /className="book-reader__header-sensor"/)
  assert.match(booksStyles, /\.book-reader__header\s*\{[\s\S]*?opacity:\s*0[\s\S]*?transform:\s*translateY/)
  assert.match(booksStyles, /\.book-reader__header-sensor\s*\{[\s\S]*?height:\s*44px/)
  assert.match(booksStyles, /\.book-reader__header-sensor:hover \+ \.book-reader__header/)
})

test('PDF continuous mode owns its scroll viewport and excludes page-flip mode', () => {
  assert.match(booksSource, /overflowY:\s*isPdf && pdfLayoutMode === 'scroll' \? 'hidden' : 'auto'/)
  assert.match(booksStyles, /\.book-reader__reading-surface\.is-pdf\.is-scroll\s*\{[^}]*height:\s*100%/)
  assert.match(booksSource, /onScroll=\{pdfLayoutMode === 'scroll' \? handlePdfScroll : undefined\}/)
  assert.match(booksSource, /loadPdfOutline\(pdfDocument\)/)
  assert.match(readerOutlineDrawer, /scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.doesNotMatch(booksSource, /value="simulation"/)
  assert.doesNotMatch(booksSource, /pdf-flip-page/)
})

test('PDF continuous scrolling avoids full-document layout scans and unstable loading slots', () => {
  assert.match(booksSource, /pdfPageElementsRef/)
  assert.match(booksSource, /pdfScrollFrameRef\.current = requestAnimationFrame/)
  assert.match(booksSource, /getPdfPageIndexAtOffset\(pageElements, viewportAnchor\)/)
  assert.doesNotMatch(booksSource, /children\.forEach\(\(child\)/)
  assert.match(booksSource, /minHeight: `\$\{pdfEstimatedPageHeight\}px`/)
  assert.match(booksSource, /devicePixelRatio=\{PDF_RENDER_DEVICE_PIXEL_RATIO\}/)
  assert.match(booksStyles, /\.book-reader__pdf-page-slot[\s\S]*?contain:\s*layout paint style/)
})

test('PDF OCR runs on demand instead of starting after every page render', () => {
  assert.match(booksSource, /requestPdfOcrForCurrentPage/)
  assert.match(booksSource, /void ensurePdfOcrPage\(pageNumber\)/)
  assert.doesNotMatch(booksSource, /handlePdfPageRendered/)
  assert.doesNotMatch(booksSource, /onRenderSuccess=\{\(\) => handlePdfPageRendered/)
})

test('reader annotations use a right-side icon control with a count badge', () => {
  assert.match(booksSource, /book-reader__drawer-toggle--annotations/)
  assert.match(booksSource, /className="book-reader__annotation-count"/)
  assert.match(booksStyles, /\.book-reader__annotation-count\s*\{/)
  assert.match(booksStyles, /\.book-reader__drawer-toggle\s*\{[\s\S]*?top:\s*56px/)
  assert.match(booksStyles, /@media \(max-width: 720px\)[\s\S]*?\.book-reader__drawer-toggle\s*\{\s*top:\s*56px/)
  assert.match(booksSource, /aria-controls="book-reader-annotations"/)
})

test('reader toolbar uses compact dropdowns and stable theme swatches', () => {
  assert.match(booksSource, /className="book-reader__layout-dropdown"/)
  assert.match(booksSource, /className=\{`book-reader__theme-swatch/)
  assert.match(booksStyles, /\.book-reader__theme-swatch\s*\{[\s\S]*?flex:\s*0 0 20px[\s\S]*?padding:\s*0/)
  assert.match(
    booksStyles,
    /\.book-reader__layout-dropdown \.dropdown__control--is-focused\s*\{\s*box-shadow:\s*none/,
  )
})

test('reader selection actions are presented in a contextual menu', () => {
  assert.match(booksSource, /className="book-reader__context-menu"/)
  assert.match(booksSource, /copy_selected_text/)
  assert.match(booksSource, /mark_highlight/)
  assert.match(booksSource, /add_annotation_action/)
  assert.match(booksSource, /translate_selected_text/)
  assert.doesNotMatch(booksSource, /className="btn sm"\s+onClick=\{\(\) => void handleTranslateSelection\(\)\}/)
})

test('reader content expands while preserving navigation gutters', () => {
  assert.match(booksSource, /className="book-reader__main"/)
  assert.match(booksSource, /className=\{`book-reader__reading-surface/)
  assert.match(booksStyles, /\.book-reader__reading-surface\s*\{[\s\S]*?width:\s*min\(100%, 1180px\)/)
  assert.match(booksSource, /padding:\s*'32px 56px'/)
})

test('PDF width measurement uses the client area with scrollbar tolerance', () => {
  assert.match(booksSource, /el\.clientWidth - PDF_SCROLLBAR_WIDTH_TOLERANCE/)
  assert.match(booksSource, /getPdfPageRenderWidth\(pdfReaderWidth, pdfLayoutMode\)/)
})

test('saved highlights render on the source text and open their annotation', () => {
  assert.match(booksSource, /className=\{`book-reader__saved-highlight/)
  assert.match(booksSource, /openSavedHighlight\(primaryHighlight\)/)
  assert.match(booksSource, /data-reader-annotation-id=\{hl\.id\}/)
  assert.match(booksStyles, /\.book-reader__saved-highlight:hover/)
  assert.match(booksStyles, /\.book-reader__pdf-saved-highlight:hover/)
  assert.match(booksSource, /prev\.pdfHighlightsByPage !== next\.pdfHighlightsByPage/)
  assert.match(booksSource, /prev\.pdfOcrPages !== next\.pdfOcrPages/)
  assert.match(booksSource, /range\.getClientRects\(\)/)
  assert.match(booksSource, /mergePdfSelectionAreas\(/)
  assert.match(booksSource, /onMouseUp=\{handleTextSelection\}/)
  assert.match(booksStyles, /text-decoration-skip-ink:\s*none/)
  assert.match(booksStyles, /\.book-reader__pdf-saved-highlight\.is-highlight-only::after/)
  assert.match(booksStyles, /\.book-reader__pdf-saved-highlight\.is-active/)
  assert.match(booksStyles, /\.book-reader__saved-highlight\.is-hovered/)
  assert.match(booksSource, /setReaderHighlightHoverState\(/)
  assert.match(pdfAnnotationLayer, /onPointerEnter=\{\(\) => setHoveredHighlightId\(highlight\.id\)\}/)
  assert.match(booksSource, /data-reader-highlight-id/)
  assert.match(pdfAnnotationLayer, /is-highlight-only/)
  assert.match(pdfAnnotationLayer, /is-annotation-only/)
  assert.match(pdfAnnotationLayer, /is-combined/)
  assert.match(pdfAnnotationLayer, /title=\{highlight\.annotation \|\| t\('books\.mark_highlight'\)\}/)
  assert.match(pdfAnnotationLayer, /onContextMenu=\{\(event\)/)
  assert.match(pdfAnnotationLayer, /if \(kind === 'translation'\) return \[\]/)
  assert.match(booksStyles, /\.book-reader__pdf-annotation-layer[\s\S]*?contain:\s*layout paint style/)
  assert.match(booksSource, /deleteReaderAnnotation/)
  assert.match(booksSource, /saveReaderAnnotation/)
  assert.match(booksSource, /selection_id/)
  assert.match(booksSource, /highlighted:\s*includesMark/)
  assert.match(booksSource, /kind:\s*getReaderAnnotationKind\(highlight\)/)
  assert.match(booksSource, /sortedHighlights\.map/)
  assert.match(booksSource, /compareReaderHighlightsByDocumentPosition/)
  assert.match(booksSource, /locateSavedHighlight\(hl\)/)
  assert.match(booksSource, /handleDeleteSavedHighlight\(hl\)/)
  assert.match(booksSource, /data-reader-highlight-id=\{primaryHighlight\.id\}/)
  assert.match(booksSource, /reader_annotation_kind_\$\{kind\}/)
  assert.match(booksStyles, /\.book-reader__annotation-card\.is-translation/)
  assert.match(booksStyles, /\.book-reader__annotation-card\.is-highlight/)
  assert.match(booksStyles, /\.book-reader__annotation-card\.is-note/)
  assert.doesNotMatch(booksSource, /handleCopyLink/)
  assert.doesNotMatch(booksSource, /copy_link_tooltip/)
})

test('PDF reader provides PDF.js with bundled WASM decoder files through a stable option object', () => {
  assert.match(booksSource, /import\.meta\.env\.DEV/)
  assert.match(booksSource, /\$\{window\.location\.origin\}\/pdfjs\/wasm\//)
  assert.match(booksSource, /new URL\('pdfjs\/wasm\/', document\.baseURI\)/)
  assert.match(booksSource, /const pdfDocumentOptions = useMemo\(\(\) => \(\{ wasmUrl: pdfWasmUrl \}\), \[\]\)/)
  assert.match(booksSource, /options=\{pdfDocumentOptions\}/)
  assert.match(viteConfig, /\['openjpeg\.wasm', 'qcms_bg\.wasm'\]/)
  assert.match(viteConfig, /dist', 'pdfjs', 'wasm'/)
})

test('PDF outline loads asynchronously after PDF render success and falls back cleanly', () => {
  assert.match(booksSource, /loadPdfOutline\(pdfDocument\)/)
  assert.match(booksSource, /setPdfOutlineStatus\('loading'\)/)
  assert.match(booksSource, /pdfOutlineEntries/)
  assert.match(booksSource, /pdfOutlineStatus === 'error'/)
  assert.match(booksSource, /analyzeReaderOutline/)
  assert.match(booksSource, /cancelReaderOutlineAnalysis/)
  assert.match(booksSource, /onReaderOutlineProgress/)
  assert.match(booksSource, /buildPageOnlyPdfOutlineEntries/)
  assert.match(booksSource, /reconcileSavedSelectionLocation/)
  assert.match(booksSource, /reader_annotation_pending/)
  assert.match(booksSource, /pdf_outline_loading/)
})

test('reader outline lazily renders deep branches and keeps PDF document ownership stable', () => {
  assert.match(booksSource, /<ReaderOutlineDrawer/)
  assert.match(booksSource, /storageKey=\{`reader:outline:expanded:\$\{readingBook\.id\}`\}/)
  assert.match(booksSource, /handleRetryPdfOutline/)
  assert.match(readerOutlineDrawer, /const OutlineBranch = React\.memo/)
  assert.match(readerOutlineDrawer, /\{isExpanded \? \(/)
  assert.match(readerOutlineDrawer, /window\.localStorage\.setItem/)
  assert.match(readerOutlineDrawer, /outline_status_partial/)
  assert.match(readerOutlineDrawer, /outline_status_failed/)
  assert.equal((booksSource.match(/<Document/g) || []).length, 1)
})

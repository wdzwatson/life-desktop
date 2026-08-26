import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')
const booksStyles = readFileSync(new URL('../src/views/Books.css', import.meta.url), 'utf8')
const pdfAnnotationLayer = readFileSync(
  new URL('../src/components/PdfAnnotationLayer.tsx', import.meta.url),
  'utf8',
)
const pdfInkSelectionLayer = readFileSync(
  new URL('../src/components/PdfInkSelectionLayer.tsx', import.meta.url),
  'utf8',
)
const readerOutlineDrawer = readFileSync(
  new URL('../src/components/ReaderOutlineDrawer.tsx', import.meta.url),
  'utf8',
)
const readerAnnotationsPanel = readFileSync(
  new URL('../src/components/ReaderAnnotationsPanel.tsx', import.meta.url),
  'utf8',
)
const pdfPageMetadataCache = readFileSync(
  new URL('../src/services/pdfPageMetadataCache.ts', import.meta.url),
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
  assert.match(
    booksStyles,
    /\.book-shelf-card \.book-shelf-card__edit-action\s*\{[\s\S]*?background-color:\s*var\(--color-accent\)/,
  )
  assert.match(
    booksStyles,
    /\.book-shelf-card \.book-shelf-card__edit-action:hover:not\(:disabled\)\s*\{[\s\S]*?background-color:\s*var\(--color-accent-hover\)/,
  )
})

test('reader header gives long titles a responsive, non-overlapping layout', () => {
  assert.match(booksSource, /className="book-reader__header"/)
  assert.match(booksSource, /className="book-reader__title"/)
  assert.match(booksSource, /className="book-reader__toolbar"/)
  assert.match(booksStyles, /\.book-reader__title\s*\{[\s\S]*?-webkit-line-clamp:\s*2/)
  assert.match(booksStyles, /@media \(max-width: 1180px\)[\s\S]*?overflow-x:\s*auto/)
})

test('book library defaults to the to-read shelf', () => {
  assert.match(booksSource, /useState<string>\(TO_READ_BOOK_SHELF_ID\)/)
})

test('book library collapses to one column on narrow windows', () => {
  assert.match(booksSource, /className="book-library-layout"/)
  assert.match(booksSource, /className="book-library-grid"/)
  assert.match(
    booksStyles,
    /@media \(max-width: 720px\)[\s\S]*?\.book-library-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) !important/,
  )
  assert.match(
    booksStyles,
    /\.book-library-grid\s*\{[\s\S]*?overflow-x:\s*hidden !important/,
  )
})

test('reader header top sensor matches the responsive control bar height', () => {
  assert.match(booksSource, /className="book-reader__header-sensor"/)
  assert.match(
    booksStyles,
    /\.book-reader__header\s*\{[\s\S]*?opacity:\s*0[\s\S]*?transform:\s*translateY/,
  )
  assert.match(booksStyles, /\.book-reader__header-sensor\s*\{[\s\S]*?height:\s*44px/)
  assert.match(booksStyles, /\.book-reader__header-sensor:hover \+ \.book-reader__header/)
  assert.match(booksSource, /data-toc-drawer-open=\{isTocDrawerOpen\}/)
  assert.match(booksSource, /data-annotations-drawer-open=\{isAnnotationsDrawerOpen\}/)
  assert.match(
    booksStyles,
    /\.book-reader-overlay\[data-toc-drawer-open='true'\][\s\S]*?left:\s*260px/,
  )
  assert.match(
    booksStyles,
    /\.book-reader-overlay\[data-annotations-drawer-open='true'\][\s\S]*?right:\s*320px/,
  )
})

test('clicking the reading surface preserves both side drawers', () => {
  const handler = booksSource.match(
    /const handleReaderContentClick = \(\) => \{([\s\S]*?)\n {2}\}/,
  )?.[1]
  assert.ok(handler)
  assert.match(handler, /setReaderContextMenu\(null\)/)
  assert.doesNotMatch(handler, /setPdfInkDraft\(null\)/)
  assert.doesNotMatch(handler, /setIsTocDrawerOpen/)
  assert.doesNotMatch(handler, /setIsAnnotationsDrawerOpen/)
})

test('PDF continuous mode owns its scroll viewport and excludes page-flip mode', () => {
  assert.match(booksSource, /overflowY:\s*isPdf && pdfLayoutMode === 'scroll' \? 'hidden' : 'auto'/)
  assert.match(
    booksStyles,
    /\.book-reader__reading-surface\.is-pdf\.is-scroll\s*\{[^}]*height:\s*100%/,
  )
  assert.match(
    booksSource,
    /onScroll=\{pdfLayoutMode === 'scroll' \? handlePdfScroll : undefined\}/,
  )
  assert.match(booksSource, /loadPdfOutline\(pdfDocument\)/)
  assert.match(readerOutlineDrawer, /scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.doesNotMatch(booksSource, /value="simulation"/)
  assert.doesNotMatch(booksSource, /pdf-flip-page/)
})

test('PDF continuous prefetch waits for a 400ms scroll idle window', () => {
  assert.match(booksSource, /const PDF_SCROLL_IDLE_DELAY_MS = 400/)
  assert.match(booksSource, /setIsPdfScrollSettled\(false\)/)
  assert.match(booksSource, /setIsPdfScrollSettled\(true\)/)
  assert.match(booksSource, /isAutoPlaying \|\| isPdfScrollSettled \? getEffectiveOverscan/)
})

test('paged EPUB and PDF readers share edge-gated, throttled wheel paging', () => {
  assert.match(booksSource, /const PAGED_WHEEL_THRESHOLD = 180/)
  assert.match(booksSource, /const PAGED_WHEEL_LINE_THRESHOLD = 96/)
  assert.match(booksSource, /const PAGED_WHEEL_FINE_THRESHOLD = 150/)
  assert.match(booksSource, /const PAGED_WHEEL_IDLE_MS = 220/)
  assert.match(booksSource, /const PAGED_WHEEL_LOCK_MS = 450/)
  assert.match(booksSource, /const PAGED_WHEEL_FINE_LOCK_MS = 600/)
  assert.match(booksSource, /READER_WHEEL_SENSITIVITY_STORAGE_KEY/)
  assert.match(booksSource, /READER_WHEEL_SENSITIVITY_SCALE/)
  assert.match(booksSource, /wheel_sensitivity_label/)
  assert.match(booksSource, /localStorage\.setItem\(READER_WHEEL_SENSITIVITY_STORAGE_KEY/)
  assert.match(booksSource, /const handleNextPage = \(\): boolean =>/)
  assert.match(booksSource, /const handlePrevPage = \(\): boolean =>/)
  assert.match(booksSource, /const handlePagedReaderWheel = \(e: WheelEvent\)/)
  assert.match(booksSource, /if \(!isAtBoundary\)/)
  assert.match(booksSource, /pagedWheelAccumulatorRef\.current \+= delta/)
  assert.match(booksSource, /e\.ctrlKey/)
  assert.match(booksSource, /e\.metaKey/)
  assert.match(booksSource, /e\.shiftKey/)
  assert.match(booksSource, /Math\.abs\(e\.deltaX\) > Math\.abs\(e\.deltaY\) \* 1\.2/)
  assert.match(booksSource, /pagedWheelGestureConsumedRef\.current/)
  assert.match(booksSource, /dataset\.wheelEdge/)
  assert.match(booksSource, /threshold \* 0\.4/)
  assert.match(booksSource, /pagedWheelBoundaryNotifiedRef\.current/)
  assert.match(booksSource, /const didAdvance = direction > 0 \? handleNextPageRef\.current\(\) : handlePrevPageRef\.current\(\)/)
  assert.match(booksSource, /e\.preventDefault\(\)/)
  assert.match(booksSource, /addEventListener\('wheel', handleWheel, \{ passive: false \}\)/)
  assert.match(booksSource, /removeEventListener\('wheel', handleWheel\)/)
  assert.doesNotMatch(booksSource, /onWheel=\{handlePagedReaderWheel\}/)
  assert.doesNotMatch(booksSource, /onWheel=\{pdfLayoutMode !== 'scroll' \? handlePdfWheel : undefined\}/)
  assert.match(booksSource, /if \(landing === 'bottom'\)/)
  assert.match(booksSource, /container\?\.scrollTo\(\{/)
  assert.match(booksStyles, /\.book-reader__main\s*\{[^}]*overscroll-behavior:\s*contain/)
  assert.match(booksStyles, /\.book-reader__main\[data-wheel-edge='next'\]/)
  assert.match(booksStyles, /\.book-reader__main\[data-wheel-edge='prev'\]/)
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

test('scanned PDF pages enable direct ink selection and merge strokes for 1.5 seconds', () => {
  assert.match(pdfPageMetadataCache, /type PdfPageTextMode = 'unknown' \| 'text' \| 'scanned'/)
  assert.match(booksSource, /page\.getTextContent\(\)/)
  assert.match(
    booksSource,
    /enabled=\{\s*getPdfPageTextMode\(currentPageIndex \+ 1\) === 'scanned'/,
  )
  assert.match(booksSource, /enabled=\{metadata\.textMode === 'scanned'\}/)
  assert.doesNotMatch(booksSource, /pdfInkMode/)
  assert.match(pdfInkSelectionLayer, /const INK_MERGE_WINDOW_MS = 1500/)
  assert.match(pdfInkSelectionLayer, /flushTimerRef\.current !== null \|\| isRecognizing/)
  assert.doesNotMatch(pdfInkSelectionLayer, /\}, 2000\)/)
  assert.match(pdfInkSelectionLayer, /const isClick = Math\.hypot/)
  assert.match(pdfInkSelectionLayer, /const renderStraightLineTo = \(point: PdfInkPoint\)/)
  assert.match(pdfInkSelectionLayer, /pointsRef\.current = \[[\s\S]*lineY[\s\S]*point\.x, y: lineY/)
  assert.match(pdfInkSelectionLayer, /if \(!insideSelection\) clearPendingSelection\(\)/)
  assert.match(pdfInkSelectionLayer, /onContextMenu=\{\(event\) => \{/)
  assert.match(pdfInkSelectionLayer, /onOpenContextMenu\(\{ clientX:/)
  assert.match(
    booksStyles,
    /\.book-reader__pdf-ink-layer\s*\{[\s\S]*?cursor:\s*default/,
  )
  assert.match(booksSource, /handlePdfOcrRecognized\(text, stroke, false\)/)
  assert.doesNotMatch(booksSource, /openReaderContextMenu\(stroke\.clientX/)
  assert.doesNotMatch(booksSource, /ocr_expand_paragraph|handleExpandPdfOcrParagraph|canExpandPdfOcrParagraph/)
})

test('PDF annotation locations can be replaced with an outline chapter or manual title', () => {
  assert.match(booksSource, /buildPdfOutlinePathSnapshot/)
  assert.match(booksSource, /reader_location_page_auto/)
  assert.match(booksSource, /reader_location_chapter_placeholder/)
  assert.match(booksSource, /manualTitle: event\.target\.value/)
  assert.doesNotMatch(readerAnnotationsPanel, /item\.kind !== 'highlight'/)
})

test('reader annotations use a right-side icon control with a count badge', () => {
  assert.match(booksSource, /book-reader__drawer-toggle--annotations/)
  assert.match(booksSource, /className="book-reader__annotation-count"/)
  assert.match(booksStyles, /\.book-reader__annotation-count\s*\{/)
  assert.match(booksStyles, /\.book-reader__drawer-toggle\s*\{[\s\S]*?top:\s*56px/)
  assert.match(
    booksStyles,
    /\.book-reader__drawer-toggle\s*\{[\s\S]*?background:\s*var\(--icon-button-bg\)[\s\S]*?color:\s*var\(--icon-button-color\)/,
  )
  assert.match(
    booksStyles,
    /\.book-reader__drawer-toggle:hover\s*\{[\s\S]*?background-color:\s*var\(--icon-button-hover-bg\)[\s\S]*?color:\s*var\(--icon-button-hover-color\)/,
  )
  assert.match(
    booksStyles,
    /\.book-reader__annotation-action\s*\{[\s\S]*?background:\s*var\(--icon-button-bg\)[\s\S]*?color:\s*var\(--icon-button-color\)/,
  )
  assert.match(
    booksStyles,
    /\.book-reader__annotation-action:hover,[\s\S]*?\.book-reader__annotation-action:focus-visible\s*\{[\s\S]*?background:\s*var\(--icon-button-hover-bg\)[\s\S]*?color:\s*var\(--icon-button-hover-color\)/,
  )
  assert.match(
    booksStyles,
    /@media \(max-width: 720px\)[\s\S]*?\.book-reader__drawer-toggle\s*\{\s*top:\s*56px/,
  )
  assert.match(booksSource, /aria-controls="book-reader-annotations"/)
  const tocToggleStyle = booksSource.match(
    /className="book-reader__drawer-toggle book-reader__drawer-toggle--toc"[\s\S]*?style=\{\{([\s\S]*?)\n\s*\}\}/,
  )?.[1]
  const annotationToggleStyle = booksSource.match(
    /className="book-reader__drawer-toggle book-reader__drawer-toggle--annotations"[\s\S]*?style=\{\{([\s\S]*?)\n\s*\}\}/,
  )?.[1]
  assert.ok(tocToggleStyle)
  assert.ok(annotationToggleStyle)
  assert.doesNotMatch(tocToggleStyle, /backgroundColor|border:/)
  assert.doesNotMatch(annotationToggleStyle, /backgroundColor|border:/)
})

test('reader toolbar uses compact dropdowns and stable theme swatches', () => {
  assert.match(booksSource, /className="book-reader__layout-dropdown"/)
  assert.match(booksSource, /className=\{`book-reader__theme-swatch/)
  assert.match(
    booksStyles,
    /\.book-reader__theme-swatch\s*\{[\s\S]*?flex:\s*0 0 20px[\s\S]*?padding:\s*0/,
  )
  assert.match(
    booksStyles,
    /\.book-reader__layout-dropdown \.dropdown__control--is-focused\s*\{\s*box-shadow:\s*none/,
  )
  assert.match(
    booksStyles,
    /\.book-reader__toolbar \.dropdown__control\s*\{[\s\S]*?border-color:\s*var\(--border-subtle\)[\s\S]*?background:\s*var\(--icon-button-bg\)[\s\S]*?color:\s*var\(--text-main\)/,
  )
  assert.match(
    booksStyles,
    /\.book-reader__toolbar \.dropdown__control:hover,[\s\S]*?\.book-reader__toolbar \.dropdown__control--menu-is-open\s*\{[\s\S]*?background:\s*var\(--icon-button-hover-bg\)/,
  )
})

test('reader selection actions are presented in a contextual menu', () => {
  assert.match(booksSource, /className="book-reader__context-menu"/)
  assert.match(booksSource, /copy_selected_text/)
  assert.match(booksSource, /mark_highlight/)
  assert.match(booksSource, /add_annotation_action/)
  assert.match(booksSource, /translate_selected_text/)
  assert.doesNotMatch(
    booksSource,
    /className="btn sm"\s+onClick=\{\(\) => void handleTranslateSelection\(\)\}/,
  )
})

test('reader content expands while preserving navigation gutters', () => {
  assert.match(booksSource, /className="book-reader__main"/)
  assert.match(booksSource, /className=\{`book-reader__reading-surface/)
  assert.match(
    booksStyles,
    /\.book-reader__reading-surface\s*\{[\s\S]*?width:\s*min\(100%, 1180px\)/,
  )
  assert.match(booksSource, /padding:\s*'32px 56px'/)
})

test('PDF width measurement uses the client area with scrollbar tolerance', () => {
  assert.match(booksSource, /el\.clientWidth - PDF_SCROLLBAR_WIDTH_TOLERANCE/)
  assert.match(booksSource, /getPdfPageRenderWidth\(pdfReaderWidth, pdfLayoutMode\)/)
})

test('saved highlights render on the source text and open their annotation', () => {
  assert.match(booksSource, /className=\{`book-reader__saved-highlight/)
  assert.match(booksSource, /openSavedHighlight\(primaryHighlight\)/)
  assert.match(readerAnnotationsPanel, /data-reader-annotation-id=\{item\.id\}/)
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
  assert.match(
    pdfAnnotationLayer,
    /onPointerEnter=\{\(\) => setHoveredHighlightId\(highlight\.id\)\}/,
  )
  assert.match(booksSource, /data-reader-highlight-id/)
  assert.match(pdfAnnotationLayer, /is-highlight-only/)
  assert.match(pdfAnnotationLayer, /is-annotation-only/)
  assert.match(pdfAnnotationLayer, /is-combined/)
  assert.match(
    pdfAnnotationLayer,
    /title=\{highlight\.annotation \|\| t\('books\.mark_highlight'\)\}/,
  )
  assert.match(pdfAnnotationLayer, /onContextMenu=\{\(event\)/)
  assert.match(pdfAnnotationLayer, /if \(kind === 'translation'\) return \[\]/)
  assert.match(
    booksStyles,
    /\.book-reader__pdf-annotation-layer[\s\S]*?contain:\s*layout paint style/,
  )
  assert.match(booksSource, /deleteReaderAnnotation/)
  assert.match(booksSource, /saveReaderAnnotation/)
  assert.match(booksSource, /selection_id/)
  assert.match(booksSource, /highlighted:\s*includesMark/)
  assert.match(booksSource, /kind:\s*getReaderAnnotationKind\(highlight\)/)
  assert.match(booksSource, /sortedHighlights\.map/)
  assert.match(booksSource, /compareReaderHighlightsByDocumentPosition/)
  assert.match(booksSource, /locate:\s*locateSavedHighlight/)
  assert.match(booksSource, /delete:\s*handleDeleteSavedHighlight/)
  assert.match(booksSource, /handleAnnotationPanelActivate/)
  assert.match(booksSource, /handleAnnotationPanelDelete/)
  assert.match(booksSource, /data-reader-highlight-id=\{primaryHighlight\.id\}/)
  assert.match(readerAnnotationsPanel, /reader_annotation_kind_\$\{item\.kind\}/)
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
  assert.match(
    booksSource,
    /const pdfDocumentOptions = useMemo\(\(\) => \(\{ wasmUrl: pdfWasmUrl \}\), \[\]\)/,
  )
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
  assert.match(booksSource, /analyzePdfOutlineWithOcr/)
  assert.match(booksSource, /PDF_OUTLINE_OCR_PAGE_LIMIT/)
  assert.match(booksSource, /outline_ocr_progress/)
  assert.match(readerOutlineDrawer, /status === 'fallback'/)
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

test('reader annotation panel filters semantic kinds and paginates large lists', () => {
  assert.match(booksSource, /<ReaderAnnotationsPanel/)
  assert.match(readerAnnotationsPanel, /ReaderAnnotationPanelFilter/)
  assert.match(readerAnnotationsPanel, /aria-pressed=\{filter === id\}/)
  assert.match(readerAnnotationsPanel, /READER_ANNOTATION_PAGE_SIZE = 80/)
  assert.match(readerAnnotationsPanel, /getReaderAnnotationPage\(filteredItems, visibleCount\)/)
  assert.match(
    readerAnnotationsPanel,
    /setVisibleCount\(\(current\) => Math\.max\(current, requiredCount\)\)/,
  )
  assert.match(readerAnnotationsPanel, /previous\.item\.content === next\.item\.content/)
  assert.match(readerAnnotationsPanel, /data-reader-annotation-id=\{item\.id\}/)
  assert.match(readerAnnotationsPanel, /reader_annotation_created_at/)
  assert.match(readerAnnotationsPanel, /onKeyDown=\{\(event\)/)
})

test('Notes export rebuilds annotation records from storage without using the active chapter', () => {
  const exportHandler = booksSource.match(
    /const handleExportHighlights = async \(\) => \{([\s\S]*?)\r?\n {2}\}\r?\n\r?\n {2}\/\/ Check if a book's category/,
  )?.[1]
  assert.ok(exportHandler)
  assert.match(exportHandler, /listReaderAnnotations/)
  assert.match(exportHandler, /buildExportAnnotationRecords\(annotationRows\)/)
  assert.match(exportHandler, /renderReaderAnnotationsManagedMarkdown/)
  assert.match(exportHandler, /mergeReaderAnnotationsManagedMarkdown/)
  assert.match(exportHandler, /SELECT id, content FROM notes/)
  assert.match(exportHandler, /annotationExportPendingRef\.current/)
  assert.doesNotMatch(exportHandler, /currentChapter/)
  assert.match(booksSource, /aria-busy=\{isExportingAnnotations\}/)
})

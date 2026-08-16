import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ScanText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PdfOcrWord } from '../views/pdfOcrService'
import { joinOcrWords } from '../ocrTextUtils'

export type PdfOcrSelectionArea = {
  x: number
  y: number
  width: number
  height: number
}

export type SavedPdfHighlight = {
  id: string
  text: string
  annotation?: string
  highlighted?: boolean
  kind?: 'translation' | 'highlight' | 'note'
  anchor?: string
  areas: PdfOcrSelectionArea[]
}

type SelectionPoint = { x: number; y: number }

export function PdfOcrTextLayer({
  words,
  status,
  progressLabel,
  onSelectAreas,
  onOpenContextMenu,
  onRetry,
  onFallback,
  savedHighlights = [],
  onOpenHighlight,
}: {
  words: PdfOcrWord[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  progressLabel?: string
  onSelectAreas: (areas: PdfOcrSelectionArea[], selectedText: string) => void
  onOpenContextMenu?: (event: {
    clientX: number
    clientY: number
    text: string
    highlight?: SavedPdfHighlight
  }) => void
  onRetry?: () => void
  onFallback?: () => void
  savedHighlights?: SavedPdfHighlight[]
  onOpenHighlight?: (highlight: SavedPdfHighlight) => void
}) {
  const { t } = useTranslation()
  const layerRef = useRef<HTMLDivElement | null>(null)
  const dragStartIndexRef = useRef<number | null>(null)
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    if (selectedIndexes.size === 0) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dragStartIndexRef.current = null
      setSelectedIndexes(new Set())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndexes])

  const pointFromEvent = (event: { clientX: number; clientY: number }): SelectionPoint | null => {
    const bounds = layerRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  const getWordIndexAtPoint = (point: SelectionPoint) => {
    const containedIndex = words.findIndex(
      (word) =>
        point.x >= word.x &&
        point.x <= word.x + word.width &&
        point.y >= word.y &&
        point.y <= word.y + word.height,
    )
    if (containedIndex >= 0) return containedIndex

    // OCR boxes can have narrow gaps between adjacent Chinese characters. Let
    // a drag that starts in such a gap snap to the closest nearby word.
    let closestIndex = -1
    let closestDistance = Number.POSITIVE_INFINITY
    words.forEach((word, index) => {
      const x = Math.max(word.x, Math.min(point.x, word.x + word.width))
      const y = Math.max(word.y, Math.min(point.y, word.y + word.height))
      const distance = Math.hypot(point.x - x, point.y - y)
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    })
    return closestDistance <= 0.018 ? closestIndex : -1
  }

  const getRangeIndexes = (startIndex: number, endIndex: number) => {
    const from = Math.min(startIndex, endIndex)
    const to = Math.max(startIndex, endIndex)
    return new Set(Array.from({ length: to - from + 1 }, (_, index) => from + index))
  }

  const getSelectionRows = (indexes: Set<number>) => {
    const rows: {
      x: number
      y: number
      width: number
      height: number
      centerY: number
      words: PdfOcrWord[]
    }[] = []
    const selectedWords = words
      .filter((_, index) => indexes.has(index))
      .sort(
        (left, right) =>
          left.y + left.height / 2 - (right.y + right.height / 2) || left.x - right.x,
      )
    const heights = selectedWords.map((word) => word.height).sort((left, right) => left - right)
    const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0
    const lineTolerance = Math.min(0.035, Math.max(0.008, medianHeight * 0.75))

    selectedWords.forEach((word) => {
      const centerY = word.y + word.height / 2
      const row = rows.find((candidate) => Math.abs(candidate.centerY - centerY) <= lineTolerance)
      if (row) {
        const right = Math.max(row.x + row.width, word.x + word.width)
        row.x = Math.min(row.x, word.x)
        row.y = Math.min(row.y, word.y)
        row.width = right - row.x
        row.height = Math.max(row.height, word.height)
        row.words.push(word)
      } else {
        rows.push({
          x: word.x,
          y: word.y,
          width: word.width,
          height: word.height,
          centerY,
          words: [word],
        })
      }
    })
    return rows.map((row) => {
      const rowWords = [...row.words].sort((left, right) => left.x - right.x)
      const [first, second] = rowWords
      // A remaining low-quality box can occasionally span a page margin. It
      // has a large gap before the first real word; trim it from presentation
      // while keeping OCR's actual text result untouched.
      const visibleWords =
        first &&
        second &&
        first.x < 0.1 &&
        second.x - (first.x + first.width) > Math.max(0.035, first.width * 1.5)
          ? rowWords.slice(1)
          : rowWords
      const left = Math.min(...visibleWords.map((word) => word.x))
      const right = Math.max(...visibleWords.map((word) => word.x + word.width))
      const top = Math.min(...visibleWords.map((word) => word.y))
      const bottom = Math.max(...visibleWords.map((word) => word.y + word.height))
      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        centerY: row.centerY,
        words: visibleWords,
      }
    })
  }

  const highlightRows = getSelectionRows(selectedIndexes)

  const getSelectedText = (indexes: Set<number>) =>
    getSelectionRows(indexes)
      .sort((left, right) => left.centerY - right.centerY || left.x - right.x)
      .map((row) => joinOcrWords(row.words.sort((left, right) => left.x - right.x)))
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim()

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // OCR selection is deliberately a primary-button gesture. Secondary
    // clicks are reserved for dismissing an existing selection below.
    if (event.button !== 0) return
    const start = pointFromEvent(event)
    if (!start) return
    const startIndex = getWordIndexAtPoint(start)
    if (startIndex < 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartIndexRef.current = startIndex
    setSelectedIndexes(new Set([startIndex]))
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.buttons & 1) === 0) return
    const end = pointFromEvent(event)
    const startIndex = dragStartIndexRef.current
    if (startIndex === null || !end) return
    const endIndex = getWordIndexAtPoint(end)
    if (endIndex >= 0) setSelectedIndexes(getRangeIndexes(startIndex, endIndex))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const end = pointFromEvent(event)
    const startIndex = dragStartIndexRef.current
    dragStartIndexRef.current = null
    if (startIndex === null || !end) return
    const endIndex = getWordIndexAtPoint(end)
    if (endIndex < 0) return
    const indexes = getRangeIndexes(startIndex, endIndex)
    setSelectedIndexes(indexes)
    const areas = getSelectionRows(indexes).map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height,
    }))
    const selectedText = getSelectedText(indexes)
    if (areas.length > 0 && selectedText) onSelectAreas(areas, selectedText)
  }

  const cancelPointerSelection = () => {
    dragStartIndexRef.current = null
    setSelectedIndexes(new Set())
  }

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const point = pointFromEvent(event)
    const wordIndex = point ? getWordIndexAtPoint(point) : -1
    // Right-clicking outside the active selection is an unobtrusive way to
    // dismiss its visual OCR range without discarding saved reader content.
    if (wordIndex < 0 || !selectedIndexes.has(wordIndex)) {
      dragStartIndexRef.current = null
      setSelectedIndexes(new Set())
      return
    }
    const text = getSelectedText(selectedIndexes)
    if (text) onOpenContextMenu?.({ clientX: event.clientX, clientY: event.clientY, text })
  }

  const renderSavedHighlights = () =>
    savedHighlights.flatMap((highlight) =>
      highlight.areas.map((area, index) => {
        const kind = highlight.kind || (highlight.annotation ? 'note' : 'highlight')
        const visualState =
          kind === 'translation'
            ? 'is-translation'
            : highlight.annotation
              ? highlight.highlighted === false
                ? 'is-annotation-only'
                : 'is-combined'
              : 'is-highlight-only'
        return (
          <button
            key={`${highlight.id}-${index}`}
            type="button"
            className={`book-reader__pdf-saved-highlight is-${kind} ${visualState}`}
            data-reader-highlight-id={highlight.id}
            aria-label={`${highlight.text}: ${highlight.annotation || t('books.mark_highlight')}`}
            title={highlight.annotation || t('books.mark_highlight')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onOpenHighlight?.(highlight)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onOpenContextMenu?.({
                clientX: event.clientX,
                clientY: event.clientY,
                text: highlight.text,
                highlight,
              })
            }}
            style={{
              position: 'absolute',
              left: `${area.x * 100}%`,
              top: `${area.y * 100}%`,
              width: `${area.width * 100}%`,
              height: `${area.height * 100}%`,
              pointerEvents: 'auto',
            }}
          />
        )
      }),
    )

  if (status !== 'ready' || words.length === 0) {
    const statusContent =
      status === 'loading' ? (
        <span
          role="status"
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            zIndex: 4,
            padding: '3px 6px',
            borderRadius: 4,
            background: 'rgba(15, 23, 42, .72)',
            color: '#fff',
            fontSize: 10,
            pointerEvents: 'none',
          }}
        >
          {progressLabel || t('books.ocr_recognizing_page')}
        </span>
      ) : status === 'error' ? (
        <div
          role="alert"
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            zIndex: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 6px',
            borderRadius: 4,
            background: 'rgba(127, 29, 29, .9)',
            color: '#fff',
            fontSize: 10,
            pointerEvents: 'auto',
          }}
        >
          <span>{t('books.ocr_failed_inline')}</span>
          {onRetry && (
            <button className="btn sm" type="button" onClick={onRetry}>
              {t('books.ocr_retry')}
            </button>
          )}
          {onFallback && (
            <button className="btn sm" type="button" onClick={onFallback}>
              <ScanText size={11} /> {t('books.ocr_select_retry')}
            </button>
          )}
        </div>
      ) : null

    if (savedHighlights.length === 0) return statusContent
    return (
      <div
        aria-label={t('books.ocr_text_layer_label')}
        style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}
      >
        {renderSavedHighlights()}
        {statusContent}
      </div>
    )
  }

  return (
    <div
      ref={layerRef}
      aria-label={t('books.ocr_text_layer_label')}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelPointerSelection}
      onContextMenu={handleContextMenu}
      style={{ position: 'absolute', inset: 0, zIndex: 3, cursor: 'text', touchAction: 'none' }}
    >
      {renderSavedHighlights()}
      {highlightRows.map((row, index) => (
        <div
          key={`${row.x}-${row.y}-${index}`}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${row.x * 100}%`,
            top: `${row.y * 100}%`,
            width: `${row.width * 100}%`,
            height: `${row.height * 100}%`,
            background: 'rgba(59, 130, 246, .2)',
            borderBottom: '1px solid rgba(37, 99, 235, .8)',
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
  )
}

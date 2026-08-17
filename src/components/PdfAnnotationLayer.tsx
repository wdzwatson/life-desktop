import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PdfSelectionArea } from '../views/bookReaderUtils'

export type SavedPdfHighlight = {
  id: string
  text: string
  annotation?: string
  highlighted?: boolean
  kind?: 'translation' | 'highlight' | 'note'
  anchor?: string
  areas: PdfSelectionArea[]
  selection_id?: string
  translation_language?: string | null
}

export type PdfAnnotationRect = {
  key: string
  highlight: SavedPdfHighlight
  area: PdfSelectionArea
  visualState: 'is-highlight-only' | 'is-annotation-only' | 'is-combined'
}

const normalizeArea = (area: PdfSelectionArea): PdfSelectionArea | null => {
  if (
    !Number.isFinite(area.x) ||
    !Number.isFinite(area.y) ||
    !Number.isFinite(area.width) ||
    !Number.isFinite(area.height) ||
    area.width <= 0 ||
    area.height <= 0
  ) {
    return null
  }
  const x = Math.max(0, Math.min(1, area.x))
  const y = Math.max(0, Math.min(1, area.y))
  const width = Math.max(0, Math.min(1 - x, area.width))
  const height = Math.max(0, Math.min(1 - y, area.height))
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

export const getPdfAnnotationRects = (highlights: SavedPdfHighlight[]): PdfAnnotationRect[] =>
  highlights.flatMap((highlight) => {
    const kind = highlight.kind || (highlight.annotation ? 'note' : 'highlight')
    if (kind === 'translation') return []
    const visualState =
      kind === 'note'
        ? highlight.highlighted === false
          ? 'is-annotation-only'
          : 'is-combined'
        : 'is-highlight-only'
    return highlight.areas.flatMap((candidate, index) => {
      const area = normalizeArea(candidate)
      return area
        ? [{ key: `${highlight.id}-${index}`, highlight, area, visualState }]
        : []
    })
  })

export const PdfAnnotationLayer = React.memo(function PdfAnnotationLayer({
  highlights,
  activeHighlightId,
  onOpenHighlight,
  onOpenContextMenu,
}: {
  highlights: SavedPdfHighlight[]
  activeHighlightId?: string | null
  onOpenHighlight?: (highlight: SavedPdfHighlight) => void
  onOpenContextMenu?: (event: {
    clientX: number
    clientY: number
    text: string
    highlight: SavedPdfHighlight
  }) => void
}) {
  const { t } = useTranslation()
  const [hoveredHighlightId, setHoveredHighlightId] = useState<string | null>(null)
  const rects = useMemo(() => getPdfAnnotationRects(highlights), [highlights])
  if (rects.length === 0) return null

  return (
    <div
      className="book-reader__pdf-annotation-layer"
      aria-label={t('books.highlights_annotations_title')}
      onPointerLeave={() => setHoveredHighlightId(null)}
    >
      {rects.map(({ key, highlight, area, visualState }) => (
        <button
          key={key}
          type="button"
          className={`book-reader__pdf-saved-highlight is-${highlight.kind || 'highlight'} ${visualState} ${hoveredHighlightId === highlight.id || activeHighlightId === highlight.id ? 'is-active' : ''}`}
          data-reader-highlight-id={highlight.id}
          aria-label={`${highlight.text}: ${highlight.annotation || t('books.mark_highlight')}`}
          title={highlight.annotation || t('books.mark_highlight')}
          onPointerEnter={() => setHoveredHighlightId(highlight.id)}
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
            left: `${area.x * 100}%`,
            top: `${area.y * 100}%`,
            width: `${area.width * 100}%`,
            height: `${area.height * 100}%`,
          }}
        />
      ))}
    </div>
  )
})

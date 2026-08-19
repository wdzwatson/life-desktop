import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { PdfSelectionArea } from '../views/bookReaderUtils'
import type { PdfInkPoint, PdfInkStroke } from '../views/pdfInkSelection'

type InkEndEvent = {
  clientX: number
  clientY: number
  preventDefault: () => void
  stopPropagation: () => void
}

const INK_MERGE_WINDOW_MS = 1500

export function PdfInkSelectionLayer({
  enabled,
  draft,
  onStroke,
  onClearSelection,
  onOpenContextMenu,
}: {
  enabled: boolean
  draft?: { areas: PdfSelectionArea[]; status: 'recognizing' | 'ready' | 'error' } | null
  onStroke: (stroke: PdfInkStroke) => Promise<void> | void
  onClearSelection: () => void
  onOpenContextMenu: (position: { clientX: number; clientY: number }) => void
}) {
  const { t } = useTranslation()
  const layerRef = useRef<HTMLDivElement | null>(null)
  const lineRef = useRef<SVGPolylineElement | null>(null)
  const pointsRef = useRef<PdfInkPoint[]>([])
  const startPointRef = useRef<PdfInkPoint | null>(null)
  const queuedStrokesRef = useRef<PdfInkPoint[][]>([])
  const flushTimerRef = useRef<number | null>(null)
  const lastClientPointRef = useRef({ clientX: 0, clientY: 0 })
  const startClientPointRef = useRef({ clientX: 0, clientY: 0 })
  const inputSourceRef = useRef<'pointer' | 'mouse' | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [queuedStrokes, setQueuedStrokes] = useState<PdfInkPoint[][]>([])

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (enabled) return
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = null
    queuedStrokesRef.current = []
    pointsRef.current = []
    startPointRef.current = null
    inputSourceRef.current = null
    setQueuedStrokes([])
    setIsDrawing(false)
    lineRef.current?.setAttribute('points', '')
  }, [enabled])

  if (!enabled) return null

  const pointFromEvent = (event: { clientX: number; clientY: number }) => {
    const bounds = layerRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  const isPointInsideSelection = (point: PdfInkPoint) => {
    const padding = 0.012
    const areas = draft?.areas || []
    if (
      areas.some(
        (area) =>
          point.x >= area.x - padding &&
          point.x <= area.x + area.width + padding &&
          point.y >= area.y - padding &&
          point.y <= area.y + area.height + padding,
      )
    ) {
      return true
    }
    return queuedStrokesRef.current.some((stroke) => {
      const bounds = stroke.reduce(
        (current, candidate) => ({
          minX: Math.min(current.minX, candidate.x),
          maxX: Math.max(current.maxX, candidate.x),
          minY: Math.min(current.minY, candidate.y),
          maxY: Math.max(current.maxY, candidate.y),
        }),
        { minX: 1, maxX: 0, minY: 1, maxY: 0 },
      )
      return (
        point.x >= bounds.minX - padding &&
        point.x <= bounds.maxX + padding &&
        point.y >= bounds.minY - padding &&
        point.y <= bounds.maxY + padding
      )
    })
  }

  const clearPendingSelection = () => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = null
    queuedStrokesRef.current = []
    setQueuedStrokes([])
    pointsRef.current = []
    startPointRef.current = null
    lineRef.current?.setAttribute('points', '')
    onClearSelection()
  }

  const resetDrawing = () => {
    setIsDrawing(false)
    inputSourceRef.current = null
    pointsRef.current = []
    startPointRef.current = null
    lineRef.current?.setAttribute('points', '')
  }

  const renderPoints = () => {
    if (!lineRef.current) return
    lineRef.current.setAttribute(
      'points',
      pointsRef.current.map((point) => `${point.x},${point.y}`).join(' '),
    )
  }

  const renderStraightLineTo = (point: PdfInkPoint) => {
    const start = startPointRef.current
    if (!start) return
    // Keep the gesture as a stable underline even when the pointer moves
    // slightly up or down while crossing a scanned line of text.
    const lineY = start.y
    pointsRef.current = [
      { x: start.x, y: lineY },
      { x: point.x, y: lineY },
    ]
    renderPoints()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isRecognizing) return
    const point = pointFromEvent(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    inputSourceRef.current = 'pointer'
    event.currentTarget.setPointerCapture(event.pointerId)
    startClientPointRef.current = { clientX: event.clientX, clientY: event.clientY }
    startPointRef.current = point
    pointsRef.current = [point]
    setIsDrawing(true)
    requestAnimationFrame(renderPoints)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inputSourceRef.current !== 'pointer' || !isDrawing || (event.buttons & 1) === 0) return
    event.preventDefault()
    event.stopPropagation()
    const point = pointFromEvent(event)
    const previous = pointsRef.current.at(-1)
    if (!point || (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002))
      return
    if (pointsRef.current.length === 1 && flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    renderStraightLineTo(point)
  }

  const flushStrokes = async () => {
    const strokes = queuedStrokesRef.current
    if (strokes.length === 0) return
    queuedStrokesRef.current = []
    setIsRecognizing(true)
    try {
      await onStroke({
        points: strokes.flat(),
        strokes,
        ...lastClientPointRef.current,
      })
    } finally {
      setQueuedStrokes([])
      setIsRecognizing(false)
    }
  }

  const finishStroke = (event: InkEndEvent) => {
    if (!isDrawing) return
    event.preventDefault()
    event.stopPropagation()
    const point = pointFromEvent(event)
    if (point) renderStraightLineTo(point)
    const start = startClientPointRef.current
    const isClick = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 6
    if (isClick) {
      const insideSelection = point ? isPointInsideSelection(point) : false
      resetDrawing()
      if (!insideSelection) clearPendingSelection()
      return
    }
    const completedStroke = [...pointsRef.current]
    resetDrawing()
    queuedStrokesRef.current = [...queuedStrokesRef.current, completedStroke]
    setQueuedStrokes(queuedStrokesRef.current)
    lastClientPointRef.current = { clientX: event.clientX, clientY: event.clientY }
    pointsRef.current = []
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      void flushStrokes()
    }, INK_MERGE_WINDOW_MS)
  }

  // Keep a mouse-event fallback for embedded Chromium/PDF canvas hosts that
  // do not consistently forward Pointer Events through the overlay.
  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (inputSourceRef.current || event.button !== 0 || isRecognizing) return
    const point = pointFromEvent(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    inputSourceRef.current = 'mouse'
    startClientPointRef.current = { clientX: event.clientX, clientY: event.clientY }
    startPointRef.current = point
    pointsRef.current = [point]
    setIsDrawing(true)
    requestAnimationFrame(renderPoints)
  }

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (inputSourceRef.current !== 'mouse' || !isDrawing || (event.buttons & 1) === 0) return
    event.preventDefault()
    event.stopPropagation()
    const point = pointFromEvent(event)
    const previous = pointsRef.current.at(-1)
    if (!point || (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002))
      return
    if (pointsRef.current.length === 1 && flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    renderStraightLineTo(point)
  }

  const handleMouseUp = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (inputSourceRef.current === 'mouse') finishStroke(event)
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={layerRef}
      className="book-reader__pdf-ink-layer"
      aria-label={t('books.ocr_ink_layer_label')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(event) => {
        if (flushTimerRef.current !== null || isRecognizing) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        const point = pointFromEvent(event)
        if (!point || !isPointInsideSelection(point)) return
        event.preventDefault()
        event.stopPropagation()
        onOpenContextMenu({ clientX: event.clientX, clientY: event.clientY })
      }}
      onClick={(event) => {
        // Pointer/mouse handlers already decide whether this was a click or a stroke.
        event.stopPropagation()
      }}
    >
      <svg
        aria-hidden="true"
        className="book-reader__pdf-ink-canvas"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
      >
        {queuedStrokes.map((stroke, index) => (
          <polyline
            key={index}
            className="book-reader__pdf-ink-stroke"
            points={stroke.map((point) => `${point.x},${point.y}`).join(' ')}
          />
        ))}
        <polyline ref={lineRef} className="book-reader__pdf-ink-stroke" />
      </svg>
      {draft?.areas.map((area, index) => (
        <span
          key={`${area.x}-${area.y}-${index}`}
          aria-hidden="true"
          className={`book-reader__pdf-ink-draft is-${draft.status}`}
          style={{
            left: `${area.x * 100}%`,
            top: `${area.y * 100}%`,
            width: `${area.width * 100}%`,
            height: `${area.height * 100}%`,
          }}
        />
      ))}
      {isRecognizing || draft?.status === 'recognizing' ? (
        <span className="book-reader__pdf-ink-status" role="status">
          {t('books.ocr_recognizing_selection')}
        </span>
      ) : null}
    </div>
  )
}

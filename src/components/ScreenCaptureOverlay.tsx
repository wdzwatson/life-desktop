import { useEffect, useRef, useState } from 'react'
import { Copy, Download, Pencil, RotateCcw, Undo2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Point = { x: number; y: number }
type Rect = Point & { width: number; height: number }
type ScreenDisplay = { id: number; label: string; primary: boolean }
export type ScreenCaptureSelectionMode = 'full' | 'rectangle' | 'freeform'

const minimumSelection = 8

function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function ScreenCaptureOverlay({
  initialImageDataUrl,
  selectionMode = 'rectangle',
  onClose,
}: {
  initialImageDataUrl?: string | null
  selectionMode?: ScreenCaptureSelectionMode
  onClose: () => void
}) {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(initialImageDataUrl ?? null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [freeformPoints, setFreeformPoints] = useState<Point[]>([])
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [isLoading, setIsLoading] = useState(!initialImageDataUrl)
  const [isEditing, setIsEditing] = useState(false)
  const [displays, setDisplays] = useState<ScreenDisplay[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | undefined>()
  const [brushColor, setBrushColor] = useState('#ef4444')
  const [brushSize, setBrushSize] = useState(4)
  const [canUndo, setCanUndo] = useState(false)
  const [isSavingOutput, setIsSavingOutput] = useState(false)
  const [message, setMessage] = useState(() => t('screen_capture.select_hint'))
  const imageRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const editorDrawingRef = useRef(false)
  const editorLastPointRef = useRef<Point | null>(null)
  const editorHistoryRef = useRef<ImageData[]>([])
  const initialCaptureRef = useRef(Boolean(initialImageDataUrl))
  const isSavingOutputRef = useRef(false)

  const setOutputBusy = (busy: boolean) => {
    isSavingOutputRef.current = busy
    setIsSavingOutput(busy)
  }

  useEffect(() => {
    api?.listScreenDisplays?.().then((items: ScreenDisplay[]) => {
      if (!Array.isArray(items)) return
      setDisplays(items)
      setSelectedDisplayId(
        (current) => current ?? items.find((item) => item.primary)?.id ?? items[0]?.id,
      )
    })
  }, [api])

  useEffect(() => {
    if (initialCaptureRef.current || selectedDisplayId === undefined) return
    let isCurrent = true
    setIsLoading(true)
    const capture = api?.captureScreen?.({ displayId: selectedDisplayId })
    if (!capture) {
      setMessage(t('screen_capture.capture_failed'))
      setIsLoading(false)
      return () => {
        isCurrent = false
      }
    }
    capture
      .then((result: any) => {
        if (!isCurrent) return
        if (result?.success) setImageDataUrl(result.imageDataUrl)
        else setMessage(result?.error || t('screen_capture.capture_failed'))
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })
    return () => {
      isCurrent = false
    }
  }, [api, initialImageDataUrl, selectedDisplayId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const getImageRect = () => imageRef.current?.getBoundingClientRect()
  const toLocalPoint = (event: React.PointerEvent): Point | null => {
    const box = getImageRect()
    if (!box) return null
    return {
      x: Math.max(0, Math.min(box.width, event.clientX - box.left)),
      y: Math.max(0, Math.min(box.height, event.clientY - box.top)),
    }
  }

  const cropToDataUrl = () => {
    const image = imageRef.current
    if (!image) return null
    const box = image.getBoundingClientRect()
    const selected =
      selectionMode !== 'full' &&
      selection &&
      selection.width >= minimumSelection &&
      selection.height >= minimumSelection
        ? selection
        : { x: 0, y: 0, width: box.width, height: box.height }
    const scaleX = image.naturalWidth / box.width
    const scaleY = image.naturalHeight / box.height
    const freeformBounds =
      selectionMode === 'freeform' && freeformPoints.length >= 3
        ? {
            x: Math.min(...freeformPoints.map((point) => point.x)),
            y: Math.min(...freeformPoints.map((point) => point.y)),
            width:
              Math.max(...freeformPoints.map((point) => point.x)) -
              Math.min(...freeformPoints.map((point) => point.x)),
            height:
              Math.max(...freeformPoints.map((point) => point.y)) -
              Math.min(...freeformPoints.map((point) => point.y)),
          }
        : null
    const output =
      freeformBounds &&
      freeformBounds.width >= minimumSelection &&
      freeformBounds.height >= minimumSelection
        ? freeformBounds
        : selected
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(output.width * scaleX))
    canvas.height = Math.max(1, Math.round(output.height * scaleY))
    const context = canvas.getContext('2d')
    if (!context) return null
    if (freeformBounds && output === freeformBounds) {
      context.beginPath()
      freeformPoints.forEach((point, index) => {
        const x = (point.x - output.x) * scaleX
        const y = (point.y - output.y) * scaleY
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.closePath()
      context.clip()
    }
    context.drawImage(
      image,
      Math.round(output.x * scaleX),
      Math.round(output.y * scaleY),
      Math.round(output.width * scaleX),
      Math.round(output.height * scaleY),
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return canvas.toDataURL('image/png')
  }

  const ensureOutput = () => canvasRef.current?.toDataURL('image/png') ?? cropToDataUrl()

  const copyScreenshot = async () => {
    if (isSavingOutputRef.current) return
    const image = ensureOutput()
    if (!image) return
    setOutputBusy(true)
    try {
      const result = await api?.copyScreenshot?.(image)
      setMessage(
        result?.success
          ? t('screen_capture.copied')
          : result?.error || t('screen_capture.copy_failed'),
      )
    } finally {
      setOutputBusy(false)
    }
  }

  const saveScreenshot = async () => {
    if (isSavingOutputRef.current) return
    const image = ensureOutput()
    if (!image) return
    setOutputBusy(true)
    try {
      const result = await api?.saveScreenshot?.(image)
      setMessage(
        result?.success
          ? result.saved
            ? t('screen_capture.saved')
            : t('screen_capture.save_cancelled')
          : result?.error || t('screen_capture.save_failed'),
      )
    } finally {
      setOutputBusy(false)
    }
  }

  const startEditing = () => {
    const image = cropToDataUrl()
    if (!image) return
    setImageDataUrl(image)
    setSelection(null)
    setFreeformPoints([])
    setIsEditing(true)
    setMessage(t('screen_capture.editor_hint'))
  }

  const renderEditor = (resetHistory = true) => {
    const canvas = canvasRef.current
    if (!canvas || !imageDataUrl) return
    const image = new Image()
    image.onload = () => {
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d')?.drawImage(image, 0, 0)
      if (resetHistory) {
        editorHistoryRef.current = []
        setCanUndo(false)
      }
    }
    image.src = imageDataUrl
  }

  useEffect(() => {
    if (isEditing) renderEditor()
  }, [isEditing, imageDataUrl])

  const editorPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        Math.min(canvas.width, (event.clientX - rect.left) * (canvas.width / rect.width)),
      ),
      y: Math.max(
        0,
        Math.min(canvas.height, (event.clientY - rect.top) * (canvas.height / rect.height)),
      ),
    }
  }

  const drawTo = (point: Point) => {
    const canvas = canvasRef.current
    const previous = editorLastPointRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !previous || !context) return
    context.strokeStyle = brushColor
    context.lineWidth = Math.max(2, (canvas.width / 900) * brushSize)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(previous.x, previous.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    editorLastPointRef.current = point
  }

  const saveEditorHistory = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    editorHistoryRef.current = [
      ...editorHistoryRef.current.slice(-19),
      context.getImageData(0, 0, canvas.width, canvas.height),
    ]
    setCanUndo(true)
  }

  const undoEditor = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const previous = editorHistoryRef.current.pop()
    if (!canvas || !context || !previous) return
    context.putImageData(previous, 0, 0)
    setCanUndo(editorHistoryRef.current.length > 0)
  }

  const handleSelectionPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (event.button !== 0) return
    if (selectionMode === 'full') return
    const point = toLocalPoint(event)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart(point)
    if (selectionMode === 'freeform') setFreeformPoints([point])
    else setSelection(null)
  }

  const handleSelectionPointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!dragStart) return
    if ((event.buttons & 1) !== 1) {
      resetSelectionDrag()
      return
    }
    const point = toLocalPoint(event)
    if (!point) return
    if (selectionMode === 'freeform') {
      setFreeformPoints((points) => {
        const previous = points.at(-1)
        return previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 3
          ? points
          : [...points, point]
      })
    } else {
      setSelection(normalizeRect(dragStart, point))
    }
  }

  const handleSelectionPointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    const point = toLocalPoint(event)
    if (dragStart && point && selectionMode !== 'freeform')
      setSelection(normalizeRect(dragStart, point))
    setDragStart(null)
  }

  const resetSelectionDrag = () => setDragStart(null)

  const stopEditorDrawing = () => {
    editorDrawingRef.current = false
    editorLastPointRef.current = null
  }

  const handleEditorPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = editorPoint(event)
    if (!point) return
    event.preventDefault()
    saveEditorHistory()
    event.currentTarget.setPointerCapture(event.pointerId)
    editorDrawingRef.current = true
    editorLastPointRef.current = point
  }

  const handleEditorPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editorDrawingRef.current) return
    if ((event.buttons & 1) !== 1) {
      stopEditorDrawing()
      return
    }
    const point = editorPoint(event)
    if (point) drawTo(point)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('screen_capture.title')}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(7, 12, 22, .88)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(1120px, 100%)',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          color: '#f8fafc',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <div>
            <strong>{t('screen_capture.title')}</strong>
            <span style={{ marginLeft: 10, color: '#cbd5e1', fontSize: 12 }}>{message}</span>
          </div>
          <button className="btn sm" onClick={onClose} aria-label={t('screen_capture.close')}>
            <X size={16} /> Esc
          </button>
        </div>
        {displays.length > 1 && (
          <div
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
            aria-label={t('screen_capture.select_display')}
          >
            {displays.map((display) => (
              <button
                key={display.id}
                type="button"
                className={`btn sm ${selectedDisplayId === display.id ? 'primary' : ''}`}
                onClick={() => {
                  setSelectedDisplayId(display.id)
                  initialCaptureRef.current = false
                  setImageDataUrl(null)
                  setSelection(null)
                  setFreeformPoints([])
                  setIsEditing(false)
                }}
              >
                {display.label}
                {display.primary ? ` (${t('screen_capture.primary_display')})` : ''}
              </button>
            ))}
          </div>
        )}
        <div
          style={{
            minHeight: 220,
            overflow: 'auto',
            display: 'grid',
            placeItems: 'center',
            background: '#020617',
            borderRadius: 10,
            padding: 12,
          }}
        >
          {isLoading && <span>{t('screen_capture.loading')}</span>}
          {!isLoading && !imageDataUrl && <span>{message}</span>}
          {imageDataUrl && !isEditing && (
            <div style={{ position: 'relative', display: 'inline-flex', lineHeight: 0 }}>
              <img
                ref={imageRef}
                src={imageDataUrl}
                alt={t('screen_capture.image_alt')}
                draggable={false}
                onLoad={() =>
                  setMessage(
                    t(
                      selectionMode === 'full'
                        ? 'screen_capture.full_hint'
                        : selectionMode === 'freeform'
                          ? 'screen_capture.freeform_hint'
                          : 'screen_capture.select_hint',
                    ),
                  )
                }
                onPointerDown={handleSelectionPointerDown}
                onPointerMove={handleSelectionPointerMove}
                onPointerUp={handleSelectionPointerUp}
                onPointerCancel={resetSelectionDrag}
                onLostPointerCapture={resetSelectionDrag}
                style={{
                  maxWidth: 'min(100%, 1000px)',
                  maxHeight: '68vh',
                  userSelect: 'none',
                  touchAction: 'none',
                  cursor: selectionMode === 'full' ? 'default' : 'crosshair',
                }}
              />
              {selection && (
                <div
                  style={{
                    position: 'absolute',
                    left: selection.x,
                    top: selection.y,
                    width: selection.width,
                    height: selection.height,
                    border: '2px solid #60a5fa',
                    background: 'rgba(96,165,250,.12)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {freeformPoints.length > 1 && (
                <svg
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                >
                  <polyline
                    points={freeformPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill="rgba(96,165,250,.12)"
                    stroke="#60a5fa"
                    strokeWidth="2"
                  />
                </svg>
              )}
            </div>
          )}
          {imageDataUrl && isEditing && (
            <canvas
              ref={canvasRef}
              onPointerDown={handleEditorPointerDown}
              onPointerMove={handleEditorPointerMove}
              onPointerUp={stopEditorDrawing}
              onPointerCancel={stopEditorDrawing}
              onLostPointerCapture={stopEditorDrawing}
              style={{
                maxWidth: 'min(100%, 1000px)',
                maxHeight: '68vh',
                cursor: 'crosshair',
                touchAction: 'none',
                background: '#fff',
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {isEditing && (
            <>
              <input
                aria-label={t('screen_capture.brush_color')}
                type="color"
                value={brushColor}
                onChange={(event) => setBrushColor(event.target.value)}
                style={{ width: 34, padding: 2 }}
              />
              <input
                aria-label={t('screen_capture.brush_size')}
                type="range"
                min="2"
                max="16"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
              />
              <button className="btn sm" disabled={!canUndo} onClick={undoEditor}>
                <Undo2 size={14} /> {t('screen_capture.undo')}
              </button>
              <button className="btn sm" onClick={() => renderEditor()}>
                <RotateCcw size={14} /> {t('screen_capture.clear')}
              </button>
            </>
          )}
          {!isEditing && (
            <button className="btn sm" disabled={!imageDataUrl} onClick={startEditing}>
              <Pencil size={14} /> {t('screen_capture.edit')}
            </button>
          )}
          <button
            className="btn sm"
            disabled={!imageDataUrl || isSavingOutput}
            onClick={copyScreenshot}
          >
            <Copy size={14} /> {t('screen_capture.copy')}
          </button>
          <button
            className="btn sm primary"
            disabled={!imageDataUrl || isSavingOutput}
            onClick={saveScreenshot}
          >
            <Download size={14} /> {t('screen_capture.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

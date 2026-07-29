import { useEffect, useRef, useState } from 'react'
import { Copy, Download, Pencil, RotateCcw, Undo2, X } from 'lucide-react'

type Point = { x: number; y: number }
type Rect = Point & { width: number; height: number }
type ScreenDisplay = { id: number; label: string; primary: boolean }

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
  onClose,
}: {
  initialImageDataUrl?: string | null
  onClose: () => void
}) {
  const api = (window as any).electronAPI
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(initialImageDataUrl ?? null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [isLoading, setIsLoading] = useState(!initialImageDataUrl)
  const [isEditing, setIsEditing] = useState(false)
  const [displays, setDisplays] = useState<ScreenDisplay[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | undefined>()
  const [brushColor, setBrushColor] = useState('#ef4444')
  const [brushSize, setBrushSize] = useState(4)
  const [canUndo, setCanUndo] = useState(false)
  const [message, setMessage] = useState('拖动框选截图区域；未框选时将使用全屏。')
  const imageRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const editorDrawingRef = useRef(false)
  const editorLastPointRef = useRef<Point | null>(null)
  const editorHistoryRef = useRef<ImageData[]>([])
  const initialCaptureRef = useRef(Boolean(initialImageDataUrl))

  useEffect(() => {
    api?.listScreenDisplays?.().then((items: ScreenDisplay[]) => {
      if (!Array.isArray(items)) return
      setDisplays(items)
      setSelectedDisplayId((current) => current ?? items.find((item) => item.primary)?.id ?? items[0]?.id)
    })
  }, [api])

  useEffect(() => {
    if (initialCaptureRef.current || selectedDisplayId === undefined) return
    setIsLoading(true)
    api?.captureScreen?.({ displayId: selectedDisplayId }).then((result: any) => {
      if (result?.success) setImageDataUrl(result.imageDataUrl)
      else setMessage(result?.error || '截图失败，请重试。')
    }).finally(() => setIsLoading(false))
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
    const selected = selection && selection.width >= minimumSelection && selection.height >= minimumSelection
      ? selection
      : { x: 0, y: 0, width: box.width, height: box.height }
    const scaleX = image.naturalWidth / box.width
    const scaleY = image.naturalHeight / box.height
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(selected.width * scaleX))
    canvas.height = Math.max(1, Math.round(selected.height * scaleY))
    canvas.getContext('2d')?.drawImage(
      image,
      Math.round(selected.x * scaleX),
      Math.round(selected.y * scaleY),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return canvas.toDataURL('image/png')
  }

  const ensureOutput = () => canvasRef.current?.toDataURL('image/png') ?? cropToDataUrl()

  const copyScreenshot = async () => {
    const image = ensureOutput()
    if (!image) return
    const result = await api?.copyScreenshot?.(image)
    setMessage(result?.success ? '截图已复制到剪贴板。' : result?.error || '复制截图失败。')
  }

  const saveScreenshot = async () => {
    const image = ensureOutput()
    if (!image) return
    const result = await api?.saveScreenshot?.(image)
    setMessage(result?.success ? (result.saved ? '截图已另存为 PNG 图片。' : '已取消另存。') : result?.error || '保存截图失败。')
  }

  const startEditing = () => {
    const image = cropToDataUrl()
    if (!image) return
    setImageDataUrl(image)
    setSelection(null)
    setIsEditing(true)
    setMessage('编辑模式：按住鼠标绘制；可复制或另存编辑后的图片。')
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
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
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
    editorHistoryRef.current = [...editorHistoryRef.current.slice(-19), context.getImageData(0, 0, canvas.width, canvas.height)]
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="截图"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(7, 12, 22, .88)', display: 'grid', placeItems: 'center', padding: 24 }}
    >
      <div style={{ width: 'min(1120px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column', gap: 12, color: '#f8fafc' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div><strong>截图</strong><span style={{ marginLeft: 10, color: '#cbd5e1', fontSize: 12 }}>{message}</span></div>
          <button className="btn sm" onClick={onClose} aria-label="关闭截图"><X size={16} /> Esc</button>
        </div>
        {displays.length > 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label="选择显示器">
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
                  setIsEditing(false)
                }}
              >
                {display.label}{display.primary ? '（主显示器）' : ''}
              </button>
            ))}
          </div>
        )}
        <div style={{ minHeight: 220, overflow: 'auto', display: 'grid', placeItems: 'center', background: '#020617', borderRadius: 10, padding: 12 }}>
          {isLoading && <span>正在捕获屏幕…</span>}
          {!isLoading && !imageDataUrl && <span>{message}</span>}
          {imageDataUrl && !isEditing && (
            <div style={{ position: 'relative', display: 'inline-flex', lineHeight: 0 }}>
              <img
                ref={imageRef}
                src={imageDataUrl}
                alt="屏幕截图"
                draggable={false}
                onLoad={() => setMessage('拖动框选截图区域；未框选时将使用全屏。')}
                onPointerDown={(event) => { const point = toLocalPoint(event); if (point) { event.currentTarget.setPointerCapture(event.pointerId); setDragStart(point); setSelection(null) } }}
                onPointerMove={(event) => { if (!dragStart) return; const point = toLocalPoint(event); if (point) setSelection(normalizeRect(dragStart, point)) }}
                onPointerUp={(event) => { const point = toLocalPoint(event); if (dragStart && point) setSelection(normalizeRect(dragStart, point)); setDragStart(null) }}
                style={{ maxWidth: 'min(100%, 1000px)', maxHeight: '68vh', userSelect: 'none', touchAction: 'none', cursor: 'crosshair' }}
              />
              {selection && <div style={{ position: 'absolute', left: selection.x, top: selection.y, width: selection.width, height: selection.height, border: '2px solid #60a5fa', background: 'rgba(96,165,250,.12)', pointerEvents: 'none' }} />}
            </div>
          )}
          {imageDataUrl && isEditing && (
            <canvas
              ref={canvasRef}
              onPointerDown={(event) => { const point = editorPoint(event); if (point) { saveEditorHistory(); event.currentTarget.setPointerCapture(event.pointerId); editorDrawingRef.current = true; editorLastPointRef.current = point } }}
              onPointerMove={(event) => { if (!editorDrawingRef.current) return; const point = editorPoint(event); if (point) drawTo(point) }}
              onPointerUp={() => { editorDrawingRef.current = false; editorLastPointRef.current = null }}
              style={{ maxWidth: 'min(100%, 1000px)', maxHeight: '68vh', cursor: 'crosshair', touchAction: 'none', background: '#fff' }}
            />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {isEditing && (
            <>
              <input aria-label="画笔颜色" type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} style={{ width: 34, padding: 2 }} />
              <input aria-label="画笔粗细" type="range" min="2" max="16" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
              <button className="btn sm" disabled={!canUndo} onClick={undoEditor}><Undo2 size={14} /> 撤销</button>
              <button className="btn sm" onClick={() => renderEditor()}><RotateCcw size={14} /> 清除编辑</button>
            </>
          )}
          {!isEditing && <button className="btn sm" disabled={!imageDataUrl} onClick={startEditing}><Pencil size={14} /> 编辑</button>}
          <button className="btn sm" disabled={!imageDataUrl} onClick={copyScreenshot}><Copy size={14} /> 复制</button>
          <button className="btn sm primary" disabled={!imageDataUrl} onClick={saveScreenshot}><Download size={14} /> 另存为</button>
        </div>
      </div>
    </div>
  )
}

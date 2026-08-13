import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Crop,
  Download,
  Grid3X3,
  Layers2,
  Maximize2,
  Paintbrush,
  Pencil,
  RotateCcw,
  ScanText,
  Trash2,
  Type,
  TypeOutline,
  Undo2,
  Underline,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import mosaicCursorUrl from '../assets/cursors/mosaic-cursor.svg'
import pencilCursorUrl from '../assets/cursors/pencil-cursor.svg'
import {
  defaultScreenshotTextStyle,
  getScreenshotTextAabb,
  getScaledScreenshotTextSize,
  getScreenshotTextFont,
  screenshotTextContainsPoint,
  type ScreenshotTextBounds,
  type ScreenshotTextLayer,
  type ScreenshotTextStyle,
} from '../utils/screenshotEditorText'
import { normalizeScreenCaptureSelection } from '../utils/screenCaptureSelection'
import { resizeScreenshotCrop, type ScreenshotCropHandle } from '../utils/screenshotEditorCrop'

type Point = { x: number; y: number }
type Rect = Point & { width: number; height: number }
type ScreenDisplay = { id: number; label: string; primary: boolean }
type EditorTool = 'brush' | 'mosaic' | 'text' | 'crop'
type PendingText = { point: Point }
type EditorSnapshot = { imageData: ImageData; textLayers: ScreenshotTextLayer[] }
type TextDrag = { id: string; start: Point; origin: Point; historySaved: boolean }
type CropDrag = { handle: ScreenshotCropHandle; start: Point; origin: Rect }
export type ScreenCaptureSelectionMode = 'full' | 'rectangle' | 'freeform'

const minimumSelection = 8
const minimumEditorZoom = 0.5
const maximumEditorZoom = 3
const editorZoomStep = 0.25
const pencilCursor = `url("${pencilCursorUrl}") 6 25, crosshair`
const mosaicCursor = `url("${mosaicCursorUrl}") 16 16, cell`

function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

function cloneTextLayers(layers: ScreenshotTextLayer[]) {
  return layers.map((layer) => ({ ...layer }))
}

function measureTextLayer(
  context: CanvasRenderingContext2D,
  layer: ScreenshotTextLayer,
  canvasWidth: number,
): ScreenshotTextBounds {
  const scaledSize = getScaledScreenshotTextSize(layer.fontSize, canvasWidth)
  context.save()
  context.font = getScreenshotTextFont(layer, scaledSize)
  const width = Math.max(1, context.measureText(layer.text).width)
  context.restore()
  return { width, height: scaledSize * 1.25 }
}

function drawTextLayer(
  context: CanvasRenderingContext2D,
  layer: ScreenshotTextLayer,
  canvasWidth: number,
) {
  const scaledSize = getScaledScreenshotTextSize(layer.fontSize, canvasWidth)
  context.save()
  context.translate(layer.x, layer.y)
  context.rotate((layer.rotation * Math.PI) / 180)
  context.transform(1, 0, Math.tan((layer.skewX * Math.PI) / 180), 1, 0, 0)
  context.font = getScreenshotTextFont(layer, scaledSize)
  context.textBaseline = 'top'
  context.fillStyle = layer.color
  if (layer.shadow) {
    context.shadowColor = 'rgba(15, 23, 42, .65)'
    context.shadowBlur = Math.max(2, scaledSize / 7)
    context.shadowOffsetX = Math.max(1, scaledSize / 12)
    context.shadowOffsetY = Math.max(1, scaledSize / 12)
  }
  if (layer.outline) {
    context.strokeStyle = '#fff'
    context.lineWidth = Math.max(2, scaledSize / 12)
    context.lineJoin = 'round'
    context.strokeText(layer.text, 0, 0)
  }
  context.fillText(layer.text, 0, 0)
  if (layer.underline) {
    const width = context.measureText(layer.text).width
    context.shadowColor = 'transparent'
    context.strokeStyle = layer.color
    context.lineWidth = Math.max(1.5, scaledSize / 16)
    context.beginPath()
    context.moveTo(0, scaledSize * 1.08)
    context.lineTo(width, scaledSize * 1.08)
    context.stroke()
  }
  context.restore()
}

export function ScreenCaptureOverlay({
  initialImageDataUrl,
  selectionMode = 'rectangle',
  startInEditor = false,
  standalone = false,
  onClose,
}: {
  initialImageDataUrl?: string | null
  selectionMode?: ScreenCaptureSelectionMode
  startInEditor?: boolean
  standalone?: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(initialImageDataUrl ?? null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [freeformPoints, setFreeformPoints] = useState<Point[]>([])
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [isLoading, setIsLoading] = useState(!initialImageDataUrl)
  const [isEditing, setIsEditing] = useState(startInEditor && Boolean(initialImageDataUrl))
  const [displays, setDisplays] = useState<ScreenDisplay[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | undefined>()
  const [editorTool, setEditorTool] = useState<EditorTool>('brush')
  const [editorZoom, setEditorZoom] = useState(1)
  const [editorFitSize, setEditorFitSize] = useState<{ width: number; height: number } | null>(null)
  const [cropSelection, setCropSelection] = useState<Rect | null>(null)
  const [brushColor, setBrushColor] = useState('#ef4444')
  const [brushSize, setBrushSize] = useState(4)
  const [mosaicSize, setMosaicSize] = useState(36)
  const [textDefaults, setTextDefaults] = useState<ScreenshotTextStyle>(defaultScreenshotTextStyle)
  const [textLayers, setTextLayers] = useState<ScreenshotTextLayer[]>([])
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  const [hoveredTextId, setHoveredTextId] = useState<string | null>(null)
  const [pendingText, setPendingText] = useState<PendingText | null>(null)
  const [textValue, setTextValue] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [isSavingOutput, setIsSavingOutput] = useState(false)
  const [message, setMessage] = useState(() => t('screen_capture.select_hint'))
  const imageRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const textInputRef = useRef<HTMLInputElement | null>(null)
  const textLayersRef = useRef<ScreenshotTextLayer[]>([])
  const editorTextDragRef = useRef<TextDrag | null>(null)
  const cropDragRef = useRef<CropDrag | null>(null)
  const editorDrawingRef = useRef(false)
  const editorLastPointRef = useRef<Point | null>(null)
  const editorHistoryRef = useRef<EditorSnapshot[]>([])
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
      if (event.key !== 'Escape') return
      if (pendingText) {
        setPendingText(null)
        setTextValue('')
        return
      }
      if (selectedTextId) {
        setSelectedTextId(null)
        setHoveredTextId(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, pendingText, selectedTextId])

  useEffect(() => {
    if (pendingText) textInputRef.current?.focus()
  }, [pendingText])

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
    textLayersRef.current = []
    setTextLayers([])
    setSelectedTextId(null)
    setHoveredTextId(null)
    setCropSelection(null)
    setEditorZoom(1)
    setPendingText(null)
    setTextValue('')
    setIsEditing(true)
    setMessage(t('screen_capture.editor_hint'))
  }

  const renderEditorComposite = () => {
    const canvas = canvasRef.current
    const annotationCanvas = annotationCanvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !annotationCanvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(annotationCanvas, 0, 0)
    textLayersRef.current.forEach((layer) => drawTextLayer(context, layer, canvas.width))
  }

  const captureEditorFitSize = () => {
    requestAnimationFrame(() => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect?.width && rect.height) setEditorFitSize({ width: rect.width, height: rect.height })
    })
  }

  const setEditorTextLayers = (layers: ScreenshotTextLayer[]) => {
    textLayersRef.current = layers
    setTextLayers(layers)
    renderEditorComposite()
  }

  const renderEditor = (resetHistory = true) => {
    const canvas = canvasRef.current
    if (!canvas || !imageDataUrl) return
    setPendingText(null)
    setTextValue('')
    setSelectedTextId(null)
    setHoveredTextId(null)
    setCropSelection(null)
    setEditorZoom(1)
    setEditorFitSize(null)
    const image = new Image()
    image.onload = () => {
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const annotationCanvas = document.createElement('canvas')
      annotationCanvas.width = image.naturalWidth
      annotationCanvas.height = image.naturalHeight
      annotationCanvas.getContext('2d')?.drawImage(image, 0, 0)
      annotationCanvasRef.current = annotationCanvas
      textLayersRef.current = []
      setTextLayers([])
      renderEditorComposite()
      captureEditorFitSize()
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

  useEffect(() => {
    if (!isEditing) return
    const handleResize = () => {
      setEditorZoom(1)
      setEditorFitSize(null)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const rect = canvasRef.current?.getBoundingClientRect()
          if (rect?.width && rect.height)
            setEditorFitSize({ width: rect.width, height: rect.height })
        })
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isEditing])

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

  const editorPointFromClient = (clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (clientX - rect.left) * (canvas.width / rect.width))),
      y: Math.max(0, Math.min(canvas.height, (clientY - rect.top) * (canvas.height / rect.height))),
    }
  }

  const drawTo = (point: Point) => {
    const canvas = annotationCanvasRef.current
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
    renderEditorComposite()
  }

  const drawBrushDot = (point: Point) => {
    const canvas = annotationCanvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const lineWidth = Math.max(2, (canvas.width / 900) * brushSize)
    context.fillStyle = brushColor
    context.beginPath()
    context.arc(point.x, point.y, lineWidth / 2, 0, Math.PI * 2)
    context.fill()
    renderEditorComposite()
  }

  const applyMosaicAt = (point: Point) => {
    const canvas = annotationCanvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const diameter = Math.max(12, (canvas.width / 900) * mosaicSize)
    const left = Math.max(0, Math.floor(point.x - diameter / 2))
    const top = Math.max(0, Math.floor(point.y - diameter / 2))
    const width = Math.min(canvas.width - left, Math.ceil(diameter))
    const height = Math.min(canvas.height - top, Math.ceil(diameter))
    if (width <= 0 || height <= 0) return

    const pixelSize = Math.max(4, Math.round(diameter / 7))
    const sample = document.createElement('canvas')
    sample.width = Math.max(1, Math.ceil(width / pixelSize))
    sample.height = Math.max(1, Math.ceil(height / pixelSize))
    const sampleContext = sample.getContext('2d')
    if (!sampleContext) return
    sampleContext.drawImage(canvas, left, top, width, height, 0, 0, sample.width, sample.height)

    context.save()
    context.beginPath()
    context.arc(point.x, point.y, diameter / 2, 0, Math.PI * 2)
    context.clip()
    context.imageSmoothingEnabled = false
    context.drawImage(sample, 0, 0, sample.width, sample.height, left, top, width, height)
    context.restore()
  }

  const applyMosaicTo = (point: Point) => {
    const previous = editorLastPointRef.current
    const canvas = annotationCanvasRef.current
    if (!previous || !canvas) return
    const diameter = Math.max(12, (canvas.width / 900) * mosaicSize)
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
    const steps = Math.max(1, Math.ceil(distance / Math.max(2, diameter / 4)))
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps
      applyMosaicAt({
        x: previous.x + (point.x - previous.x) * progress,
        y: previous.y + (point.y - previous.y) * progress,
      })
    }
    editorLastPointRef.current = point
    renderEditorComposite()
  }

  const saveEditorHistory = () => {
    const canvas = annotationCanvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    editorHistoryRef.current = [
      ...editorHistoryRef.current.slice(-19),
      {
        imageData: context.getImageData(0, 0, canvas.width, canvas.height),
        textLayers: cloneTextLayers(textLayersRef.current),
      },
    ]
    setCanUndo(true)
  }

  const undoEditor = () => {
    const annotationCanvas = annotationCanvasRef.current
    const canvas = canvasRef.current
    const previous = editorHistoryRef.current.pop()
    if (!annotationCanvas || !canvas || !previous) return
    annotationCanvas.width = previous.imageData.width
    annotationCanvas.height = previous.imageData.height
    canvas.width = previous.imageData.width
    canvas.height = previous.imageData.height
    const context = annotationCanvas.getContext('2d')
    if (!context) return
    context.putImageData(previous.imageData, 0, 0)
    textLayersRef.current = cloneTextLayers(previous.textLayers)
    setTextLayers(textLayersRef.current)
    setPendingText(null)
    setTextValue('')
    setSelectedTextId(null)
    setCropSelection(null)
    setEditorZoom(1)
    setEditorFitSize(null)
    setCanUndo(editorHistoryRef.current.length > 0)
    renderEditorComposite()
    captureEditorFitSize()
  }

  const cancelPendingText = () => {
    setPendingText(null)
    setTextValue('')
  }

  const commitPendingText = () => {
    const canvas = canvasRef.current
    const value = textValue.trim()
    if (!canvas || !pendingText || !value) {
      cancelPendingText()
      return
    }

    saveEditorHistory()
    const layer: ScreenshotTextLayer = {
      ...textDefaults,
      id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: value,
      x: pendingText.point.x,
      y: pendingText.point.y,
    }
    const context = canvas.getContext('2d')
    if (context) {
      const bounds = measureTextLayer(context, layer, canvas.width)
      layer.x = Math.max(0, Math.min(layer.x, canvas.width - bounds.width - 4))
      layer.y = Math.max(0, Math.min(layer.y, canvas.height - bounds.height))
    }
    setEditorTextLayers([...textLayersRef.current, layer])
    setSelectedTextId(layer.id)
    cancelPendingText()
  }

  const updateTextStyle = <Key extends keyof ScreenshotTextStyle>(
    key: Key,
    value: ScreenshotTextStyle[Key],
    saveHistory = false,
  ) => {
    if (selectedTextId) {
      if (saveHistory) saveEditorHistory()
      setEditorTextLayers(
        textLayersRef.current.map((layer) =>
          layer.id === selectedTextId ? { ...layer, [key]: value } : layer,
        ),
      )
      return
    }
    setTextDefaults((current) => ({ ...current, [key]: value }))
  }

  const deleteSelectedText = () => {
    if (!selectedTextId) return
    saveEditorHistory()
    setEditorTextLayers(textLayersRef.current.filter((layer) => layer.id !== selectedTextId))
    setSelectedTextId(null)
    setHoveredTextId(null)
  }

  const getTextLayerAtPoint = (point: Point) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return null
    for (let index = textLayersRef.current.length - 1; index >= 0; index -= 1) {
      const layer = textLayersRef.current[index]
      const bounds = measureTextLayer(context, layer, canvas.width)
      if (screenshotTextContainsPoint(layer, bounds, point)) return layer
    }
    return null
  }

  const changeEditorZoom = (direction: -1 | 1) => {
    setEditorZoom((current) =>
      Math.max(
        minimumEditorZoom,
        Math.min(maximumEditorZoom, current + direction * editorZoomStep),
      ),
    )
  }

  const handleEditorWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    changeEditorZoom(event.deltaY < 0 ? 1 : -1)
  }

  const applyEditorCrop = () => {
    const canvas = canvasRef.current
    const annotationCanvas = annotationCanvasRef.current
    const sourceContext = canvas?.getContext('2d')
    const selection =
      canvas && cropSelection
        ? normalizeScreenCaptureSelection(cropSelection, {
            width: canvas.width,
            height: canvas.height,
          })
        : null
    if (!canvas || !annotationCanvas || !sourceContext || !selection) return

    const left = Math.max(0, Math.floor(selection.x))
    const top = Math.max(0, Math.floor(selection.y))
    const right = Math.min(canvas.width, Math.ceil(selection.x + selection.width))
    const bottom = Math.min(canvas.height, Math.ceil(selection.y + selection.height))
    const width = Math.max(1, right - left)
    const height = Math.max(1, bottom - top)
    saveEditorHistory()

    const croppedAnnotation = document.createElement('canvas')
    croppedAnnotation.width = width
    croppedAnnotation.height = height
    croppedAnnotation
      .getContext('2d')
      ?.drawImage(annotationCanvas, left, top, width, height, 0, 0, width, height)

    const croppedTextLayers = textLayersRef.current
      .filter((layer) => {
        const bounds = measureTextLayer(sourceContext, layer, canvas.width)
        const area = getScreenshotTextAabb(layer, bounds)
        return (
          area.x + area.width > left &&
          area.x < right &&
          area.y + area.height > top &&
          area.y < bottom
        )
      })
      .map((layer) => ({ ...layer, x: layer.x - left, y: layer.y - top }))

    annotationCanvas.width = width
    annotationCanvas.height = height
    annotationCanvas.getContext('2d')?.drawImage(croppedAnnotation, 0, 0)
    canvas.width = width
    canvas.height = height
    setEditorTextLayers(croppedTextLayers)
    setCropSelection(null)
    setSelectedTextId(null)
    setHoveredTextId(null)
    setEditorZoom(1)
    setEditorFitSize(null)
    setEditorTool('brush')
    captureEditorFitSize()
  }

  const selectEditorTool = (tool: EditorTool) => {
    stopEditorDrawing()
    cancelPendingText()
    setHoveredTextId(null)
    if (tool === 'crop') {
      const canvas = canvasRef.current
      if (canvas) setCropSelection({ x: 0, y: 0, width: canvas.width, height: canvas.height })
    } else setCropSelection(null)
    setEditorTool(tool)
    if (tool === 'crop') setMessage(t('screen_capture.crop_hint'))
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
    editorTextDragRef.current = null
    cropDragRef.current = null
  }

  const handleEditorPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = editorPoint(event)
    if (!point) return
    event.preventDefault()
    if (editorTool === 'crop') {
      return
    }
    if (editorTool === 'text') {
      const hitLayer = getTextLayerAtPoint(point)
      if (hitLayer) {
        cancelPendingText()
        setSelectedTextId(hitLayer.id)
        setHoveredTextId(hitLayer.id)
        editorTextDragRef.current = {
          id: hitLayer.id,
          start: point,
          origin: { x: hitLayer.x, y: hitLayer.y },
          historySaved: false,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      setSelectedTextId(null)
      setHoveredTextId(null)
      setPendingText({ point })
      setTextValue('')
      return
    }
    saveEditorHistory()
    event.currentTarget.setPointerCapture(event.pointerId)
    editorDrawingRef.current = true
    editorLastPointRef.current = point
    if (editorTool === 'brush') drawBrushDot(point)
    else {
      applyMosaicAt(point)
      renderEditorComposite()
    }
  }

  const handleEditorPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const textDrag = editorTextDragRef.current
    if (textDrag) {
      if ((event.buttons & 1) !== 1) {
        stopEditorDrawing()
        return
      }
      const point = editorPoint(event)
      const canvas = canvasRef.current
      if (!point || !canvas) return
      if (!textDrag.historySaved) {
        saveEditorHistory()
        textDrag.historySaved = true
      }
      const nextX = Math.max(
        0,
        Math.min(canvas.width, textDrag.origin.x + point.x - textDrag.start.x),
      )
      const nextY = Math.max(
        0,
        Math.min(canvas.height, textDrag.origin.y + point.y - textDrag.start.y),
      )
      setEditorTextLayers(
        textLayersRef.current.map((layer) =>
          layer.id === textDrag.id ? { ...layer, x: nextX, y: nextY } : layer,
        ),
      )
      return
    }
    if (editorTool === 'text' && !editorDrawingRef.current) {
      const point = editorPoint(event)
      setHoveredTextId(point ? (getTextLayerAtPoint(point)?.id ?? null) : null)
      return
    }
    if (!editorDrawingRef.current) return
    if ((event.buttons & 1) !== 1) {
      stopEditorDrawing()
      return
    }
    const point = editorPoint(event)
    if (!point) return
    if (editorTool === 'brush') drawTo(point)
    else if (editorTool === 'mosaic') applyMosaicTo(point)
  }

  const handleEditorPointerUp = () => {
    stopEditorDrawing()
  }

  const beginCropDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    handle: ScreenshotCropHandle,
  ) => {
    if (event.button !== 0 || !cropSelection) return
    const point = editorPointFromClient(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    cropDragRef.current = { handle, start: point, origin: { ...cropSelection } }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const updateCropDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current
    if (!drag || (event.buttons & 1) !== 1) return
    const point = editorPointFromClient(event.clientX, event.clientY)
    const canvas = canvasRef.current
    if (!point || !canvas) return
    const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y }
    setCropSelection(
      resizeScreenshotCrop(drag.origin, drag.handle, delta, {
        width: canvas.width,
        height: canvas.height,
      }),
    )
  }

  const endCropDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event) event.stopPropagation()
    cropDragRef.current = null
  }

  const selectedTextLayer = textLayers.find((layer) => layer.id === selectedTextId) ?? null
  const selectedTextBounds = (() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    return canvas && context && selectedTextLayer
      ? measureTextLayer(context, selectedTextLayer, canvas.width)
      : null
  })()
  const activeTextStyle: ScreenshotTextStyle = selectedTextLayer ?? textDefaults
  const validCropSelection =
    canvasRef.current && cropSelection
      ? (() => {
          const normalized = normalizeScreenCaptureSelection(cropSelection, {
            width: canvasRef.current.width,
            height: canvasRef.current.height,
          })
          if (!normalized) return null
          return normalized.width < canvasRef.current.width - 0.5 ||
            normalized.height < canvasRef.current.height - 0.5 ||
            normalized.x > 0.5 ||
            normalized.y > 0.5
            ? normalized
            : null
        })()
      : null
  const editorDisplaySize = editorFitSize
    ? {
        width: editorFitSize.width * editorZoom,
        height: editorFitSize.height * editorZoom,
      }
    : null
  const editorCursor =
    editorTool === 'brush'
      ? pencilCursor
      : editorTool === 'mosaic'
        ? mosaicCursor
        : editorTool === 'crop'
          ? 'crosshair'
          : hoveredTextId || editorTextDragRef.current
            ? 'move'
            : 'text'
  const cropHandles: Array<{
    handle: ScreenshotCropHandle
    left: string
    top: string
    transform: string
    cursor: string
  }> = [
    {
      handle: 'north-west',
      left: '0%',
      top: '0%',
      transform: 'translate(-50%, -50%)',
      cursor: 'nwse-resize',
    },
    {
      handle: 'north',
      left: '50%',
      top: '0%',
      transform: 'translate(-50%, -50%)',
      cursor: 'ns-resize',
    },
    {
      handle: 'north-east',
      left: '100%',
      top: '0%',
      transform: 'translate(-50%, -50%)',
      cursor: 'nesw-resize',
    },
    {
      handle: 'east',
      left: '100%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      cursor: 'ew-resize',
    },
    {
      handle: 'south-east',
      left: '100%',
      top: '100%',
      transform: 'translate(-50%, -50%)',
      cursor: 'nwse-resize',
    },
    {
      handle: 'south',
      left: '50%',
      top: '100%',
      transform: 'translate(-50%, -50%)',
      cursor: 'ns-resize',
    },
    {
      handle: 'south-west',
      left: '0%',
      top: '100%',
      transform: 'translate(-50%, -50%)',
      cursor: 'nesw-resize',
    },
    {
      handle: 'west',
      left: '0%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      cursor: 'ew-resize',
    },
  ]
  const cropPercent =
    cropSelection && canvasRef.current
      ? {
          left: (cropSelection.x / canvasRef.current.width) * 100,
          top: (cropSelection.y / canvasRef.current.height) * 100,
          width: (cropSelection.width / canvasRef.current.width) * 100,
          height: (cropSelection.height / canvasRef.current.height) * 100,
        }
      : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('screen_capture.title')}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: standalone ? '#05070a' : 'rgba(7, 12, 22, .88)',
        display: 'grid',
        placeItems: 'center',
        padding: standalone ? 12 : 24,
        fontFamily: standalone ? 'Satoshi, Outfit, system-ui, sans-serif' : undefined,
      }}
    >
      <div
        style={{
          width: standalone ? '100%' : 'min(1120px, 100%)',
          height: standalone ? '100%' : undefined,
          minHeight: 0,
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          color: '#f8fafc',
        }}
      >
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
                  setPendingText(null)
                  setTextValue('')
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
          onWheel={isEditing ? handleEditorWheel : undefined}
          style={{
            flex: standalone ? '1 1 0' : undefined,
            minHeight: standalone ? 0 : 220,
            maxHeight: standalone ? 'none' : 'calc(68vh + 24px)',
            overflow: 'auto',
            display: 'grid',
            placeItems: 'safe center',
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
            <div
              style={{
                position: 'relative',
                display: 'inline-flex',
                width: editorDisplaySize?.width,
                height: editorDisplaySize?.height,
                maxWidth: editorDisplaySize ? 'none' : standalone ? '100%' : 'min(100%, 1000px)',
                maxHeight: editorDisplaySize ? 'none' : standalone ? '100%' : '68vh',
                lineHeight: 0,
                overflow: 'visible',
              }}
            >
              <canvas
                ref={canvasRef}
                onPointerDown={handleEditorPointerDown}
                onPointerMove={handleEditorPointerMove}
                onPointerUp={handleEditorPointerUp}
                onPointerCancel={stopEditorDrawing}
                onLostPointerCapture={stopEditorDrawing}
                style={{
                  width: editorDisplaySize ? '100%' : undefined,
                  height: editorDisplaySize ? '100%' : undefined,
                  maxWidth: editorDisplaySize ? 'none' : '100%',
                  maxHeight: editorDisplaySize ? 'none' : standalone ? '100%' : '68vh',
                  cursor: editorCursor,
                  touchAction: 'none',
                  background: '#fff',
                }}
              />
              {pendingText && canvasRef.current && (
                <div
                  onPointerDown={(event) => event.stopPropagation()}
                  style={{
                    position: 'absolute',
                    left: `${(pendingText.point.x / canvasRef.current.width) * 100}%`,
                    top: `${(pendingText.point.y / canvasRef.current.height) * 100}%`,
                    transform:
                      pendingText.point.x > canvasRef.current.width * 0.65
                        ? 'translateX(-100%)'
                        : pendingText.point.x > canvasRef.current.width * 0.35
                          ? 'translateX(-50%)'
                          : undefined,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    zIndex: 2,
                    lineHeight: 1.2,
                  }}
                >
                  <input
                    ref={textInputRef}
                    type="text"
                    value={textValue}
                    placeholder={t('screen_capture.text_placeholder')}
                    aria-label={t('screen_capture.text_placeholder')}
                    onChange={(event) => setTextValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitPendingText()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        cancelPendingText()
                      }
                    }}
                    style={{
                      width: 'clamp(112px, 22vw, 210px)',
                      minWidth: 0,
                      padding: '7px 9px',
                      border: `2px solid ${textDefaults.color}`,
                      borderRadius: 6,
                      background: '#fff',
                      color: '#0f172a',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={commitPendingText}
                    aria-label={t('screen_capture.confirm_text')}
                    title={t('screen_capture.confirm_text')}
                    style={{ width: 32, height: 32, padding: 0 }}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={cancelPendingText}
                    aria-label={t('screen_capture.cancel_text')}
                    title={t('screen_capture.cancel_text')}
                    style={{ width: 32, height: 32, padding: 0 }}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              {editorTool === 'text' &&
                selectedTextLayer &&
                selectedTextBounds &&
                canvasRef.current && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: `${(selectedTextLayer.x / canvasRef.current.width) * 100}%`,
                      top: `${(selectedTextLayer.y / canvasRef.current.height) * 100}%`,
                      width: `${(selectedTextBounds.width / canvasRef.current.width) * 100}%`,
                      height: `${(selectedTextBounds.height / canvasRef.current.height) * 100}%`,
                      transform: `rotate(${selectedTextLayer.rotation}deg) skewX(${selectedTextLayer.skewX}deg)`,
                      transformOrigin: 'top left',
                      border: '2px dashed #60a5fa',
                      background: 'rgba(96, 165, 250, .08)',
                      boxSizing: 'border-box',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              {editorTool === 'crop' && cropSelection && cropPercent && (
                <>
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: `0 0 auto 0`,
                      height: `${cropPercent.top}%`,
                      background: 'rgba(2, 6, 23, .62)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: `${cropPercent.top + cropPercent.height}% 0 0 0`,
                      background: 'rgba(2, 6, 23, .62)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: `${cropPercent.top}%`,
                      width: `${cropPercent.left}%`,
                      height: `${cropPercent.height}%`,
                      background: 'rgba(2, 6, 23, .62)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: `${cropPercent.left + cropPercent.width}%`,
                      right: 0,
                      top: `${cropPercent.top}%`,
                      height: `${cropPercent.height}%`,
                      background: 'rgba(2, 6, 23, .62)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    role="presentation"
                    onPointerDown={(event) => beginCropDrag(event, 'move')}
                    onPointerMove={updateCropDrag}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                    style={{
                      position: 'absolute',
                      left: `${cropPercent.left}%`,
                      top: `${cropPercent.top}%`,
                      width: `${cropPercent.width}%`,
                      height: `${cropPercent.height}%`,
                      border: '2px solid #60a5fa',
                      outline: '1px solid rgba(255, 255, 255, .9)',
                      background: 'rgba(96, 165, 250, .08)',
                      boxSizing: 'border-box',
                      pointerEvents: 'auto',
                      cursor: 'move',
                      touchAction: 'none',
                    }}
                  >
                    {cropHandles.map(({ handle, left, top, transform, cursor }) => (
                      <div
                        key={handle}
                        role="button"
                        tabIndex={0}
                        aria-label={t('screen_capture.crop_handle')}
                        onPointerDown={(event) => beginCropDrag(event, handle)}
                        onPointerMove={updateCropDrag}
                        onPointerUp={endCropDrag}
                        onPointerCancel={endCropDrag}
                        style={{
                          position: 'absolute',
                          left,
                          top,
                          transform,
                          width: 12,
                          height: 12,
                          border: '2px solid #0f172a',
                          borderRadius: 2,
                          background: '#f8fafc',
                          boxShadow: '0 0 0 1px rgba(255,255,255,.9)',
                          cursor,
                          pointerEvents: 'auto',
                          touchAction: 'none',
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            flex: '0 0 auto',
            flexWrap: 'wrap',
          }}
        >
          {isEditing && (
            <>
              <div
                role="group"
                aria-label={t('screen_capture.editor_tools')}
                style={{ display: 'inline-flex', gap: 4 }}
              >
                <button
                  type="button"
                  className={`btn sm ${editorTool === 'brush' ? 'primary' : ''}`}
                  onClick={() => selectEditorTool('brush')}
                  title={t('screen_capture.tool_brush')}
                  aria-pressed={editorTool === 'brush'}
                >
                  <Paintbrush size={14} /> {t('screen_capture.tool_brush')}
                </button>
                <button
                  type="button"
                  className={`btn sm ${editorTool === 'mosaic' ? 'primary' : ''}`}
                  onClick={() => selectEditorTool('mosaic')}
                  title={t('screen_capture.tool_mosaic')}
                  aria-pressed={editorTool === 'mosaic'}
                >
                  <Grid3X3 size={14} /> {t('screen_capture.tool_mosaic')}
                </button>
                <button
                  type="button"
                  className={`btn sm ${editorTool === 'text' ? 'primary' : ''}`}
                  onClick={() => selectEditorTool('text')}
                  title={t('screen_capture.tool_text')}
                  aria-pressed={editorTool === 'text'}
                >
                  <Type size={14} /> {t('screen_capture.tool_text')}
                </button>
                <button
                  type="button"
                  className={`btn sm ${editorTool === 'crop' ? 'primary' : ''}`}
                  onClick={() => selectEditorTool('crop')}
                  title={t('screen_capture.tool_crop')}
                  aria-pressed={editorTool === 'crop'}
                >
                  <Crop size={14} /> {t('screen_capture.tool_crop')}
                </button>
              </div>
              {editorTool === 'brush' && (
                <input
                  aria-label={t('screen_capture.brush_color')}
                  title={t('screen_capture.brush_color')}
                  type="color"
                  value={brushColor}
                  onChange={(event) => setBrushColor(event.target.value)}
                  style={{ width: 34, padding: 2 }}
                />
              )}
              {editorTool === 'brush' && (
                <input
                  aria-label={t('screen_capture.brush_size')}
                  title={t('screen_capture.brush_size')}
                  type="range"
                  min="2"
                  max="16"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
              )}
              {editorTool === 'mosaic' && (
                <input
                  aria-label={t('screen_capture.mosaic_size')}
                  title={t('screen_capture.mosaic_size')}
                  type="range"
                  min="16"
                  max="80"
                  value={mosaicSize}
                  onChange={(event) => setMosaicSize(Number(event.target.value))}
                />
              )}
              {editorTool === 'text' && (
                <div
                  role="group"
                  aria-label={t('screen_capture.text_effects')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
                >
                  <input
                    aria-label={t('screen_capture.text_color')}
                    title={t('screen_capture.text_color')}
                    type="color"
                    value={activeTextStyle.color}
                    onPointerDown={() => selectedTextId && saveEditorHistory()}
                    onChange={(event) => updateTextStyle('color', event.target.value)}
                    style={{ width: 34, padding: 2 }}
                  />
                  <input
                    aria-label={t('screen_capture.text_size')}
                    title={t('screen_capture.text_size')}
                    type="range"
                    min="14"
                    max="96"
                    value={activeTextStyle.fontSize}
                    onPointerDown={() => selectedTextId && saveEditorHistory()}
                    onChange={(event) => updateTextStyle('fontSize', Number(event.target.value))}
                    style={{ width: 104 }}
                  />
                  <button
                    type="button"
                    className={`btn sm ${activeTextStyle.bold ? 'primary' : ''}`}
                    aria-label={t('screen_capture.text_bold')}
                    title={t('screen_capture.text_bold')}
                    aria-pressed={activeTextStyle.bold}
                    onClick={() => updateTextStyle('bold', !activeTextStyle.bold, true)}
                    style={{ width: 32, padding: 0 }}
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${activeTextStyle.italic ? 'primary' : ''}`}
                    aria-label={t('screen_capture.text_italic')}
                    title={t('screen_capture.text_italic')}
                    aria-pressed={activeTextStyle.italic}
                    onClick={() => updateTextStyle('italic', !activeTextStyle.italic, true)}
                    style={{ width: 32, padding: 0 }}
                  >
                    <em>I</em>
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${activeTextStyle.underline ? 'primary' : ''}`}
                    aria-label={t('screen_capture.text_underline')}
                    title={t('screen_capture.text_underline')}
                    aria-pressed={activeTextStyle.underline}
                    onClick={() => updateTextStyle('underline', !activeTextStyle.underline, true)}
                    style={{ width: 32, padding: 0 }}
                  >
                    <Underline size={14} />
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${activeTextStyle.outline ? 'primary' : ''}`}
                    aria-label={t('screen_capture.text_outline')}
                    title={t('screen_capture.text_outline')}
                    aria-pressed={activeTextStyle.outline}
                    onClick={() => updateTextStyle('outline', !activeTextStyle.outline, true)}
                    style={{ width: 32, padding: 0 }}
                  >
                    <TypeOutline size={14} />
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${activeTextStyle.shadow ? 'primary' : ''}`}
                    aria-label={t('screen_capture.text_shadow')}
                    title={t('screen_capture.text_shadow')}
                    aria-pressed={activeTextStyle.shadow}
                    onClick={() => updateTextStyle('shadow', !activeTextStyle.shadow, true)}
                    style={{ width: 32, padding: 0 }}
                  >
                    <Layers2 size={14} />
                  </button>
                  <label
                    title={t('screen_capture.text_rotation')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    <RotateCcw size={14} />
                    <input
                      aria-label={t('screen_capture.text_rotation')}
                      type="range"
                      min="-180"
                      max="180"
                      value={activeTextStyle.rotation}
                      onPointerDown={() => selectedTextId && saveEditorHistory()}
                      onChange={(event) => updateTextStyle('rotation', Number(event.target.value))}
                      style={{ width: 88 }}
                    />
                    <span style={{ width: 34, fontSize: 11, color: '#cbd5e1' }}>
                      {activeTextStyle.rotation}°
                    </span>
                  </label>
                  <label
                    title={t('screen_capture.text_skew')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    <ScanText size={14} />
                    <input
                      aria-label={t('screen_capture.text_skew')}
                      type="range"
                      min="-45"
                      max="45"
                      value={activeTextStyle.skewX}
                      onPointerDown={() => selectedTextId && saveEditorHistory()}
                      onChange={(event) => updateTextStyle('skewX', Number(event.target.value))}
                      style={{ width: 88 }}
                    />
                    <span style={{ width: 30, fontSize: 11, color: '#cbd5e1' }}>
                      {activeTextStyle.skewX}°
                    </span>
                  </label>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={!selectedTextId}
                    onClick={deleteSelectedText}
                    aria-label={t('screen_capture.delete_text')}
                    title={t('screen_capture.delete_text')}
                    style={{ width: 32, padding: 0 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
              {editorTool === 'crop' && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={!validCropSelection}
                    onClick={applyEditorCrop}
                  >
                    <Check size={14} /> {t('screen_capture.apply_crop')}
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setCropSelection(null)
                      setEditorTool('brush')
                    }}
                  >
                    <X size={14} /> {t('screen_capture.cancel_crop')}
                  </button>
                </div>
              )}
              <div
                role="group"
                aria-label={t('screen_capture.zoom_controls')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <button
                  type="button"
                  className="btn sm"
                  disabled={editorZoom <= minimumEditorZoom}
                  onClick={() => changeEditorZoom(-1)}
                  aria-label={t('screen_capture.zoom_out')}
                  title={t('screen_capture.zoom_out')}
                  style={{ width: 32, padding: 0 }}
                >
                  <ZoomOut size={14} />
                </button>
                <span
                  aria-live="polite"
                  style={{ width: 44, textAlign: 'center', fontSize: 11, color: '#cbd5e1' }}
                >
                  {Math.round(editorZoom * 100)}%
                </span>
                <button
                  type="button"
                  className="btn sm"
                  disabled={editorZoom >= maximumEditorZoom}
                  onClick={() => changeEditorZoom(1)}
                  aria-label={t('screen_capture.zoom_in')}
                  title={t('screen_capture.zoom_in')}
                  style={{ width: 32, padding: 0 }}
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={editorZoom === 1}
                  onClick={() => setEditorZoom(1)}
                  aria-label={t('screen_capture.zoom_reset')}
                  title={t('screen_capture.zoom_reset')}
                  style={{ width: 32, padding: 0 }}
                >
                  <Maximize2 size={14} />
                </button>
              </div>
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

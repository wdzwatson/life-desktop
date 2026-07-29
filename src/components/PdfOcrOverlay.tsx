import { useEffect, useRef, useState } from 'react'
import { ScanText, X } from 'lucide-react'

type Point = { x: number; y: number }
type Rect = Point & { width: number; height: number }

function getRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function PdfOcrOverlay({
  imageDataUrl,
  onRecognized,
  onClose,
}: {
  imageDataUrl: string
  onRecognized: (text: string) => void
  onClose: () => void
}) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const workerRef = useRef<any>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [progress, setProgress] = useState('正在准备 OCR…')
  const [isPreparing, setIsPreparing] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [errorDetail, setErrorDetail] = useState('')
  const ocrRuntimeBase = import.meta.env.DEV
    ? `${window.location.origin}/ocr/`
    : new URL('ocr/', document.baseURI).toString()

  const prepareWorker = async () => {
    if (workerRef.current || isPreparing === false && isReady) return
    setIsPreparing(true)
    setIsReady(false)
    setErrorDetail('')
    try {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker(['eng', 'chi_sim'], 1, {
        workerPath: `${ocrRuntimeBase}worker.min.js`,
        corePath: `${ocrRuntimeBase}tesseract-core-simd-lstm.wasm.js`,
        workerBlobURL: false,
        logger: (message) => {
          if (message.status === 'loading tesseract core') setProgress('正在加载本地 OCR 引擎…')
          else if (message.status === 'loading language traineddata') {
            setProgress(`正在下载免费语言包… ${Math.round((message.progress || 0) * 100)}%`)
          } else if (message.status === 'initializing tesseract') {
            setProgress('正在初始化文字识别…')
          } else if (message.status === 'recognizing text') {
            setProgress(`正在识别文字… ${Math.round((message.progress || 0) * 100)}%`)
          }
        },
      })
      workerRef.current = worker
      setIsReady(true)
      setProgress('OCR 已就绪。框选文字区域后点击“识别并翻译”。')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setErrorDetail(detail)
      setProgress('OCR 准备失败。请检查网络后重试。')
    } finally {
      setIsPreparing(false)
    }
  }

  useEffect(() => {
    void prepareWorker()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRecognizing) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      const worker = workerRef.current
      workerRef.current = null
      void worker?.terminate?.()
    }
    // OCR resources are prepared once for the modal lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pointFromEvent = (event: React.PointerEvent) => {
    const bounds = imageRef.current?.getBoundingClientRect()
    if (!bounds) return null
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    }
  }

  const getCroppedImage = () => {
    const image = imageRef.current
    if (!image) return null
    const bounds = image.getBoundingClientRect()
    const area = selection && selection.width > 8 && selection.height > 8
      ? selection
      : { x: 0, y: 0, width: bounds.width, height: bounds.height }
    const scaleX = image.naturalWidth / bounds.width
    const scaleY = image.naturalHeight / bounds.height
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(area.width * scaleX)
    canvas.height = Math.round(area.height * scaleY)
    const context = canvas.getContext('2d')
    context?.drawImage(
      image,
      Math.round(area.x * scaleX),
      Math.round(area.y * scaleY),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return canvas.toDataURL('image/png')
  }

  const recognize = async () => {
    const croppedImage = getCroppedImage()
    if (!croppedImage || isRecognizing || !workerRef.current) return
    setIsRecognizing(true)
    setProgress('正在识别文字…')
    try {
      const { data } = await workerRef.current.recognize(croppedImage)
      const text = data.text.replace(/\s+/g, ' ').trim()
      if (!text) {
        setProgress('没有识别到文字。请框选更小、更清晰的区域后重试。')
        return
      }
      onRecognized(text)
      onClose()
    } catch (error) {
      console.error('PDF OCR failed:', error)
      const detail = error instanceof Error ? error.message : String(error)
      setErrorDetail(detail)
      setProgress('识别未完成。可重新框选更清晰的区域后重试。')
    } finally {
      setIsRecognizing(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="扫描 PDF OCR 取词"
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(7, 12, 22, .9)', display: 'grid', placeItems: 'center', padding: 24 }}
    >
      <div style={{ width: 'min(1000px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column', gap: 12, color: '#f8fafc' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div><strong>扫描 PDF OCR 取词</strong><span style={{ marginLeft: 10, color: '#cbd5e1', fontSize: 12 }}>{progress}</span></div>
          <button className="btn sm" onClick={onClose} disabled={isRecognizing}><X size={16} /> Esc</button>
        </div>
        <div style={{ minHeight: 220, overflow: 'auto', display: 'grid', placeItems: 'center', background: '#020617', borderRadius: 10, padding: 12 }}>
          <div style={{ position: 'relative', lineHeight: 0 }}>
            <img
              ref={imageRef}
              src={imageDataUrl}
              alt="待识别的 PDF 页面"
              draggable={false}
              onPointerDown={(event) => { const point = pointFromEvent(event); if (point && !isRecognizing) { event.currentTarget.setPointerCapture(event.pointerId); setStart(point); setSelection(null) } }}
              onPointerMove={(event) => { if (!start) return; const point = pointFromEvent(event); if (point) setSelection(getRect(start, point)) }}
              onPointerUp={(event) => { const point = pointFromEvent(event); if (start && point) setSelection(getRect(start, point)); setStart(null) }}
              style={{ maxWidth: 'min(100%, 900px)', maxHeight: '68vh', cursor: isRecognizing ? 'wait' : 'crosshair', touchAction: 'none', userSelect: 'none' }}
            />
            {selection && <div style={{ position: 'absolute', left: selection.x, top: selection.y, width: selection.width, height: selection.height, border: '2px solid #60a5fa', background: 'rgba(96,165,250,.12)', pointerEvents: 'none' }} />}
          </div>
        </div>
        {errorDetail && <div style={{ color: '#fca5a5', fontSize: 12, lineHeight: 1.45 }}>详细原因：{errorDetail}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!isReady && <button className="btn" onClick={() => void prepareWorker()} disabled={isPreparing}>重试准备</button>}
          <button className="btn primary" onClick={() => void recognize()} disabled={!isReady || isRecognizing}>
            <ScanText size={14} /> {isRecognizing ? '识别中…' : '识别并翻译'}
          </button>
        </div>
      </div>
    </div>
  )
}

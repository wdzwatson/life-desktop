export type PdfOcrSymbol = {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export type PdfOcrWord = PdfOcrSymbol & {
  blockIndex?: number
  paragraphIndex?: number
  lineIndex?: number
  wordIndex?: number
  symbols?: PdfOcrSymbol[]
}

export type PdfOcrPage = {
  text: string
  words: PdfOcrWord[]
}

export type PdfOcrRegionArea = {
  x: number
  y: number
  width: number
  height: number
}

const normalizeRegionKeyValue = (value: number) =>
  Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 10000) / 10000

export function getPdfOcrRegionCacheKey(
  pageNumber: number,
  area: PdfOcrRegionArea,
  engineVersion: string,
  sourceSize?: { width: number; height: number },
) {
  return [
    engineVersion,
    Math.max(0, Math.trunc(pageNumber)),
    normalizeRegionKeyValue(area.x),
    normalizeRegionKeyValue(area.y),
    normalizeRegionKeyValue(area.width),
    normalizeRegionKeyValue(area.height),
    Math.max(0, Math.trunc(sourceSize?.width || 0)),
    Math.max(0, Math.trunc(sourceSize?.height || 0)),
  ].join(':')
}

export class PdfOcrRegionCache {
  private readonly entries = new Map<string, PdfOcrPage>()

  private readonly maxEntries: number

  constructor(maxEntries = 24) {
    this.maxEntries = Math.max(1, Math.trunc(maxEntries))
  }

  get(key: string) {
    const value = this.entries.get(key)
    if (!value) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: PdfOcrPage) {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) break
      this.entries.delete(oldestKey)
    }
  }

  clear() {
    this.entries.clear()
  }

  get size() {
    return this.entries.size
  }
}

type OcrProgress = (status: string, progress?: number) => void

export type PdfOcrOptions = {
  priority?: 'background' | 'user'
  signal?: AbortSignal
}

let workerPromise: Promise<any> | null = null
let currentProgressListener: OcrProgress | null = null
type QueuedRecognition = {
  image: string
  progressListener: OcrProgress
  options: PdfOcrOptions
  resolve: (page: PdfOcrPage) => void
  reject: (reason: unknown) => void
}

const userRecognitionQueue: QueuedRecognition[] = []
const backgroundRecognitionQueue: QueuedRecognition[] = []
let isRecognizing = false

function createAbortError() {
  return new DOMException('OCR request was cancelled.', 'AbortError')
}

const getRuntimeBase = () =>
  import.meta.env.DEV
    ? `${window.location.origin}/ocr/`
    : new URL('ocr/', document.baseURI).toString()

async function getWorker(progressListener: OcrProgress) {
  currentProgressListener = progressListener
  if (!workerPromise) {
    const runtimeBase = getRuntimeBase()
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) =>
        createWorker(['eng', 'chi_sim'], 1, {
          workerPath: `${runtimeBase}worker.min.js`,
          corePath: `${runtimeBase}tesseract-core-simd-lstm.wasm.js`,
          workerBlobURL: false,
          logger: (message) => currentProgressListener?.(message.status, message.progress),
        }),
      )
      .catch((error) => {
        // A rejected worker promise would make every later Retry fail until restart.
        workerPromise = null
        throw error
      })
  }
  return workerPromise
}

async function runRecognition(job: QueuedRecognition): Promise<PdfOcrPage> {
  const { image, progressListener, options } = job
  if (options.signal?.aborted) throw createAbortError()
  const worker = await getWorker(progressListener)
  currentProgressListener = progressListener
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
  if (options.signal?.aborted) throw createAbortError()
  const words: PdfOcrWord[] = []
  for (const [blockIndex, block] of (data.blocks || []).entries()) {
    for (const [paragraphIndex, paragraph] of (block.paragraphs || []).entries()) {
      for (const [lineIndex, line] of (paragraph.lines || []).entries()) {
        for (const [wordIndex, word] of (line.words || []).entries()) {
          const text = String(word.text || '').trim()
          const confidence = Number(word.confidence || 0)
          if (!text || confidence < 35) continue
          words.push({
            text,
            x: Number(word.bbox?.x0 || 0),
            y: Number(word.bbox?.y0 || 0),
            width: Math.max(1, Number(word.bbox?.x1 || 0) - Number(word.bbox?.x0 || 0)),
            height: Math.max(1, Number(word.bbox?.y1 || 0) - Number(word.bbox?.y0 || 0)),
            confidence,
            blockIndex,
            paragraphIndex,
            lineIndex,
            wordIndex,
            symbols: (word.symbols || [])
              .map((symbol: any) => ({
                text: String(symbol.text || ''),
                x: Number(symbol.bbox?.x0 || 0),
                y: Number(symbol.bbox?.y0 || 0),
                width: Math.max(1, Number(symbol.bbox?.x1 || 0) - Number(symbol.bbox?.x0 || 0)),
                height: Math.max(1, Number(symbol.bbox?.y1 || 0) - Number(symbol.bbox?.y0 || 0)),
                confidence: Number(symbol.confidence ?? confidence),
              }))
              .filter((symbol: PdfOcrSymbol) => symbol.text),
          })
        }
      }
    }
  }
  words
    // Margin specks are often emitted as a "word" with a very low score.
    // Do not let those phantom boxes become selectable/highlighted content.
    .sort((left: PdfOcrWord, right: PdfOcrWord) => {
      return (
        (left.blockIndex || 0) - (right.blockIndex || 0) ||
        (left.paragraphIndex || 0) - (right.paragraphIndex || 0) ||
        (left.lineIndex || 0) - (right.lineIndex || 0) ||
        (left.wordIndex || 0) - (right.wordIndex || 0)
      )
    })
  return {
    text: String(data.text || '')
      .replace(/\s+/g, ' ')
      .trim(),
    words,
  }
}

export function normalizePdfOcrPageGeometry(
  page: PdfOcrPage,
  targetWidth: number,
  targetHeight: number,
  offsetX = 0,
  offsetY = 0,
): PdfOcrPage {
  const normalizeUnit = <T extends PdfOcrSymbol>(unit: T): T => ({
    ...unit,
    x: (offsetX + unit.x) / targetWidth,
    y: (offsetY + unit.y) / targetHeight,
    width: unit.width / targetWidth,
    height: unit.height / targetHeight,
  })
  return {
    text: page.text,
    words: page.words.map((word) => ({
      ...normalizeUnit(word),
      symbols: word.symbols?.map(normalizeUnit),
    })),
  }
}

export async function recognizePdfCanvasRegion(
  sourceCanvas: HTMLCanvasElement,
  area: { x: number; y: number; width: number; height: number },
  progressListener: OcrProgress,
  options: PdfOcrOptions = {},
) {
  const x = Math.max(0, Math.floor(area.x * sourceCanvas.width))
  const y = Math.max(0, Math.floor(area.y * sourceCanvas.height))
  const width = Math.max(
    1,
    Math.min(sourceCanvas.width - x, Math.ceil(area.width * sourceCanvas.width)),
  )
  const height = Math.max(
    1,
    Math.min(sourceCanvas.height - y, Math.ceil(area.height * sourceCanvas.height)),
  )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height)
  try {
    const result = await recognizePdfPage(
      canvas.toDataURL('image/jpeg', 0.94),
      progressListener,
      options,
    )
    return normalizePdfOcrPageGeometry(result, sourceCanvas.width, sourceCanvas.height, x, y)
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}

function pumpRecognitionQueue() {
  if (isRecognizing) return
  const job = userRecognitionQueue.shift() ?? backgroundRecognitionQueue.shift()
  if (!job) return

  if (job.options.signal?.aborted) {
    job.reject(createAbortError())
    pumpRecognitionQueue()
    return
  }

  isRecognizing = true
  void runRecognition(job)
    .then(job.resolve, job.reject)
    .finally(() => {
      isRecognizing = false
      pumpRecognitionQueue()
    })
}

export function recognizePdfPage(
  image: string,
  progressListener: OcrProgress,
  options: PdfOcrOptions = {},
): Promise<PdfOcrPage> {
  return new Promise<PdfOcrPage>((resolve, reject) => {
    const job = { image, progressListener, options, resolve, reject }
    if (options.priority === 'user') userRecognitionQueue.push(job)
    else backgroundRecognitionQueue.push(job)
    pumpRecognitionQueue()
  })
}

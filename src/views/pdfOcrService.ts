export type PdfOcrWord = {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export type PdfOcrPage = {
  text: string
  words: PdfOcrWord[]
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
  const words = (data.blocks || [])
    .flatMap((block: any) => block.paragraphs || [])
    .flatMap((paragraph: any) => paragraph.lines || [])
    .flatMap((line: any) => line.words || [])
    .map((word: any) => ({
      text: String(word.text || '').trim(),
      x: Number(word.bbox?.x0 || 0),
      y: Number(word.bbox?.y0 || 0),
      width: Math.max(1, Number(word.bbox?.x1 || 0) - Number(word.bbox?.x0 || 0)),
      height: Math.max(1, Number(word.bbox?.y1 || 0) - Number(word.bbox?.y0 || 0)),
      confidence: Number(word.confidence || 0),
    }))
    // Margin specks are often emitted as a "word" with a very low score.
    // Do not let those phantom boxes become selectable/highlighted content.
    .filter((word: PdfOcrWord) => word.text && word.confidence >= 35)
    // Tesseract blocks are not guaranteed to be emitted in visual reading
    // order. Sorting here makes a drag from one word to another select only
    // the text between them, instead of including a stray block at the margin.
    .sort((left: PdfOcrWord, right: PdfOcrWord) => {
      const leftCenterY = left.y + left.height / 2
      const rightCenterY = right.y + right.height / 2
      const lineTolerance = Math.max(4, Math.min(24, Math.max(left.height, right.height) * 0.7))
      if (Math.abs(leftCenterY - rightCenterY) > lineTolerance) return leftCenterY - rightCenterY
      return left.x - right.x
    })
  return { text: String(data.text || '').replace(/\s+/g, ' ').trim(), words }
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

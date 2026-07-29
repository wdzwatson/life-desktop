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

let workerPromise: Promise<any> | null = null
let currentProgressListener: OcrProgress | null = null
let recognitionQueue: Promise<void> = Promise.resolve()

const getRuntimeBase = () =>
  import.meta.env.DEV
    ? `${window.location.origin}/ocr/`
    : new URL('ocr/', document.baseURI).toString()

async function getWorker(progressListener: OcrProgress) {
  currentProgressListener = progressListener
  if (!workerPromise) {
    const runtimeBase = getRuntimeBase()
    workerPromise = import('tesseract.js').then(({ createWorker }) =>
      createWorker(['eng', 'chi_sim'], 1, {
        workerPath: `${runtimeBase}worker.min.js`,
        corePath: `${runtimeBase}tesseract-core-simd-lstm.wasm.js`,
        workerBlobURL: false,
        logger: (message) => currentProgressListener?.(message.status, message.progress),
      }),
    )
  }
  return workerPromise
}

export async function recognizePdfPage(
  image: string,
  progressListener: OcrProgress,
): Promise<PdfOcrPage> {
  // Tesseract workers process one recognition request at a time. Keeping an
  // explicit queue avoids colliding jobs when dual-page/scroll layouts render
  // several scanned pages together, and keeps progress attached to its page.
  const run = recognitionQueue.then(async () => {
    const worker = await getWorker(progressListener)
    currentProgressListener = progressListener
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
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
    return { text: String(data.text || '').replace(/\s+/g, ' ').trim(), words } satisfies PdfOcrPage
  })
  recognitionQueue = run.then(() => undefined, () => undefined)
  return run
}

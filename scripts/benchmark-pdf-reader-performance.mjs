import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const rootUrl = new URL('../', import.meta.url)
const fixtureUrl = (name) => new URL(`docs/archive/qa/assets/reader-at15/${name}`, rootUrl)
const samples = [
  { id: 'scanned', file: 'at15-scanned.pdf', targetPage: 1 },
  { id: 'hidden-ocr', file: 'at15-hidden-ocr.pdf', targetPage: 1 },
  { id: 'text', file: 'at15-multicolumn-deep-outline.pdf', targetPage: 8 },
  { id: 'mixed', file: 'at15-mixed.pdf', targetPage: 2 },
]

const round = (value) => Math.round(value * 1000) / 1000

const measurePdfSample = async (sample) => {
  const data = new Uint8Array(await readFile(fileURLToPath(fixtureUrl(sample.file))))
  const loadStartedAt = performance.now()
  const loadingTask = getDocument({ data, disableWorker: true })
  const document = await loadingTask.promise
  const documentLoadMs = performance.now() - loadStartedAt
  try {
    const coldStartedAt = performance.now()
    const targetPage = await document.getPage(sample.targetPage)
    await targetPage.getOperatorList()
    const coldPageStageMs = performance.now() - coldStartedAt

    const textStartedAt = performance.now()
    const textContent = await targetPage.getTextContent()
    const textContentMs = performance.now() - textStartedAt

    const hotStartedAt = performance.now()
    await (await document.getPage(sample.targetPage)).getOperatorList()
    const hotPageStageMs = performance.now() - hotStartedAt

    const sequenceStartedAt = performance.now()
    const sequence = Array.from({ length: Math.min(document.numPages, 4) }, (_, index) => index + 1)
    for (const pageNumber of sequence) await (await document.getPage(pageNumber)).getOperatorList()
    const consecutivePageStageMs = (performance.now() - sequenceStartedAt) / sequence.length

    return {
      id: sample.id,
      pageCount: document.numPages,
      documentLoadMs: round(documentLoadMs),
      coldPageStageMs: round(coldPageStageMs),
      hotPageStageMs: round(hotPageStageMs),
      consecutivePageStageMs: round(consecutivePageStageMs),
      textContentMs: round(textContentMs),
      textItemCount: textContent.items.length,
    }
  } finally {
    await document.destroy()
  }
}

const pdfSamples = []
for (const sample of samples) pdfSamples.push(await measurePdfSample(sample))
process.stdout.write(`${JSON.stringify({ measuredAt: new Date().toISOString(), pdfSamples }, null, 2)}\n`)

import type { TextContent } from 'pdfjs-dist/types/src/display/api'

export type PdfDetectedTextMode = 'text' | 'scanned'

const MIN_SELECTABLE_CHARACTER_COUNT = 2

export const detectPdfPageTextMode = (
  textContent: Pick<TextContent, 'items'>,
): PdfDetectedTextMode => {
  let characterCount = 0
  for (const item of textContent.items) {
    if (!('str' in item) || typeof item.str !== 'string') continue
    characterCount += item.str.trim().length
    if (characterCount >= MIN_SELECTABLE_CHARACTER_COUNT) return 'text'
  }
  return 'scanned'
}


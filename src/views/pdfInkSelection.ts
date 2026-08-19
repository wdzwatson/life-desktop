import { joinOcrWords } from '../ocrTextUtils'
import type { PdfSelectionArea } from './bookReaderUtils'
import type { PdfOcrWord } from './pdfOcrService'

export type PdfInkPoint = { x: number; y: number }

export type PdfInkStroke = {
  points: PdfInkPoint[]
  strokes?: PdfInkPoint[][]
  clientX: number
  clientY: number
}

export type PdfInkSelectionPlan = {
  visualArea: PdfSelectionArea
  cropArea: PdfSelectionArea
}

export type PdfOcrParagraphSelection = {
  text: string
  areas: PdfSelectionArea[]
  confidence: number
  bounds: PdfSelectionArea
  lineCount: number
}

type PixelBuffer = {
  data: Uint8ClampedArray
  width: number
  height: number
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))

export function getPdfInkStrokeBounds(points: PdfInkPoint[]): PdfSelectionArea | null {
  if (points.length < 2) return null
  let left = 1
  let right = 0
  let top = 1
  let bottom = 0
  for (const point of points) {
    left = Math.min(left, clamp(point.x))
    right = Math.max(right, clamp(point.x))
    top = Math.min(top, clamp(point.y))
    bottom = Math.max(bottom, clamp(point.y))
  }
  if (right - left < 0.012) return null
  return { x: left, y: top, width: right - left, height: Math.max(0.002, bottom - top) }
}

export function detectNearestTextBand(buffer: PixelBuffer, strokeY: number) {
  if (
    buffer.width < 2 ||
    buffer.height < 2 ||
    buffer.data.length < buffer.width * buffer.height * 4
  ) {
    return null
  }

  let luminanceTotal = 0
  let sampleCount = 0
  const sampleStepX = Math.max(1, Math.floor(buffer.width / 80))
  const sampleStepY = Math.max(1, Math.floor(buffer.height / 80))
  for (let y = 0; y < buffer.height; y += sampleStepY) {
    for (let x = 0; x < buffer.width; x += sampleStepX) {
      const offset = (y * buffer.width + x) * 4
      luminanceTotal +=
        buffer.data[offset] * 0.299 +
        buffer.data[offset + 1] * 0.587 +
        buffer.data[offset + 2] * 0.114
      sampleCount += 1
    }
  }
  const averageLuminance = sampleCount ? luminanceTotal / sampleCount : 255
  const darkThreshold = Math.max(80, Math.min(210, averageLuminance - 24))
  const density = new Float64Array(buffer.height)

  for (let y = 0; y < buffer.height; y += 1) {
    let darkPixels = 0
    for (let x = 0; x < buffer.width; x += 1) {
      const offset = (y * buffer.width + x) * 4
      const luminance =
        buffer.data[offset] * 0.299 +
        buffer.data[offset + 1] * 0.587 +
        buffer.data[offset + 2] * 0.114
      if (buffer.data[offset + 3] > 24 && luminance < darkThreshold) darkPixels += 1
    }
    density[y] = darkPixels / buffer.width
  }

  const smoothRadius = Math.max(1, Math.round(buffer.height * 0.012))
  const smoothed = new Float64Array(buffer.height)
  let peak = 0
  for (let y = 0; y < buffer.height; y += 1) {
    let total = 0
    let count = 0
    for (
      let sampleY = Math.max(0, y - smoothRadius);
      sampleY <= Math.min(buffer.height - 1, y + smoothRadius);
      sampleY += 1
    ) {
      total += density[sampleY]
      count += 1
    }
    smoothed[y] = count ? total / count : 0
    peak = Math.max(peak, smoothed[y])
  }
  if (peak < 0.008) return null

  const activeThreshold = Math.max(0.006, peak * 0.16)
  const gapTolerance = Math.max(2, Math.round(buffer.height * 0.025))
  const bands: Array<{ top: number; bottom: number; lastActive: number }> = []
  for (let y = 0; y < buffer.height; y += 1) {
    if (smoothed[y] < activeThreshold) continue
    const current = bands.at(-1)
    if (!current || y - current.lastActive > gapTolerance) {
      bands.push({ top: y, bottom: y, lastActive: y })
      continue
    }
    current.bottom = y
    current.lastActive = y
  }

  const targetY = clamp(strokeY, 0, buffer.height - 1)
  const candidates = bands.filter((band) => {
    const height = band.bottom - band.top + 1
    return height >= Math.max(2, buffer.height * 0.025) && height <= buffer.height * 0.8
  })
  if (candidates.length === 0) return null

  const selected = candidates.reduce((best, candidate) => {
    const candidateGap = targetY - candidate.bottom
    const bestGap = targetY - best.bottom
    const candidateScore =
      Math.abs(candidateGap) + (candidateGap < -buffer.height * 0.08 ? buffer.height : 0)
    const bestScore = Math.abs(bestGap) + (bestGap < -buffer.height * 0.08 ? buffer.height : 0)
    return candidateScore < bestScore ? candidate : best
  })
  const padding = Math.max(1, Math.round((selected.bottom - selected.top + 1) * 0.16))
  return {
    top: Math.max(0, selected.top - padding),
    bottom: Math.min(buffer.height - 1, selected.bottom + padding),
  }
}

export function createPdfInkSelectionPlan(
  canvas: HTMLCanvasElement,
  points: PdfInkPoint[],
): PdfInkSelectionPlan | null {
  const stroke = getPdfInkStrokeBounds(points)
  if (!stroke || canvas.width < 2 || canvas.height < 2) return null

  const strokeCenterY = clamp(stroke.y + stroke.height / 2)
  const sampleLeft = clamp(stroke.x - 0.018)
  const sampleRight = clamp(stroke.x + stroke.width + 0.018)
  const sampleTop = clamp(strokeCenterY - 0.085)
  const sampleBottom = clamp(strokeCenterY + 0.018)
  const pixelX = Math.floor(sampleLeft * canvas.width)
  const pixelY = Math.floor(sampleTop * canvas.height)
  const pixelWidth = Math.max(2, Math.ceil((sampleRight - sampleLeft) * canvas.width))
  const pixelHeight = Math.max(2, Math.ceil((sampleBottom - sampleTop) * canvas.height))

  let lineTop = clamp(strokeCenterY - 0.028)
  let lineBottom = clamp(strokeCenterY + 0.006)
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const pixels = context?.getImageData(pixelX, pixelY, pixelWidth, pixelHeight)
    const band = pixels
      ? detectNearestTextBand(pixels, strokeCenterY * canvas.height - pixelY)
      : null
    if (band) {
      lineTop = clamp((pixelY + band.top) / canvas.height)
      lineBottom = clamp((pixelY + band.bottom + 1) / canvas.height)
    }
  } catch {
    // The geometric fallback remains usable if the canvas cannot be sampled.
  }

  const lineHeight = Math.max(0.012, lineBottom - lineTop)
  const visualArea = {
    x: stroke.x,
    y: lineTop,
    width: stroke.width,
    height: lineHeight,
  }
  const horizontalPadding = Math.max(0.025, Math.min(0.07, stroke.width * 0.18))
  const cropTop = clamp(lineTop - lineHeight * 0.45)
  const cropBottom = clamp(lineBottom + lineHeight * 0.45)
  return {
    visualArea,
    cropArea: {
      x: clamp(stroke.x - horizontalPadding),
      y: cropTop,
      width:
        clamp(stroke.x + stroke.width + horizontalPadding) - clamp(stroke.x - horizontalPadding),
      height: Math.max(0.015, cropBottom - cropTop),
    },
  }
}

const unionAreas = (areas: PdfSelectionArea[]): PdfSelectionArea => {
  const left = Math.min(...areas.map((area) => area.x))
  const top = Math.min(...areas.map((area) => area.y))
  const right = Math.max(...areas.map((area) => area.x + area.width))
  const bottom = Math.max(...areas.map((area) => area.y + area.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

const isFiniteArea = (area: PdfSelectionArea) =>
  Number.isFinite(area.x) &&
  Number.isFinite(area.y) &&
  Number.isFinite(area.width) &&
  Number.isFinite(area.height) &&
  area.width > 0 &&
  area.height > 0

const cjkBoundary =
  /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af，。！？；：、（）《》〈〉“”‘’…—]/u
const latinLowercaseStart = /^[a-z]/

const isLikelyTabularParagraph = (words: PdfOcrWord[]) => {
  const wordsByLine = new Map<number, PdfOcrWord[]>()
  for (const word of words) {
    const lineIndex = word.lineIndex as number
    const line = wordsByLine.get(lineIndex) ?? []
    line.push(word)
    wordsByLine.set(lineIndex, line)
  }
  const repeatedGapCenters: number[] = []
  for (const lineWords of wordsByLine.values()) {
    const sorted = lineWords.toSorted((left, right) => left.x - right.x)
    const gapCenters: number[] = []
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      const gap = current.x - (previous.x + previous.width)
      if (gap >= 0.075) gapCenters.push(previous.x + previous.width + gap / 2)
    }
    for (const center of gapCenters) {
      const existing = repeatedGapCenters.findIndex(
        (candidate) => Math.abs(candidate - center) < 0.035,
      )
      if (existing >= 0) return true
      repeatedGapCenters.push(center)
    }
  }
  return false
}

export function joinPdfOcrParagraphWords(words: PdfOcrWord[]) {
  if (words.length === 0) return ''
  const paragraphs = new Map<string, Map<number, PdfOcrWord[]>>()
  for (const word of words) {
    if (
      !Number.isInteger(word.blockIndex) ||
      !Number.isInteger(word.paragraphIndex) ||
      !Number.isInteger(word.lineIndex) ||
      !Number.isInteger(word.wordIndex)
    ) {
      return ''
    }
    const paragraphKey = `${word.blockIndex}:${word.paragraphIndex}`
    const lines = paragraphs.get(paragraphKey) ?? new Map<number, PdfOcrWord[]>()
    const line = lines.get(word.lineIndex as number) ?? []
    line.push(word)
    lines.set(word.lineIndex as number, line)
    paragraphs.set(paragraphKey, lines)
  }

  return [...paragraphs.values()]
    .map((lines) => {
      const lineTexts = [...lines.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, lineWords]) =>
          joinOcrWords(
            lineWords
              .toSorted(
                (left, right) =>
                  (left.wordIndex as number) - (right.wordIndex as number) || left.x - right.x,
              )
              .map((word) => ({ text: word.text })),
          ).trim(),
        )
        .filter(Boolean)

      return lineTexts.reduce((paragraph, line) => {
        if (!paragraph) return line
        const previousCharacter = paragraph.at(-1) || ''
        const nextCharacter = line.at(0) || ''
        if (
          (previousCharacter === '-' || previousCharacter === '\u00ad') &&
          latinLowercaseStart.test(line)
        ) {
          return `${paragraph.slice(0, -1)}${line}`
        }
        return cjkBoundary.test(previousCharacter) || cjkBoundary.test(nextCharacter)
          ? `${paragraph}${line}`
          : `${paragraph} ${line}`
      }, '')
    })
    .filter(Boolean)
    .join('\n\n')
}

export function selectPdfOcrParagraph(
  words: PdfOcrWord[],
  currentAreas: PdfSelectionArea[],
): PdfOcrParagraphSelection | null {
  const anchors = currentAreas.filter(isFiniteArea)
  if (words.length === 0 || anchors.length === 0) return null

  const matchingParagraphs = new Set<string>()
  for (const word of words) {
    if (!Number.isInteger(word.blockIndex) || !Number.isInteger(word.paragraphIndex)) continue
    const matchesAnchor = anchors.some((area) => {
      const padding = 0.006
      const horizontal = overlap(
        word.x,
        word.x + word.width,
        area.x - padding,
        area.x + area.width + padding,
      )
      const vertical = overlap(
        word.y,
        word.y + word.height,
        area.y - padding,
        area.y + area.height + padding,
      )
      return horizontal > 0 && vertical > 0
    })
    if (matchesAnchor) matchingParagraphs.add(`${word.blockIndex}:${word.paragraphIndex}`)
  }
  if (matchingParagraphs.size !== 1) return null

  const paragraphKey = [...matchingParagraphs][0]
  const paragraphWords = words.filter(
    (word) => `${word.blockIndex}:${word.paragraphIndex}` === paragraphKey,
  )
  if (
    paragraphWords.length === 0 ||
    paragraphWords.some(
      (word) => !Number.isInteger(word.lineIndex) || !Number.isInteger(word.wordIndex),
    ) ||
    isLikelyTabularParagraph(paragraphWords)
  ) {
    return null
  }
  const text = joinPdfOcrParagraphWords(paragraphWords).trim()
  if (!text) return null
  const areas = paragraphWords.map(({ x, y, width, height }) => ({ x, y, width, height }))
  return {
    text,
    areas,
    confidence:
      paragraphWords.reduce((total, word) => total + word.confidence, 0) / paragraphWords.length,
    bounds: unionAreas(areas),
    lineCount: new Set(paragraphWords.map((word) => word.lineIndex)).size,
  }
}

export function createPdfOcrParagraphCropArea(
  currentAreas: PdfSelectionArea[],
  expanded = false,
): PdfSelectionArea | null {
  const areas = currentAreas.filter(isFiniteArea)
  if (areas.length === 0) return null
  const bounds = unionAreas(areas)
  const targetHeight = Math.min(
    expanded ? 0.68 : 0.34,
    Math.max(expanded ? 0.46 : 0.24, bounds.height * (expanded ? 12 : 7)),
  )
  const centerY = bounds.y + bounds.height / 2
  const y = clamp(centerY - targetHeight / 2, 0, Math.max(0, 1 - targetHeight))
  return { x: 0.03, y, width: 0.94, height: targetHeight }
}

export function doesPdfOcrParagraphTouchCropEdge(
  paragraphBounds: PdfSelectionArea,
  cropArea: PdfSelectionArea,
) {
  const margin = Math.max(0.008, Math.min(0.025, paragraphBounds.height * 0.08))
  const touchesTop = cropArea.y > 0.001 && paragraphBounds.y - cropArea.y <= margin
  const cropBottom = cropArea.y + cropArea.height
  const paragraphBottom = paragraphBounds.y + paragraphBounds.height
  const touchesBottom = cropBottom < 0.999 && cropBottom - paragraphBottom <= margin
  return touchesTop || touchesBottom
}

export function isPdfOcrSelectionAvailable(
  anchor: { source?: string; pageNumber?: number; areas?: PdfSelectionArea[] } | null | undefined,
) {
  return (
    anchor?.source === 'ocr' &&
    Number.isInteger(anchor.pageNumber) &&
    Boolean(anchor.areas?.some(isFiniteArea))
  )
}

export function createPdfInkSelectionPlans(
  canvas: HTMLCanvasElement,
  strokes: PdfInkPoint[][],
): PdfInkSelectionPlan[] {
  const plans = strokes
    .map((points) => createPdfInkSelectionPlan(canvas, points))
    .filter((plan): plan is PdfInkSelectionPlan => Boolean(plan))
    .sort(
      (left, right) =>
        left.visualArea.y +
          left.visualArea.height / 2 -
          (right.visualArea.y + right.visualArea.height / 2) ||
        left.visualArea.x - right.visualArea.x,
    )
  const merged: PdfInkSelectionPlan[] = []
  for (const plan of plans) {
    const previous = merged.at(-1)
    const verticalOverlap = previous
      ? overlap(
          previous.visualArea.y,
          previous.visualArea.y + previous.visualArea.height,
          plan.visualArea.y,
          plan.visualArea.y + plan.visualArea.height,
        )
      : 0
    const overlapRatio = previous
      ? verticalOverlap / Math.min(previous.visualArea.height, plan.visualArea.height)
      : 0
    if (!previous || overlapRatio < 0.55) {
      merged.push(plan)
      continue
    }
    previous.visualArea = unionAreas([previous.visualArea, plan.visualArea])
    previous.cropArea = unionAreas([previous.cropArea, plan.cropArea])
  }
  return merged
}

export function getPdfInkCropArea(plans: PdfInkSelectionPlan[]) {
  return plans.length ? unionAreas(plans.map((plan) => plan.cropArea)) : null
}

const overlap = (left: number, right: number, otherLeft: number, otherRight: number) =>
  Math.max(0, Math.min(right, otherRight) - Math.max(left, otherLeft))

export function selectPdfOcrWordsForInk(
  words: PdfOcrWord[],
  visualArea: PdfSelectionArea,
): { text: string; areas: PdfSelectionArea[]; confidence: number } | null {
  const selectionLeft = visualArea.x
  const selectionRight = visualArea.x + visualArea.width
  const selectionTop = visualArea.y
  const selectionBottom = visualArea.y + visualArea.height
  const selectedTokens: Array<{
    text: string
    x: number
    y: number
    width: number
    height: number
    confidence: number
  }> = []

  for (const word of words) {
    const verticalOverlap = overlap(word.y, word.y + word.height, selectionTop, selectionBottom)
    if (verticalOverlap / Math.max(0.0001, Math.min(word.height, visualArea.height)) < 0.18)
      continue
    const units = word.symbols?.length ? word.symbols : [word]
    const selectedUnits = units.filter((unit) => {
      const horizontalOverlap = overlap(
        unit.x,
        unit.x + unit.width,
        selectionLeft - 0.004,
        selectionRight + 0.004,
      )
      return (
        horizontalOverlap > 0 ||
        (unit.x + unit.width / 2 >= selectionLeft && unit.x + unit.width / 2 <= selectionRight)
      )
    })
    if (selectedUnits.length === 0) continue
    const left = Math.min(...selectedUnits.map((unit) => unit.x))
    const right = Math.max(...selectedUnits.map((unit) => unit.x + unit.width))
    const top = Math.min(...selectedUnits.map((unit) => unit.y))
    const bottom = Math.max(...selectedUnits.map((unit) => unit.y + unit.height))
    selectedTokens.push({
      text: word.symbols?.length ? selectedUnits.map((unit) => unit.text).join('') : word.text,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      confidence:
        selectedUnits.reduce((total, unit) => total + unit.confidence, 0) / selectedUnits.length,
    })
  }

  if (selectedTokens.length === 0) return null
  selectedTokens.sort((left, right) => left.x - right.x)
  const text = joinOcrWords(selectedTokens).trim()
  if (!text) return null
  return {
    text,
    areas: selectedTokens.map(({ x, y, width, height }) => ({ x, y, width, height })),
    confidence:
      selectedTokens.reduce((total, token) => total + token.confidence, 0) / selectedTokens.length,
  }
}

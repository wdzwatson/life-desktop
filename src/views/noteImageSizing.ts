export interface NoteImageDimensions {
  url: string
  width: number
  height: number
}

export interface NoteImageResizeDragInput {
  startWidth: number
  startHeight: number
  deltaX: number
  deltaY: number
  maxWidth: number
}

const sizedNoteImagePattern = /!\[((?:\\.|[^\]])*)\]\((life-note-asset:\/\/attachment\/[^)\s]+)\)\{width=(\d{1,4}) height=(\d{1,4})\}/g

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const clampNoteImageDimension = (value: number) => Math.min(4096, Math.max(48, Math.round(value)))

export const getNoteImageResizeDragDimensions = ({
  startWidth,
  startHeight,
  deltaX,
  deltaY,
  maxWidth,
}: NoteImageResizeDragInput) => {
  const width = clampNoteImageDimension(startWidth)
  const height = clampNoteImageDimension(startHeight)
  const aspectRatio = height / width || 1
  const horizontalDelta = Number.isFinite(deltaX) ? deltaX : 0
  const verticalDelta = Number.isFinite(deltaY) ? deltaY / Math.max(aspectRatio, 0.01) : 0
  const dominantDelta =
    Math.abs(horizontalDelta) >= Math.abs(verticalDelta) ? horizontalDelta : verticalDelta
  const nextWidth = Math.min(clampNoteImageDimension(maxWidth), clampNoteImageDimension(width + dominantDelta))
  return {
    width: nextWidth,
    height: clampNoteImageDimension(nextWidth * aspectRatio),
  }
}

export const renderSizedNoteImages = (markdown: string) =>
  markdown.replace(sizedNoteImagePattern, (_match, label, url, width, height) => {
    const safeWidth = clampNoteImageDimension(Number(width))
    const safeHeight = clampNoteImageDimension(Number(height))
    const alt = String(label).replace(/\\([[]\\])/g, '$1')
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" data-note-image="true" data-note-width="${safeWidth}" data-note-height="${safeHeight}" style="width: ${safeWidth}px; height: auto; max-width: 100%;" />`
  })

export const updateNoteImageDimensions = (
  content: string,
  { url, width, height }: NoteImageDimensions,
  reset = false,
) => {
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const imagePattern = new RegExp(
    `!\\[((?:\\\\.|[^\\]])*)\\]\\(${escapedUrl}\\)(?:\\{width=\\d{1,4} height=\\d{1,4}\\})?`,
  )
  return content.replace(imagePattern, (_match, label) =>
    reset
      ? `![${label}](${url})`
      : `![${label}](${url}){width=${clampNoteImageDimension(width)} height=${clampNoteImageDimension(height)}}`,
  )
}

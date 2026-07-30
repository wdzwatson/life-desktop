export interface NoteImageDimensions {
  url: string
  width: number
  height: number
}

const sizedNoteImagePattern = /!\[((?:\\.|[^\]])*)\]\((life-note-asset:\/\/attachment\/[^)\s]+)\)\{width=(\d{1,4}) height=(\d{1,4})\}/g

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const clampNoteImageDimension = (value: number) => Math.min(4096, Math.max(48, Math.round(value)))

export const renderSizedNoteImages = (markdown: string) =>
  markdown.replace(sizedNoteImagePattern, (_match, label, url, width, height) => {
    const safeWidth = clampNoteImageDimension(Number(width))
    const safeHeight = clampNoteImageDimension(Number(height))
    const alt = String(label).replace(/\\([[]\\])/g, '$1')
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" data-note-image="true" data-note-width="${safeWidth}" data-note-height="${safeHeight}" style="width: ${safeWidth}px; height: ${safeHeight}px; max-width: 100%;" />`
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

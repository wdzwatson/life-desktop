export type StatefulVideoStatus =
  | 'not_downloaded'
  | 'queued'
  | 'downloading'
  | 'downloaded'
  | 'download_failed'
  | 'invalid'

const invalidPatterns = [
  /\b404\b/i,
  /not found/i,
  /private video/i,
  /video unavailable/i,
  /has been deleted/i,
  /removed by/i,
  /does not exist/i,
]

export function normalizeLegacyVideoStatus(status?: string | null): StatefulVideoStatus {
  if (status === 'downloaded') return 'downloaded'
  if (status === 'queued') return 'download_failed'
  if (status === 'downloading') return 'download_failed'
  if (status === 'download_failed') return 'download_failed'
  if (status === 'invalid') return 'invalid'
  if (status === 'not_downloaded') return 'not_downloaded'
  return 'not_downloaded'
}

export function getInterruptedDownloadMessage() {
  return 'Download was interrupted. Retry is available.'
}

export function classifyVideoDownloadFailure(message?: string | null): {
  status: 'download_failed' | 'invalid'
  downloadError: string
  invalidReason: string | null
} {
  const downloadError = message?.trim() || 'Unknown download error'
  const isInvalid = invalidPatterns.some((pattern) => pattern.test(downloadError))
  return {
    status: isInvalid ? 'invalid' : 'download_failed',
    downloadError,
    invalidReason: isInvalid ? downloadError : null,
  }
}

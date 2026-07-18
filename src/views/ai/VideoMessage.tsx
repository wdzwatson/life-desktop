import { Download, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AIChatMediaPart } from './chatUtils'

type VideoMessageProps = {
  video: AIChatMediaPart
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  const rest = rounded % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function VideoMessage({ video }: VideoMessageProps) {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  const src = `life-ai-asset://asset/${video.assetId}`
  const poster = video.posterAssetId ? `life-ai-asset://asset/${video.posterAssetId}` : undefined
  return (
    <figure className="ai-video-card">
      <div className="ai-video-card__frame">
        <video src={src} poster={poster} controls preload="metadata" />
      </div>
      <figcaption>
        <span>{video.name ?? t('aiChat.videos.generated')}</span>
        {video.durationSeconds && <em>{formatDuration(video.durationSeconds)}</em>}
        <button onClick={() => void api?.saveAIAsset?.(video.assetId)}><Download size={13} />{t('aiChat.images.save_as')}</button>
        <button onClick={() => void api?.revealAIAsset?.(video.assetId)}><FolderOpen size={13} />{t('aiChat.images.reveal')}</button>
      </figcaption>
    </figure>
  )
}

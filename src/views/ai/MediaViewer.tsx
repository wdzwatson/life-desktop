import { Download, FolderOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AIChatMediaPart } from './chatUtils'

type MediaViewerProps = {
  media: AIChatMediaPart
  onClose: () => void
}

export function MediaViewer({ media, onClose }: MediaViewerProps) {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  return (
    <div className="ai-media-viewer" role="dialog" aria-modal="true" aria-label={media.alt ?? media.name ?? t('aiChat.images.viewer')}>
      <div className="ai-media-viewer__backdrop" onClick={onClose} />
      <section className="ai-media-viewer__panel">
        <header>
          <span>{media.name ?? t('aiChat.images.generated')}</span>
          <div>
            <button onClick={() => void api?.saveAIAsset?.(media.assetId)}><Download size={14} />{t('aiChat.images.save_as')}</button>
            <button onClick={() => void api?.revealAIAsset?.(media.assetId)}><FolderOpen size={14} />{t('aiChat.images.reveal')}</button>
            <button onClick={onClose} aria-label={t('common.close')}><X size={16} /></button>
          </div>
        </header>
        <div className="ai-media-viewer__canvas">
          <img src={`life-ai-asset://asset/${media.assetId}`} alt={media.alt ?? media.name ?? ''} />
        </div>
      </section>
    </div>
  )
}

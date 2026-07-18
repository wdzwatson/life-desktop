import { Download, FolderOpen, X } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import type { AIChatMediaPart } from './chatUtils'

type MediaViewerProps = {
  media: AIChatMediaPart
  onClose: () => void
}

export function MediaViewer({ media, onClose }: MediaViewerProps) {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnTargetRef = useRef(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )
  const title = media.name ?? t('aiChat.images.generated')
  return (
    <AccessibleDialog
      title={title}
      onClose={onClose}
      returnFocus={() => returnTargetRef.current?.focus()}
      initialFocusRef={closeRef}
      overlayClassName="ai-media-viewer"
      contentClassName="ai-media-viewer__panel"
      closeOnOverlay
    >
        <header>
          <div>
            <button onClick={() => void api?.saveAIAsset?.(media.assetId)}><Download size={14} aria-hidden="true" />{t('aiChat.images.save_as')}</button>
            <button onClick={() => void api?.revealAIAsset?.(media.assetId)}><FolderOpen size={14} aria-hidden="true" />{t('aiChat.images.reveal')}</button>
            <button ref={closeRef} onClick={onClose} aria-label={t('common.close')}><X size={16} aria-hidden="true" /></button>
          </div>
        </header>
        <div className="ai-media-viewer__canvas">
          <img src={`life-ai-asset://asset/${media.assetId}`} alt={media.alt ?? media.name ?? t('aiChat.images.generated_alt')} />
        </div>
    </AccessibleDialog>
  )
}

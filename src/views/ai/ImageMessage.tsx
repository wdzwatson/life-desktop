import type { AIChatMediaPart } from './chatUtils'
import { useTranslation } from 'react-i18next'

type ImageMessageProps = {
  images: AIChatMediaPart[]
  onOpen: (image: AIChatMediaPart) => void
}

export function ImageMessage({ images, onOpen }: ImageMessageProps) {
  const { t } = useTranslation()
  return (
    <div className={`ai-image-grid count-${Math.min(images.length, 4)}`}>
      {images.map((image) => (
        <button
          key={image.assetId}
          className="ai-image-card group"
          onClick={() => onOpen(image)}
          aria-label={t('aiChat.images.open_name', { name: image.name ?? t('aiChat.images.generated') })}
        >
          <span className="ai-image-card__frame">
            <img src={`life-ai-asset://asset/${image.assetId}`} alt={image.alt ?? image.name ?? t('aiChat.images.generated_alt')} loading="lazy" />
          </span>
          {image.name && <span className="ai-image-card__name">{image.name}</span>}
        </button>
      ))}
    </div>
  )
}

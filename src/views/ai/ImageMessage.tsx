import type { AIChatMediaPart } from './chatUtils'

type ImageMessageProps = {
  images: AIChatMediaPart[]
  onOpen: (image: AIChatMediaPart) => void
}

export function ImageMessage({ images, onOpen }: ImageMessageProps) {
  return (
    <div className={`ai-image-grid count-${Math.min(images.length, 4)}`}>
      {images.map((image) => (
        <button key={image.assetId} className="ai-image-card group" onClick={() => onOpen(image)}>
          <span className="ai-image-card__frame">
            <img src={`life-ai-asset://asset/${image.assetId}`} alt={image.alt ?? image.name ?? ''} loading="lazy" />
          </span>
          {image.name && <span className="ai-image-card__name">{image.name}</span>}
        </button>
      ))}
    </div>
  )
}

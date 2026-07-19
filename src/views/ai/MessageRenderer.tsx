import { Check, Copy, File, Image, RefreshCw, Video } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AIChatMediaPart, AIChatMessage, AIChatMessagePart } from './chatUtils'
import { renderAIMessageMarkdown } from './messageSecurity'
import { ToolCallCard } from './ToolCallCard'
import { ImageMessage } from './ImageMessage'
import { MediaViewer } from './MediaViewer'
import { VideoMessage } from './VideoMessage'

type MessageRendererProps = {
  message: AIChatMessage
  onRetry?: (message: AIChatMessage) => void
  retryDisabled?: boolean
}

function isTextPart(
  part: AIChatMessagePart,
): part is Extract<AIChatMessagePart, { type: 'text' | 'markdown' | 'code' }> {
  return part.type === 'text' || part.type === 'markdown' || part.type === 'code'
}

function isToolCallPart(
  part: AIChatMessagePart,
): part is Extract<AIChatMessagePart, { type: 'tool_call' }> {
  return part.type === 'tool_call' && typeof part.toolCallId === 'string' && typeof part.toolName === 'string'
}

function joinConsecutiveMarkdownParts(parts: AIChatMessagePart[], startIndex: number) {
  let text = ''
  for (let index = startIndex; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.type !== 'markdown') break
    text += String(part.text)
  }
  return text
}

function copyText(message: AIChatMessage) {
  return `${message.parts.filter(isTextPart).map((part) => part.text).join('\n')}${message.streamText ?? ''}`.trim()
}

export function MessageRenderer({ message, onRetry, retryDisabled }: MessageRendererProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [openImage, setOpenImage] = useState<AIChatMediaPart | null>(null)
  const canRetry = message.role === 'assistant' && ['completed', 'failed', 'cancelled', 'interrupted'].includes(message.status)
  const toolResults = new Map(
    message.parts
      .filter((part): part is Extract<AIChatMessagePart, { type: 'tool_result' }> => part.type === 'tool_result')
      .map((part) => [part.toolCallId, part]),
  )
  const latestToolCallIndex = new Map<string, number>()
  message.parts.forEach((part, index) => {
    if (isToolCallPart(part)) latestToolCallIndex.set(part.toolCallId, index)
  })
  const images = message.parts.filter((part): part is AIChatMediaPart =>
    part.type === 'image' && typeof part.assetId === 'number' && typeof part.mimeType === 'string',
  )
  const videos = message.parts.filter((part): part is AIChatMediaPart =>
    part.type === 'video' && typeof part.assetId === 'number' && typeof part.mimeType === 'string',
  )
  const firstImageIndex = message.parts.findIndex((part) => part.type === 'image')
  const firstVideoIndex = message.parts.findIndex((part) => part.type === 'video')

  const handleCopy = async () => {
    const text = copyText(message)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  const handleMarkdownClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const anchor = target.closest('a')
    if (!anchor) return
    event.preventDefault()
    const href = anchor.getAttribute('href') ?? ''
    if (!/^https?:\/\//i.test(href)) return
    void (window as any).electronAPI?.openExternal?.(href)
  }

  return (
    <>
    <article className={`ai-message ai-message--${message.role} is-${message.status}`} data-message-id={message.id}>
      <header className="ai-message__header">
        <span>{t(`aiChat.chat.role_${message.role}`)}</span>
        <span className="ai-message__status">{t(`aiChat.chat.status_${message.status}`)}</span>
      </header>
      <div className="ai-message__body">
        {message.parts.map((part, index) => {
          if (part.type === 'text') return <p key={index} className="ai-message__plain">{String(part.text)}</p>
          if (part.type === 'markdown') {
            if (message.parts[index - 1]?.type === 'markdown') return null
            return (
              <div
                key={index}
                className="ai-message__markdown"
                onClick={handleMarkdownClick}
                dangerouslySetInnerHTML={{ __html: renderAIMessageMarkdown(joinConsecutiveMarkdownParts(message.parts, index)) }}
              />
            )
          }
          if (part.type === 'code') {
            return (
              <pre key={index} className="ai-message__code">
                <code data-language={typeof part.language === 'string' ? part.language : undefined}>{String(part.text)}</code>
              </pre>
            )
          }
          if (part.type === 'error') {
            return <div key={index} className="ai-message__error" role="alert">{String(part.message)}</div>
          }
          if (part.type === 'media_task') {
            if (message.status !== 'pending' && message.status !== 'streaming') return null
            const isVideo = part.mediaType === 'video'
            const progress = typeof part.progress === 'number' && Number.isFinite(part.progress)
              ? Math.min(Math.max(part.progress, 0), 100)
              : undefined
            return (
              <div key={index} className="ai-message__media-task" role="status">
                {isVideo ? <Video size={16} aria-hidden="true" /> : <Image size={16} aria-hidden="true" />}
                <span>{t(isVideo ? 'aiChat.videos.generating' : 'aiChat.images.generating')}</span>
                {progress !== undefined && <strong>{Math.round(progress)}%</strong>}
              </div>
            )
          }
          if (isToolCallPart(part)) {
            if (latestToolCallIndex.get(part.toolCallId) !== index) return null
            return <ToolCallCard key={`${part.toolCallId}-${index}`} call={part} result={toolResults.get(part.toolCallId)} />
          }
          if (part.type === 'tool_result') return null
          if (part.type === 'image' && typeof part.assetId === 'number') {
            if (index !== firstImageIndex) return null
            return <ImageMessage key="images" images={images} onOpen={setOpenImage} />
          }
          if (part.type === 'video' && typeof part.assetId === 'number') {
            if (index !== firstVideoIndex) return null
            return (
              <div key="videos" className="ai-video-list">
                {videos.map((video) => <VideoMessage key={video.assetId} video={video} />)}
              </div>
            )
          }
          if (part.type === 'image' || part.type === 'video' || part.type === 'file' || part.type === 'audio') {
            const Icon = part.type === 'image' ? Image : part.type === 'video' ? Video : File
            return (
              <div key={index} className="ai-message__attachment">
                <Icon size={15} aria-hidden="true" />
                <span>{typeof part.name === 'string' ? part.name : String(part.mimeType ?? part.type)}</span>
              </div>
            )
          }
          return null
        })}
        {message.streamText && (
          <div
            className="ai-message__markdown ai-message__stream"
            onClick={handleMarkdownClick}
            dangerouslySetInnerHTML={{ __html: renderAIMessageMarkdown(message.streamText) }}
          />
        )}
        {message.status === 'streaming' && !copyText(message) && !message.parts.some((part) => part.type === 'media_task') && (
          <span className="ai-message__thinking" aria-label={t('aiChat.chat.generating')}>
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
      <footer className="ai-message__actions">
        <button onClick={() => void handleCopy()} disabled={!copyText(message)}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {t(copied ? 'aiChat.chat.copied' : 'aiChat.chat.copy')}
        </button>
        {canRetry && onRetry && (
          <button onClick={() => onRetry(message)} disabled={retryDisabled}>
            <RefreshCw size={12} />
            {t(message.status === 'completed' ? 'aiChat.chat.send_again' : 'aiChat.chat.retry_message')}
          </button>
        )}
      </footer>
    </article>
    {openImage && <MediaViewer media={openImage} onClose={() => setOpenImage(null)} />}
    </>
  )
}

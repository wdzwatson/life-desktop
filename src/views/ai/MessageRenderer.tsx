import { Check, Copy, File, Image, RefreshCw, Video } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AIChatMessage, AIChatMessagePart } from './chatUtils'
import { renderAIMessageMarkdown } from './messageSecurity'

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

function copyText(message: AIChatMessage) {
  return `${message.parts.filter(isTextPart).map((part) => part.text).join('\n')}${message.streamText ?? ''}`.trim()
}

export function MessageRenderer({ message, onRetry, retryDisabled }: MessageRendererProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const canRetry = message.role === 'assistant' && ['completed', 'failed', 'cancelled', 'interrupted'].includes(message.status)

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
    <article className={`ai-message ai-message--${message.role} is-${message.status}`} data-message-id={message.id}>
      <header className="ai-message__header">
        <span>{t(`aiChat.chat.role_${message.role}`)}</span>
        <span className="ai-message__status">{t(`aiChat.chat.status_${message.status}`)}</span>
      </header>
      <div className="ai-message__body">
        {message.parts.map((part, index) => {
          if (part.type === 'text') return <p key={index} className="ai-message__plain">{String(part.text)}</p>
          if (part.type === 'markdown') {
            return (
              <div
                key={index}
                className="ai-message__markdown"
                onClick={handleMarkdownClick}
                dangerouslySetInnerHTML={{ __html: renderAIMessageMarkdown(String(part.text)) }}
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
        {message.status === 'streaming' && !copyText(message) && (
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
            {t(message.status === 'completed' ? 'aiChat.chat.regenerate' : 'aiChat.chat.retry_message')}
          </button>
        )}
      </footer>
    </article>
  )
}

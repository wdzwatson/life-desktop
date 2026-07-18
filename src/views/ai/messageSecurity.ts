import DOMPurify from 'dompurify'
import { marked } from 'marked'

export const AI_MESSAGE_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'del',
    'blockquote',
    'ul',
    'ol',
    'li',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
  ],
  ALLOWED_ATTR: ['href', 'title'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'video', 'audio'],
  FORBID_ATTR: ['style', 'srcdoc', 'onerror', 'onload', 'onclick'],
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
} as const

type Sanitizer = (html: string, config: typeof AI_MESSAGE_SANITIZE_CONFIG) => string

export function sanitizeAIMessageHtml(html: string, sanitizer?: Sanitizer) {
  const sanitize = sanitizer ?? ((value, config) => DOMPurify.sanitize(value, config as any))
  return sanitize(html, AI_MESSAGE_SANITIZE_CONFIG)
}

export function renderAIMessageMarkdown(source: string, sanitizer?: Sanitizer) {
  const raw = marked.parse(source, { async: false, gfm: true, breaks: true }) as string
  return sanitizeAIMessageHtml(raw, sanitizer)
}

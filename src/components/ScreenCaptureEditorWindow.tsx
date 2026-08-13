import { useEffect, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ScreenCaptureOverlay } from './ScreenCaptureOverlay'

type EditorPayload = {
  imageDataUrl: string | null
  selectionMode: 'full' | 'rectangle' | 'freeform'
  status: 'loading' | 'ready'
}

export function ScreenCaptureEditorWindow() {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  const [payload, setPayload] = useState<EditorPayload | null>(null)

  useEffect(() => {
    let active = true
    const accept = (next: EditorPayload | null) => {
      if (active && next) setPayload(next)
    }
    const acceptBrowserPayload = (event: Event) => {
      accept((event as CustomEvent<EditorPayload>).detail ?? null)
    }
    const acceptMessagePayload = (
      event: MessageEvent<{ type?: string; payload?: EditorPayload }>,
    ) => {
      if (event.data?.type === 'screen-capture:editor-payload') accept(event.data.payload ?? null)
    }
    window.addEventListener('screen-capture:editor-payload', acceptBrowserPayload)
    window.addEventListener('message', acceptMessagePayload)
    const unsubscribe = api?.onScreenCaptureEditorPayload?.(accept)
    const payloadRequest = api?.getScreenCaptureEditorPayload?.()
    if (payloadRequest?.then) void payloadRequest.then(accept)
    return () => {
      active = false
      window.removeEventListener('screen-capture:editor-payload', acceptBrowserPayload)
      window.removeEventListener('message', acceptMessagePayload)
      unsubscribe?.()
    }
  }, [api])

  const close = () => {
    api?.closeScreenCaptureEditor?.()
    if (!api) window.close()
  }

  if (payload?.status === 'ready' && payload.imageDataUrl) {
    return (
      <ScreenCaptureOverlay
        initialImageDataUrl={payload.imageDataUrl}
        selectionMode="full"
        startInEditor
        standalone
        onClose={close}
      />
    )
  }

  return (
    <main
      role="dialog"
      aria-modal="true"
      aria-label={t('screen_capture.title')}
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        color: '#f8fafc',
        background: '#05070a',
        fontFamily: 'Satoshi, Outfit, system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'grid', justifyItems: 'center', gap: 16 }}>
        <LoaderCircle
          size={28}
          strokeWidth={1.8}
          style={{ animation: 'spin 1s linear infinite' }}
        />
        <strong>{t('screen_capture.processing_title')}</strong>
        <span style={{ color: '#cbd5e1', fontSize: 13 }}>
          {t('screen_capture.processing_hint')}
        </span>
        <button className="btn sm" type="button" onClick={close}>
          <X size={15} /> {t('screen_capture.close')}
        </button>
      </div>
    </main>
  )
}

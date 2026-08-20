import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  FolderOpen,
  Globe2,
  ListChecks,
  Link2,
  LoaderCircle,
  Play,
  PlugZap,
  X,
} from 'lucide-react'
import { AccessibleDialog } from '../components/AccessibleDialog'
import './WebLike.css'

type ApiError = { code?: string; message?: string }
type ApiResponse<T> = { success: boolean; data?: T; error?: ApiError }
type RegistrationStatus = {
  registered: boolean
  supported: boolean
  requiresPackagedApp: boolean
  manifestPath: string
}
type BrowserControlStatus = {
  bridgeReady: boolean
  extensionConnected: boolean
  connectionCount: number
  extensionVersion: string | null
  registration: RegistrationStatus
}
type WebLikeCandidate = {
  tabId: number
  title: string
  url: string
  active: boolean
  matchScore: number
}
type WebLikeResult =
  | { status: 'ambiguous'; candidates: WebLikeCandidate[] }
  | {
      status: 'opened' | 'matched'
      tabId: number
      title: string
      url: string
      scriptExecuted: boolean
    }

type BrowserControlApi = {
  getBrowserControlStatus?: () => Promise<ApiResponse<BrowserControlStatus>>
  installBrowserControlIntegration?: () => Promise<ApiResponse<RegistrationStatus>>
  openBrowserControlExtensionFolder?: () => Promise<ApiResponse<string>>
  executeWebLike?: (url: string, preferredTabId?: number) => Promise<ApiResponse<WebLikeResult>>
}

function getBrowserControlApi() {
  return (window as Window & { electronAPI?: BrowserControlApi }).electronAPI
}

export function WebLike() {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<BrowserControlStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<Extract<WebLikeResult, { status: 'opened' | 'matched' }> | null>(null)
  const [candidates, setCandidates] = useState<WebLikeCandidate[]>([])
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const tutorialButtonRef = useRef<HTMLButtonElement | null>(null)
  const tutorialCloseButtonRef = useRef<HTMLButtonElement | null>(null)

  const refreshStatus = useCallback(async () => {
    const api = getBrowserControlApi()
    if (!api?.getBrowserControlStatus) return
    const response = await api.getBrowserControlStatus()
    if (response?.success && response.data) setStatus(response.data)
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 3000)
    return () => window.clearInterval(timer)
  }, [refreshStatus])

  const errorMessage = useCallback(
    (error?: ApiError) => {
      if (error?.code === 'invalid_url') return t('toolbox.web_like_error_invalid_url')
      if (error?.code === 'extension_disconnected') return t('toolbox.web_like_error_disconnected')
      if (error?.code === 'timeout') return t('toolbox.web_like_error_timeout')
      return error?.message || t('toolbox.web_like_error_generic')
    },
    [t],
  )

  const installIntegration = async () => {
    const api = getBrowserControlApi()
    if (!api?.installBrowserControlIntegration) return
    setSetupBusy(true)
    setNotice('')
    try {
      const response = await api.installBrowserControlIntegration()
      if (!response?.success || !response.data) {
        setNotice(errorMessage(response?.error))
      } else if (response.data.requiresPackagedApp) {
        setNotice(t('toolbox.web_like_packaged_required'))
      } else {
        setNotice(t('toolbox.web_like_install_complete'))
      }
      await refreshStatus()
    } finally {
      setSetupBusy(false)
    }
  }

  const openExtensionFolder = async () => {
    const api = getBrowserControlApi()
    if (!api?.openBrowserControlExtensionFolder) return
    const response = await api.openBrowserControlExtensionFolder()
    if (!response?.success) setNotice(errorMessage(response?.error))
  }

  const execute = async (preferredTabId?: number) => {
    const api = getBrowserControlApi()
    if (!api?.executeWebLike) return
    setBusy(true)
    setNotice('')
    setResult(null)
    try {
      const response = await api.executeWebLike(url, preferredTabId)
      if (!response?.success || !response.data) {
        setCandidates([])
        setNotice(errorMessage(response?.error))
        return
      }
      if (response.data.status === 'ambiguous') {
        setCandidates(response.data.candidates)
        setNotice(t('toolbox.web_like_ambiguous'))
        return
      }
      setCandidates([])
      setResult(response.data)
    } finally {
      setBusy(false)
      void refreshStatus()
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void execute()
  }

  const connected = Boolean(status?.bridgeReady && status?.extensionConnected)
  const registered = Boolean(status?.registration.registered)

  return (
    <section className="web-like" aria-labelledby="web-like-title">
      <div className="web-like__connection">
        <div className="web-like__identity">
          <span className={`web-like__status-icon ${connected ? 'is-connected' : ''}`}>
            <Globe2 size={19} aria-hidden="true" />
          </span>
          <div>
            <h2 id="web-like-title">{t('toolbox.web_like_title')}</h2>
            <p>{t(connected ? 'toolbox.web_like_connected' : 'toolbox.web_like_disconnected')}</p>
          </div>
        </div>
        <div className="web-like__connection-meta" aria-label={t('toolbox.web_like_connection_status')}>
          <span className={status?.bridgeReady ? 'is-ready' : ''}>{t('toolbox.web_like_bridge')}</span>
          <span className={registered ? 'is-ready' : ''}>{t('toolbox.web_like_native_host')}</span>
          <span className={status?.extensionConnected ? 'is-ready' : ''}>{t('toolbox.web_like_extension')}</span>
        </div>
        <div className="web-like__setup-actions">
          <button
            ref={tutorialButtonRef}
            className="btn"
            type="button"
            onClick={() => setTutorialOpen(true)}
          >
            <ListChecks size={15} aria-hidden="true" />
            {t('toolbox.web_like_tutorial_button')}
          </button>
          <button className="btn" type="button" onClick={() => void openExtensionFolder()}>
            <FolderOpen size={15} aria-hidden="true" />
            {t('toolbox.web_like_open_extension')}
          </button>
          <button className="btn" type="button" disabled={setupBusy} onClick={() => void installIntegration()}>
            {setupBusy ? <LoaderCircle className="web-like__spinner" size={15} /> : <PlugZap size={15} aria-hidden="true" />}
            {t('toolbox.web_like_install')}
          </button>
        </div>
      </div>

      <form className="web-like__workspace" onSubmit={submit}>
        <label htmlFor="web-like-url">{t('toolbox.web_like_url_label')}</label>
        <div className="web-like__url-row">
          <span className="web-like__url-icon"><Link2 size={17} aria-hidden="true" /></span>
          <input
            id="web-like-url"
            className="form-field"
            type="url"
            required
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/path"
          />
          <button className="btn primary web-like__run" type="submit" disabled={busy || !url.trim()}>
            {busy ? <LoaderCircle className="web-like__spinner" size={16} /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
            {t('toolbox.web_like_execute')}
          </button>
        </div>
      </form>

      {notice && (
        <div className="web-like__notice" role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="web-like__candidates" aria-label={t('toolbox.web_like_candidates')}>
          {candidates.map((candidate) => (
            <button key={candidate.tabId} type="button" onClick={() => void execute(candidate.tabId)} disabled={busy}>
              <span>
                <strong>{candidate.title || t('toolbox.web_like_untitled')}</strong>
                <small>{candidate.url}</small>
              </span>
              <Play size={15} fill="currentColor" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {result && (
        <div className="web-like__result" role="status">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <strong>{t(result.status === 'opened' ? 'toolbox.web_like_result_opened' : 'toolbox.web_like_result_matched')}</strong>
            <span>{result.title || result.url}</span>
            <small>{t('toolbox.web_like_result_script')}</small>
          </div>
        </div>
      )}

      <section className="web-like__guides" aria-label={t('toolbox.web_like_guides_label')}>
        <details className="web-like__guide">
          <summary>
            <CircleAlert size={17} aria-hidden="true" />
            <span>
              <strong>{t('toolbox.web_like_debug_title')}</strong>
              <small>{t('toolbox.web_like_debug_summary')}</small>
            </span>
          </summary>
          <div className="web-like__debug-status" aria-label={t('toolbox.web_like_connection_status')}>
            <div className="web-like__debug-row">
              <span className={`web-like__debug-dot ${status?.bridgeReady ? 'is-ready' : ''}`} aria-hidden="true" />
              <span><strong>{t('toolbox.web_like_bridge')}</strong><small>{t('toolbox.web_like_debug_bridge')}</small></span>
            </div>
            <div className="web-like__debug-row">
              <span className={`web-like__debug-dot ${registered ? 'is-ready' : ''}`} aria-hidden="true" />
              <span><strong>{t('toolbox.web_like_native_host')}</strong><small>{t('toolbox.web_like_debug_native_host')}</small></span>
            </div>
            <div className="web-like__debug-row">
              <span className={`web-like__debug-dot ${status?.extensionConnected ? 'is-ready' : ''}`} aria-hidden="true" />
              <span><strong>{t('toolbox.web_like_extension')}</strong><small>{t('toolbox.web_like_debug_extension')}</small></span>
            </div>
          </div>
          <ul className="web-like__debug-list">
            <li>{t('toolbox.web_like_debug_check_1')}</li>
            <li>{t('toolbox.web_like_debug_check_2')}</li>
            <li>{t('toolbox.web_like_debug_check_3')}</li>
            <li>{t('toolbox.web_like_debug_check_4')}</li>
          </ul>
          <p className="web-like__guide-note">
            <CircleHelp size={15} aria-hidden="true" />
            <span>{t('toolbox.web_like_debug_note')}</span>
          </p>
        </details>
      </section>

      {tutorialOpen ? (
        <AccessibleDialog
          title={t('toolbox.web_like_first_use_title')}
          onClose={() => setTutorialOpen(false)}
          returnFocus={() => tutorialButtonRef.current?.focus()}
          initialFocusRef={tutorialCloseButtonRef}
          closeOnOverlay
          overlayClassName="web-like-tutorial__overlay"
          contentClassName="web-like-tutorial"
        >
          <button
            ref={tutorialCloseButtonRef}
            className="web-like-tutorial__close"
            type="button"
            onClick={() => setTutorialOpen(false)}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
          <p className="web-like-tutorial__summary">{t('toolbox.web_like_first_use_summary')}</p>
          <ol className="web-like__steps web-like-tutorial__steps">
            <li>{t('toolbox.web_like_first_use_step_1')}</li>
            <li>{t('toolbox.web_like_first_use_step_2')}</li>
            <li>{t('toolbox.web_like_first_use_step_3')}</li>
            <li>{t('toolbox.web_like_first_use_step_4')}</li>
          </ol>
          <p className="web-like__guide-note web-like-tutorial__note">
            <CircleHelp size={15} aria-hidden="true" />
            <span>{t('toolbox.web_like_first_use_note')}</span>
          </p>
          <div className="web-like-tutorial__footer">
            <button className="btn primary" type="button" onClick={() => setTutorialOpen(false)}>
              {t('toolbox.web_like_tutorial_acknowledge')}
            </button>
          </div>
        </AccessibleDialog>
      ) : null}
    </section>
  )
}

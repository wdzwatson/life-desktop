import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Database,
  Pencil,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import { useAppStore } from '../../store/useAppStore'
import {
  PROVIDER_CAPABILITIES,
  buildProviderPayload,
  createProviderDraft,
  formatProviderLastTestedAt,
  providerToDraft,
  toggleProviderCapability,
  type ProviderDraft,
  type ProviderSummary,
} from './providerUtils'

type Props = { onChanged: () => void | Promise<void> }

type ModelCapability = 'text' | 'image' | 'video'
type CatalogModel = { id: number; name: string; category: string; capabilities: ModelCapability[] }
const MODEL_CAPABILITIES: ModelCapability[] = ['text', 'image', 'video']

export function ProviderManager({ onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([])
  const [search, setSearch] = useState('')
  const [protocol, setProtocol] = useState('')
  const [capability, setCapability] = useState('')
  const [enabled, setEnabled] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ProviderSummary | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const api = (window as any).electronAPI

  const loadProviders = async () => {
    if (!api?.listAIProviders) return
    setBusy(true)
    const [response, catalogResponse] = await Promise.all([
      api.listAIProviders({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(protocol ? { protocol } : {}),
        ...(capability ? { capability } : {}),
        ...(enabled ? { enabled: enabled === 'enabled' } : {}),
      }),
      api.listAIModels?.() ?? Promise.resolve({ success: true, data: [] }),
    ])
    setBusy(false)
    if (!response?.success) {
      setError(response?.error?.message || t('aiChat.providers.load_failed'))
      return
    }
    setProviders(response.data ?? [])
    setCatalogModels(catalogResponse?.success ? (catalogResponse.data ?? []) : [])
    setError('')
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProviders(), 120)
    return () => window.clearTimeout(timer)
  }, [search, protocol, capability, enabled])

  const refresh = async () => {
    await loadProviders()
    await onChanged()
  }

  const closeEditor = () => {
    setDraft(null)
    setEditing(null)
  }

  const handleDrawerClose = () => closeEditor()

  const openCreate = (trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger
    setEditing(null)
    setDraft(createProviderDraft())
    setError('')
  }

  const openEdit = (provider: ProviderSummary, trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger
    setEditing(provider)
    setDraft(providerToDraft(provider))
    setError('')
  }

  const toggleCatalogModel = (model: CatalogModel) => {
    if (!draft) return
    const applicableCapabilities = model.capabilities.filter((item) => draft.capabilities.includes(item))
    if (applicableCapabilities.length === 0) return
    const selectedForEveryApplicableCapability = applicableCapabilities.every((kind) => {
      const plural = `${kind}Models` as 'textModels' | 'imageModels' | 'videoModels'
      return draft[plural].includes(model.name)
    })
    const nextDraft = { ...draft }
    applicableCapabilities.forEach((kind) => {
      const plural = `${kind}Models` as 'textModels' | 'imageModels' | 'videoModels'
      const models = selectedForEveryApplicableCapability
        ? draft[plural].filter((item) => item !== model.name)
        : [...draft[plural], model.name]
      const defaultKey = `${kind}Model` as 'textModel' | 'imageModel' | 'videoModel'
      nextDraft[plural] = models
      nextDraft[defaultKey] = models.includes(draft[defaultKey]) ? draft[defaultKey] : (models[0] ?? '')
    })
    setDraft(nextDraft)
  }

  const saveProvider = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const payload = buildProviderPayload(draft)
      const response = editing
        ? await api.updateAIProvider(editing.id, payload, {
            preserveHeaders: !draft.replaceHeaders,
          })
        : await api.createAIProvider(payload)
      if (!response?.success) throw new Error(response?.error?.message || t('aiChat.providers.save_failed'))
      const wasEditing = Boolean(editing)
      await api.syncAIModels?.()
      setDraft(null)
      setEditing(null)
      showToast(t(wasEditing ? 'aiChat.providers.updated' : 'aiChat.providers.created'))
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('aiChat.providers.save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: () => Promise<any>, successKey: string) => {
    setBusy(true)
    setError('')
    try {
      const response = await action()
      if (!response?.success) throw new Error(response?.error?.message || t('aiChat.providers.action_failed'))
      showToast(t(successKey))
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('aiChat.providers.action_failed'))
    } finally {
      setBusy(false)
    }
  }

  const deleteProvider = async (provider: ProviderSummary) => {
    if (!window.confirm(t('aiChat.providers.delete_confirm', { name: provider.name }))) return
    await runAction(() => api.deleteAIProvider(provider.id), 'aiChat.providers.deleted')
  }

  return (
    <div className="ai-provider-manager">
      <div className="ai-provider-toolbar">
        <label className="ai-provider-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('aiChat.providers.search_placeholder')}
            aria-label={t('aiChat.providers.search_label')}
          />
        </label>
        <select className="form-field" value={protocol} onChange={(event) => setProtocol(event.target.value)}>
          <option value="">{t('aiChat.providers.all_protocols')}</option>
          <option value="openai_compatible">OpenAI-compatible</option>
          <option value="xai">xAI</option>
          <option value="custom_http">{t('aiChat.providers.custom_http')}</option>
        </select>
        <select className="form-field" value={capability} onChange={(event) => setCapability(event.target.value)}>
          <option value="">{t('aiChat.providers.all_capabilities')}</option>
          {PROVIDER_CAPABILITIES.map((item) => (
            <option key={item} value={item}>
              {t(`aiChat.providers.capability_${item}`)}
            </option>
          ))}
        </select>
        <select className="form-field" value={enabled} onChange={(event) => setEnabled(event.target.value)}>
          <option value="">{t('aiChat.providers.all_statuses')}</option>
          <option value="enabled">{t('aiChat.providers.enabled')}</option>
          <option value="disabled">{t('aiChat.providers.disabled')}</option>
        </select>
        <button className="btn primary ai-provider-add" onClick={(event) => openCreate(event.currentTarget)}>
          <Plus size={15} aria-hidden="true" />
          {t('aiChat.providers.add')}
        </button>
      </div>

      {error && !draft && <p className="ai-provider-error" role="alert">{error}</p>}

      <div className="ai-provider-list" aria-busy={busy}>
        {!busy && providers.length === 0 && (
          <div className="ai-provider-empty">
            <Database size={25} aria-hidden="true" />
            <h2>{t('aiChat.providers.empty_title')}</h2>
            <p>{t('aiChat.providers.empty_desc')}</p>
            <button className="btn primary" onClick={(event) => openCreate(event.currentTarget)}>{t('aiChat.providers.add_first')}</button>
          </div>
        )}

        {providers.map((provider) => (
          <article className={`ai-provider-card ${provider.enabled ? '' : 'is-disabled'}`} key={provider.id}>
            <div className="ai-provider-card__main">
              <div className="ai-provider-card__title-row">
                <h2>{provider.name}</h2>
                <span className={`ai-provider-status is-${provider.connectionStatus}`}>
                  {t(`aiChat.providers.connection_${provider.connectionStatus}`)}
                </span>
                {!provider.enabled && <span className="ai-provider-status">{t('aiChat.providers.disabled')}</span>}
              </div>
              <p className="ai-provider-url">{provider.baseUrl}</p>
              {formatProviderLastTestedAt(provider.lastTestedAt, i18n.language) && (
                <p className="ai-provider-tested-at">
                  {t('aiChat.providers.last_tested', {
                    value: formatProviderLastTestedAt(provider.lastTestedAt, i18n.language),
                  })}
                </p>
              )}
              <div className="ai-provider-badges">
                <span>{provider.protocol}</span>
                {provider.capabilities.map((item) => (
                  <span key={item}>{t(`aiChat.providers.capability_${item}`)}</span>
                ))}
                {provider.credentialConfigured && (
                  <span className="is-secure"><ShieldCheck size={12} aria-hidden="true" />{t('aiChat.providers.credential_saved')}</span>
                )}
              </div>
              <div className="ai-provider-models">
                {(['text', 'image', 'video'] as const).map((kind) => provider.models[kind] && (
                  <div key={kind}>
                    <span>{t(`aiChat.providers.model_${kind}`)}</span>
                    <strong>{provider.models[kind]}{((kind === 'text' ? provider.models.textOptions : kind === 'image' ? provider.models.imageOptions : provider.models.videoOptions)?.length ?? 0) > 1
                      ? ` ${t('aiChat.providers.more_text_models', { count: ((kind === 'text' ? provider.models.textOptions : kind === 'image' ? provider.models.imageOptions : provider.models.videoOptions)?.length ?? 1) - 1 })}`
                      : ''}</strong>
                    {provider.defaults[kind] && <em><Check size={12} aria-hidden="true" />{t('aiChat.providers.default')}</em>}
                  </div>
                ))}
              </div>
            </div>

            <div className="ai-provider-card__actions">
              <button className="ai-chat-icon-button" onClick={(event) => openEdit(provider, event.currentTarget)} aria-label={t('aiChat.providers.edit_name', { name: provider.name })} title={t('aiChat.providers.edit_name', { name: provider.name })}>
                <Pencil size={15} />
              </button>
              <button className="ai-chat-icon-button" onClick={() => void runAction(() => api.copyAIProvider(provider.id), 'aiChat.providers.copied')} aria-label={t('aiChat.providers.copy_name', { name: provider.name })} title={t('aiChat.providers.copy_name', { name: provider.name })}>
                <Copy size={15} />
              </button>
              <button className="ai-chat-icon-button" onClick={() => void runAction(() => api.setAIProviderEnabled(provider.id, !provider.enabled), provider.enabled ? 'aiChat.providers.disabled_toast' : 'aiChat.providers.enabled_toast')} aria-label={t(provider.enabled ? 'aiChat.providers.disable_name' : 'aiChat.providers.enable_name', { name: provider.name })} title={t(provider.enabled ? 'aiChat.providers.disable_name' : 'aiChat.providers.enable_name', { name: provider.name })}>
                <Power size={15} />
              </button>
              <button className="ai-chat-icon-button is-danger" onClick={() => void deleteProvider(provider)} aria-label={t('aiChat.providers.delete_name', { name: provider.name })} title={t('aiChat.providers.delete_name', { name: provider.name })}>
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {draft && (
        <AccessibleDialog
          title={(
            <span className="ai-settings-drawer__title">
              <span>{t(editing ? 'aiChat.providers.edit_title' : 'aiChat.providers.create_title')}</span>
              <button type="button" onClick={handleDrawerClose} aria-label={t('common.close')}>
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          )}
          onClose={closeEditor}
          returnFocus={() => drawerTriggerRef.current?.focus()}
          initialFocusRef={nameRef}
          overlayClassName="ai-settings-drawer-overlay"
          contentClassName="ai-settings-drawer ai-settings-drawer--provider"
          closeOnOverlay
        >
          <div className="ai-provider-form">
            <div className="ai-provider-form__grid">
              <label>
                <span>{t('aiChat.providers.name')}</span>
                <input ref={nameRef} className="form-field" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>
                <span>{t('aiChat.providers.protocol')}</span>
                <select className="form-field" value={draft.protocol} onChange={(event) => setDraft({ ...draft, protocol: event.target.value as ProviderDraft['protocol'] })}>
                  <option value="openai_compatible">OpenAI-compatible</option>
                  <option value="xai">xAI</option>
                  <option value="custom_http">{t('aiChat.providers.custom_http')}</option>
                </select>
              </label>
              <label className="is-wide">
                <span>{t('aiChat.providers.base_url')}</span>
                <input className="form-field" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
              </label>
              <label className="is-wide">
                <span>{t('aiChat.providers.api_key')}</span>
                <input className="form-field" type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={editing?.credentialConfigured ? '********' : (editing ? t('aiChat.providers.api_key_keep') : '')} autoComplete="off" />
              </label>
            </div>
            <fieldset className="ai-provider-capabilities">
              <legend>{t('aiChat.providers.capabilities')}</legend>
              {PROVIDER_CAPABILITIES.map((item) => (
                <label key={item}>
                  <input type="checkbox" checked={draft.capabilities.includes(item)} onChange={() => setDraft({ ...draft, capabilities: toggleProviderCapability(draft.capabilities, item) })} />
                  <span>{t(`aiChat.providers.capability_${item}`)}</span>
                </label>
              ))}
            </fieldset>

            <label className="ai-provider-request-body">
              <span>{t('aiChat.providers.request_body')}</span>
              <small>{t('aiChat.providers.request_body_hint')}</small>
              <textarea
                className="form-field"
                value={draft.requestBodyJson}
                onChange={(event) => setDraft({ ...draft, requestBodyJson: event.target.value })}
                spellCheck={false}
                aria-label={t('aiChat.providers.request_body')}
              />
            </label>

            <fieldset className="ai-provider-model-catalog">
              <legend>{t('aiChat.providers.model_catalog_title')}</legend>
              <p>{t('aiChat.providers.model_catalog_hint')}</p>
              <div className="ai-provider-model-options" role="list">
                {catalogModels.map((model) => {
                  const applicableCapabilities = model.capabilities.filter((item) => draft.capabilities.includes(item))
                  const selected = applicableCapabilities.length > 0 && applicableCapabilities.every((kind) => {
                    const plural = `${kind}Models` as 'textModels' | 'imageModels' | 'videoModels'
                    return draft[plural].includes(model.name)
                  })
                  return <label key={model.id} className="ai-provider-model-option" role="listitem">
                    <input type="checkbox" checked={selected} disabled={applicableCapabilities.length === 0} onChange={() => toggleCatalogModel(model)} />
                    <span className="ai-provider-model-option__name">{model.name}</span>
                    <span className="ai-provider-model-option__category">{model.category || 'other'}</span>
                    <span className="ai-provider-model-option__capabilities">{model.capabilities.map((kind) => t(`aiChat.providers.capability_${kind}`)).join(' · ')}</span>
                  </label>
                })}
                {catalogModels.length === 0 && <span className="ai-provider-model-catalog__empty">{t('aiChat.providers.model_catalog_empty')}</span>}
              </div>
              <div className="ai-provider-model-defaults">
                {MODEL_CAPABILITIES.map((kind) => draft.capabilities.includes(kind) && (() => {
                  const plural = `${kind}Models` as 'textModels' | 'imageModels' | 'videoModels'
                  const defaultKey = `${kind}Model` as 'textModel' | 'imageModel' | 'videoModel'
                  return <label className="ai-provider-model-catalog__default" key={kind}>
                    <span>{t(`aiChat.providers.model_${kind}`)} · {t('aiChat.providers.default_model')}</span>
                    <select className="form-field" value={draft[defaultKey]} disabled={draft[plural].length === 0} onChange={(event) => setDraft({ ...draft, [defaultKey]: event.target.value })}>
                      <option value="">{t('aiChat.providers.select_default_model')}</option>
                      {draft[plural].map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  </label>
                })())}
              </div>
            </fieldset>

            <div className="ai-provider-form__grid">
              <label>
                <span>{t('aiChat.providers.timeout')}</span>
                <input className="form-field" type="number" min="1" max="600" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: event.target.value })} />
              </label>
            </div>

            {editing && editing.headerNames.length > 0 && !draft.replaceHeaders && (
              <div className="ai-provider-preserved-headers">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>{t('aiChat.providers.headers_preserved', { names: editing.headerNames.join(', ') })}</span>
                <button className="btn sm" onClick={() => setDraft({ ...draft, replaceHeaders: true })}>{t('aiChat.providers.replace_headers')}</button>
              </div>
            )}
            {draft.replaceHeaders && (
              <label>
                <span>{t('aiChat.providers.headers_json')}</span>
                <textarea className="form-field ai-provider-headers" value={draft.headersJson} onChange={(event) => setDraft({ ...draft, headersJson: event.target.value })} spellCheck={false} />
              </label>
            )}

            <div className="ai-provider-options">
              <label><input type="checkbox" checked={draft.allowLocalNetwork} onChange={(event) => setDraft({ ...draft, allowLocalNetwork: event.target.checked })} />{t('aiChat.providers.allow_local')}</label>
              <label><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />{t('aiChat.providers.enabled')}</label>
            </div>

            {error && <p className="ai-provider-error" role="alert">{error}</p>}
            <div className="ai-provider-form__actions">
              <button className="btn" onClick={closeEditor}><X size={14} />{t('common.cancel')}</button>
              <button className="btn primary" disabled={busy} onClick={() => void saveProvider()}>{t('common.save')}</button>
            </div>
          </div>
        </AccessibleDialog>
      )}
    </div>
  )
}

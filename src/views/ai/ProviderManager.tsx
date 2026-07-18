import { useEffect, useRef, useState } from 'react'
import {
  Bot,
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
import { buildAgentPayload, type AgentSummary } from './agentUtils'
import {
  PROVIDER_AGENT_PRESETS,
  appendCustomAgentName,
  createCustomAgentSystemPrompt,
  createProviderLinkedAgentDraft,
  toggleProviderAgentPreset,
  type ProviderAgentPresetId,
} from './providerAgentUtils'

type Props = { onChanged: () => void | Promise<void> }

export function ProviderManager({ onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [search, setSearch] = useState('')
  const [protocol, setProtocol] = useState('')
  const [capability, setCapability] = useState('')
  const [enabled, setEnabled] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ProviderSummary | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [selectedPresetIds, setSelectedPresetIds] = useState<ProviderAgentPresetId[]>([])
  const [customAgentName, setCustomAgentName] = useState('')
  const [customAgentNames, setCustomAgentNames] = useState<string[]>([])
  const nameRef = useRef<HTMLInputElement | null>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const api = (window as any).electronAPI

  const loadProviders = async () => {
    if (!api?.listAIProviders) return
    setBusy(true)
    const [response, agentResponse] = await Promise.all([
      api.listAIProviders({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(protocol ? { protocol } : {}),
        ...(capability ? { capability } : {}),
        ...(enabled ? { enabled: enabled === 'enabled' } : {}),
      }),
      api.listAIAgents?.() ?? Promise.resolve({ success: true, data: [] }),
    ])
    setBusy(false)
    if (!response?.success) {
      setError(response?.error?.message || t('aiChat.providers.load_failed'))
      return
    }
    setProviders(response.data ?? [])
    setAgents(agentResponse?.success ? (agentResponse.data ?? []) : [])
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
    setSelectedPresetIds([])
    setCustomAgentName('')
    setCustomAgentNames([])
  }

  const openCreate = (trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger
    setEditing(null)
    setDraft(createProviderDraft())
    setSelectedPresetIds(
      agents.some((agent) => agent.systemPrompt === PROVIDER_AGENT_PRESETS[0].systemPrompt)
        ? []
        : ['general'],
    )
    setCustomAgentName('')
    setCustomAgentNames([])
    setError('')
  }

  const openEdit = (provider: ProviderSummary, trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger
    setEditing(provider)
    setDraft(providerToDraft(provider))
    setSelectedPresetIds([])
    setCustomAgentName('')
    setCustomAgentNames([])
    setError('')
  }

  const addCustomAgent = () => {
    const next = appendCustomAgentName(customAgentNames, customAgentName, agents.map((agent) => agent.name))
    if (next === customAgentNames) return
    setCustomAgentNames(next)
    setCustomAgentName('')
  }

  const createRequestedAgents = async (provider: ProviderSummary) => {
    if (!provider.capabilities.includes('text') || !provider.models.text) return { created: 0, failed: 0 }
    const presetRequests = selectedPresetIds
      .map((presetId) => PROVIDER_AGENT_PRESETS.find((preset) => preset.id === presetId))
      .filter((preset) => preset && !agents.some((agent) => agent.systemPrompt === preset.systemPrompt))
      .map((preset) => ({
        name: t(preset!.nameKey),
        description: t(preset!.descriptionKey),
        systemPrompt: preset!.systemPrompt,
      }))
    const existingNames = new Set(agents.map((agent) => agent.name.trim().toLocaleLowerCase()))
    const customRequests = customAgentNames
      .filter((name) => !existingNames.has(name.trim().toLocaleLowerCase()))
      .map((name) => ({
        name,
        description: t('aiChat.providers.custom_agent_description', { name }),
        systemPrompt: createCustomAgentSystemPrompt(name),
      }))
    const requests = [...presetRequests, ...customRequests]
    let shouldSetDefault = provider.enabled && !agents.some(
      (agent) => agent.isDefault && agent.enabled && agent.configurationStatus === 'ready',
    )
    let created = 0
    let failed = 0

    for (const request of requests) {
      if (!api?.createAIAgent) {
        failed += 1
        continue
      }
      const agentDraft = createProviderLinkedAgentDraft({
        providerId: provider.id,
        ...request,
        capabilities: provider.capabilities,
        enabled: provider.enabled,
        isDefault: shouldSetDefault,
      })
      const response = await api.createAIAgent(buildAgentPayload(agentDraft))
      if (response?.success) {
        created += 1
        shouldSetDefault = false
      } else {
        failed += 1
      }
    }
    return { created, failed }
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
      const linkedResult = await createRequestedAgents(response.data as ProviderSummary)
      setDraft(null)
      setEditing(null)
      setSelectedPresetIds([])
      setCustomAgentName('')
      setCustomAgentNames([])
      showToast(t(linkedResult.created > 0
        ? 'aiChat.providers.saved_with_agents'
        : editing
          ? 'aiChat.providers.updated'
          : 'aiChat.providers.created', { count: linkedResult.created }))
      await refresh()
      if (linkedResult.failed > 0) {
        setError(t('aiChat.providers.agents_create_failed', { count: linkedResult.failed }))
      }
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
                    <strong>{provider.models[kind]}</strong>
                    {provider.defaults[kind] && <em><Check size={12} aria-hidden="true" />{t('aiChat.providers.default')}</em>}
                  </div>
                ))}
              </div>
              {agents.some((agent) => agent.providers.text === provider.id) && (
                <div className="ai-provider-linked-agents">
                  <Bot size={13} aria-hidden="true" />
                  <span>{t('aiChat.providers.linked_agents')}</span>
                  {agents
                    .filter((agent) => agent.providers.text === provider.id)
                    .map((agent) => <strong key={agent.id}>{agent.name}</strong>)}
                </div>
              )}
            </div>

            <div className="ai-provider-card__actions">
              {(['text', 'image', 'video'] as const).map((kind) =>
                provider.capabilities.includes(kind) && provider.models[kind] ? (
                  <button
                    key={kind}
                    className="btn sm"
                    disabled={busy || !provider.enabled || provider.defaults[kind]}
                    onClick={() => void runAction(() => api.setDefaultAIProvider(provider.id, kind), 'aiChat.providers.default_updated')}
                  >
                    {provider.defaults[kind]
                      ? t('aiChat.providers.default_kind', { kind: t(`aiChat.providers.model_${kind}`) })
                      : t('aiChat.providers.set_default_kind', { kind: t(`aiChat.providers.model_${kind}`) })}
                  </button>
                ) : null,
              )}
              <button className="ai-chat-icon-button" onClick={(event) => openEdit(provider, event.currentTarget)} aria-label={t('aiChat.providers.edit_name', { name: provider.name })}>
                <Pencil size={15} />
              </button>
              <button className="ai-chat-icon-button" onClick={() => void runAction(() => api.copyAIProvider(provider.id), 'aiChat.providers.copied')} aria-label={t('aiChat.providers.copy_name', { name: provider.name })}>
                <Copy size={15} />
              </button>
              <button className="ai-chat-icon-button" onClick={() => void runAction(() => api.setAIProviderEnabled(provider.id, !provider.enabled), provider.enabled ? 'aiChat.providers.disabled_toast' : 'aiChat.providers.enabled_toast')} aria-label={t(provider.enabled ? 'aiChat.providers.disable_name' : 'aiChat.providers.enable_name', { name: provider.name })}>
                <Power size={15} />
              </button>
              <button className="ai-chat-icon-button is-danger" onClick={() => void deleteProvider(provider)} aria-label={t('aiChat.providers.delete_name', { name: provider.name })}>
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
              <button type="button" onClick={closeEditor} aria-label={t('common.close')}>
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
                <input className="form-field" type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={editing ? t('aiChat.providers.api_key_keep') : ''} autoComplete="off" />
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

            <div className="ai-provider-form__grid">
              {(['text', 'image', 'video'] as const).map((kind) => draft.capabilities.includes(kind) && (
                <label key={kind}>
                  <span>{t(`aiChat.providers.model_${kind}`)}</span>
                  <input className="form-field" value={draft[`${kind}Model`]} onChange={(event) => setDraft({ ...draft, [`${kind}Model`]: event.target.value })} />
                </label>
              ))}
              <label>
                <span>{t('aiChat.providers.timeout')}</span>
                <input className="form-field" type="number" min="1" max="600" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: event.target.value })} />
              </label>
            </div>

            <fieldset className="ai-provider-agent-picker" disabled={!draft.capabilities.includes('text') || !draft.textModel.trim()}>
              <legend>{t('aiChat.providers.agents_section')}</legend>
              <p>{t(draft.capabilities.includes('text') && draft.textModel.trim()
                ? 'aiChat.providers.agents_section_desc'
                : 'aiChat.providers.agents_require_text')}</p>
              <div className="ai-provider-agent-presets">
                {PROVIDER_AGENT_PRESETS.map((preset) => {
                  const existingAgent = agents.find((agent) => agent.systemPrompt === preset.systemPrompt)
                  const linkedToCurrent = Boolean(existingAgent && editing && existingAgent.providers.text === editing.id)
                  const checked = linkedToCurrent || selectedPresetIds.includes(preset.id)
                  return (
                    <label key={preset.id} className={existingAgent ? 'is-existing' : ''}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={Boolean(existingAgent)}
                        onChange={() => setSelectedPresetIds(toggleProviderAgentPreset(selectedPresetIds, preset.id))}
                      />
                      <span>
                        <strong>{t(preset.nameKey)}</strong>
                        <small>{t(linkedToCurrent
                          ? 'aiChat.providers.agent_already_linked'
                          : existingAgent
                            ? 'aiChat.providers.agent_already_exists'
                            : preset.descriptionKey)}</small>
                      </span>
                    </label>
                  )
                })}
              </div>
              <div className="ai-provider-agent-custom">
                <input
                  className="form-field"
                  value={customAgentName}
                  onChange={(event) => setCustomAgentName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    addCustomAgent()
                  }}
                  placeholder={t('aiChat.providers.custom_agent_placeholder')}
                  aria-label={t('aiChat.providers.custom_agent_label')}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={!customAgentName.trim() || agents.some((agent) => agent.name.trim().toLocaleLowerCase() === customAgentName.trim().toLocaleLowerCase())}
                  onClick={addCustomAgent}
                >
                  <Plus size={14} aria-hidden="true" />
                  {t('aiChat.providers.add_custom_agent')}
                </button>
              </div>
              {customAgentNames.length > 0 && (
                <div className="ai-provider-agent-chips" aria-label={t('aiChat.providers.pending_agents')}>
                  {customAgentNames.map((name) => (
                    <span key={name}>
                      {name}
                      <button type="button" onClick={() => setCustomAgentNames((current) => current.filter((item) => item !== name))} aria-label={t('aiChat.providers.remove_custom_agent', { name })}>
                        <X size={11} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </fieldset>
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

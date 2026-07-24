import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Copy, Pencil, Plus, Power, Search, ShieldAlert, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import { useConfirmation } from '../../components/ConfirmationProvider'
import { useAppStore } from '../../store/useAppStore'
import type { ProviderSummary } from './providerUtils'
import {
  agentToDraft,
  buildAgentPayload,
  createAgentDraft,
  getAgentProviderNames,
  getAgentProviderOptions,
  type AgentDraft,
  type AgentSummary,
} from './agentUtils'

type Props = { onChanged: () => void | Promise<void> }

export function AgentManager({ onChanged }: Props) {
  const { t } = useTranslation()
  const { confirm } = useConfirmation()
  const showToast = useAppStore((state) => state.showToast)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AgentSummary | null>(null)
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const api = (window as any).electronAPI

  const loadData = async () => {
    if (!api?.listAIAgents || !api?.listAIProviders) return
    setBusy(true)
    try {
      const [agentResponse, providerResponse] = await Promise.all([
        api.listAIAgents(),
        api.listAIProviders(),
      ])
      if (!agentResponse?.success || !providerResponse?.success) {
        throw new Error(t('aiChat.agents.load_failed'))
      }
      setAgents(agentResponse.data ?? [])
      setProviders(providerResponse.data ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('aiChat.agents.load_failed'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const refresh = async () => {
    await loadData()
    await onChanged()
  }

  const textProviders = getAgentProviderOptions(providers, 'text')
  const imageProviders = getAgentProviderOptions(providers, 'image')
  const videoProviders = getAgentProviderOptions(providers, 'video')
  const hasEnabledTextProvider = textProviders.some((provider) => provider.enabled)
  const selectedTextProvider = textProviders.find((provider) => String(provider.id) === draft?.textProviderId)
  const selectedTextModels = selectedTextProvider?.models.textOptions?.length
    ? selectedTextProvider.models.textOptions
    : (selectedTextProvider?.models.text ? [selectedTextProvider.models.text] : [])
  const visibleAgents = agents.filter((agent) => {
    const query = search.trim().toLowerCase()
    return !query || agent.name.toLowerCase().includes(query) || agent.description.toLowerCase().includes(query)
  })

  const closeEditor = () => {
    setDraft(null)
    setEditing(null)
  }

  const openCreate = (trigger: HTMLButtonElement) => {
    const defaultProvider = textProviders.find((provider) => provider.enabled)
    drawerTriggerRef.current = trigger
    setEditing(null)
    setDraft(createAgentDraft(defaultProvider?.id, agents.length === 0, defaultProvider?.models.text ?? ''))
    setError('')
  }

  const openEdit = (agent: AgentSummary, trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger
    setEditing(agent)
    setDraft(agentToDraft(agent))
    setError('')
  }

  const saveAgent = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const payload = buildAgentPayload(draft)
      const response = editing
        ? await api.updateAIAgent(editing.id, payload)
        : await api.createAIAgent(payload)
      if (!response?.success) throw new Error(response?.error?.message || t('aiChat.agents.save_failed'))
      setDraft(null)
      setEditing(null)
      showToast(t(editing ? 'aiChat.agents.updated' : 'aiChat.agents.created'))
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('aiChat.agents.save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: () => Promise<any>, successKey: string) => {
    setBusy(true)
    setError('')
    try {
      const response = await action()
      if (!response?.success) throw new Error(response?.error?.message || t('aiChat.agents.action_failed'))
      showToast(t(successKey))
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('aiChat.agents.action_failed'))
    } finally {
      setBusy(false)
    }
  }

  const deleteAgent = async (agent: AgentSummary) => {
    if (!(await confirm({ description: t('aiChat.agents.delete_confirm', { name: agent.name }), confirmLabel: t('common.delete'), tone: 'danger' }))) return
    await runAction(() => api.deleteAIAgent(agent.id), 'aiChat.agents.deleted')
  }

  return (
    <div className="ai-agent-manager">
      <div className="ai-agent-toolbar">
        <label className="ai-provider-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('aiChat.agents.search_placeholder')}
            aria-label={t('aiChat.agents.search_label')}
          />
        </label>
        <button className="btn primary ai-provider-add" disabled={!hasEnabledTextProvider} onClick={(event) => openCreate(event.currentTarget)}>
          <Plus size={15} aria-hidden="true" />
          {t('aiChat.agents.add')}
        </button>
      </div>
      <p className="ai-agent-manager__intro">{t('aiChat.agents.manager_intro')}</p>

      {error && !draft && <p className="ai-provider-error" role="alert">{error}</p>}

      <div className="ai-agent-list" aria-busy={busy}>
        {!busy && agents.length === 0 && (
          <div className="ai-provider-empty">
            <Bot size={25} aria-hidden="true" />
            <h2>{t('aiChat.agents.empty_title')}</h2>
            <p>{t(hasEnabledTextProvider ? 'aiChat.agents.empty_desc' : 'aiChat.agents.provider_required')}</p>
            <button className="btn primary" disabled={!hasEnabledTextProvider} onClick={(event) => openCreate(event.currentTarget)}>
              {t('aiChat.agents.add_first')}
            </button>
          </div>
        )}

        {!busy && agents.length > 0 && visibleAgents.length === 0 && (
          <div className="ai-agent-no-results">{t('aiChat.agents.no_results')}</div>
        )}

        {visibleAgents.map((agent) => {
          const providerNames = getAgentProviderNames(agent, providers)
          return (
            <article className={`ai-agent-card ${agent.enabled ? '' : 'is-disabled'}`} key={agent.id}>
              <div className="ai-agent-card__content">
                <div className="ai-provider-card__title-row">
                  <h2>{agent.name}</h2>
                  <span className={`ai-agent-status is-${agent.configurationStatus}`}>
                    {t(`aiChat.agents.status_${agent.configurationStatus}`)}
                  </span>
                  {agent.isDefault && <span className="ai-agent-status is-default"><Check size={12} />{t('aiChat.agents.default')}</span>}
                  {!agent.enabled && <span className="ai-agent-status">{t('aiChat.agents.disabled')}</span>}
                </div>
                {agent.description && <p className="ai-agent-description">{agent.description}</p>}
                <div className="ai-agent-provider-summary">
                  <span>{t('aiChat.agents.text_provider')}<strong>{providerNames.text} · {agent.textModel}</strong></span>
                  {providerNames.image && <span>{t('aiChat.agents.image_provider')}<strong>{providerNames.image}</strong></span>}
                  {providerNames.video && <span>{t('aiChat.agents.video_provider')}<strong>{providerNames.video}</strong></span>}
                </div>
                <div className="ai-agent-meta">
                  <span>{t('aiChat.agents.context_summary', { count: agent.context.maxMessages })}</span>
                  {agent.temperature !== undefined && <span>{t('aiChat.agents.temperature_summary', { value: agent.temperature })}</span>}
                </div>
                {agent.issues.length > 0 && (
                  <div className="ai-agent-issues" role="status">
                    <ShieldAlert size={15} aria-hidden="true" />
                    <div>
                      <strong>{t('aiChat.agents.issues_title')}</strong>
                      {agent.issues.map((issue) => <p key={issue}>{issue}</p>)}
                    </div>
                  </div>
                )}
              </div>

              <div className="ai-agent-card__actions">
                <button
                  className="btn sm"
                  disabled={busy || agent.isDefault || !agent.enabled || agent.configurationStatus !== 'ready'}
                  onClick={() => void runAction(() => api.setDefaultAIAgent(agent.id), 'aiChat.agents.default_updated')}
                >
                  {agent.isDefault ? t('aiChat.agents.default') : t('aiChat.agents.set_default')}
                </button>
                <button className="ai-chat-icon-button" onClick={(event) => openEdit(agent, event.currentTarget)} aria-label={t('aiChat.agents.edit_name', { name: agent.name })}>
                  <Pencil size={15} />
                </button>
                <button className="ai-chat-icon-button" onClick={() => void runAction(() => api.copyAIAgent(agent.id), 'aiChat.agents.copied')} aria-label={t('aiChat.agents.copy_name', { name: agent.name })}>
                  <Copy size={15} />
                </button>
                <button className="ai-chat-icon-button" disabled={agent.isDefault && agent.enabled} onClick={() => void runAction(() => api.setAIAgentEnabled(agent.id, !agent.enabled), agent.enabled ? 'aiChat.agents.disabled_toast' : 'aiChat.agents.enabled_toast')} aria-label={t(agent.enabled ? 'aiChat.agents.disable_name' : 'aiChat.agents.enable_name', { name: agent.name })}>
                  <Power size={15} />
                </button>
                <button className="ai-chat-icon-button is-danger" onClick={() => void deleteAgent(agent)} aria-label={t('aiChat.agents.delete_name', { name: agent.name })}>
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {draft && (
        <AccessibleDialog
          title={(
            <span className="ai-settings-drawer__title">
              <span>{t(editing ? 'aiChat.agents.edit_title' : 'aiChat.agents.create_title')}</span>
              <button
                type="button"
                className="btn btn-icon-close ai-settings-drawer__close"
                onClick={closeEditor}
                title={t('common.close')}
                aria-label={t('common.close')}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          )}
          onClose={closeEditor}
          returnFocus={() => drawerTriggerRef.current?.focus()}
          initialFocusRef={nameRef}
          overlayClassName="ai-settings-drawer-overlay"
          contentClassName="ai-settings-drawer ai-settings-drawer--agent"
          closeOnOverlay
        >
          <div className="ai-agent-form">
            <div className="ai-provider-form__grid">
              <label>
                <span>{t('aiChat.agents.name')}</span>
                <input ref={nameRef} className="form-field" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>
                <span>{t('aiChat.agents.description')}</span>
                <input className="form-field" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </label>
              <label className="is-wide">
                <span>{t('aiChat.agents.system_prompt')}</span>
                <textarea className="form-field ai-agent-system-prompt" value={draft.systemPrompt} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} />
              </label>
            </div>

            <fieldset className="ai-agent-fieldset">
              <legend>{t('aiChat.agents.provider_section')}</legend>
              <div className="ai-agent-provider-grid">
                <label>
                  <span>{t('aiChat.agents.text_provider')}</span>
                  <select className="form-field" value={draft.textProviderId} onChange={(event) => {
                    const provider = textProviders.find((item) => String(item.id) === event.target.value)
                    setDraft({
                      ...draft,
                      textProviderId: event.target.value,
                      textModel: provider?.models.text ?? '',
                    })
                  }}>
                    <option value="">{t('aiChat.agents.select_provider')}</option>
                    {textProviders.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.enabled}>{provider.name} · {provider.models.text}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('aiChat.agents.text_model')}</span>
                  <select className="form-field" value={draft.textModel} disabled={!draft.textProviderId || selectedTextModels.length === 0} onChange={(event) => setDraft({ ...draft, textModel: event.target.value })}>
                    <option value="">{t('aiChat.agents.select_text_model')}</option>
                    {selectedTextModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('aiChat.agents.image_provider')}</span>
                  <select className="form-field" value={draft.imageProviderId} onChange={(event) => setDraft({ ...draft, imageProviderId: event.target.value })}>
                    <option value="">{t('aiChat.agents.no_provider')}</option>
                    {imageProviders.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.enabled}>{provider.name} · {provider.models.image}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('aiChat.agents.video_provider')}</span>
                  <select className="form-field" value={draft.videoProviderId} onChange={(event) => setDraft({ ...draft, videoProviderId: event.target.value })}>
                    <option value="">{t('aiChat.agents.no_provider')}</option>
                    {videoProviders.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.enabled}>{provider.name} · {provider.models.video}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset className="ai-agent-fieldset">
              <legend>{t('aiChat.agents.behavior_section')}</legend>
              <div className="ai-agent-provider-grid">
                <label>
                  <span>{t('aiChat.agents.temperature')}</span>
                  <input className="form-field" type="number" min="0" max="2" step="0.1" value={draft.temperature} onChange={(event) => setDraft({ ...draft, temperature: event.target.value })} />
                </label>
                <label>
                  <span>{t('aiChat.agents.max_messages')}</span>
                  <input className="form-field" type="number" min="1" max="1000" value={draft.maxMessages} onChange={(event) => setDraft({ ...draft, maxMessages: event.target.value })} />
                </label>
                <label>
                  <span>{t('aiChat.agents.max_output_tokens')}</span>
                  <input className="form-field" type="number" min="1" max="1000000" value={draft.maxOutputTokens} onChange={(event) => setDraft({ ...draft, maxOutputTokens: event.target.value })} />
                </label>
              </div>
            </fieldset>

            <div className="ai-provider-options">
              <label><input type="checkbox" checked={draft.enabled} disabled={editing?.isDefault} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />{t('aiChat.agents.enabled')}</label>
              <label><input type="checkbox" checked={draft.isDefault} disabled={editing?.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />{t('aiChat.agents.default')}</label>
            </div>

            {error && <p className="ai-provider-error" role="alert">{error}</p>}
            <div className="ai-provider-form__actions">
              <button className="btn" onClick={closeEditor}><X size={14} />{t('common.cancel')}</button>
              <button className="btn primary" disabled={busy || !draft.textProviderId || !draft.textModel} onClick={() => void saveAgent()}>{t('common.save')}</button>
            </div>
          </div>
        </AccessibleDialog>
      )}
    </div>
  )
}

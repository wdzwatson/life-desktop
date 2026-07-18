import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Copy, Pencil, Plus, Power, Search, ShieldAlert, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import { useAppStore } from '../../store/useAppStore'
import type { ProviderSummary } from './providerUtils'
import {
  agentToDraft,
  buildAgentPayload,
  createAgentDraft,
  getAgentProviderNames,
  getAgentProviderOptions,
  toggleAgentMcpServer,
  type AgentDraft,
  type AgentMcpSummary,
  type AgentSummary,
} from './agentUtils'

type Props = { onChanged: () => void | Promise<void> }

export function AgentManager({ onChanged }: Props) {
  const { t } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [mcpServers, setMcpServers] = useState<AgentMcpSummary[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AgentSummary | null>(null)
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const api = (window as any).electronAPI

  const loadData = async () => {
    if (!api?.listAIAgents || !api?.listAIProviders || !api?.listAIMcpServers) return
    setBusy(true)
    try {
      const [agentResponse, providerResponse, mcpResponse] = await Promise.all([
        api.listAIAgents(),
        api.listAIProviders(),
        api.listAIMcpServers(),
      ])
      if (!agentResponse?.success || !providerResponse?.success || !mcpResponse?.success) {
        throw new Error(t('aiChat.agents.load_failed'))
      }
      setAgents(agentResponse.data ?? [])
      setProviders(providerResponse.data ?? [])
      setMcpServers(mcpResponse.data ?? [])
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
  const visibleAgents = agents.filter((agent) => {
    const query = search.trim().toLowerCase()
    return !query || agent.name.toLowerCase().includes(query) || agent.description.toLowerCase().includes(query)
  })

  const openCreate = () => {
    const defaultProvider = textProviders.find((provider) => provider.enabled)
    setEditing(null)
    setDraft(createAgentDraft(defaultProvider?.id, agents.length === 0))
    setError('')
  }

  const openEdit = (agent: AgentSummary) => {
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
    if (!window.confirm(t('aiChat.agents.delete_confirm', { name: agent.name }))) return
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
        <button className="btn primary ai-provider-add" disabled={!hasEnabledTextProvider} onClick={openCreate}>
          <Plus size={15} aria-hidden="true" />
          {t('aiChat.agents.add')}
        </button>
      </div>

      {error && <p className="ai-provider-error" role="alert">{error}</p>}

      <div className="ai-agent-list" aria-busy={busy}>
        {!busy && agents.length === 0 && (
          <div className="ai-provider-empty">
            <Bot size={25} aria-hidden="true" />
            <h2>{t('aiChat.agents.empty_title')}</h2>
            <p>{t(hasEnabledTextProvider ? 'aiChat.agents.empty_desc' : 'aiChat.agents.provider_required')}</p>
            <button className="btn primary" disabled={!hasEnabledTextProvider} onClick={openCreate}>
              {t('aiChat.agents.add_first')}
            </button>
          </div>
        )}

        {!busy && agents.length > 0 && visibleAgents.length === 0 && (
          <div className="ai-agent-no-results">{t('aiChat.agents.no_results')}</div>
        )}

        {visibleAgents.map((agent) => {
          const providerNames = getAgentProviderNames(agent, providers)
          const selectedMcpNames = agent.mcpServerIds.map(
            (id) => mcpServers.find((server) => server.id === id)?.name ?? `#${id}`,
          )
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
                  <span>{t('aiChat.agents.text_provider')}<strong>{providerNames.text}</strong></span>
                  {providerNames.image && <span>{t('aiChat.agents.image_provider')}<strong>{providerNames.image}</strong></span>}
                  {providerNames.video && <span>{t('aiChat.agents.video_provider')}<strong>{providerNames.video}</strong></span>}
                </div>
                <div className="ai-agent-meta">
                  <span>{t(`aiChat.agents.approval_${agent.toolApprovalMode}`)}</span>
                  <span>{t('aiChat.agents.max_calls_summary', { count: agent.maxToolCalls })}</span>
                  <span>{t('aiChat.agents.context_summary', { count: agent.context.maxMessages })}</span>
                  <span>{t('aiChat.agents.mcp_summary', { count: selectedMcpNames.length })}</span>
                </div>
                {selectedMcpNames.length > 0 && <p className="ai-agent-mcp-names">{selectedMcpNames.join(' · ')}</p>}
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
                <button className="ai-chat-icon-button" onClick={() => openEdit(agent)} aria-label={t('aiChat.agents.edit_name', { name: agent.name })}>
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
          title={t(editing ? 'aiChat.agents.edit_title' : 'aiChat.agents.create_title')}
          onClose={() => setDraft(null)}
          initialFocusRef={nameRef}
          contentStyle={{ width: 'min(780px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)' }}
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
                  <select className="form-field" value={draft.textProviderId} onChange={(event) => setDraft({ ...draft, textProviderId: event.target.value })}>
                    <option value="">{t('aiChat.agents.select_provider')}</option>
                    {textProviders.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.enabled}>{provider.name} · {provider.models.text}</option>)}
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
                  <span>{t('aiChat.agents.approval_mode')}</span>
                  <select className="form-field" value={draft.toolApprovalMode} onChange={(event) => setDraft({ ...draft, toolApprovalMode: event.target.value as AgentDraft['toolApprovalMode'] })}>
                    {(['confirm_all', 'confirm_risky', 'allow_selected', 'allow_all'] as const).map((mode) => <option key={mode} value={mode}>{t(`aiChat.agents.approval_${mode}`)}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('aiChat.agents.max_tool_calls')}</span>
                  <input className="form-field" type="number" min="0" max="32" value={draft.maxToolCalls} onChange={(event) => setDraft({ ...draft, maxToolCalls: event.target.value })} />
                </label>
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
              {draft.toolApprovalMode === 'allow_all' && (
                <div className="ai-agent-risk-warning"><ShieldAlert size={15} />{t('aiChat.agents.allow_all_warning')}</div>
              )}
            </fieldset>

            <fieldset className="ai-agent-fieldset">
              <legend>{t('aiChat.agents.mcp_section')}</legend>
              {mcpServers.length === 0 ? (
                <p className="ai-agent-fieldset__empty">{t('aiChat.agents.no_mcp')}</p>
              ) : (
                <div className="ai-agent-mcp-grid">
                  {mcpServers.map((server) => (
                    <label key={server.id} className={!server.enabled ? 'is-disabled' : ''}>
                      <input type="checkbox" checked={draft.mcpServerIds.includes(server.id)} onChange={() => setDraft({ ...draft, mcpServerIds: toggleAgentMcpServer(draft.mcpServerIds, server.id) })} />
                      <span><strong>{server.name}</strong><small>{server.transport} · {t('aiChat.agents.tool_count', { count: server.toolCount })}</small></span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="ai-provider-form__grid">
              <label>
                <span>{t('aiChat.agents.allowed_tools')}</span>
                <textarea className="form-field ai-agent-tool-list" value={draft.allowedToolsText} onChange={(event) => setDraft({ ...draft, allowedToolsText: event.target.value })} placeholder={t('aiChat.agents.tools_placeholder')} />
              </label>
              <label>
                <span>{t('aiChat.agents.blocked_tools')}</span>
                <textarea className="form-field ai-agent-tool-list" value={draft.blockedToolsText} onChange={(event) => setDraft({ ...draft, blockedToolsText: event.target.value })} placeholder={t('aiChat.agents.tools_placeholder')} />
              </label>
            </div>

            <div className="ai-provider-options">
              <label><input type="checkbox" checked={draft.enabled} disabled={editing?.isDefault} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />{t('aiChat.agents.enabled')}</label>
              <label><input type="checkbox" checked={draft.isDefault} disabled={editing?.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />{t('aiChat.agents.default')}</label>
            </div>

            {error && <p className="ai-provider-error" role="alert">{error}</p>}
            <div className="ai-provider-form__actions">
              <button className="btn" onClick={() => setDraft(null)}><X size={14} />{t('common.cancel')}</button>
              <button className="btn primary" disabled={busy || !draft.textProviderId} onClick={() => void saveAgent()}>{t('common.save')}</button>
            </div>
          </div>
        </AccessibleDialog>
      )}
    </div>
  )
}

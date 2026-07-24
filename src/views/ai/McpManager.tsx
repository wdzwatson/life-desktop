import { useEffect, useRef, useState } from 'react'
import { Activity, Bot, Copy, Pencil, Plug, Plus, Power, Search, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import { useConfirmation } from '../../components/ConfirmationProvider'
import { useAppStore } from '../../store/useAppStore'
import { agentToDraft, buildAgentPayload, type AgentSummary } from './agentUtils'
import {
  buildMcpPayload,
  createMcpDraft,
  formatMcpLastConnectedAt,
  getMcpCredentialNames,
  getMcpEndpointLabel,
  mcpToDraft,
  setMcpServerLink,
  type McpDraft,
  type McpServerSummary,
  type McpToolRisk,
} from './mcpUtils'

type Props = { onChanged: () => void | Promise<void> }

export function McpManager({ onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const { confirm } = useConfirmation()
  const showToast = useAppStore((state) => state.showToast)
  const [servers, setServers] = useState<McpServerSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [search, setSearch] = useState('')
  const [transport, setTransport] = useState('')
  const [enabled, setEnabled] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<McpServerSummary | null>(null)
  const [draft, setDraft] = useState<McpDraft | null>(null)
  const [riskToolName, setRiskToolName] = useState('')
  const [riskLevel, setRiskLevel] = useState<McpToolRisk>('read')
  const [selectedAgentIds, setSelectedAgentIds] = useState<number[]>([])
  const nameRef = useRef<HTMLInputElement | null>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const api = (window as any).electronAPI

  const loadServers = async () => {
    if (!api?.listAIMcpServers) return
    setBusy(true)
    try {
      const [response, agentResponse] = await Promise.all([
        api.listAIMcpServers(),
        api.listAIAgents?.() ?? Promise.resolve({ success: true, data: [] }),
      ])
      if (!response?.success) throw new Error(response?.error?.message || t('aiChat.mcp.load_failed'))
      setServers(response.data ?? [])
      setAgents(agentResponse?.success ? (agentResponse.data ?? []) : [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('aiChat.mcp.load_failed'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadServers()
  }, [])

  const refresh = async () => {
    await loadServers()
    await onChanged()
  }

  const visibleServers = servers.filter((server) => {
    const query = search.trim().toLowerCase()
    return (
      (!query || server.name.toLowerCase().includes(query) || getMcpEndpointLabel(server).toLowerCase().includes(query)) &&
      (!transport || server.transport === transport) &&
      (!enabled || server.enabled === (enabled === 'enabled'))
    )
  })

  const closeEditor = () => {
    setDraft(null)
    setEditing(null)
    setRiskToolName('')
    setSelectedAgentIds([])
  }

  const openCreate = (trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger
    setEditing(null)
    setDraft(createMcpDraft())
    setRiskToolName('')
    setSelectedAgentIds([])
    setError('')
  }

  const openEdit = (server: McpServerSummary, trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger
    setEditing(server)
    setDraft(mcpToDraft(server))
    setRiskToolName('')
    setSelectedAgentIds(agents.filter((agent) => agent.mcpServerIds.includes(server.id)).map((agent) => agent.id))
    setError('')
  }

  const syncAgentLinks = async (serverId: number) => {
    let changed = 0
    let failed = 0
    for (const agent of agents) {
      const shouldLink = selectedAgentIds.includes(agent.id)
      const isLinked = agent.mcpServerIds.includes(serverId)
      if (shouldLink === isLinked) continue
      if (!api?.updateAIAgent) {
        failed += 1
        continue
      }
      const mcpServerIds = setMcpServerLink(agent.mcpServerIds, serverId, shouldLink)
      const response = await api.updateAIAgent(
        agent.id,
        buildAgentPayload(agentToDraft({ ...agent, mcpServerIds })),
      )
      if (response?.success) changed += 1
      else failed += 1
    }
    return { changed, failed }
  }

  const saveServer = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const payload = buildMcpPayload(draft)
      const response = editing
        ? await api.updateAIMcpServer(editing.id, payload, {
            preserveCredentials:
              draft.preserveCredentials && draft.transport === draft.originalTransport,
          })
        : await api.createAIMcpServer(payload)
      if (!response?.success) throw new Error(response?.error?.message || t('aiChat.mcp.save_failed'))
      const linkResult = await syncAgentLinks((response.data as McpServerSummary).id)
      setDraft(null)
      setEditing(null)
      setSelectedAgentIds([])
      showToast(t(linkResult.changed > 0
        ? 'aiChat.mcp.saved_with_assistants'
        : editing
          ? 'aiChat.mcp.updated'
          : 'aiChat.mcp.created', { count: linkResult.changed }))
      await refresh()
      if (linkResult.failed > 0) {
        setError(t('aiChat.mcp.assistant_link_failed', { count: linkResult.failed }))
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('aiChat.mcp.save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: () => Promise<any>, successKey: string) => {
    setBusy(true)
    setError('')
    try {
      const response = await action()
      if (!response?.success) throw new Error(response?.error?.message || t('aiChat.mcp.action_failed'))
      showToast(t(successKey))
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('aiChat.mcp.action_failed'))
    } finally {
      setBusy(false)
    }
  }

  const deleteServer = async (server: McpServerSummary) => {
    if (api?.getAIMcpDependencies) {
      const dependencyResponse = await api.getAIMcpDependencies(server.id)
      if (dependencyResponse?.success && dependencyResponse.data?.length > 0) {
        setError(t('aiChat.mcp.delete_blocked_dependencies', {
          names: dependencyResponse.data.map((item: { agentName: string }) => item.agentName).join(', '),
        }))
        return
      }
    }
    if (!(await confirm({ description: t('aiChat.mcp.delete_confirm', { name: server.name }), confirmLabel: t('common.delete'), tone: 'danger' }))) return
    await runAction(() => api.deleteAIMcpServer(server.id), 'aiChat.mcp.deleted')
  }

  const toggleServer = async (server: McpServerSummary) => {
    if (server.enabled && api?.getAIMcpDependencies) {
      const dependencyResponse = await api.getAIMcpDependencies(server.id)
      if (dependencyResponse?.success && dependencyResponse.data?.length > 0) {
        const names = dependencyResponse.data.map((item: { agentName: string }) => item.agentName).join(', ')
        if (!(await confirm({ description: t('aiChat.mcp.disable_confirm_dependencies', { names }), confirmLabel: t('common.confirm'), tone: 'danger' }))) return
      }
    }
    await runAction(
      () => api.setAIMcpServerEnabled(server.id, !server.enabled),
      server.enabled ? 'aiChat.mcp.disabled_toast' : 'aiChat.mcp.enabled_toast',
    )
  }

  const testServer = async (server: McpServerSummary) => {
    if (!server.enabled || !api?.connectAIMcpServer) return
    await runAction(
      () => api.connectAIMcpServer(server.id, true),
      'aiChat.mcp.connection_succeeded',
    )
  }

  const setRiskOverride = async (toolName: string, risk: McpToolRisk | null) => {
    if (!editing || (!toolName.trim() && risk !== null)) return
    setBusy(true)
    setError('')
    try {
      const response = await api.setAIMcpToolRisk(editing.id, toolName.trim(), risk)
      if (!response?.success) throw new Error(response?.error?.message || t('aiChat.mcp.risk_failed'))
      setEditing(response.data)
      setServers((current) => current.map((server) => server.id === editing.id ? response.data : server))
      setRiskToolName('')
      showToast(t(risk === null ? 'aiChat.mcp.risk_removed' : 'aiChat.mcp.risk_saved'))
    } catch (riskError) {
      setError(riskError instanceof Error ? riskError.message : t('aiChat.mcp.risk_failed'))
    } finally {
      setBusy(false)
    }
  }

  const changeTransport = (nextTransport: McpDraft['transport']) => {
    if (!draft) return
    setDraft({
      ...draft,
      transport: nextTransport,
      preserveCredentials:
        nextTransport === draft.originalTransport ? draft.preserveCredentials : false,
    })
  }

  return (
    <div className="ai-mcp-manager">
      <section className="ai-mcp-explainer" aria-labelledby="ai-mcp-explainer-title">
        <div className="ai-mcp-explainer__heading">
          <Plug size={18} aria-hidden="true" />
          <div>
            <h2 id="ai-mcp-explainer-title">{t('aiChat.mcp.explainer_title')}</h2>
            <p>{t('aiChat.mcp.explainer_desc')}</p>
          </div>
        </div>
        <dl>
          <div><dt>{t('aiChat.mcp.use_case_label')}</dt><dd>{t('aiChat.mcp.use_case_desc')}</dd></div>
          <div><dt>{t('aiChat.mcp.optional_label')}</dt><dd>{t('aiChat.mcp.optional_desc')}</dd></div>
          <div><dt>{t('aiChat.mcp.safety_label')}</dt><dd>{t('aiChat.mcp.safety_desc')}</dd></div>
        </dl>
      </section>

      <div className="ai-mcp-toolbar">
        <label className="ai-provider-search">
          <Search size={15} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('aiChat.mcp.search_placeholder')} aria-label={t('aiChat.mcp.search_label')} />
        </label>
        <select className="form-field" value={transport} onChange={(event) => setTransport(event.target.value)} aria-label={t('aiChat.mcp.transport_filter')}>
          <option value="">{t('aiChat.mcp.all_transports')}</option>
          <option value="streamable_http">Streamable HTTP</option>
          <option value="sse">SSE</option>
          <option value="stdio">stdio</option>
        </select>
        <select className="form-field" value={enabled} onChange={(event) => setEnabled(event.target.value)} aria-label={t('aiChat.mcp.status_filter')}>
          <option value="">{t('aiChat.mcp.all_statuses')}</option>
          <option value="enabled">{t('aiChat.mcp.enabled')}</option>
          <option value="disabled">{t('aiChat.mcp.disabled')}</option>
        </select>
        <button className="btn primary ai-provider-add" onClick={(event) => openCreate(event.currentTarget)}><Plus size={15} />{t('aiChat.mcp.add')}</button>
      </div>

      {error && !draft && <p className="ai-provider-error" role="alert">{error}</p>}

      <div className="ai-mcp-list" aria-busy={busy}>
        {!busy && servers.length === 0 && (
          <div className="ai-provider-empty">
            <Plug size={25} aria-hidden="true" />
            <h2>{t('aiChat.mcp.empty_title')}</h2>
            <p>{t('aiChat.mcp.empty_desc')}</p>
            <button className="btn primary" onClick={(event) => openCreate(event.currentTarget)}>{t('aiChat.mcp.add_first')}</button>
          </div>
        )}

        {!busy && servers.length > 0 && visibleServers.length === 0 && <div className="ai-agent-no-results">{t('aiChat.mcp.no_results')}</div>}

        {visibleServers.map((server) => {
          const lastConnectedAt = formatMcpLastConnectedAt(server.lastConnectedAt, i18n.language)
          const linkedAgents = agents.filter((agent) => agent.mcpServerIds.includes(server.id))
          return (
            <article className={`ai-mcp-card ${server.enabled ? '' : 'is-disabled'}`} key={server.id}>
              <div className="ai-mcp-card__content">
                <div className="ai-provider-card__title-row">
                  <h2>{server.name}</h2>
                  <span className={`ai-mcp-status is-${server.connectionStatus}`}>{t(`aiChat.mcp.connection_${server.connectionStatus}`)}</span>
                  {!server.enabled && <span className="ai-mcp-status">{t('aiChat.mcp.disabled')}</span>}
                </div>
                {server.description && <p className="ai-agent-description">{server.description}</p>}
                <p className="ai-mcp-endpoint">{getMcpEndpointLabel(server)}</p>
                <div className="ai-mcp-meta">
                  <span>{server.transport}</span>
                  <span>{t('aiChat.mcp.tool_count', { count: server.toolCount })}</span>
                  {server.protocolVersion && <span>{t('aiChat.mcp.protocol_version', { version: server.protocolVersion })}</span>}
                  {server.credentialConfigured && <span className="is-secure"><ShieldCheck size={12} />{t('aiChat.mcp.credential_saved')}</span>}
                </div>
                {linkedAgents.length > 0 && (
                  <div className="ai-provider-linked-agents">
                    <Bot size={13} aria-hidden="true" />
                    <span>{t('aiChat.mcp.linked_assistants')}</span>
                    {linkedAgents.map((agent) => <strong key={agent.id}>{agent.name}</strong>)}
                  </div>
                )}
                {lastConnectedAt && <p className="ai-provider-tested-at">{t('aiChat.mcp.last_connected', { value: lastConnectedAt })}</p>}
                {server.lastError.message && (
                  <div className="ai-mcp-error"><ShieldAlert size={15} /><div><strong>{server.lastError.code ?? t('aiChat.mcp.unknown_error')}</strong><p>{server.lastError.message}</p></div></div>
                )}
                {Object.keys(server.riskOverrides).length > 0 && (
                  <div className="ai-mcp-risk-summary">
                    {Object.entries(server.riskOverrides).map(([toolName, risk]) => <span key={toolName}>{toolName}<strong>{t(`aiChat.mcp.risk_${risk}`)}</strong></span>)}
                  </div>
                )}
              </div>
              <div className="ai-mcp-card__actions">
                <button
                  className="btn sm"
                  disabled={!server.enabled || busy}
                  title={t(server.connectionStatus === 'connected' ? 'aiChat.mcp.refresh_tools' : 'aiChat.mcp.test_connection')}
                  onClick={() => void testServer(server)}
                >
                  <Activity size={14} />
                  {t(server.connectionStatus === 'connected' ? 'aiChat.mcp.refresh_tools' : 'aiChat.mcp.test_connection')}
                </button>
                <button className="ai-chat-icon-button" onClick={(event) => openEdit(server, event.currentTarget)} aria-label={t('aiChat.mcp.edit_name', { name: server.name })}><Pencil size={15} /></button>
                <button className="ai-chat-icon-button" onClick={() => void runAction(() => api.copyAIMcpServer(server.id), 'aiChat.mcp.copied')} aria-label={t('aiChat.mcp.copy_name', { name: server.name })}><Copy size={15} /></button>
                <button className="ai-chat-icon-button" onClick={() => void toggleServer(server)} aria-label={t(server.enabled ? 'aiChat.mcp.disable_name' : 'aiChat.mcp.enable_name', { name: server.name })}><Power size={15} /></button>
                <button className="ai-chat-icon-button is-danger" onClick={() => void deleteServer(server)} aria-label={t('aiChat.mcp.delete_name', { name: server.name })}><Trash2 size={15} /></button>
              </div>
            </article>
          )
        })}
      </div>

      {draft && (
        <AccessibleDialog
          title={(
            <span className="ai-settings-drawer__title">
              <span>{t(editing ? 'aiChat.mcp.edit_title' : 'aiChat.mcp.create_title')}</span>
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
          contentClassName="ai-settings-drawer ai-settings-drawer--mcp"
          closeOnOverlay
        >
          <div className="ai-mcp-form">
            <div className="ai-provider-form__grid">
              <label><span>{t('aiChat.mcp.name')}</span><input ref={nameRef} className="form-field" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label><span>{t('aiChat.mcp.transport')}</span><select className="form-field" value={draft.transport} onChange={(event) => changeTransport(event.target.value as McpDraft['transport'])}><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option><option value="stdio">stdio</option></select></label>
              <label className="is-wide"><span>{t('aiChat.mcp.description')}</span><input className="form-field" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            </div>

            {draft.transport === 'stdio' ? (
              <div className="ai-provider-form__grid">
                <label className="is-wide"><span>{t('aiChat.mcp.command')}</span><input className="form-field" value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} /></label>
                <label><span>{t('aiChat.mcp.arguments')}</span><textarea className="form-field ai-mcp-code-field" value={draft.argsText} onChange={(event) => setDraft({ ...draft, argsText: event.target.value })} placeholder={t('aiChat.mcp.arguments_placeholder')} /></label>
                <label><span>{t('aiChat.mcp.cwd')}</span><input className="form-field" value={draft.cwd} onChange={(event) => setDraft({ ...draft, cwd: event.target.value })} /></label>
              </div>
            ) : (
              <label><span>{t('aiChat.mcp.url')}</span><input className="form-field" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://mcp.example.com" /></label>
            )}

            {editing && draft.preserveCredentials && draft.transport === draft.originalTransport && (
              <div className="ai-provider-preserved-headers"><ShieldCheck size={15} /><span>{t('aiChat.mcp.credentials_preserved', { names: getMcpCredentialNames(editing).join(', ') })}</span><button className="btn sm" onClick={() => setDraft({ ...draft, preserveCredentials: false })}>{t('aiChat.mcp.replace_credentials')}</button></div>
            )}
            {!draft.preserveCredentials && (
              <label><span>{t(draft.transport === 'stdio' ? 'aiChat.mcp.env_json' : 'aiChat.mcp.headers_json')}</span><textarea className="form-field ai-mcp-code-field" value={draft.transport === 'stdio' ? draft.envJson : draft.headersJson} onChange={(event) => setDraft(draft.transport === 'stdio' ? { ...draft, envJson: event.target.value } : { ...draft, headersJson: event.target.value })} spellCheck={false} /></label>
            )}

            {draft.transport === 'stdio' && <div className="ai-agent-risk-warning"><ShieldAlert size={15} />{t('aiChat.mcp.stdio_warning')}</div>}

            <div className="ai-provider-form__grid">
              <label><span>{t('aiChat.mcp.timeout')}</span><input className="form-field" type="number" min="1" max="600" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: event.target.value })} /></label>
            </div>

            <fieldset className="ai-mcp-agent-picker">
              <legend>{t('aiChat.mcp.assistant_access')}</legend>
              <p>{t('aiChat.mcp.assistant_access_desc')}</p>
              {agents.length === 0 ? (
                <div className="ai-agent-fieldset__empty">{t('aiChat.mcp.no_assistants')}</div>
              ) : (
                <div className="ai-mcp-agent-grid">
                  {agents.map((agent) => (
                    <label key={agent.id}>
                      <input
                        type="checkbox"
                        checked={selectedAgentIds.includes(agent.id)}
                        onChange={() => setSelectedAgentIds((current) => current.includes(agent.id)
                          ? current.filter((id) => id !== agent.id)
                          : [...current, agent.id].sort((left, right) => left - right))}
                      />
                      <Bot size={14} aria-hidden="true" />
                      <span><strong>{agent.name}</strong><small>{agent.description}</small></span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            {editing && (
              <fieldset className="ai-agent-fieldset">
                <legend>{t('aiChat.mcp.risk_overrides')}</legend>
                <div className="ai-mcp-risk-editor">
                  <input className="form-field" value={riskToolName} onChange={(event) => setRiskToolName(event.target.value)} placeholder={t('aiChat.mcp.tool_name')} />
                  <select className="form-field" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as McpToolRisk)}>{(['read', 'write', 'command', 'external_side_effect'] as const).map((risk) => <option value={risk} key={risk}>{t(`aiChat.mcp.risk_${risk}`)}</option>)}</select>
                  <button className="btn sm" disabled={!riskToolName.trim() || busy} onClick={() => void setRiskOverride(riskToolName, riskLevel)}>{t('aiChat.mcp.save_risk')}</button>
                </div>
                <div className="ai-mcp-risk-list">
                  {Object.entries(editing.riskOverrides).map(([toolName, risk]) => <span key={toolName}>{toolName}<strong>{t(`aiChat.mcp.risk_${risk}`)}</strong><button onClick={() => void setRiskOverride(toolName, null)} aria-label={t('aiChat.mcp.remove_risk_name', { name: toolName })}><X size={12} /></button></span>)}
                  {Object.keys(editing.riskOverrides).length === 0 && <p className="ai-agent-fieldset__empty">{t('aiChat.mcp.no_risk_overrides')}</p>}
                </div>
              </fieldset>
            )}

            <div className="ai-provider-options"><label><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />{t('aiChat.mcp.enabled')}</label></div>
            {error && <p className="ai-provider-error" role="alert">{error}</p>}
            <div className="ai-provider-form__actions"><button className="btn" onClick={closeEditor}><X size={14} />{t('common.cancel')}</button><button className="btn primary" disabled={busy} onClick={() => void saveServer()}>{t('common.save')}</button></div>
          </div>
        </AccessibleDialog>
      )}
    </div>
  )
}

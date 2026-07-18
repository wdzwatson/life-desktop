import { useEffect, useMemo, useState } from 'react'
import { Bot, Database, MessageSquare, Plug, RefreshCw, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './AIChat.css'
import { ProviderManager } from './ProviderManager'

type AIView = 'chat' | 'providers' | 'agents' | 'mcp'
type ConfigCounts = { providers: number; agents: number; mcp: number }
type LoadState = 'loading' | 'ready' | 'error'

const EMPTY_COUNTS: ConfigCounts = { providers: 0, agents: 0, mcp: 0 }

export function AIChat() {
  const { t } = useTranslation()
  const [activeView, setActiveView] = useState<AIView>('chat')
  const [counts, setCounts] = useState<ConfigCounts>(EMPTY_COUNTS)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const api = (window as any).electronAPI

  const loadConfiguration = async () => {
    if (!api?.listAIProviders || !api?.listAIAgents || !api?.listAIMcpServers) {
      setCounts(EMPTY_COUNTS)
      setLoadState('ready')
      return
    }
    setLoadState('loading')
    try {
      const [providers, agents, mcp] = await Promise.all([
        api.listAIProviders(),
        api.listAIAgents(),
        api.listAIMcpServers(),
      ])
      if (!providers?.success || !agents?.success || !mcp?.success) throw new Error('load failed')
      setCounts({
        providers: providers.data?.length ?? 0,
        agents: agents.data?.length ?? 0,
        mcp: mcp.data?.length ?? 0,
      })
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }

  useEffect(() => {
    void loadConfiguration()
  }, [])

  const navigation = useMemo(
    () => [
      { id: 'chat' as const, label: t('aiChat.nav_chat'), icon: MessageSquare },
      { id: 'providers' as const, label: t('aiChat.nav_providers'), icon: Database, count: counts.providers },
      { id: 'agents' as const, label: t('aiChat.nav_agents'), icon: Bot, count: counts.agents },
      { id: 'mcp' as const, label: t('aiChat.nav_mcp'), icon: Plug, count: counts.mcp },
    ],
    [counts, t],
  )

  const hasProvider = counts.providers > 0

  return (
    <main className="ai-chat-shell" aria-label={t('aiChat.title')}>
      <header className="ai-chat-header">
        <div className="ai-chat-heading">
          <span className="ai-chat-heading__icon" aria-hidden="true">
            <MessageSquare size={19} />
          </span>
          <div>
            <h1>{t('aiChat.title')}</h1>
            <p>{t('aiChat.subtitle')}</p>
          </div>
        </div>
        <button className="ai-chat-icon-button" aria-label={t('aiChat.settings')} title={t('aiChat.settings')}>
          <Settings2 size={17} />
        </button>
      </header>

      <nav className="ai-chat-nav" aria-label={t('aiChat.navigation_label')}>
        {navigation.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            className={`ai-chat-nav__item ${activeView === id ? 'is-active' : ''}`}
            onClick={() => setActiveView(id)}
            aria-current={activeView === id ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
            {typeof count === 'number' && <span className="ai-chat-nav__count">{count}</span>}
          </button>
        ))}
      </nav>

      <section className="ai-chat-content" aria-live="polite">
        {loadState === 'loading' && (
          <div className="ai-chat-state" role="status">
            <RefreshCw className="ai-chat-state__spinner" size={22} aria-hidden="true" />
            <p>{t('aiChat.loading')}</p>
          </div>
        )}

        {loadState === 'error' && (
          <div className="ai-chat-state ai-chat-state--error" role="alert">
            <h2>{t('aiChat.config_error_title')}</h2>
            <p>{t('aiChat.config_error_desc')}</p>
            <button className="btn" onClick={() => void loadConfiguration()}>
              {t('aiChat.retry')}
            </button>
          </div>
        )}

        {loadState === 'ready' && activeView === 'chat' && !hasProvider && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty__ambient" aria-hidden="true" />
            <div className="ai-chat-empty__content">
              <h2>{t('aiChat.empty_title')}</h2>
              <p>{t('aiChat.empty_desc')}</p>
              <div className="ai-chat-empty__actions">
                <button className="btn primary" onClick={() => setActiveView('providers')}>
                  {t('aiChat.configure_provider')}
                </button>
                <button className="btn" onClick={() => setActiveView('agents')}>
                  {t('aiChat.review_agents')}
                </button>
              </div>
            </div>
          </div>
        )}

        {loadState === 'ready' && activeView === 'providers' && (
          <ProviderManager onChanged={loadConfiguration} />
        )}

        {loadState === 'ready' && activeView !== 'providers' && (activeView !== 'chat' || hasProvider) && (
          <div className="ai-chat-panel-placeholder">
            <div className="ai-chat-panel-placeholder__icon" aria-hidden="true">
              {activeView === 'agents' ? <Bot size={24} /> : activeView === 'mcp' ? <Plug size={24} /> : <MessageSquare size={24} />}
            </div>
            <h2>{t(`aiChat.panel_${activeView}_title`)}</h2>
            <p>{t(`aiChat.panel_${activeView}_desc`)}</p>
          </div>
        )}
      </section>
    </main>
  )
}

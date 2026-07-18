import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Database, HardDrive, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './AIChat.css'
import { ChatWorkspace, type AIChatAgent } from './ChatWorkspace'
import { ProviderManager } from './ProviderManager'
import { StorageManager } from './StorageManager'

type AIMode = 'chat' | 'settings'
type AISettingsView = 'providers' | 'storage'
type ConfigCounts = { providers: number }
type LoadState = 'loading' | 'ready' | 'error'

const EMPTY_COUNTS: ConfigCounts = { providers: 0 }

export function AIChat() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AIMode>('chat')
  const [settingsView, setSettingsView] = useState<AISettingsView>('providers')
  const [counts, setCounts] = useState<ConfigCounts>(EMPTY_COUNTS)
  const [agents, setAgents] = useState<AIChatAgent[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const setupTransitionRef = useRef(false)
  const api = (window as any).electronAPI

  const loadConfiguration = async () => {
    if (!api?.listAIProviders || !api?.listAIAgents) {
      setCounts(EMPTY_COUNTS)
      setLoadState('ready')
      return
    }
    setLoadState('loading')
    try {
      const [providers, agents] = await Promise.all([
        api.listAIProviders(),
        api.listAIAgents(),
      ])
      if (!providers?.success || !agents?.success) throw new Error('load failed')
      setCounts({
        providers: providers.data?.length ?? 0,
      })
      if ((providers.data?.length ?? 0) > 0 && setupTransitionRef.current) {
        setupTransitionRef.current = false
        setMode('chat')
      }
      setAgents(agents.data ?? [])
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }

  useEffect(() => {
    void loadConfiguration()
  }, [])

  const settingsNavigation = useMemo(
    () => [
      { id: 'providers' as const, label: t('aiChat.nav_providers'), icon: Database, count: counts.providers },
      { id: 'storage' as const, label: t('aiChat.nav_storage'), icon: HardDrive },
    ],
    [counts, t],
  )

  const hasProvider = counts.providers > 0
  const openSettings = (view: AISettingsView = 'providers') => {
    setSettingsView(view)
    setMode('settings')
  }

  return (
    <main className={`ai-chat-shell is-${mode}`} aria-label={t('aiChat.title')}>
      {mode === 'settings' && (
        <header className="ai-chat-header">
          <div className="ai-settings-heading">
            <button className="ai-settings-back" onClick={() => setMode('chat')}>
              <ArrowLeft size={16} aria-hidden="true" />
              {t('aiChat.back_to_chat')}
            </button>
            <div>
              <h1>{t('aiChat.settings_title')}</h1>
              <p>{t('aiChat.settings_description')}</p>
            </div>
          </div>
        </header>
      )}

      <section className="ai-chat-content">
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

        {loadState === 'ready' && mode === 'chat' && (
          <ChatWorkspace
            agents={agents}
            hasProvider={hasProvider}
            onOpenSettings={() => openSettings()}
            onOpenProviders={() => {
              setupTransitionRef.current = true
              openSettings('providers')
            }}
          />
        )}

        {loadState === 'ready' && mode === 'settings' && (
          <div className="ai-settings-shell">
            <nav className="ai-settings-nav" aria-label={t('aiChat.settings_navigation_label')}>
              {settingsNavigation.map(({ id, label, icon: Icon, count }) => (
                <button
                  key={id}
                  className={settingsView === id ? 'is-active' : ''}
                  onClick={() => setSettingsView(id)}
                  aria-current={settingsView === id ? 'page' : undefined}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                  {typeof count === 'number' && <strong>{count}</strong>}
                </button>
              ))}
            </nav>
            <section className="ai-settings-content">
              {settingsView === 'providers' && <ProviderManager onChanged={loadConfiguration} />}
              {settingsView === 'storage' && <StorageManager />}
            </section>
          </div>
        )}
      </section>
    </main>
  )
}

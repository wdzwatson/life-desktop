import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Boxes, Database, HardDrive, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './AIChat.css'
import { ChatWorkspace, type AIChatMediaProvider, type AIChatModel } from './ChatWorkspace'
import { ModelManager } from './ModelManager'
import { ProviderManager } from './ProviderManager'
import { StorageManager } from './StorageManager'

type AIMode = 'chat' | 'settings'
type AISettingsView = 'providers' | 'models' | 'storage'
type ConfigCounts = { providers: number; models: number }
type LoadState = 'loading' | 'ready' | 'error'

const EMPTY_COUNTS: ConfigCounts = { providers: 0, models: 0 }

export function AIChat() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AIMode>('chat')
  const [settingsView, setSettingsView] = useState<AISettingsView>('providers')
  const [counts, setCounts] = useState<ConfigCounts>(EMPTY_COUNTS)
  const [models, setModels] = useState<AIChatModel[]>([])
  const [mediaProviders, setMediaProviders] = useState<AIChatMediaProvider[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const setupTransitionRef = useRef(false)
  const api = (window as any).electronAPI

  const loadConfiguration = async () => {
    if (!api?.listAIProviders || !api?.listAIModels) {
      setCounts(EMPTY_COUNTS)
      setLoadState('ready')
      return
    }
    setLoadState('loading')
    try {
      const [providers, catalogResponse, runtimeResponse] = await Promise.all([
        api.listAIProviders(),
        api.listAIModels(),
        api.syncAIModels(),
      ])
      if (!providers?.success || !catalogResponse?.success || !runtimeResponse?.success) throw new Error('load failed')
      const textModels = (runtimeResponse.data ?? []).filter((model: any) => model.agentId && model.providers) as any[]
      const providerById = new Map<number, { capabilities?: string[] }>(
        (providers.data ?? []).map((provider: any) => [provider.id, provider]),
      )
      setCounts({
        providers: providers.data?.length ?? 0,
        models: catalogResponse.data?.length ?? 0,
      })
      if ((providers.data?.length ?? 0) > 0 && setupTransitionRef.current) {
        setupTransitionRef.current = false
        setMode('chat')
      }
      setModels(textModels.map((model: any) => ({
        id: model.agentId,
        name: model.model,
        description: model.providerName,
        providerName: model.providerName,
        textModel: model.model,
        providers: model.providers,
        supportsVision: providerById.get(model.providers.text)?.capabilities?.includes('vision') ?? false,
        enabled: model.enabled,
        isDefault: model.isDefault,
        configurationStatus: model.enabled ? 'ready' : 'incomplete',
        issues: [],
      })))
      setMediaProviders((providers.data ?? []).map((provider: any) => ({
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        capabilities: provider.capabilities ?? [],
        models: provider.models ?? {},
      })))
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
      { id: 'models' as const, label: t('aiChat.nav_models'), icon: Boxes, count: counts.models },
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
            models={models}
            mediaProviders={mediaProviders}
            hasProvider={hasProvider}
            onOpenSettings={() => openSettings()}
            onOpenProviders={() => {
              setupTransitionRef.current = true
              openSettings('providers')
            }}
            onOpenModels={() => openSettings('models')}
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
              {settingsView === 'models' && <ModelManager onChanged={loadConfiguration} />}
              {settingsView === 'storage' && <StorageManager />}
            </section>
          </div>
        )}
      </section>
    </main>
  )
}

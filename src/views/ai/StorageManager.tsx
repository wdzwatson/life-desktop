import { useEffect, useMemo, useState } from 'react'
import {
  ArchiveX,
  Database,
  Film,
  FolderOpen,
  HardDrive,
  Image,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConfirmation } from '../../components/ConfirmationProvider'

type StorageUsage = {
  schemaVersion: number
  databaseBytes: number
  mediaBytes: number
  orphanBytes: number
  temporaryBytes: number
  totalBytes: number
  capacityLimitBytes: number
  conversationCount: number
  messageCount: number
  activeRunCount: number
  mediaCount: number
  activeMediaCount: number
  recoverableMediaCount: number
  referencedMediaCount: number
  unreferencedMediaCount: number
  orphanFileCount: number
  temporaryFileCount: number
  latestImageAssetId: number | null
  locations: { database: string; media: string; credentials: string }
  byType: Array<{ mediaType: 'image' | 'video' | 'audio' | 'file'; count: number; bytes: number }>
}

type CleanupScope = 'unreferenced' | 'media_type' | 'capacity' | 'all_media' | 'all_ai'
type CleanupPlan = {
  planHash: string
  assetCount: number
  referencedAssetCount: number
  activeAssetCount: number
  activeConversationRunCount: number
  orphanFileCount: number
  conversationCount: number
  bytes: number
  estimatedRemainingMediaBytes: number
  blockedReason: string | null
  input: Record<string, unknown>
}

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { message?: string } | string }

const GIB = 1024 * 1024 * 1024

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / (1024 ** index)
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

function responseError(response: ApiResponse<unknown> | undefined, fallback: string) {
  if (!response || response.success) return fallback
  return typeof response.error === 'string' ? response.error : response.error?.message || fallback
}

export function StorageManager() {
  const { t } = useTranslation()
  const { confirm } = useConfirmation()
  const api = (window as any).electronAPI
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [scope, setScope] = useState<CleanupScope>('unreferenced')
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio' | 'file'>('image')
  const [capacityGb, setCapacityGb] = useState(5)
  const [autoCleanup, setAutoCleanup] = useState(false)
  const [plan, setPlan] = useState<CleanupPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    if (!api?.getAIStorageUsage) return
    setBusy(true)
    const [usageResponse, settingsResponse] = await Promise.all([
      api.getAIStorageUsage() as Promise<ApiResponse<StorageUsage>>,
      api.getSettings?.() as Promise<Record<string, unknown>>,
    ])
    setBusy(false)
    if (!usageResponse?.success) {
      setNotice(responseError(usageResponse, t('aiChat.storage.load_failed')))
      return
    }
    setUsage(usageResponse.data)
    const loadedSettings = settingsResponse ?? {}
    setSettings(loadedSettings)
    const configuredBytes = Number(loadedSettings.aiMediaMaxBytes)
    setCapacityGb(Number.isFinite(configuredBytes) && configuredBytes > 0 ? Math.round(configuredBytes / GIB) : 5)
    setAutoCleanup(loadedSettings.aiMediaCleanupPolicy === 'auto_unreferenced')
    setPlan(null)
    setNotice(null)
  }

  useEffect(() => {
    void load()
  }, [])

  const typeMap = useMemo(
    () => new Map(usage?.byType.map((item) => [item.mediaType, item]) ?? []),
    [usage?.byType],
  )
  const cleanupInput = () => ({
    scope,
    ...(scope === 'media_type' ? { mediaType } : {}),
    ...(scope === 'capacity' ? { maxMediaBytes: capacityGb * GIB } : {}),
  })

  const preview = async () => {
    if (!api?.previewAIStorageCleanup) return
    setBusy(true)
    setNotice(null)
    const response = await api.previewAIStorageCleanup(cleanupInput()) as ApiResponse<CleanupPlan>
    setBusy(false)
    if (!response?.success) {
      setNotice(responseError(response, t('aiChat.storage.preview_failed')))
      return
    }
    setPlan(response.data)
  }

  const clean = async () => {
    if (!plan || !api?.cleanAIStorage) return
    if (
      !(await confirm({
        description: t('aiChat.storage.confirm_cleanup', {
          count: plan.assetCount,
          bytes: formatBytes(plan.bytes),
        }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    setBusy(true)
    const response = await api.cleanAIStorage({ ...cleanupInput(), planHash: plan.planHash }) as ApiResponse<{ usage: StorageUsage }>
    setBusy(false)
    if (!response?.success) {
      setNotice(responseError(response, t('aiChat.storage.cleanup_failed')))
      await load()
      return
    }
    setUsage(response.data.usage)
    setPlan(null)
    setNotice(t('aiChat.storage.cleanup_complete'))
  }

  const savePolicy = async () => {
    if (!api?.saveSettings) return
    setBusy(true)
    setNotice(null)
    const nextSettings = {
      ...settings,
      aiMediaMaxBytes: capacityGb * GIB,
      aiMediaCleanupPolicy: autoCleanup ? 'auto_unreferenced' : 'manual',
    }
    try {
      await api.saveSettings(nextSettings)
      setSettings(nextSettings)
      setNotice(t('aiChat.storage.policy_saved'))
    } catch {
      setNotice(t('aiChat.storage.policy_save_failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!usage) {
    return (
      <div className="ai-chat-state" role="status">
        <RefreshCw className="ai-chat-state__spinner" size={22} aria-hidden="true" />
        <p>{t('aiChat.storage.loading')}</p>
      </div>
    )
  }

  const mediaTypes = [
    ['image', Image],
    ['video', Film],
    ['audio', Sparkles],
    ['file', ArchiveX],
  ] as const

  return (
    <div className="ai-storage-view">
      <header className="ai-storage-summary-header">
        <div>
          <h2>{t('aiChat.storage.overview')}</h2>
          <p>{t('aiChat.storage.hero_desc')}</p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={14} aria-hidden="true" />
          {t('aiChat.storage.refresh')}
        </button>
      </header>

      <section className="ai-storage-summary-grid" aria-label={t('aiChat.storage.overview')}>
        <article className="ai-storage-summary-card is-total">
          <HardDrive size={18} aria-hidden="true" />
          <span>{t('aiChat.storage.total_usage')}</span>
          <strong>{formatBytes(usage.totalBytes)}</strong>
          <small>{t('aiChat.storage.schema_version', { version: usage.schemaVersion })} · {formatBytes(usage.capacityLimitBytes)}</small>
        </article>
        <article className="ai-storage-summary-card">
          <Database size={18} aria-hidden="true" />
          <span>{t('aiChat.storage.database')}</span>
          <strong>{formatBytes(usage.databaseBytes)}</strong>
          <small>{t('aiChat.storage.database_detail', { conversations: usage.conversationCount, messages: usage.messageCount })}</small>
        </article>
        <article className="ai-storage-summary-card is-media">
          <Image size={18} aria-hidden="true" />
          <span>{t('aiChat.storage.media')}</span>
          <strong>{formatBytes(usage.mediaBytes)}</strong>
          <small>{t('aiChat.storage.media_detail', { count: usage.mediaCount })}</small>
          <div className="ai-storage-type-list" aria-label={t('aiChat.storage.type_detail')}>
            {mediaTypes.map(([type, Icon]) => (
              <span key={type}>
                <Icon size={12} aria-hidden="true" />
                {t(`aiChat.storage.type_${type}`)}
                <strong>{formatBytes(typeMap.get(type)?.bytes ?? 0)}</strong>
              </span>
            ))}
          </div>
        </article>
        <article className="ai-storage-summary-card">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{t('aiChat.storage.recovery')}</span>
          <strong>{usage.recoverableMediaCount}</strong>
          <small>{t('aiChat.storage.recovery_detail', { active: usage.activeMediaCount })} · {formatBytes(usage.orphanBytes + usage.temporaryBytes)}</small>
        </article>
      </section>

      <section className="ai-storage-locations" aria-labelledby="ai-storage-locations-title">
        <div className="ai-storage-settings-card__heading">
          <div>
            <h3 id="ai-storage-locations-title">{t('aiChat.storage.locations_title')}</h3>
            <p>{t('aiChat.storage.locations_desc')}</p>
          </div>
        </div>
        <div className="ai-storage-location-list">
          {(['database', 'media', 'credentials'] as const).map((kind) => (
            <article key={kind}>
              <div>
                <span>{t(`aiChat.storage.location_${kind}`)}</span>
                <code title={usage.locations[kind]}>{usage.locations[kind] || t('aiChat.storage.location_unavailable')}</code>
              </div>
              <button className="btn sm" disabled={!usage.locations[kind]} onClick={() => api?.revealInFinder?.(usage.locations[kind])}>
                <FolderOpen size={13} aria-hidden="true" />
                {t('aiChat.storage.reveal_location')}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="ai-storage-settings-grid">
        <article className="ai-storage-settings-card is-policy">
          <div className="ai-storage-settings-card__heading">
            <div>
              <h3>{t('aiChat.storage.capacity_policy')}</h3>
              <p>{t('aiChat.storage.auto_cleanup')}</p>
            </div>
          </div>
          <div className="ai-storage-policy-row">
            <select value={capacityGb} onChange={(event) => setCapacityGb(Number(event.target.value))} aria-label={t('aiChat.storage.capacity_label')}>
              {[1, 5, 10, 20].map((value) => <option key={value} value={value}>{value} GB</option>)}
            </select>
            <label>
              <input type="checkbox" checked={autoCleanup} onChange={(event) => setAutoCleanup(event.target.checked)} />
              {t('aiChat.storage.auto_cleanup')}
            </label>
            <button className="btn" onClick={() => void savePolicy()} disabled={busy}>{t('aiChat.storage.save_policy')}</button>
          </div>
        </article>

        <article className="ai-storage-settings-card is-cleanup">
          <div className="ai-storage-settings-card__heading">
            <div>
              <h3>{t('aiChat.storage.cleanup_title')}</h3>
              <p>{t('aiChat.storage.cleanup_desc')}</p>
            </div>
          </div>
          <div className="ai-storage-cleanup-controls">
            <div className="ai-storage-scope-grid">
              {(['unreferenced', 'capacity', 'media_type', 'all_media', 'all_ai'] as CleanupScope[]).map((item) => (
                <button key={item} className={scope === item ? 'is-active' : ''} onClick={() => { setScope(item); setPlan(null) }}>
                  {t(`aiChat.storage.scope_${item}`)}
                </button>
              ))}
            </div>
            {scope === 'media_type' && (
              <select value={mediaType} onChange={(event) => setMediaType(event.target.value as typeof mediaType)} aria-label={t('aiChat.storage.media_type_label')}>
                {mediaTypes.map(([type]) => <option key={type} value={type}>{t(`aiChat.storage.type_${type}`)}</option>)}
              </select>
            )}
            <button className="btn primary" onClick={() => void preview()} disabled={busy}>{t('aiChat.storage.preview_cleanup')}</button>
          </div>

          <div className="ai-storage-impact" aria-live="polite">
            {!plan ? (
              <div className="ai-storage-impact-empty">
                <ShieldCheck size={18} aria-hidden="true" />
                <p>{t('aiChat.storage.preview_empty')}</p>
              </div>
            ) : (
              <>
                <div className="ai-storage-impact-grid">
                  <span><strong>{plan.assetCount}</strong>{t('aiChat.storage.impact_assets')}</span>
                  <span><strong>{formatBytes(plan.bytes)}</strong>{t('aiChat.storage.impact_bytes')}</span>
                  <span><strong>{plan.conversationCount}</strong>{t('aiChat.storage.impact_conversations')}</span>
                </div>
                <p>{t('aiChat.storage.remaining_after', { bytes: formatBytes(plan.estimatedRemainingMediaBytes) })}</p>
                {plan.blockedReason && <p className="ai-storage-warning">{t('aiChat.storage.active_block')}</p>}
                <button className="btn danger" onClick={() => void clean()} disabled={busy || Boolean(plan.blockedReason)}>
                  <Trash2 size={14} />
                  {t('aiChat.storage.confirm_action')}
                </button>
              </>
            )}
          </div>
        </article>
      </section>

      {notice && <div className="ai-storage-notice" role="status">{notice}</div>}
    </div>
  )
}

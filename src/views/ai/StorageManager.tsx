import { useEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  ArchiveX,
  ChevronLeft,
  ChevronRight,
  Database,
  Film,
  HardDrive,
  Image,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

gsap.registerPlugin(useGSAP, ScrollTrigger)

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
  const api = (window as any).electronAPI
  const rootRef = useRef<HTMLDivElement>(null)
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [scope, setScope] = useState<CleanupScope>('unreferenced')
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio' | 'file'>('image')
  const [capacityGb, setCapacityGb] = useState(5)
  const [autoCleanup, setAutoCleanup] = useState(false)
  const [plan, setPlan] = useState<CleanupPlan | null>(null)
  const [impactIndex, setImpactIndex] = useState(0)
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

  useGSAP(() => {
    const root = rootRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const cards = root.querySelectorAll('.ai-storage-bento__card')
    gsap.fromTo(cards, { y: 28, scale: 0.96, opacity: 0.45 }, {
      y: 0,
      scale: 1,
      opacity: 1,
      stagger: 0.08,
      ease: 'none',
      scrollTrigger: {
        trigger: '.ai-storage-bento',
        scroller: root,
        start: 'top 86%',
        end: 'bottom 58%',
        scrub: 0.7,
      },
    })
    const aside = root.querySelector('.ai-storage-desire__aside')
    const desire = root.querySelector('.ai-storage-desire')
    if (aside && desire && root.scrollHeight > root.clientHeight + 120) {
      ScrollTrigger.create({
        trigger: desire,
        scroller: root,
        start: 'top top+=18',
        end: 'bottom bottom-=18',
        pin: aside,
        pinSpacing: false,
      })
    }
  }, { scope: rootRef, dependencies: [usage] })

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
    setImpactIndex(0)
  }

  const clean = async () => {
    if (!plan || !api?.cleanAIStorage) return
    if (!window.confirm(t('aiChat.storage.confirm_cleanup', {
      count: plan.assetCount,
      bytes: formatBytes(plan.bytes),
    }))) return
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

  const impacts = plan ? [
    { value: String(plan.assetCount), label: t('aiChat.storage.impact_assets') },
    { value: formatBytes(plan.bytes), label: t('aiChat.storage.impact_bytes') },
    { value: String(plan.conversationCount), label: t('aiChat.storage.impact_conversations') },
  ] : []
  const marqueeItems = [
    ['image', Image],
    ['video', Film],
    ['audio', Sparkles],
    ['file', ArchiveX],
  ] as const

  return (
    <div ref={rootRef} className="ai-storage-view">
      <section className="ai-storage-hero">
        <div>
          <h2>
            {t('aiChat.storage.hero_title_before')}
            <span
              className="ai-storage-hero__inline-media"
              style={usage.latestImageAssetId
                ? { backgroundImage: `url(life-ai-asset://asset/${usage.latestImageAssetId})` }
                : undefined}
              aria-hidden="true"
            />
            {t('aiChat.storage.hero_title_after')}
          </h2>
          <p>{t('aiChat.storage.hero_desc')}</p>
        </div>
        <div className="ai-storage-hero__total">
          <span>{t('aiChat.storage.total_usage')}</span>
          <strong>{formatBytes(usage.totalBytes)}</strong>
          <small>{t('aiChat.storage.schema_version', { version: usage.schemaVersion })}</small>
        </div>
      </section>

      <section className="ai-storage-bento" aria-label={t('aiChat.storage.overview')}>
        <article className="ai-storage-bento__card is-database">
          <Database size={18} aria-hidden="true" />
          <span>{t('aiChat.storage.database')}</span>
          <strong>{formatBytes(usage.databaseBytes)}</strong>
          <small>{t('aiChat.storage.database_detail', { conversations: usage.conversationCount, messages: usage.messageCount })}</small>
        </article>
        <article className="ai-storage-bento__card is-media">
          <HardDrive size={18} aria-hidden="true" />
          <span>{t('aiChat.storage.media')}</span>
          <strong>{formatBytes(usage.mediaBytes)}</strong>
          <small>{t('aiChat.storage.media_detail', { count: usage.mediaCount })}</small>
        </article>
        <article className="ai-storage-bento__card is-recovery">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{t('aiChat.storage.recovery')}</span>
          <strong>{usage.recoverableMediaCount}</strong>
          <small>{t('aiChat.storage.recovery_detail', { active: usage.activeMediaCount })}</small>
        </article>
        <article className="ai-storage-bento__card is-types">
          <div className="ai-storage-marquee">
            <div>
              {[...marqueeItems, ...marqueeItems].map(([type, Icon], index) => (
                <span key={`${type}-${index}`}>
                  <Icon size={14} aria-hidden="true" />
                  {t(`aiChat.storage.type_${type}`)}
                  <strong>{formatBytes(typeMap.get(type)?.bytes ?? 0)}</strong>
                </span>
              ))}
            </div>
          </div>
          <small>{t('aiChat.storage.type_detail')}</small>
        </article>
        <article className="ai-storage-bento__card is-policy">
          <span>{t('aiChat.storage.capacity_policy')}</span>
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
      </section>

      <section className="ai-storage-desire">
        <aside className="ai-storage-desire__aside">
          <h3>{t('aiChat.storage.cleanup_title')}</h3>
          <p>{t('aiChat.storage.cleanup_desc')}</p>
          <button className="ai-chat-icon-button" onClick={() => void load()} disabled={busy} aria-label={t('aiChat.storage.refresh')}>
            <RefreshCw size={15} />
          </button>
        </aside>
        <div className="ai-storage-cleanup-stack">
          <article className="ai-storage-cleanup-card">
            <div className="ai-storage-scope-grid">
              {(['unreferenced', 'capacity', 'media_type', 'all_media', 'all_ai'] as CleanupScope[]).map((item) => (
                <button key={item} className={scope === item ? 'is-active' : ''} onClick={() => { setScope(item); setPlan(null) }}>
                  {t(`aiChat.storage.scope_${item}`)}
                </button>
              ))}
            </div>
            {scope === 'media_type' && (
              <select value={mediaType} onChange={(event) => setMediaType(event.target.value as typeof mediaType)} aria-label={t('aiChat.storage.media_type_label')}>
                {marqueeItems.map(([type]) => <option key={type} value={type}>{t(`aiChat.storage.type_${type}`)}</option>)}
              </select>
            )}
            <button className="btn primary" onClick={() => void preview()} disabled={busy}>{t('aiChat.storage.preview_cleanup')}</button>
          </article>

          <article className="ai-storage-cleanup-card is-impact" aria-live="polite">
            {!plan ? (
              <div className="ai-storage-impact-empty">
                <ShieldCheck size={22} aria-hidden="true" />
                <p>{t('aiChat.storage.preview_empty')}</p>
              </div>
            ) : (
              <>
                <div className="ai-storage-impact-carousel">
                  <button onClick={() => setImpactIndex((current) => (current + impacts.length - 1) % impacts.length)} aria-label={t('aiChat.storage.previous_impact')}>
                    <ChevronLeft size={15} />
                  </button>
                  <div>
                    <strong>{impacts[impactIndex].value}</strong>
                    <span>{impacts[impactIndex].label}</span>
                  </div>
                  <button onClick={() => setImpactIndex((current) => (current + 1) % impacts.length)} aria-label={t('aiChat.storage.next_impact')}>
                    <ChevronRight size={15} />
                  </button>
                </div>
                <p>{t('aiChat.storage.remaining_after', { bytes: formatBytes(plan.estimatedRemainingMediaBytes) })}</p>
                {plan.blockedReason && <p className="ai-storage-warning">{t('aiChat.storage.active_block')}</p>}
                <button className="btn danger" onClick={() => void clean()} disabled={busy || Boolean(plan.blockedReason)}>
                  <Trash2 size={14} />
                  {t('aiChat.storage.confirm_action')}
                </button>
              </>
            )}
          </article>
        </div>
      </section>

      {notice && <div className="ai-storage-notice" role="status">{notice}</div>}
    </div>
  )
}

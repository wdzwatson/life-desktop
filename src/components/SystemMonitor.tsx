import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Cpu, MemoryStick, Network, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  SystemMonitorDetails,
  SystemMonitorMetric,
  SystemMonitorNetworkRow,
  SystemMonitorProcessRow,
  SystemMonitorSnapshot,
} from '../types/systemMonitor'
import './SystemMonitor.css'

type MonitorApi = {
  getSystemMonitorSnapshot?: () => Promise<SystemMonitorSnapshot>
  subscribeSystemMonitor?: (callback: (snapshot: SystemMonitorSnapshot) => void) => () => void
  subscribeSystemMonitorDetails?: (
    metric: SystemMonitorMetric,
    callback: (details: SystemMonitorDetails) => void,
  ) => () => void
}

const getApi = () => (window as any).electronAPI as MonitorApi | undefined

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const formatRate = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.round(bytes || 0)} B/s`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB/s`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`
}

const metricIcons: Record<SystemMonitorMetric, typeof Cpu> = {
  cpu: Cpu,
  memory: MemoryStick,
  network: Network,
}

const defaultSnapshot: SystemMonitorSnapshot = {
  timestamp: 0,
  status: 'unavailable',
  cpu: { percent: 0 },
  memory: { usedBytes: 0, totalBytes: 0, percent: 0 },
  network: { online: false, downloadBps: 0, uploadBps: 0, interfaces: [] },
}

const isProcessRows = (rows: SystemMonitorDetails['rows']): rows is SystemMonitorProcessRow[] =>
  rows.length === 0 || 'cpuPercent' in rows[0]

const MetricValue = ({ metric, snapshot }: { metric: SystemMonitorMetric; snapshot: SystemMonitorSnapshot }) => {
  if (metric === 'cpu') return <strong>{snapshot.cpu.percent.toFixed(0)}%</strong>
  if (metric === 'memory') return <strong>{snapshot.memory.percent.toFixed(0)}%</strong>
  return (
    <strong className="system-monitor__network-value">
      <span>↓{formatRate(snapshot.network.downloadBps)}</span>
      <span>↑{formatRate(snapshot.network.uploadBps)}</span>
    </strong>
  )
}

export function SystemMonitor({ placement = 'statusbar' }: { placement?: 'statusbar' | 'note' }) {
  const { t } = useTranslation()
  const api = getApi()
  const [snapshot, setSnapshot] = useState<SystemMonitorSnapshot>(defaultSnapshot)
  const [activeMetric, setActiveMetric] = useState<SystemMonitorMetric | null>(null)
  const [details, setDetails] = useState<SystemMonitorDetails | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!api) return
    let mounted = true
    let unsubscribe: (() => void) | undefined
    const synchronizeSubscription = () => {
      unsubscribe?.()
      unsubscribe = undefined
      if (document.visibilityState === 'hidden') return
      unsubscribe = api.subscribeSystemMonitor?.((nextSnapshot) => {
        if (mounted) setSnapshot(nextSnapshot)
      })
      void api.getSystemMonitorSnapshot?.().then((nextSnapshot) => {
        if (mounted && nextSnapshot) setSnapshot(nextSnapshot)
      })
    }
    synchronizeSubscription()
    document.addEventListener('visibilitychange', synchronizeSubscription)
    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', synchronizeSubscription)
      unsubscribe?.()
    }
  }, [api])

  useEffect(() => {
    if (!activeMetric || !api) {
      setDetails(null)
      return
    }
    let mounted = true
    setDetails(null)
    const unsubscribe = api.subscribeSystemMonitorDetails?.(activeMetric, (nextDetails) => {
      if (mounted) setDetails(nextDetails)
    })
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [activeMetric, api])

  useEffect(() => {
    if (!activeMetric) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setActiveMetric(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveMetric(null)
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [activeMetric])

  const metrics = useMemo(() => ['cpu', 'memory', 'network'] as SystemMonitorMetric[], [])
  const rows = details?.rows || []
  const metricLabels: Record<SystemMonitorMetric, string> = {
    cpu: 'CPU',
    memory: t('system_monitor.memory'),
    network: t('system_monitor.network'),
  }

  return (
    <div ref={rootRef} className={`system-monitor system-monitor--${placement}`}>
      <div className="system-monitor__metrics" aria-label={t('system_monitor.aria_label')}>
        {metrics.map((metric) => {
          const Icon = metricIcons[metric]
          const isActive = activeMetric === metric
          return (
            <button
              type="button"
              key={metric}
              className={`system-monitor__metric ${isActive ? 'is-active' : ''}`}
              aria-expanded={isActive}
              aria-haspopup="dialog"
              aria-label={t('system_monitor.open_details', { metric: metricLabels[metric] })}
              onClick={() => setActiveMetric((current) => (current === metric ? null : metric))}
            >
              <Icon size={13} aria-hidden="true" />
              <span className="system-monitor__metric-label">{metricLabels[metric]}</span>
              <MetricValue metric={metric} snapshot={snapshot} />
            </button>
          )
        })}
      </div>

      {activeMetric && (
        <section className="system-monitor__popover" role="dialog" aria-label={t('system_monitor.open_details', { metric: metricLabels[activeMetric] })}>
          <header className="system-monitor__popover-header">
            <div>
              <span className="system-monitor__popover-kicker">{t('system_monitor.live_resources')}</span>
              <h3>{t('system_monitor.top_eight', { metric: metricLabels[activeMetric] })}</h3>
            </div>
            <button type="button" className="system-monitor__close" onClick={() => setActiveMetric(null)} aria-label={t('system_monitor.close')} title={t('system_monitor.close')}>
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          {details?.note && (
            <p className="system-monitor__note">
              {activeMetric === 'network' ? t('system_monitor.network_note') : details.note}
            </p>
          )}
          {!details ? (
            <p className="system-monitor__loading">{t('system_monitor.loading')}</p>
          ) : !details.supported ? (
            <p className="system-monitor__loading">{t('system_monitor.unavailable')}</p>
          ) : rows.length === 0 ? (
            <p className="system-monitor__loading">{t('system_monitor.empty')}</p>
          ) : isProcessRows(rows) ? (
            <ol className="system-monitor__rows">
              {rows.map((row) => (
                <li key={row.key} className="system-monitor__row">
                  <span className="system-monitor__rank">{rows.indexOf(row) + 1}</span>
                  <span className="system-monitor__row-copy">
                    <strong title={row.name}>{row.name}</strong>
                    <small>{t('system_monitor.process_count', { count: row.pidCount })}</small>
                  </span>
                  <span className="system-monitor__row-value">
                    {activeMetric === 'cpu' ? `${row.cpuPercent.toFixed(1)}%` : `${formatBytes(row.memoryBytes)} · ${row.memoryPercent.toFixed(1)}%`}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="system-monitor__rows">
              {(rows as SystemMonitorNetworkRow[]).map((row, index) => (
                <li key={row.key} className="system-monitor__row">
                  <span className="system-monitor__rank">{index + 1}</span>
                  <span className="system-monitor__row-copy">
                    <strong title={row.name}>{row.name}</strong>
                    <small>{row.online ? t('system_monitor.online') : t('system_monitor.offline')}</small>
                  </span>
                  <span className="system-monitor__row-value system-monitor__network-row-value">
                    <span><ArrowDown size={11} aria-hidden="true" />{formatRate(row.downloadBps)}</span>
                    <span><ArrowUp size={11} aria-hidden="true" />{formatRate(row.uploadBps)}</span>
                    <small>{row.percent.toFixed(1)}%</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  )
}

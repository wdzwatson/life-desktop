import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, HardDrive, PauseCircle, ScanLine, ShieldCheck, Trash2, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '../components/Checkbox'
import { useConfirmation } from '../components/ConfirmationProvider'
import './SystemCleaner.css'

type Category = {
  id: string
  risk: 'safe' | 'optional'
  title: string
  description: string
  requiresClosedApp?: string
  fileCount: number
  bytes: number
  incomplete: boolean
  unavailableReason?: string
}
type Scan = {
  taskId: string
  state: 'scanning' | 'completed' | 'cancelled' | 'failed'
  disks: Array<{ path: string; totalBytes: number; freeBytes: number }>
  categories: Category[]
  error?: string
}
type Progress = {
  phase: 'scanning' | 'previewing' | 'cleaning' | 'completed' | 'cancelled' | 'failed'
  categoryId?: string
  currentLabel: string
  processedFiles: number
  totalFiles?: number
  processedBytes: number
  skippedFiles: number
  failedFiles: number
  elapsedMs: number
}
type Plan = { planHash: string; fileCount: number; bytes: number; blockedCategories: string[]; expiresAt: number }
type ApiResponse<T> = { success: boolean; data?: T; error?: string }

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function SystemCleaner() {
  const { t } = useTranslation()
  const { confirm } = useConfirmation()
  const api = (window as any).electronAPI
  const rootRef = useRef<HTMLElement | null>(null)
  const [scan, setScan] = useState<Scan | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [plan, setPlan] = useState<Plan | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedCategories = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected])
  const diskUsed = scan?.disks.reduce((sum, disk) => sum + Math.max(0, disk.totalBytes - disk.freeBytes), 0) ?? 0
  const diskTotal = scan?.disks.reduce((sum, disk) => sum + disk.totalBytes, 0) ?? 0

  const refresh = async (id: string) => {
    const response = await api?.getSystemCleanerScan?.(id) as ApiResponse<Scan>
    if (!response?.success || !response.data) return
    setScan(response.data)
    if (response.data.state === 'completed') {
      setSelected((current) => Object.keys(current).length ? current : Object.fromEntries(
        response.data!.categories.filter((category) => category.risk === 'safe' && category.fileCount > 0 && !category.incomplete)
          .map((category) => [category.id, true]),
      ))
    }
  }

  useEffect(() => {
    if (!api?.onSystemCleanerProgress) return
    return api.onSystemCleanerProgress((event: Progress) => setProgress(event))
  }, [api])

  useEffect(() => {
    const body = rootRef.current?.closest('.toolbox-view__body')
    if (body instanceof HTMLElement) body.scrollTop = 0
  }, [])

  useEffect(() => {
    if (!taskId) return
    void refresh(taskId)
    const timer = window.setInterval(() => void refresh(taskId), 700)
    return () => window.clearInterval(timer)
  }, [taskId])

  const startScan = async () => {
    setBusy(true); setNotice(null); setPlan(null); setScan(null); setSelected({}); setProgress(null)
    const response = await api?.startSystemCleanerScan?.() as ApiResponse<{ taskId: string }>
    setBusy(false)
    if (!response?.success || !response.data) { setNotice(response?.error ?? t('toolbox.cleaner.scan_failed')); return }
    setTaskId(response.data.taskId)
  }

  const cancelScan = async () => {
    if (!taskId) return
    await api?.cancelSystemCleanerScan?.(taskId)
    setNotice(t('toolbox.cleaner.scan_cancelled'))
  }

  const preview = async () => {
    if (!taskId || !selectedCategories.length) return
    setBusy(true); setNotice(null)
    const response = await api?.previewSystemCleaner?.({ taskId, categoryIds: selectedCategories }) as ApiResponse<Plan>
    setBusy(false)
    if (!response?.success || !response.data) { setNotice(response?.error ?? t('toolbox.cleaner.preview_failed')); return }
    setPlan(response.data)
    if (response.data.blockedCategories.length) setNotice(t('toolbox.cleaner.close_apps_required'))
  }

  const execute = async () => {
    if (!plan || !api?.executeSystemCleaner) return
    if (!(await confirm({ title: t('toolbox.cleaner.confirm_title'), description: t('toolbox.cleaner.confirm_body', { files: plan.fileCount, bytes: formatBytes(plan.bytes) }), confirmLabel: t('toolbox.cleaner.execute'), tone: 'danger' }))) return
    setBusy(true); setNotice(null)
    const response = await api.executeSystemCleaner(plan.planHash) as ApiResponse<{ deletedFiles: number; deletedBytes: number; skippedFiles: number; failedFiles: number }>
    setBusy(false)
    if (!response?.success || !response.data) { setNotice(response?.error ?? t('toolbox.cleaner.cleanup_failed')); return }
    setPlan(null)
    setNotice(t('toolbox.cleaner.cleanup_complete', { files: response.data.deletedFiles, bytes: formatBytes(response.data.deletedBytes), skipped: response.data.skippedFiles, failed: response.data.failedFiles }))
    if (taskId) await refresh(taskId)
  }

  const active = scan?.state === 'scanning' || progress?.phase === 'cleaning'
  return (
    <section ref={rootRef} className="system-cleaner" aria-busy={busy || active}>
      <div className="system-cleaner__toolbar">
        <div>
          <h2>{t('toolbox.cleaner.title')}</h2>
          <p>{t('toolbox.cleaner.subtitle')}</p>
        </div>
        <div className="system-cleaner__actions">
          {scan?.state === 'scanning' ? <button className="btn" onClick={() => void cancelScan()}><PauseCircle size={16} />{t('toolbox.cleaner.cancel_scan')}</button> : <button className="btn primary" onClick={() => void startScan()} disabled={busy || progress?.phase === 'cleaning'}><ScanLine size={16} />{t('toolbox.cleaner.start_scan')}</button>}
        </div>
      </div>

      <div className="system-cleaner__notice"><ShieldCheck size={16} />{t('toolbox.cleaner.boundary')}</div>

      {(scan || progress) && <div className="system-cleaner__progress" aria-live="polite">
        <div><strong>{progress?.phase === 'cleaning' ? t('toolbox.cleaner.cleaning') : scan?.state === 'scanning' ? t('toolbox.cleaner.scanning') : t('toolbox.cleaner.status')}</strong><span>{progress?.currentLabel ?? t('toolbox.cleaner.waiting')}</span></div>
        <div className="system-cleaner__progress-track"><span style={{ width: progress?.totalFiles ? `${Math.min(100, progress.processedFiles / progress.totalFiles * 100)}%` : active ? '35%' : '100%' }} /></div>
        <small>{t('toolbox.cleaner.progress_detail', { files: progress?.processedFiles ?? 0, bytes: formatBytes(progress?.processedBytes ?? 0), skipped: progress?.skippedFiles ?? 0, failed: progress?.failedFiles ?? 0 })}</small>
      </div>}

      {scan && <>
        <div className="system-cleaner__summary">
          <article><HardDrive size={18} /><span>{t('toolbox.cleaner.scanned_volumes')}</span><strong>{scan.disks.length}</strong></article>
          <article><span>{t('toolbox.cleaner.used_space')}</span><strong>{formatBytes(diskUsed)}</strong><small>{t('toolbox.cleaner.of_total', { total: formatBytes(diskTotal) })}</small></article>
          <article><span>{t('toolbox.cleaner.safe_total')}</span><strong>{formatBytes(scan.categories.filter((category) => category.risk === 'safe').reduce((sum, category) => sum + category.bytes, 0))}</strong></article>
        </div>
        <div className="system-cleaner__mounts">{scan.disks.map((disk) => <span key={disk.path}>{disk.path}: {formatBytes(disk.freeBytes)} {t('toolbox.cleaner.free_space')}</span>)}</div>
        <div className="system-cleaner__panel">
          <div className="system-cleaner__panel-heading"><div><h3>{t('toolbox.cleaner.review_title')}</h3><p>{t('toolbox.cleaner.review_desc')}</p></div>{scan.state === 'completed' && <button className="btn primary" onClick={() => void preview()} disabled={!selectedCategories.length || busy || active}>{t('toolbox.cleaner.preview')}</button>}</div>
          <div className="system-cleaner__categories">
            {scan.categories.map((category) => <label className={`system-cleaner__category risk-${category.risk}`} key={category.id}>
              <Checkbox checked={Boolean(selected[category.id])} disabled={scan.state !== 'completed' || category.incomplete || category.fileCount === 0 || busy || active} onChange={(event) => { setSelected((current) => ({ ...current, [category.id]: event.target.checked })); setPlan(null) }} />
              <span className="system-cleaner__category-main"><span><strong>{category.title}</strong><em>{category.risk === 'safe' ? t('toolbox.cleaner.safe') : t('toolbox.cleaner.optional')}</em></span><small>{category.description}</small>{category.unavailableReason && <small>{t('toolbox.cleaner.unavailable')}</small>}{category.requiresClosedApp && <small className="system-cleaner__warning"><AlertTriangle size={13} />{t('toolbox.cleaner.close_app', { app: category.requiresClosedApp })}</small>}</span>
              <span className="system-cleaner__category-size"><strong>{formatBytes(category.bytes)}</strong><small>{t('toolbox.cleaner.file_count', { count: category.fileCount })}</small>{category.incomplete && <small className="system-cleaner__warning">{t('toolbox.cleaner.incomplete')}</small>}</span>
            </label>)}
          </div>
        </div>
      </>}

      {plan && <div className="system-cleaner__plan"><div><h3>{t('toolbox.cleaner.plan_title')}</h3><p>{t('toolbox.cleaner.plan_desc', { files: plan.fileCount, bytes: formatBytes(plan.bytes) })}</p>{plan.blockedCategories.length > 0 && <p className="system-cleaner__warning"><AlertTriangle size={14} />{t('toolbox.cleaner.close_apps_required')}</p>}</div><button className="btn danger" disabled={busy || active || plan.blockedCategories.length > 0} onClick={() => void execute()}><Trash2 size={16} />{t('toolbox.cleaner.execute')}</button></div>}

      <div className="system-cleaner__diagnostics"><div><Wrench size={17} /><div><h3>{t('toolbox.cleaner.external_title')}</h3><p>{t('toolbox.cleaner.external_desc')}</p></div></div><ul><li>WSL: {t('toolbox.cleaner.wsl_hint')}</li><li>Docker: {t('toolbox.cleaner.docker_hint')}</li><li>Android: {t('toolbox.cleaner.android_hint')}</li></ul></div>
      {notice && <p className="system-cleaner__result" role="status">{notice}</p>}
    </section>
  )
}

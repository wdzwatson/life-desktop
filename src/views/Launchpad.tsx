import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CheckSquare, FileText, LayoutDashboard, Play, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import heroPoster from '../assets/hero.png'
import { AccessibleDialog } from '../components/AccessibleDialog'
import { useAppStore } from '../store/useAppStore'
import { getLaunchpadRecommendation, type LaunchpadTaskSummary } from './launchpadUtils'
import './Launchpad.css'

type LaunchpadData = {
  tasks: LaunchpadTaskSummary
  contentCount: number
}

function getTodayYmd() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function loadDecodedImage(url: string) {
  return new Promise<boolean>((resolve) => {
    const image = new Image()
    image.onload = async () => {
      try {
        await image.decode?.()
      } catch {
        // A successful onload is still safe to paint in older Chromium paths.
      }
      resolve(true)
    }
    image.onerror = () => resolve(false)
    image.src = url
  })
}

export function Launchpad() {
  const { t, i18n } = useTranslation()
  const setActiveScreen = useAppStore((state) => state.setActiveScreen)
  const setTaskTab = useAppStore((state) => state.setTaskTab)
  const userNickname = useAppStore((state) => state.userNickname)
  const launchpadSettings = useAppStore((state) => state.launchpadSettings)
  const showToast = useAppStore((state) => state.showToast)
  const captureButtonRef = useRef<HTMLButtonElement | null>(null)
  const [data, setData] = useState<LaunchpadData>({ tasks: { overdue: 0, today: 0 }, contentCount: 0 })
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [customPosterReady, setCustomPosterReady] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureText, setCaptureText] = useState('')
  const [captureBusy, setCaptureBusy] = useState(false)
  const api = (window as any).electronAPI

  const customPosterUrl = launchpadSettings.posterVersion
    ? `life-landing-poster://poster/current?v=${encodeURIComponent(launchpadSettings.posterVersion)}`
    : undefined

  useEffect(() => {
    let cancelled = false
    setCustomPosterReady(false)
    if (!customPosterUrl) return
    void loadDecodedImage(customPosterUrl).then((loaded) => {
      if (!cancelled && loaded) setCustomPosterReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [customPosterUrl])

  useEffect(() => {
    let cancelled = false
    if (!api) {
      setIsLoadingData(false)
      return
    }
    const today = getTodayYmd()
    Promise.all([
      api.dbQuery(
        'tasks',
        "SELECT COUNT(*) AS count FROM tasks WHERE is_completed = 0 AND due_date <> '' AND due_date < ?",
        [today],
      ),
      api.dbQuery(
        'tasks',
        'SELECT COUNT(*) AS count FROM tasks WHERE is_completed = 0 AND due_date = ?',
        [today],
      ),
      api.dbQuery('notes', 'SELECT COUNT(*) AS count FROM notes'),
      api.dbQuery('books', 'SELECT COUNT(*) AS count FROM books'),
      api.dbQuery('videos', 'SELECT COUNT(*) AS count FROM videos'),
    ])
      .then(([overdue, todayTasks, notes, books, videos]: any[]) => {
        if (cancelled) return
        setData({
          tasks: {
            overdue: overdue?.success ? Number(overdue.data[0]?.count || 0) : 0,
            today: todayTasks?.success ? Number(todayTasks.data[0]?.count || 0) : 0,
          },
          contentCount:
            Number(notes?.data?.[0]?.count || 0) +
            Number(books?.data?.[0]?.count || 0) +
            Number(videos?.data?.[0]?.count || 0),
        })
      })
      .finally(() => {
        if (!cancelled) setIsLoadingData(false)
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const recommendation = useMemo(
    () =>
      getLaunchpadRecommendation({
        tasks: data.tasks,
        hasWorkspaceContent: data.contentCount > 0,
        context: launchpadSettings.lastContext,
      }),
    [data, launchpadSettings.lastContext],
  )

  const formattedDate = new Intl.DateTimeFormat(i18n.language, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())

  const navigateToTasks = () => {
    setActiveScreen('tasks')
    setTaskTab('list')
  }

  const handleRecommendation = () => {
    if (recommendation.kind === 'continue' && launchpadSettings.lastContext) {
      setActiveScreen(launchpadSettings.lastContext.screen)
      return
    }
    navigateToTasks()
  }

  const handleNewTask = () => {
    navigateToTasks()
    window.setTimeout(() => window.dispatchEvent(new Event('task:create')), 0)
  }

  const handleCapture = async (kind: 'note' | 'task') => {
    const title = captureText.trim()
    if (!title || !api || captureBusy) return
    setCaptureBusy(true)
    try {
      if (kind === 'note') {
        const result = await api.dbQuery(
          'notes',
          "INSERT INTO notes (title, content, note_type) VALUES (?, '# ' || ?, 'markdown')",
          [title, title],
        )
        if (!result?.success) throw new Error(result?.error || 'Unable to create note')
        setActiveScreen('notes')
      } else {
        const today = getTodayYmd()
        const result = await api.dbQuery(
          'tasks',
          `INSERT INTO tasks (title, description, priority, status, start_date, due_date, due_time, is_completed, progress)
           VALUES (?, '', 'mid', '待处理', ?, ?, '23:59:59', 0, 0)`,
          [title, today, today],
        )
        if (!result?.success) throw new Error(result?.error || 'Unable to create task')
        navigateToTasks()
      }
      setCaptureText('')
      setCaptureOpen(false)
      showToast(t(kind === 'note' ? 'launchpad.note_saved' : 'launchpad.task_saved'))
    } catch {
      showToast(t('launchpad.capture_failed'))
    } finally {
      setCaptureBusy(false)
    }
  }

  const recommendationCopy = {
    overdue: {
      eyebrow: t('launchpad.recommendation_overdue_eyebrow'),
      title: t('launchpad.recommendation_overdue_title', { count: data.tasks.overdue }),
      action: t('launchpad.recommendation_overdue_action'),
    },
    today: {
      eyebrow: t('launchpad.recommendation_today_eyebrow'),
      title: t('launchpad.recommendation_today_title', { count: data.tasks.today }),
      action: t('launchpad.recommendation_today_action'),
    },
    continue: {
      eyebrow: t('launchpad.recommendation_continue_eyebrow'),
      title: launchpadSettings.lastContext?.label || t('launchpad.recommendation_continue_title'),
      action: t('launchpad.recommendation_continue_action'),
    },
    empty: {
      eyebrow: t('launchpad.recommendation_empty_eyebrow'),
      title: t('launchpad.recommendation_empty_title'),
      action: t('launchpad.recommendation_empty_action'),
    },
    default: {
      eyebrow: t('launchpad.recommendation_default_eyebrow'),
      title: t('launchpad.recommendation_default_title'),
      action: t('launchpad.recommendation_default_action'),
    },
  }[recommendation.kind]

  return (
    <section className="launchpad" aria-labelledby="launchpad-title">
      <section className="launchpad__poster" aria-hidden="true">
        <img className="launchpad__poster-fallback" src={heroPoster} alt="" />
        {customPosterUrl && customPosterReady && (
          <img className="launchpad__poster-custom" src={customPosterUrl} alt="" />
        )}
        <div className="launchpad__poster-shade" />
        <span className="launchpad__poster-mark">LifeOS</span>
      </section>

      <section className="launchpad__actions">
        <p className="launchpad__date">{formattedDate}</p>
        <h1 id="launchpad-title">{t('launchpad.greeting', { name: userNickname })}</h1>
        <p className="launchpad__intro">{t('launchpad.intro')}</p>

        <div className="launchpad__recommendation" aria-busy={isLoadingData}>
          <span className="launchpad__eyebrow">{recommendationCopy.eyebrow}</span>
          <strong>{recommendationCopy.title}</strong>
          <button className="launchpad__recommendation-action" type="button" onClick={handleRecommendation}>
            {recommendationCopy.action} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="launchpad__primary-actions">
          <button className="btn primary launchpad__button" type="button" onClick={handleRecommendation}>
            <Play size={16} aria-hidden="true" />
            {recommendationCopy.action}
          </button>
          <button
            ref={captureButtonRef}
            className="btn launchpad__button"
            type="button"
            onClick={() => setCaptureOpen(true)}
          >
            <FileText size={16} aria-hidden="true" />
            {t('launchpad.quick_capture')}
          </button>
        </div>

        <div className="launchpad__secondary-actions" aria-label={t('launchpad.secondary_actions')}>
          <button type="button" onClick={handleNewTask}>
            <CheckSquare size={15} aria-hidden="true" />
            {t('launchpad.new_task')}
          </button>
          <button type="button" onClick={() => setActiveScreen('ai')}>
            <Sparkles size={15} aria-hidden="true" />
            {t('launchpad.open_ai')}
          </button>
          <button type="button" onClick={() => setActiveScreen('dashboard')}>
            <LayoutDashboard size={15} aria-hidden="true" />
            {t('launchpad.open_dashboard')}
          </button>
        </div>

        <div className="launchpad__status" aria-live="polite">
          <span>{t('launchpad.status_offline')}</span>
          <span>{t('launchpad.status_tasks', { count: data.tasks.today })}</span>
          <span>{t('launchpad.status_content', { count: data.contentCount })}</span>
        </div>
      </section>

      {captureOpen && (
        <AccessibleDialog
          title={t('launchpad.capture_title')}
          onClose={() => setCaptureOpen(false)}
          returnFocus={() => captureButtonRef.current?.focus()}
          closeOnOverlay
          contentClassName="launchpad-capture"
        >
          <p>{t('launchpad.capture_description')}</p>
          <textarea
            autoFocus
            value={captureText}
            onChange={(event) => setCaptureText(event.target.value)}
            placeholder={t('launchpad.capture_placeholder')}
            aria-label={t('launchpad.capture_placeholder')}
            rows={4}
          />
          <div className="launchpad-capture__actions">
            <button className="btn" type="button" onClick={() => setCaptureOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!captureText.trim() || captureBusy}
              onClick={() => void handleCapture('note')}
            >
              {t('launchpad.save_as_note')}
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!captureText.trim() || captureBusy}
              onClick={() => void handleCapture('task')}
            >
              {t('launchpad.save_as_task')}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </section>
  )
}

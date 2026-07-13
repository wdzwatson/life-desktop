import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle,
  Circle,
  Play,
  Clock,
  FileText,
  TrendingUp,
} from 'lucide-react'

export const Dashboard: React.FC = () => {
  const { t } = useTranslation()
  const setActiveScreen = useAppStore((state) => state.setActiveScreen)
  const setTaskTab = useAppStore((state) => state.setTaskTab)
  const showToast = useAppStore((state) => state.showToast)
  const userId = useAppStore((state) => state.userId)

  // DB States
  const [todayTasks, setTodayTasks] = useState<any[]>([])
  const [currentBook, setCurrentBook] = useState<any>(null)
  const [recentNote, setRecentNote] = useState<any>(null)
  const [recentVideo, setRecentVideo] = useState<any>(null)

  // Stats
  const [stats, setStats] = useState({
    tasks: 0,
    notes: 0,
    books: 0,
    videos: 0,
  })

  // Timer Mock/Integration State
  const [timerLeft, setTimerLeft] = useState('25:00')

  useEffect(() => {
    const api = (window as any).electronAPI
    if (api) {
      const todayYMD = new Date().toISOString().slice(0, 10)

      // 1. Fetch Today Tasks
      api
        .dbQuery('tasks', "SELECT * FROM tasks WHERE due_date = ? OR status = '已逾期' LIMIT 3", [
          todayYMD,
        ])
        .then((res: any) => {
          if (res?.success) setTodayTasks(res.data)
        })

      // 2. Fetch Reading Book
      api
        .dbQuery('books', "SELECT * FROM books WHERE status = 'reading' LIMIT 1")
        .then((res: any) => {
          if (res?.success && res.data.length > 0) {
            setCurrentBook(res.data[0])
          } else {
            // fallback to first book if none is active
            api.dbQuery('books', 'SELECT * FROM books LIMIT 1').then((subRes: any) => {
              if (subRes?.success && subRes.data.length > 0) {
                setCurrentBook(subRes.data[0])
              }
            })
          }
        })

      // 3. Fetch Recent Note
      api
        .dbQuery('notes', 'SELECT * FROM notes ORDER BY updated_at DESC LIMIT 1')
        .then((res: any) => {
          if (res?.success && res.data.length > 0) setRecentNote(res.data[0])
        })

      // 4. Fetch Recent Video
      api
        .dbQuery(
          'videos',
          "SELECT * FROM videos WHERE status = 'Downloaded' ORDER BY id DESC LIMIT 1",
        )
        .then((res: any) => {
          if (res?.success && res.data.length > 0) setRecentVideo(res.data[0])
        })

      // 5. Fetch Aggregate Stats
      Promise.all([
        api.dbQuery('tasks', 'SELECT COUNT(*) as count FROM tasks'),
        api.dbQuery('notes', 'SELECT COUNT(*) as count FROM notes'),
        api.dbQuery('books', 'SELECT COUNT(*) as count FROM books'),
        api.dbQuery('videos', 'SELECT COUNT(*) as count FROM videos'),
      ]).then(([tRes, nRes, bRes, vRes]: any[]) => {
        setStats({
          tasks: tRes?.success ? tRes.data[0].count : 0,
          notes: nRes?.success ? nRes.data[0].count : 0,
          books: bRes?.success ? bRes.data[0].count : 0,
          videos: vRes?.success ? vRes.data[0].count : 0,
        })
      })

      // 6. Fetch Pomo time from background ipc if running (optional mock loop)
      const interval = setInterval(() => {
        if ((window as any).pomoSecondsLeft !== undefined) {
          const totalSecs = (window as any).pomoSecondsLeft
          const m = Math.floor(totalSecs / 60)
            .toString()
            .padStart(2, '0')
          const s = (totalSecs % 60).toString().padStart(2, '0')
          setTimerLeft(`${m}:${s}`)
        }
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [userId])

  const toggleTask = async (id: number, currentDone: boolean) => {
    const api = (window as any).electronAPI
    if (api) {
      const nextDone = currentDone ? 0 : 1
      const nextStatus = nextDone ? '已关闭' : '待处理'
      const query = 'UPDATE tasks SET is_completed = ?, status = ?, progress = ? WHERE id = ?'
      await api.dbQuery('tasks', query, [nextDone, nextStatus, nextDone ? 100 : 0, id])
      showToast(nextDone ? t('dashboard.toast_task_completed') : t('dashboard.toast_task_reopened'))

      // Refresh list
      const todayYMD = new Date().toISOString().slice(0, 10)
      const res = await api.dbQuery(
        'tasks',
        'SELECT * FROM tasks WHERE due_date = ? OR status = ? LIMIT 3',
        [todayYMD, '已逾期'],
      )
      if (res?.success) setTodayTasks(res.data)
    }
  }

  const navigateTo = (screen: string, tab?: string) => {
    setActiveScreen(screen)
    if (tab) setTaskTab(tab)
  }

  return (
    <div style={{ animation: 'enter 0.15s ease both' }}>
      {/* Page header banner */}
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            marginBottom: '4px',
          }}
        >
          {t('dashboard.greeting')}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('dashboard.intro')}</p>
      </div>

      <div className="grid-layout grid-3">
        {/* Card: Today's Tasks */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">
            <span>{t('dashboard.today_tasks')}</span>
            <button
              className="pill blue"
              onClick={() => navigateTo('tasks', 'list')}
              style={{ cursor: 'pointer', border: 'none' }}
            >
              {t('dashboard.manage_list')}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
            {todayTasks.length === 0 ? (
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                  fontStyle: 'italic',
                  margin: 'auto',
                }}
              >
                {t('dashboard.no_tasks')}
              </p>
            ) : (
              todayTasks.map((task: any) => (
                <div
                  key={task.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-app)',
                    cursor: 'pointer',
                  }}
                  onClick={() => toggleTask(task.id, task.is_completed === 1)}
                >
                  {task.is_completed === 1 ? (
                    <CheckCircle size={18} color="var(--color-success)" />
                  ) : (
                    <Circle
                      size={18}
                      color={task.status === '已逾期' ? 'var(--color-danger)' : 'var(--text-muted)'}
                    />
                  )}
                  <div style={{ minWidth: 0, flexGrow: 1 }}>
                    <p
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        textDecoration: task.is_completed === 1 ? 'line-through' : 'none',
                        color: task.is_completed === 1 ? 'var(--text-muted)' : 'var(--text-main)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {task.title}
                    </p>
                    <span
                      style={{
                        fontSize: '11px',
                        color:
                          task.status === '已逾期' ? 'var(--color-danger)' : 'var(--text-muted)',
                      }}
                    >
                      {task.status === '已逾期' ? t('common.overdue') : task.due_date}
                    </span>
                  </div>
                  <span
                    className={`pill ${task.priority === 'high' ? 'red' : task.priority === 'mid' ? 'yellow' : 'green'}`}
                    style={{ transform: 'scale(0.85)' }}
                  >
                    {task.priority === 'high'
                      ? t('tasks.priority_high')
                      : task.priority === 'mid'
                        ? t('tasks.priority_mid')
                        : t('tasks.priority_low')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Card: Current Book */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">
            <span>{t('dashboard.current_read')}</span>
            <button
              className="pill blue"
              onClick={() => navigateTo('books')}
              style={{ cursor: 'pointer', border: 'none' }}
            >
              {t('dashboard.open_shelf')}
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              height: '100%',
              gap: '16px',
            }}
          >
            {currentBook ? (
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                <div
                  style={{
                    width: '64px',
                    height: '88px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-accent)',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 'bold',
                    fontSize: '12px',
                    boxShadow: 'var(--shadow-app)',
                    flexShrink: 0,
                  }}
                >
                  {currentBook.cover || 'BOOK'}
                </div>
                <div style={{ minWidth: 0, width: '100%' }}>
                  <h3
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {currentBook.title}
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '4px 0 8px' }}>
                    {currentBook.author || t('dashboard.unknown_author')}
                  </p>

                  {/* Reading Progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        height: '6px',
                        backgroundColor: 'var(--color-border)',
                        borderRadius: '99px',
                        flexGrow: 1,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${currentBook.progress || 0}%`,
                          backgroundColor: 'var(--color-accent)',
                        }}
                      />
                    </div>
                    <span
                      style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                    >
                      {Math.round(currentBook.progress || 0)}%
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                  fontStyle: 'italic',
                  margin: 'auto',
                }}
              >
                {t('dashboard.no_books')}
              </p>
            )}
          </div>
        </div>

        {/* Card: Pomodoro timer Pin */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">
            <span>{t('dashboard.toolbox_pin')}</span>
            <button
              className="pill green"
              onClick={() => navigateTo('toolbox')}
              style={{ cursor: 'pointer', border: 'none' }}
            >
              {t('dashboard.pomodoro')}
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: '100%',
              padding: '10px 8px',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '42px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '-0.02em',
                  color: 'var(--text-main)',
                }}
              >
                {timerLeft}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {t('dashboard.bind_task_hint')}
              </p>
            </div>
            <button
              className="btn primary"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                padding: 0,
                justifyContent: 'center',
              }}
              onClick={() => {
                navigateTo('toolbox')
                showToast(t('dashboard.toast_start_pomo'))
              }}
            >
              <Clock size={20} />
            </button>
          </div>
        </div>

        {/* Card: Recent Note */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">
            <span>{t('dashboard.recent_notes')}</span>
            <button
              className="pill blue"
              onClick={() => navigateTo('notes')}
              style={{ cursor: 'pointer', border: 'none' }}
            >
              {t('dashboard.open_notes')}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px' }}>
            {recentNote ? (
              <div
                style={{ padding: '8px 4px', cursor: 'pointer' }}
                onClick={() => navigateTo('notes')}
              >
                <h4
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '4px',
                  }}
                >
                  <FileText size={14} color="var(--color-accent)" />
                  {recentNote.title}
                </h4>
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.4,
                  }}
                >
                  {recentNote.content || t('dashboard.no_content')}
                </p>
              </div>
            ) : (
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                  fontStyle: 'italic',
                  margin: 'auto',
                }}
              >
                {t('dashboard.empty_notebook')}
              </p>
            )}
          </div>
        </div>

        {/* Card: Recent Video */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">
            <span>{t('dashboard.recent_videos')}</span>
            <button
              className="pill blue"
              onClick={() => navigateTo('videos')}
              style={{ cursor: 'pointer', border: 'none' }}
            >
              {t('dashboard.videos_title')}
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              justifyContent: 'center',
            }}
          >
            {recentVideo ? (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    color: 'var(--color-accent)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Play size={16} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h4
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      margin: 0,
                    }}
                  >
                    {recentVideo.title}
                  </h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                    {recentVideo.source} · {recentVideo.duration || '00:00'} ·{' '}
                    {t('dashboard.downloaded')}
                  </p>
                </div>
              </div>
            ) : (
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                  fontStyle: 'italic',
                  margin: 'auto',
                }}
              >
                {t('dashboard.no_videos')}
              </p>
            )}
          </div>
        </div>

        {/* Card: Overall Metrics */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">
            <span>{t('dashboard.stats')}</span>
            <TrendingUp size={16} color="var(--text-muted)" />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              height: '100%',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                textAlign: 'center',
                padding: '6px',
                borderRight: '1px solid var(--color-border)',
              }}
            >
              <strong style={{ fontSize: '18px', display: 'block' }}>{stats.tasks}</strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {t('dashboard.stats_tasks')}
              </span>
            </div>
            <div style={{ textAlign: 'center', padding: '6px' }}>
              <strong style={{ fontSize: '18px', display: 'block' }}>{stats.notes}</strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {t('dashboard.stats_notes')}
              </span>
            </div>
            <div
              style={{
                textAlign: 'center',
                padding: '6px',
                borderRight: '1px solid var(--color-border)',
                borderTop: '1px solid var(--color-border)',
                paddingTop: '8px',
              }}
            >
              <strong style={{ fontSize: '18px', display: 'block' }}>{stats.books}</strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {t('dashboard.stats_books')}
              </span>
            </div>
            <div
              style={{
                textAlign: 'center',
                padding: '6px',
                borderTop: '1px solid var(--color-border)',
                paddingTop: '8px',
              }}
            >
              <strong style={{ fontSize: '18px', display: 'block' }}>{stats.videos}</strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {t('dashboard.stats_videos')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

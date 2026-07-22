import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Circle, RefreshCw, X } from 'lucide-react'
import { getDesktopTasksForDate, getUserDateKey } from './taskDesktopUtils'
import './DesktopTaskNote.css'

type DesktopTaskRecord = {
  id: number
  title: string
  status?: string | null
  due_date?: string | null
  start_date?: string | null
  end_date?: string | null
  is_completed?: number | null
  progress?: number | null
}

const getUserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export const DesktopTaskNote: React.FC = () => {
  const api = (window as any).electronAPI
  const [tasks, setTasks] = useState<DesktopTaskRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskToClose, setTaskToClose] = useState<DesktopTaskRecord | null>(null)

  const todayKey = useMemo(() => getUserDateKey(new Date(), getUserTimeZone()), [])

  const loadTasks = useCallback(
    async (manual = false) => {
      if (!api) {
        setError('桌面便签需要在 LifeOS Electron 应用中运行。')
        setIsLoading(false)
        return
      }

      if (manual) setIsRefreshing(true)
      setError(null)
      const result = await api.dbQuery(
        'tasks',
        "SELECT * FROM tasks WHERE status != '已关闭' ORDER BY COALESCE(due_date, created_at) ASC, id ASC",
      )
      if (result?.success) {
        setTasks(getDesktopTasksForDate(result.data as DesktopTaskRecord[], todayKey))
      } else {
        setError('任务加载失败，请稍后重试。')
      }
      setIsLoading(false)
      setIsRefreshing(false)
    },
    [api, todayKey],
  )

  useEffect(() => {
    void loadTasks()
    const timer = window.setInterval(() => void loadTasks(), 60_000)
    return () => window.clearInterval(timer)
  }, [loadTasks])

  const toggleTask = async (task: DesktopTaskRecord) => {
    const nextDone = task.is_completed === 1 ? 0 : 1
    const nextStatus = task.status === '已关闭' ? '待处理' : task.status || '待处理'
    const result = await api?.dbQuery(
      'tasks',
      'UPDATE tasks SET is_completed = ?, status = ?, progress = ? WHERE id = ?',
      [nextDone, nextStatus, nextDone ? 100 : 0, task.id],
    )
    if (result?.success) {
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === task.id
            ? {
                ...candidate,
                is_completed: nextDone,
                status: nextStatus,
                progress: nextDone ? 100 : 0,
              }
            : candidate,
        ),
      )
    } else {
      setError('任务状态更新失败，请稍后重试。')
    }
  }

  const closeTask = async () => {
    if (!taskToClose) return
    const result = await api?.dbQuery('tasks', "UPDATE tasks SET status = '已关闭' WHERE id = ?", [
      taskToClose.id,
    ])
    if (result?.success) {
      setTasks((current) => current.filter((task) => task.id !== taskToClose.id))
      setTaskToClose(null)
    } else {
      setError('关闭任务失败，请稍后重试。')
    }
  }

  const activeTasks = tasks.filter((task) => task.is_completed !== 1)
  const completedTasks = tasks.filter((task) => task.is_completed === 1)

  const renderTask = (task: DesktopTaskRecord) => {
    const isCompleted = task.is_completed === 1
    return (
      <li key={task.id} className={`desktop-task-note__task ${isCompleted ? 'is-completed' : ''}`}>
        <button
          type="button"
          className="desktop-task-note__check"
          aria-label={isCompleted ? '标记为未完成' : '标记为已完成'}
          onClick={() => void toggleTask(task)}
        >
          {isCompleted ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Circle size={16} aria-hidden="true" />
          )}
        </button>
        <span className="desktop-task-note__title">{task.title}</span>
        {task.status === '已逾期' && <span className="desktop-task-note__overdue">逾期</span>}
        <button
          type="button"
          className="desktop-task-note__close"
          aria-label="关闭任务"
          title="关闭任务"
          onClick={() => setTaskToClose(task)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </li>
    )
  }

  return (
    <main className="desktop-task-note">
      <header className="desktop-task-note__header">
        <div>
          <p className="desktop-task-note__eyebrow">LifeOS</p>
          <h1>今日任务</h1>
        </div>
        <button
          type="button"
          className="desktop-task-note__refresh"
          aria-label="刷新任务"
          onClick={() => void loadTasks(true)}
          disabled={isRefreshing}
        >
          <RefreshCw size={16} className={isRefreshing ? 'is-spinning' : ''} aria-hidden="true" />
        </button>
      </header>

      {error && (
        <p className="desktop-task-note__error" role="alert">
          {error}
        </p>
      )}
      {isLoading ? (
        <p className="desktop-task-note__empty">正在加载任务…</p>
      ) : tasks.length === 0 ? (
        <p className="desktop-task-note__empty">今天没有任务</p>
      ) : (
        <div className="desktop-task-note__content">
          <section aria-labelledby="desktop-task-note-active-title">
            <h2 id="desktop-task-note-active-title">待完成 · {activeTasks.length}</h2>
            {activeTasks.length > 0 ? (
              <ul className="desktop-task-note__list">{activeTasks.map(renderTask)}</ul>
            ) : (
              <p className="desktop-task-note__section-empty">全部完成</p>
            )}
          </section>
          <section aria-labelledby="desktop-task-note-completed-title">
            <h2 id="desktop-task-note-completed-title">已完成 · {completedTasks.length}</h2>
            {completedTasks.length > 0 ? (
              <ul className="desktop-task-note__list">{completedTasks.map(renderTask)}</ul>
            ) : (
              <p className="desktop-task-note__section-empty">暂无已完成任务</p>
            )}
          </section>
        </div>
      )}

      {taskToClose && (
        <div className="desktop-task-note__dialog-backdrop" role="presentation">
          <section
            className="desktop-task-note__dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="desktop-task-note-close-title"
            aria-describedby="desktop-task-note-close-description"
          >
            <h2 id="desktop-task-note-close-title">关闭任务？</h2>
            <p id="desktop-task-note-close-description">
              “{taskToClose.title}”关闭后将不再显示在桌面便签中，但仍可在主任务列表中恢复。
            </p>
            <div className="desktop-task-note__dialog-actions">
              <button
                type="button"
                className="desktop-task-note__dialog-cancel"
                onClick={() => setTaskToClose(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="desktop-task-note__dialog-confirm"
                onClick={() => void closeTask()}
              >
                确认关闭
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

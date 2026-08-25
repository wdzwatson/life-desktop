import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  LayoutDashboard,
  Pin,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  getDesktopTasksForDate,
  getUserDateKey,
  moveDesktopTaskId,
  sortDesktopTasksByOrder,
  type DesktopTaskOrder,
} from './taskDesktopUtils'
import { getTaskDuePresentation } from './taskDuePresentationUtils'
import { getActionableTasks } from './taskSemantics'
import './DesktopTaskNote.css'
import { SystemMonitor } from '../components/SystemMonitor'
import { Slider } from '../components/Slider'
import {
  buildCloseTaskTreeMutation,
  buildCompleteTaskTreeMutation,
  buildAggregateTaskMutation,
  buildReopenTaskTreeMutation,
} from '../taskTreeMutation'

type DesktopTaskRecord = {
  id: number
  title: string
  status?: string | null
  closed_from_status?: string | null
  due_date?: string | null
  due_time?: string | null
  requires_review?: number | null
  recur_rule_id?: number | null
  start_date?: string | null
  end_date?: string | null
  is_completed?: number | null
  progress?: number | null
}

const getUserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const formatTaskSchedule = (task: DesktopTaskRecord, todayKey: string) => {
  const due = getTaskDuePresentation(task.due_date, task.due_time)
  if (!due.dateKey) return null
  if (due.time && due.dateKey === todayKey) return due.time
  return `${due.dateKey.slice(5).replace('-', '/')}${due.time ? ` ${due.time}` : ''}`
}

const formatShortDate = (dateKey: string) => {
  const [, month, day] = dateKey.split('-')
  if (!month || !day) return dateKey
  return `${Number(month)}/${Number(day)}`
}

export const DesktopTaskNote: React.FC = () => {
  const api = (window as any).electronAPI
  const [tasks, setTasks] = useState<DesktopTaskRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskToClose, setTaskToClose] = useState<DesktopTaskRecord | null>(null)
  const [taskOrder, setTaskOrder] = useState<DesktopTaskOrder>({ active: [], completed: [] })
  const [storageKey, setStorageKey] = useState('lifeos.desktop-task-note.order.guest')
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null)
  const [opacity, setOpacity] = useState(0.96)
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [showCompleted, setShowCompleted] = useState(false)
  const [completedPanelTouched, setCompletedPanelTouched] = useState(false)

  const todayKey = useMemo(() => getUserDateKey(new Date(), getUserTimeZone()), [])

  useEffect(() => {
    void api?.getCurrentUser?.().then((user: { userId?: string } | null) => {
      setStorageKey(`lifeos.desktop-task-note.order.${user?.userId || 'guest'}`)
    })
  }, [api])

  useEffect(() => {
    void api
      ?.getDesktopTaskNoteSettings?.()
      .then((settings: { opacity?: number; alwaysOnTop?: boolean }) => {
        if (typeof settings?.opacity === 'number') setOpacity(settings.opacity)
        if (typeof settings?.alwaysOnTop === 'boolean') setAlwaysOnTop(settings.alwaysOnTop)
      })
  }, [api])

  const updateAppearance = async (patch: { opacity?: number; alwaysOnTop?: boolean }) => {
    const result = await api?.setDesktopTaskNoteSettings?.(patch)
    if (!result?.success) return
    if (typeof result.data?.opacity === 'number') setOpacity(result.data.opacity)
    if (typeof result.data?.alwaysOnTop === 'boolean') setAlwaysOnTop(result.data.alwaysOnTop)
  }

  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(storageKey) || '{}',
      ) as Partial<DesktopTaskOrder>
      setTaskOrder({
        active: Array.isArray(stored.active) ? stored.active : [],
        completed: Array.isArray(stored.completed) ? stored.completed : [],
      })
      setLoadedStorageKey(storageKey)
    } catch {
      setTaskOrder({ active: [], completed: [] })
      setLoadedStorageKey(storageKey)
    }
  }, [storageKey])

  useEffect(() => {
    if (loadedStorageKey !== storageKey) return
    localStorage.setItem(storageKey, JSON.stringify(taskOrder))
  }, [loadedStorageKey, storageKey, taskOrder])

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
        "SELECT * FROM tasks WHERE status != '已关闭' OR is_completed = 1 ORDER BY COALESCE(due_date, created_at) ASC, COALESCE(due_time, '23:59:59') ASC, id ASC",
      )
      if (result?.success) {
        setTasks(
          getDesktopTasksForDate(getActionableTasks(result.data as DesktopTaskRecord[]), todayKey),
        )
      } else {
        setError('任务加载失败，请稍后重试。')
      }
      setIsLoading(false)
      setIsRefreshing(false)
    },
    [api, todayKey],
  )

  useEffect(() => {
    const unsubscribe = api?.onTasksChanged?.(() => {
      void loadTasks()
    })
    return unsubscribe
  }, [api, loadTasks])

  useEffect(() => {
    void loadTasks()
    const timer = window.setInterval(() => void loadTasks(), 60_000)
    return () => window.clearInterval(timer)
  }, [loadTasks])

  const toggleTask = async (task: DesktopTaskRecord) => {
    const nextDone = task.is_completed === 1 ? 0 : 1
    const mutation = nextDone
      ? buildCompleteTaskTreeMutation(task.id)
      : buildReopenTaskTreeMutation(task.id)
    const result = await api?.dbQuery('tasks', mutation.sql, mutation.params)
    if (result?.success) {
      await refreshAncestors(task.id)
      await loadTasks()
    } else {
      setError('任务状态更新失败，请稍后重试。')
    }
  }

  const refreshAncestors = async (taskId: number) => {
    let currentId: number | null = taskId
    const visited = new Set<number>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const parentResult: any = await api?.dbQuery(
        'tasks',
        'SELECT parent_id FROM tasks WHERE id = ?',
        [currentId],
      )
      const parentId: number | null | undefined = parentResult?.data?.[0]?.parent_id
      if (!parentId) break
      const mutation = buildAggregateTaskMutation(Number(parentId))
      await api?.dbQuery('tasks', mutation.sql, mutation.params)
      currentId = Number(parentId)
    }
  }

  const closeTask = async () => {
    if (!taskToClose) return
    const mutation = buildCloseTaskTreeMutation(taskToClose.id)
    const result = await api?.dbQuery('tasks', mutation.sql, mutation.params)
    if (result?.success) {
      await refreshAncestors(taskToClose.id)
      await loadTasks()
      setTaskToClose(null)
    } else {
      setError('关闭任务失败，请稍后重试。')
    }
  }

  const activeTasks = tasks.filter((task) => task.is_completed !== 1)
  const completedTasks = tasks.filter((task) => task.is_completed === 1)
  const orderedActiveTasks = sortDesktopTasksByOrder(activeTasks, taskOrder.active)
  const orderedCompletedTasks = sortDesktopTasksByOrder(completedTasks, taskOrder.completed)
  const isCompletedPanelExpanded = completedPanelTouched ? showCompleted : activeTasks.length === 0

  const moveTask = (group: 'active' | 'completed', sourceId: number, targetId: number) => {
    setTaskOrder((current) => ({
      ...current,
      [group]: moveDesktopTaskId(current[group], sourceId, targetId),
    }))
  }

  const renderTask = (task: DesktopTaskRecord, group: 'active' | 'completed') => {
    const isCompleted = task.is_completed === 1
    const schedule = formatTaskSchedule(task, todayKey)
    const due = getTaskDuePresentation(task.due_date, task.due_time)
    return (
      <li
        key={task.id}
        className={`desktop-task-note__task ${isCompleted ? 'is-completed' : ''}`}
        draggable
        onDragStart={(event) => event.dataTransfer.setData('text/plain', String(task.id))}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const sourceId = Number(event.dataTransfer.getData('text/plain'))
          if (sourceId) moveTask(group, sourceId, task.id)
        }}
      >
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
        {schedule && (
          <time
            className="desktop-task-note__schedule"
            dateTime={due.time ? `${due.dateKey}T${due.time}` : due.dateKey || undefined}
            title={due.time ? `${due.dateKey} ${due.time}` : due.dateKey || undefined}
          >
            <Clock3 size={12} aria-hidden="true" />
            {schedule}
          </time>
        )}
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
        <div className="desktop-task-note__heading">
          <h1>今日任务</h1>
          <p>
            {formatShortDate(todayKey)} · {activeTasks.length} 项待完成
          </p>
        </div>
        <div className="desktop-task-note__controls">
          <button
            type="button"
            className="desktop-task-note__refresh desktop-task-note__drag-exempt"
            aria-label="打开主界面"
            title="打开主界面"
            onClick={() => void api?.openMainWindow?.()}
          >
            <LayoutDashboard size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`desktop-task-note__refresh desktop-task-note__drag-exempt ${alwaysOnTop ? 'is-active' : ''}`}
            aria-label={alwaysOnTop ? '取消置顶' : '始终置顶'}
            title={alwaysOnTop ? '取消置顶' : '始终置顶'}
            onClick={() => void updateAppearance({ alwaysOnTop: !alwaysOnTop })}
          >
            <Pin size={15} aria-hidden="true" />
          </button>
          <label
            className="desktop-task-note__opacity desktop-task-note__drag-exempt"
            title="便签透明度"
          >
            <span className="sr-only">便签透明度</span>
            <Slider
              type="range"
              min="0.35"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(event) => {
                const nextOpacity = Number(event.target.value)
                setOpacity(nextOpacity)
                void updateAppearance({ opacity: nextOpacity })
              }}
            />
          </label>
          <button
            type="button"
            className="desktop-task-note__refresh desktop-task-note__drag-exempt"
            aria-label="刷新任务"
            title="刷新任务"
            onClick={() => void loadTasks(true)}
            disabled={isRefreshing}
          >
            <RefreshCw size={16} className={isRefreshing ? 'is-spinning' : ''} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="desktop-task-note__refresh desktop-task-note__drag-exempt"
            aria-label="关闭便签"
            title="关闭便签"
            onClick={() => void api?.hideDesktopTaskNote?.()}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
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
          <div className="desktop-task-note__active-scroll">
            {activeTasks.length > 0 ? (
              <section aria-label="待完成">
                <ul className="desktop-task-note__list">
                  {orderedActiveTasks.map((task) => renderTask(task, 'active'))}
                </ul>
              </section>
            ) : (
              <p className="desktop-task-note__focus-empty">今日任务已全部完成</p>
            )}
          </div>
          {completedTasks.length > 0 && (
            <section
              className={`desktop-task-note__completed-section ${isCompletedPanelExpanded ? 'is-expanded' : ''}`}
              aria-label="已完成"
            >
              <button
                type="button"
                className="desktop-task-note__completed-toggle"
                aria-expanded={isCompletedPanelExpanded}
                aria-controls="desktop-task-note-completed-list"
                onClick={() => {
                  setCompletedPanelTouched(true)
                  setShowCompleted(!isCompletedPanelExpanded)
                }}
              >
                <span className="desktop-task-note__completed-label">
                  <Check size={12} aria-hidden="true" />
                  <span>已完成</span>
                  <span className="desktop-task-note__completed-count">
                    {completedTasks.length}
                  </span>
                </span>
                {isCompletedPanelExpanded ? (
                  <ChevronDown size={13} aria-hidden="true" />
                ) : (
                  <ChevronRight size={13} aria-hidden="true" />
                )}
              </button>
              {isCompletedPanelExpanded && (
                <ul id="desktop-task-note-completed-list" className="desktop-task-note__list">
                  {orderedCompletedTasks.map((task) => renderTask(task, 'completed'))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      <footer className="desktop-task-note__footer">
        <SystemMonitor placement="note" />
      </footer>

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

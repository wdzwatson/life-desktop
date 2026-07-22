import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../components/AccessibleDialog'
import { useConfirmation } from '../components/ConfirmationProvider'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Circle,
  Flag,
  X,
  Kanban,
  ListChecks,
  ListTodo,
  Trash2,
  Plus,
  RefreshCw,
} from 'lucide-react'
import {
  getCalendarMonthDays,
  getCalendarWeekDays,
  groupTasksByDueDate,
  shiftCalendarDate,
  toCalendarDateKey,
} from './taskCalendarUtils'
import {
  getNextTemplateOccurrences,
  getTemplateStartDateKey,
  getTemplateStartTime,
  getTemplateTimes,
  toLocalDateKey,
} from './taskScheduleUtils'
import { projectCalendarOccurrences } from './taskOccurrenceProjection'
import './Tasks.css'

const getCurrentTimeValue = () => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

const getDefaultDueTime = () => '23:59:59'

const getDefaultScheduleTime = () => '09:00'

const normalizeScheduleTime = (value: string | null | undefined) => {
  if (!value) return getDefaultScheduleTime()
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value.slice(0, 5)
  return /^\d{2}:\d{2}$/.test(value) ? value : getDefaultScheduleTime()
}

const normalizeTaskDueTime = (value: string | null | undefined) => {
  if (!value) return '23:59:59'
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
}

type TaskDeletionScope = 'single' | 'end-repeat' | 'delete-repeat'

export const Tasks: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { confirm } = useConfirmation()

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high':
        return t('tasks.priority_high')
      case 'mid':
        return t('tasks.priority_mid')
      case 'low':
        return t('tasks.priority_low')
      default:
        return priority
    }
  }

  const getStatusLabel = (status: string) => {
    const currentLocale = i18n.language
    const match = translations.find(
      (t) =>
        t.entity_type === 'task_status' && t.entity_id === status && t.locale === currentLocale,
    )
    if (match) return match.translation

    switch (status) {
      case '待收集':
        return t('tasks.lane_inbox')
      case '待处理':
        return t('tasks.lane_todo')
      case '进行中':
        return t('tasks.lane_inprogress')
      case '待验收':
        return t('tasks.lane_review')
      case '已关闭':
        return t('tasks.lane_closed')
      case '已逾期':
        return t('common.overdue')
      default:
        return status
    }
  }
  const taskTab = useAppStore((state) => state.taskTab)
  const setTaskTab = useAppStore((state) => state.setTaskTab)
  const showToast = useAppStore((state) => state.showToast)
  const userId = useAppStore((state) => state.userId)
  const api = (window as any).electronAPI

  // DB States
  const [tasks, setTasks] = useState<any[]>([])
  const [translations, setTranslations] = useState<any[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [expandedTaskGroupId, setExpandedTaskGroupId] = useState<number | null>(null)
  const [expandedOccurrenceGroupKey, setExpandedOccurrenceGroupKey] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  const [completionConfirmationTask, setCompletionConfirmationTask] = useState<any | null>(null)
  const [isCompletionConfirming, setIsCompletionConfirming] = useState(false)
  const completionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [deletionConfirmationTask, setDeletionConfirmationTask] = useState<any | null>(null)
  const [deletionScope, setDeletionScope] = useState<TaskDeletionScope>('single')
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const deletionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const deletionCancelButtonRef = useRef<HTMLButtonElement | null>(null)

  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null)
  const [taskDraft, setTaskDraft] = useState({
    title: '',
    description: '',
    dueDate: toLocalDateKey(new Date()),
    time: getDefaultDueTime(),
    priority: 'mid',
    repeat: 'none',
  })

  // Detail Panel Edit State
  const [editDesc, setEditDesc] = useState('')
  const [editProgress, setEditProgress] = useState(0)

  // Recurring Rules States
  const [rules, setRules] = useState<any[]>([])
  const [skippedOccurrences, setSkippedOccurrences] = useState<Set<string>>(new Set())
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null)
  const [ruleName, setRuleName] = useState('')
  const [ruleDesc, setRuleDesc] = useState('')
  const [ruleFreq, setRuleFreq] = useState('daily')
  const [ruleInterval, setRuleInterval] = useState(1)
  const [ruleStartDate, setRuleStartDate] = useState(() => toLocalDateKey(new Date()))
  const [ruleTime, setRuleTime] = useState('09:00')
  const [ruleTimes, setRuleTimes] = useState<string[]>(['09:00'])
  const [rulePriority, setRulePriority] = useState('mid')
  const [ruleWeekDays, setRuleWeekDays] = useState<number[]>([]) // 1=Mon...7=Sun
  const [ruleMonthDays, setRuleMonthDays] = useState<number[]>([])
  const [ruleCron, setRuleCron] = useState('')
  const [ruleHolidayPolicy, setRuleHolidayPolicy] = useState('skip')

  // Calendar Mode State ('day' | 'week' | 'month')
  const [calendarMode, setCalendarMode] = useState<'day' | 'week' | 'month'>('week')
  const [calendarDate, setCalendarDate] = useState(() => new Date())

  // Templates
  const [templates, setTemplates] = useState<any[]>([])
  const [templateEditor, setTemplateEditor] = useState<any | null>(null)
  const [isRulePanelExpanded, setIsRulePanelExpanded] = useState(false)
  const [editRuleScope, setEditRuleScope] = useState<'single' | 'future' | 'all'>('future')

  useEffect(() => {
    if (!['list', 'kanban', 'calendar', 'scheduled'].includes(taskTab)) {
      setTaskTab('list')
    }
  }, [setTaskTab, taskTab])

  useEffect(() => {
    const builtinTemplates = [
      {
        id: 1,
        templateKey: 'builtin-prd',
        title: t('tasks.template_prd_title'),
        icon: '🚀',
        subtasks: [
          t('tasks.template_prd_sub_1'),
          t('tasks.template_prd_sub_2'),
          t('tasks.template_prd_sub_3'),
          t('tasks.template_prd_sub_4'),
        ],
        tags: [t('tasks.template_prd_tag_1'), t('tasks.template_prd_tag_2')],
      },
      {
        id: 2,
        templateKey: 'builtin-review',
        title: t('tasks.template_review_title'),
        icon: '📝',
        subtasks: [
          t('tasks.template_review_sub_1'),
          t('tasks.template_review_sub_2'),
          t('tasks.template_review_sub_3'),
        ],
        tags: [t('tasks.template_review_tag_1'), t('tasks.template_review_tag_2')],
      },
      {
        id: 3,
        templateKey: 'builtin-study',
        title: t('tasks.template_study_title'),
        icon: '📚',
        subtasks: [
          t('tasks.template_study_sub_1'),
          t('tasks.template_study_sub_2'),
          t('tasks.template_study_sub_3'),
        ],
        tags: [t('tasks.template_study_tag_1'), t('tasks.template_study_tag_2')],
      },
    ]

    const loadTemplates = async () => {
      if (!api?.dbQuery) {
        setTemplates(builtinTemplates)
        return
      }
      try {
        const result = await api.dbQuery(
          'tasks',
          `SELECT id, template_key AS templateKey, title, description, icon, version FROM task_templates ORDER BY updated_at DESC, id DESC`,
        )
        const rows = result?.data ?? []
        if (rows.length === 0) {
          setTemplates(builtinTemplates)
          return
        }
        const loaded = await Promise.all(rows.map(async (template: any) => {
          const stepsResult = await api.dbQuery(
            'tasks',
            `SELECT title FROM task_template_steps WHERE template_id = ? ORDER BY sort_order, id`,
            [template.id],
          )
          return {
            ...template,
            subtasks: (stepsResult?.data ?? []).map((step: any) => step.title),
            tags: [t('tasks.template_version_label', { version: template.version || 1 })],
          }
        }))
        setTemplates(loaded)
      } catch {
        setTemplates(builtinTemplates)
      }
    }
    void loadTemplates()

  }, [api, i18n.language, t])

  const scheduledLogs = useMemo(
    () =>
      rules.map((rule) => {
        const nextOccurrence = getNextTemplateOccurrences(rule, new Date(), 1)[0]
        return {
          id: rule.id,
          name: rule.title,
          action: t('tasks.log_rule_action'),
          trigger: `${rule.cron || rule.frequency} · ${getTemplateStartTime(rule)}`,
          status: t('tasks.log_rule_status_active'),
          nextRun: nextOccurrence
            ? `${nextOccurrence.dateKey} ${nextOccurrence.time}`
            : t('tasks.log_rule_next_calculated'),
        }
      }),
    [rules, t],
  )

  const boardLanes = useMemo(
    () => [
      { key: 'lane_inbox', dbVal: '待收集' },
      { key: 'lane_todo', dbVal: '待处理' },
      { key: 'lane_inprogress', dbVal: '进行中' },
      { key: 'lane_review', dbVal: '待验收' },
      { key: 'lane_closed', dbVal: '已关闭' },
    ],
    [],
  )
  const calendarWeekDays = useMemo(() => getCalendarWeekDays(calendarDate), [calendarDate])
  const calendarMonthDays = useMemo(() => getCalendarMonthDays(calendarDate), [calendarDate])
  const calendarVisibleDays =
    calendarMode === 'day'
      ? [calendarDate]
      : calendarMode === 'week'
        ? calendarWeekDays
        : calendarMonthDays.filter((day) => day.getMonth() === calendarDate.getMonth())
  const calendarTasks = useMemo(() => {
    const start = new Date(calendarVisibleDays[0])
    start.setHours(0, 0, 0, 0)
    const end = new Date(calendarVisibleDays[calendarVisibleDays.length - 1])
    end.setHours(23, 59, 59, 999)
    return projectCalendarOccurrences(tasks, rules, start, end, skippedOccurrences)
  }, [calendarVisibleDays, rules, skippedOccurrences, tasks])
  const calendarTasksByDate = useMemo(() => groupTasksByDueDate(calendarTasks), [calendarTasks])
  const calendarVisibleTasks = calendarVisibleDays.flatMap(
    (day) => calendarTasksByDate.get(toCalendarDateKey(day)) ?? [],
  )
  const calendarTodayKey = toCalendarDateKey(new Date())
  const calendarPeriodLabel = useMemo(() => {
    if (calendarMode === 'day') {
      return new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }).format(calendarDate)
    }

    if (calendarMode === 'week') {
      const formatter = new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
      return `${formatter.format(calendarWeekDays[0])} – ${formatter.format(calendarWeekDays[6])}`
    }

    return new Intl.DateTimeFormat(i18n.language, {
      year: 'numeric',
      month: 'long',
    }).format(calendarDate)
  }, [calendarDate, calendarMode, calendarWeekDays, i18n.language])

  const openCalendarTask = async (task: any) => {
    if (task.is_virtual && api) {
      await api.dbQuery(
        'tasks',
        `INSERT OR IGNORE INTO tasks (title, description, priority, status, due_date, due_time, recur_rule_id, template_id, template_version, instance_key, progress)
         VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, 0)`,
        [task.title, task.description || '', task.priority, task.due_date, task.due_time || task.occurrence_time || null, task.recur_rule_id, task.template_id || null, task.template_version || null, task.instance_key],
      )
      const result = await api.dbQuery(
        'tasks',
        'SELECT * FROM tasks WHERE recur_rule_id = ? AND instance_key = ? AND parent_id IS NULL LIMIT 1',
        [task.recur_rule_id, task.instance_key],
      )
      const materialized = result?.data?.[0]
      if (materialized) {
        const children = await api.dbQuery(
          'tasks',
          'SELECT id FROM tasks WHERE parent_id = ? LIMIT 1',
          [materialized.id],
        )
        if (!children?.data?.length) {
          const steps = await api.dbQuery(
            'tasks',
            'SELECT * FROM recurring_rule_steps WHERE rule_id = ? ORDER BY sort_order ASC, id ASC',
            [task.recur_rule_id],
          )
          for (const step of steps?.data ?? []) {
            await api.dbQuery(
              'tasks',
            `INSERT INTO tasks (title, description, priority, status, due_date, due_time, recur_rule_id, template_id, template_version, instance_key, parent_id, progress)
             VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, ?, 0)`,
              [step.title, step.description || '', step.priority || task.priority, task.due_date, task.due_time || task.occurrence_time || null, task.recur_rule_id, task.template_id || null, task.template_version || null, task.instance_key, materialized.id],
            )
          }
        }
      }
      await loadData()
      if (materialized) selectTaskForDetails(materialized)
      return
    }
    selectTaskForDetails(task)
  }

  const formatDue = (task: any) => {
    if (!task.due_date) return t('tasks.due_date_not_set')
    return task.due_time ? `${task.due_date} ${task.due_time}` : task.due_date
  }

  const renderCalendarTask = (task: any) => (
    <button
      key={task.id}
      type="button"
      className="task-calendar__task"
      onClick={() => openCalendarTask(task)}
    >
      <span className="task-calendar__task-title">{task.title}</span>
      <span className="task-calendar__task-meta">
        {getPriorityLabel(task.priority)} · {getStatusLabel(task.status)}
      </span>
    </button>
  )

  const openCreateDrawer = () => {
    setSelectedTaskId(null)
    setIsRulePanelExpanded(false)
    setEditRuleScope('future')
    setRuleFreq('daily')
    setRuleInterval(1)
    setRuleStartDate(toLocalDateKey(new Date()))
    setRuleTimes(['09:00'])
    setRuleWeekDays([])
    setRuleMonthDays([])
    setTaskDraft({
      title: '',
      description: '',
      dueDate: toLocalDateKey(new Date()),
      time: getDefaultDueTime(),
      priority: 'mid',
      repeat: 'none',
    })
    setDrawerMode('create')
  }

  useEffect(() => {
    const handleCreateTask = () => openCreateDrawer()
    window.addEventListener('task:create', handleCreateTask)
    return () => window.removeEventListener('task:create', handleCreateTask)
  }, [])

  const selectTaskForDetails = (task: any) => {
    setSelectedTaskId(task.id)
    setEditDesc(task.description || '')
    setEditProgress(task.progress || 0)
    const rule = task.recur_rule_id ? rules.find((candidate) => candidate.id === task.recur_rule_id) : null
    setIsRulePanelExpanded(Boolean(rule && rule.frequency !== 'custom'))
    setEditRuleScope('future')
    if (rule) {
      setRuleFreq(rule.frequency || 'daily')
      setRuleInterval(Math.max(1, Number(rule.interval || 1)))
      setRuleStartDate(getTemplateStartDateKey(rule))
      setRuleTimes(getTemplateTimes(rule))
      setRuleWeekDays(String(rule.week_days || '').split(',').map(Number).filter(Boolean))
      setRuleMonthDays(String(rule.month_days || '').split(',').map(Number).filter(Boolean))
      setRulePriority(rule.priority || task.priority || 'mid')
      setRuleHolidayPolicy(rule.missed_policy || 'skip')
    }
    setTaskDraft({
      title: task.title || '',
      description: task.description || '',
      dueDate: task.due_date || toLocalDateKey(new Date()),
      time: normalizeTaskDueTime(task.due_time),
      priority: task.priority || 'mid',
      repeat: rule && rule.frequency !== 'custom' ? rule.frequency : 'none',
    })
    setDrawerMode('edit')
  }

  const getFrequencyLabel = (frequency: string) => {
    switch (frequency) {
      case 'custom':
        return t('tasks.freq_once')
      case 'daily':
        return t('tasks.freq_daily')
      case 'weekday':
        return t('tasks.freq_weekday')
      case 'weekly':
        return t('tasks.freq_weekly')
      case 'monthly':
        return t('tasks.freq_monthly')
      case 'cron':
        return t('tasks.freq_cron')
      default:
        return frequency
    }
  }

  const getRepeatSummary = (task: any) => {
    if (!task.recur_rule_id) return null

    const frequency = rules.find((rule) => rule.id === task.recur_rule_id)?.frequency
    switch (frequency) {
      case 'daily':
        return t('tasks.repeat_summary_daily')
      case 'weekday':
        return t('tasks.repeat_summary_weekday')
      case 'weekly':
        return t('tasks.repeat_summary_weekly')
      case 'monthly':
        return t('tasks.repeat_summary_monthly')
      default:
        return t('tasks.repeat_summary_source')
    }
  }

  const runDueTaskGeneration = async () => {
    if (api?.runTaskScheduler) {
      await api.runTaskScheduler()
    }
  }

  const handleStartFirstTask = () => {
    setTaskTab('list')
    openCreateDrawer()
  }

  const handleMoveTaskStatus = async (task: any, nextStatus: string) => {
    if (!api || !task || task.status === nextStatus) return

    const nextCompleted = nextStatus === '已关闭' ? 1 : 0
    const nextProgress = nextCompleted ? 100 : task.progress === 100 ? 0 : task.progress || 0
    const res = await api.dbQuery(
      'tasks',
      'UPDATE tasks SET status = ?, is_completed = ?, progress = ? WHERE id = ?',
      [nextStatus, nextCompleted, nextProgress, task.id],
    )

    if (res?.success) {
      showToast(
        t('tasks.toast_task_moved', {
          status: getStatusLabel(nextStatus),
        }),
      )
      await loadData()
    }
  }

  const loadData = async () => {
    if (api) {
      // Load Tasks
      const res = await api.dbQuery(
        'tasks',
        'SELECT * FROM tasks ORDER BY COALESCE(due_date, created_at) ASC, id ASC',
      )
      if (res?.success) {
        setTasks(res.data)
        if (res.data.length > 0 && selectedTaskId === null) {
          setSelectedTaskId(res.data[0].id)
          setEditDesc(res.data[0].description || '')
          setEditProgress(res.data[0].progress || 0)
        }
      }

      // Load translations
      const transRes = await api.dbQuery(
        'tasks',
        "SELECT * FROM translations WHERE entity_type = 'task_status'",
      )
      if (transRes?.success) {
        setTranslations(transRes.data)
      }

      // Load Recurring Rules
      const rulesRes = await api.dbQuery(
        'tasks',
        'SELECT * FROM recurring_rules ORDER BY COALESCE(start_date, created_at) ASC, start_time ASC, id ASC',
      )
      if (rulesRes?.success) {
        setRules(rulesRes.data)
        if (rulesRes.data.length > 0 && selectedRuleId === null) {
          selectRule(rulesRes.data[0])
        }
      }
    }
  }

  useEffect(() => {
    loadData()
  }, [userId, taskTab])

  useEffect(() => {
    return api?.onTaskSchedulerChanged?.(() => {
      void loadData()
    })
  }, [api, userId])

  const refreshTaskData = async () => {
    if (!api || isRefreshing) return

    setIsRefreshing(true)
    try {
      await api.runTaskScheduler?.()
      await loadData()
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshTaskData()
    }

    const timer = window.setInterval(refreshWhenVisible, 60_000)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [api, userId, taskTab, isRefreshing])

  // Select a rule and map to inputs
  const selectRule = (rule: any) => {
    setSelectedRuleId(rule.id)
    setRuleName(rule.title)
    setRuleDesc(rule.description || '')
    setRuleFreq(rule.frequency)
    setRuleInterval(rule.interval || 1)
    setRuleStartDate(getTemplateStartDateKey(rule))
    setRuleTime(getTemplateStartTime(rule))
    setRuleTimes(getTemplateTimes(rule))
    setRulePriority(rule.priority || 'mid')
    setRuleWeekDays(
      (rule.week_days || '')
        .split(',')
        .filter(Boolean)
        .map((x: string) => parseInt(x)),
    )
    setRuleMonthDays(
      (rule.month_days || '')
        .split(',')
        .filter(Boolean)
        .map((x: string) => parseInt(x)),
    )
    setRuleCron(rule.cron || '')
    setRuleHolidayPolicy(rule.missed_policy || 'skip')
  }

  // Task checkmark click toggle
  const toggleTaskDone = async (task: any) => {
    if (!api) return
    const nextDone = task.is_completed === 1 ? 0 : 1
    const nextStatus = nextDone ? '已关闭' : '待处理'

    // Update self
    await api.dbQuery(
      'tasks',
      'UPDATE tasks SET is_completed = ?, status = ?, progress = ? WHERE id = ?',
      [nextDone, nextStatus, nextDone ? 100 : 0, task.id],
    )

    // If task is completed and has children, ask or auto-close children
    if (nextDone) {
      await api.dbQuery(
        'tasks',
        `
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM tasks WHERE parent_id = ?
            UNION ALL
            SELECT tasks.id FROM tasks
            INNER JOIN descendants ON tasks.parent_id = descendants.id
          )
          UPDATE tasks SET is_completed = 1, status = ?, progress = 100
          WHERE id IN (SELECT id FROM descendants)
        `,
        [task.id, '已关闭'],
      )
    }

    showToast(nextDone ? t('tasks.toast_completed') : t('tasks.toast_reopened'))
    loadData()
  }

  const requestTaskCompletionToggle = (task: any, trigger: HTMLButtonElement) => {
    completionTriggerRef.current = trigger
    setCompletionConfirmationTask(task)
  }

  const confirmTaskCompletionToggle = async () => {
    if (!completionConfirmationTask || isCompletionConfirming) return

    setIsCompletionConfirming(true)
    try {
      await toggleTaskDone(completionConfirmationTask)
      setCompletionConfirmationTask(null)
    } finally {
      setIsCompletionConfirming(false)
    }
  }

  const getCompletionConfirmationCopy = (task: any) => {
    const hasSubtasks = tasks.some((candidate) => candidate.parent_id === task.id)
    if (task.is_completed === 1) {
      return {
        title: t('tasks.confirm_reopen_title'),
        description: t('tasks.confirm_reopen_description', { title: task.title }),
        action: t('tasks.confirm_reopen_action'),
      }
    }

    if (task.status === '已逾期') {
      return {
        title: t('tasks.confirm_close_overdue_title'),
        description: hasSubtasks
          ? t('tasks.confirm_close_overdue_with_subtasks_description', { title: task.title })
          : t('tasks.confirm_close_overdue_description', { title: task.title }),
        action: t('tasks.confirm_close_overdue_action'),
      }
    }

    return {
      title: t('tasks.confirm_complete_title'),
      description: hasSubtasks
        ? t('tasks.confirm_complete_with_subtasks_description', { title: task.title })
        : t('tasks.confirm_complete_description', { title: task.title }),
      action: t('tasks.confirm_complete_action'),
    }
  }

  const renderSubtaskRows = (
    parentId: number,
    depth = 1,
    visited = new Set<number>(),
  ): React.ReactNode[] =>
    tasks
      .filter((candidate) => candidate.parent_id === parentId && !visited.has(candidate.id))
      .flatMap((child) => {
        const nextVisited = new Set(visited)
        nextVisited.add(child.id)
        const isChildOverdue = child.status === '已逾期'
        return [
          <div
            key={child.id}
            className={`task-row task-row--child ${selectedTaskId === child.id ? 'is-selected' : ''} ${
              child.is_completed === 1 ? 'is-completed' : ''
            }`}
            style={{ paddingLeft: `${30 + (depth - 1) * 18}px` }}
            role="button"
            tabIndex={0}
            aria-label={child.title}
            onClick={() => selectTaskForDetails(child)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                selectTaskForDetails(child)
              }
            }}
          >
            <button
              type="button"
              title={
                child.is_completed === 1
                  ? t('tasks.reopen_task_action')
                  : isChildOverdue
                    ? t('tasks.close_overdue_task_action')
                    : t('tasks.complete_task_action')
              }
              aria-label={
                child.is_completed === 1
                  ? t('tasks.reopen_task_action')
                  : isChildOverdue
                    ? t('tasks.close_overdue_task_action')
                    : t('tasks.complete_task_action')
              }
              onClick={(e) => {
                e.stopPropagation()
                requestTaskCompletionToggle(child, e.currentTarget)
              }}
              className="task-row__check"
            >
              {child.is_completed === 1 ? (
                <Check size={14} color="var(--color-success)" />
              ) : isChildOverdue ? (
                <X size={14} color="var(--color-danger)" />
              ) : (
                <Circle size={14} color="var(--text-muted)" />
              )}
            </button>
            <span className={`task-row__date ${child.status === '已逾期' ? 'is-overdue-date' : ''}`}>
              <span
                className={`task-row__priority is-${child.priority}`}
                role="img"
                aria-label={getPriorityLabel(child.priority)}
                title={getPriorityLabel(child.priority)}
              >
                <Flag size={13} aria-hidden="true" />
              </span>
              <span className="task-row__date-content">
                {child.status === '已逾期' && <strong>{t('common.overdue')}</strong>}
                <time>{formatDue(child)}</time>
              </span>
            </span>
            <span className="task-row__title">{child.title}</span>
          </div>,
          ...renderSubtaskRows(child.id, depth + 1, nextVisited),
        ]
      })

  const toggleTaskGroup = (taskId: number) => {
    setExpandedTaskGroupId((current) => (current === taskId ? null : taskId))
  }

  const handleSaveDrawer = async () => {
    if (!api || !taskDraft.title.trim()) return

    if (drawerMode === 'create') {
      const effectiveFrequency = taskDraft.repeat === 'none' ? 'custom' : ruleFreq
      const effectiveTimes = ruleTimes
      const res = await api.dbQuery(
        'tasks',
        `INSERT INTO recurring_rules (title, description, frequency, interval, week_days, month_days, start_date, start_time, time_slots, priority, end_condition, missed_policy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [taskDraft.title.trim(), taskDraft.description, effectiveFrequency, ruleInterval,
          ruleWeekDays.join(','), ruleMonthDays.join(','), ruleStartDate, effectiveTimes[0], effectiveTimes.join(','),
          rulePriority, effectiveFrequency === 'custom' ? 'count:1' : 'never', ruleHolidayPolicy],
      )
      if (res?.success) {
        await runDueTaskGeneration()
        showToast(t('tasks.toast_task_added'))
      }

      const skippedRes = await api.dbQuery(
        'tasks',
        'SELECT recur_rule_id, instance_key FROM recurring_rule_occurrence_exceptions',
      )
      if (skippedRes?.success) {
        setSkippedOccurrences(
          new Set(skippedRes.data.map((item: any) => `${item.recur_rule_id}:${item.instance_key}`)),
        )
      }
    } else if (activeTask) {
      const isChangingToNonRecurring = Boolean(activeTask.recur_rule_id && taskDraft.repeat === 'none')
      const isChangingToRecurring = Boolean(!activeTask.recur_rule_id && taskDraft.repeat !== 'none')

      if (isChangingToNonRecurring && activeTask.recur_rule_id && activeTask.instance_key) {
        await api.dbQuery(
          'tasks',
          'INSERT OR IGNORE INTO recurring_rule_occurrence_exceptions (recur_rule_id, instance_key) VALUES (?, ?)',
          [activeTask.recur_rule_id, activeTask.instance_key],
        )
      }

      await api.dbQuery(
        'tasks',
        `UPDATE tasks
         SET title = ?, description = ?, priority = ?, due_date = ?, due_time = ?,
             recur_rule_id = CASE WHEN ? THEN NULL ELSE recur_rule_id END,
             template_id = CASE WHEN ? THEN NULL ELSE template_id END,
             template_version = CASE WHEN ? THEN NULL ELSE template_version END,
             instance_key = CASE WHEN ? THEN NULL ELSE instance_key END
         WHERE id = ?`,
        [
          taskDraft.title.trim(),
          taskDraft.description,
          taskDraft.priority,
          taskDraft.dueDate,
          normalizeTaskDueTime(taskDraft.time),
          isChangingToNonRecurring ? 1 : 0,
          isChangingToNonRecurring ? 1 : 0,
          isChangingToNonRecurring ? 1 : 0,
          isChangingToNonRecurring ? 1 : 0,
          activeTask.id,
        ],
      )

      if (isChangingToRecurring) {
        const effectiveTimes = ruleTimes
        const ruleResult = await api.dbQuery(
          'tasks',
          `INSERT INTO recurring_rules
           (title, description, frequency, interval, week_days, month_days, start_date, start_time, time_slots, priority, end_condition, missed_policy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            taskDraft.title.trim(),
            taskDraft.description,
            ruleFreq,
            ruleInterval,
            ruleWeekDays.join(','),
            ruleMonthDays.join(','),
            ruleStartDate,
            effectiveTimes[0],
            effectiveTimes.join(','),
            rulePriority,
            'never',
            ruleHolidayPolicy,
          ],
        )
        const ruleId = ruleResult?.data?.lastInsertRowid || ruleResult?.data?.insertId
        if (ruleId) {
          await api.dbQuery(
            'tasks',
            'UPDATE tasks SET recur_rule_id = ?, instance_key = ? WHERE id = ?',
            [ruleId, `${taskDraft.dueDate}T${normalizeScheduleTime(effectiveTimes[0])}`, activeTask.id],
          )
        }
      } else if (activeTask.recur_rule_id && !isChangingToNonRecurring && editRuleScope !== 'single') {
        await api.dbQuery(
          'tasks',
          'UPDATE recurring_rules SET title = ?, description = ?, frequency = ?, interval = ?, week_days = ?, month_days = ?, start_date = ?, start_time = ?, time_slots = ?, priority = ?, missed_policy = ? WHERE id = ?',
          [taskDraft.title.trim(), taskDraft.description, ruleFreq, ruleInterval, ruleWeekDays.join(','), ruleMonthDays.join(','), ruleStartDate, ruleTimes[0], ruleTimes.join(','), rulePriority, ruleHolidayPolicy, activeTask.recur_rule_id],
        )
      }
      showToast(t('tasks.toast_details_updated'))
    }

    setDrawerMode(null)
    await loadData()
  }

  const isRecurringRootTask = (task: any) =>
    Boolean(task?.recur_rule_id && task.instance_key && !task.parent_id)

  const deleteTaskTree = async (taskId: number) => {
    if (!api) return
    await api.dbQuery(
      'tasks',
      `
        WITH RECURSIVE task_tree(id) AS (
          SELECT id FROM tasks WHERE id = ?
          UNION ALL
          SELECT tasks.id FROM tasks
          INNER JOIN task_tree ON tasks.parent_id = task_tree.id
        )
        DELETE FROM tasks WHERE id IN (SELECT id FROM task_tree)
      `,
      [taskId],
    )
  }

  const deleteUnfinishedRecurringTaskTrees = async (
    ruleId: number,
    afterOccurrence?: { due_date?: string | null; instance_key?: string | null },
  ) => {
    if (!api) return

    const result = afterOccurrence?.due_date
      ? await api.dbQuery(
          'tasks',
          `
            SELECT id FROM tasks
            WHERE recur_rule_id = ?
              AND parent_id IS NULL
              AND is_completed = 0
              AND (due_date > ? OR (due_date = ? AND instance_key > ?))
          `,
          [ruleId, afterOccurrence.due_date, afterOccurrence.due_date, afterOccurrence.instance_key || ''],
        )
      : await api.dbQuery(
          'tasks',
          'SELECT id FROM tasks WHERE recur_rule_id = ? AND parent_id IS NULL AND is_completed = 0',
          [ruleId],
        )

    for (const task of result?.data ?? []) {
      await deleteTaskTree(task.id)
    }
  }

  const deleteRecurringRule = async (ruleId: number) => {
    if (!api) return
    await api.dbQuery('tasks', 'DELETE FROM recurring_rule_steps WHERE rule_id = ?', [ruleId])
    await api.dbQuery('tasks', 'DELETE FROM recurring_rule_occurrence_exceptions WHERE recur_rule_id = ?', [ruleId])
    await api.dbQuery('tasks', 'DELETE FROM recurring_rules WHERE id = ?', [ruleId])
  }

  const openTaskDeletionConfirmation = (task: any, trigger: HTMLButtonElement) => {
    deletionTriggerRef.current = trigger
    setDeletionScope('single')
    setDeletionConfirmationTask(task)
  }

  const confirmTaskDeletion = async () => {
    if (!api || !deletionConfirmationTask || isDeletingTask) return

    const task = deletionConfirmationTask
    const canManageRepeat = isRecurringRootTask(task)
    setIsDeletingTask(true)
    try {
      if (canManageRepeat && deletionScope !== 'delete-repeat') {
        await api.dbQuery(
          'tasks',
          'INSERT OR IGNORE INTO recurring_rule_occurrence_exceptions (recur_rule_id, instance_key) VALUES (?, ?)',
          [task.recur_rule_id, task.instance_key],
        )
      }

      await deleteTaskTree(task.id)

      if (canManageRepeat && deletionScope === 'end-repeat') {
        await deleteUnfinishedRecurringTaskTrees(task.recur_rule_id, task)
        await deleteRecurringRule(task.recur_rule_id)
        showToast(t('tasks.toast_repeat_ended'))
      } else if (canManageRepeat && deletionScope === 'delete-repeat') {
        await deleteUnfinishedRecurringTaskTrees(task.recur_rule_id)
        await deleteRecurringRule(task.recur_rule_id)
        showToast(t('tasks.toast_repeat_deleted'))
      } else {
        showToast(t('tasks.toast_task_deleted'))
      }

      setExpandedTaskGroupId(null)
      setSelectedTaskId(null)
      setDrawerMode(null)
      setDeletionConfirmationTask(null)
      await loadData()
    } finally {
      setIsDeletingTask(false)
    }
  }

  // Save Task Detail modifications
  const handleSaveDetails = async () => {
    if (!selectedTaskId || !api) return

    // If progress is changed to 100, mark as completed
    const isCompleted = editProgress === 100 ? 1 : 0
    const status = isCompleted ? '已关闭' : '进行中'

    const query = `
      UPDATE tasks 
      SET description = ?, progress = ?, is_completed = ?, status = ?
      WHERE id = ?
    `
    const res = await api.dbQuery('tasks', query, [
      editDesc,
      editProgress,
      isCompleted,
      status,
      selectedTaskId,
    ])
    if (res?.success) {
      showToast(t('tasks.toast_details_updated'))
      loadData()
    }
  }

  // Save / Create Recurring Rule
  const handleSaveRule = async () => {
    if (!api) return

    if (ruleFreq === 'cron') {
      showToast(t('tasks.legacy_cron_save_blocked'))
      return
    }

    const weekDaysStr = ruleWeekDays.join(',')
    const monthDaysStr = ruleMonthDays.join(',')
    const timeSlots = ruleTimes.length > 0 ? ruleTimes : [ruleTime]
    const primaryTime = timeSlots[0] || '09:00'
    const timeSlotsStr = timeSlots.join(',')

    if (selectedRuleId) {
      // Update
      const query = `
        UPDATE recurring_rules 
        SET title = ?, description = ?, frequency = ?, interval = ?, week_days = ?, month_days = ?, cron = ?, start_date = ?, start_time = ?, time_slots = ?, priority = ?, missed_policy = ?
        WHERE id = ?
      `
      await api.dbQuery('tasks', query, [
        ruleName,
        ruleDesc,
        ruleFreq,
        ruleInterval,
        weekDaysStr,
        monthDaysStr,
        ruleCron,
        ruleStartDate,
        primaryTime,
        timeSlotsStr,
        rulePriority,
        ruleHolidayPolicy,
        selectedRuleId,
      ])
      showToast(t('tasks.toast_rule_modified'))
    } else {
      // Create new
      const query = `
        INSERT INTO recurring_rules (
          title, description, frequency, interval, week_days, month_days, cron, start_date, start_time, time_slots, priority, missed_policy
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      await api.dbQuery('tasks', query, [
        ruleName,
        ruleDesc,
        ruleFreq,
        ruleInterval,
        weekDaysStr,
        monthDaysStr,
        ruleCron,
        ruleStartDate,
        primaryTime,
        timeSlotsStr,
        rulePriority,
        ruleHolidayPolicy,
      ])
      showToast(t('tasks.toast_rule_created'))
    }
    await runDueTaskGeneration()
    loadData()
  }

  const handleNewRule = () => {
    setSelectedRuleId(null)
    setRuleName(t('tasks.rule_new_name'))
    setRuleDesc('')
    setRuleFreq('daily')
    setRuleInterval(1)
    setRuleStartDate(toLocalDateKey(new Date()))
    setRuleTime('09:00')
    setRuleTimes(['09:00'])
    setRulePriority('mid')
    setRuleWeekDays([])
    setRuleMonthDays([])
    setRuleCron('')
  }

  const handleDeleteRule = async (id: number) => {
    if (!api) return
    if (
      !(await confirm({
        title: t('tasks.delete_task'),
        description: t('tasks.prompt_delete_rule_confirm'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    await api.dbQuery('tasks', 'DELETE FROM recurring_rule_steps WHERE rule_id = ?', [id])
    await api.dbQuery('tasks', 'DELETE FROM recurring_rules WHERE id = ?', [id])
    setSelectedRuleId(null)
    showToast(t('tasks.toast_rule_deleted'))
    loadData()
  }

  const openTemplateEditor = (template?: any) => {
    setTemplateEditor(template
      ? {
          id: template.id,
          templateKey: template.templateKey,
          title: template.title,
          description: template.description || '',
          icon: template.icon || '🧩',
          subtasksText: (template.subtasks || []).join('\n'),
        }
      : { id: null, templateKey: '', title: '', description: '', icon: '🧩', subtasksText: '' })
  }

  const handleSaveTemplate = async () => {
    if (!api?.dbQuery || !templateEditor?.title.trim()) return
    const steps = templateEditor.subtasksText
      .split('\n')
      .map((step: string) => step.trim())
      .filter(Boolean)
    const templateKey = templateEditor.templateKey || `custom-${Date.now()}`
    if (templateEditor.id) {
      const current = templates.find((template) => template.id === templateEditor.id)
      const version = Number(current?.version || 1) + 1
      await api.dbQuery(
        'tasks',
        `UPDATE task_templates SET title = ?, description = ?, icon = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [templateEditor.title.trim(), templateEditor.description, templateEditor.icon, version, templateEditor.id],
      )
      await api.dbQuery('tasks', 'DELETE FROM task_template_steps WHERE template_id = ?', [templateEditor.id])
      for (const [index, step] of steps.entries()) {
        await api.dbQuery(
          'tasks',
          `INSERT INTO task_template_steps (template_id, title, description, priority, sort_order) VALUES (?, ?, '', 'mid', ?)`,
          [templateEditor.id, step, index + 1],
        )
      }
      setTemplates((currentTemplates) => currentTemplates.map((template) => template.id === templateEditor.id
        ? { ...template, title: templateEditor.title.trim(), description: templateEditor.description, icon: templateEditor.icon, version, subtasks: steps, tags: [t('tasks.template_version_label', { version })] }
        : template))
    } else {
      const result = await api.dbQuery(
        'tasks',
        `INSERT INTO task_templates (template_key, title, description, icon, version) VALUES (?, ?, ?, ?, 1)`,
        [templateKey, templateEditor.title.trim(), templateEditor.description, templateEditor.icon],
      )
      const id = result?.data?.lastInsertRowid || result?.data?.insertId
      if (id) {
        for (const [index, step] of steps.entries()) {
          await api.dbQuery(
            'tasks',
            `INSERT INTO task_template_steps (template_id, title, description, priority, sort_order) VALUES (?, ?, '', 'mid', ?)`,
            [id, step, index + 1],
          )
        }
        setTemplates((currentTemplates) => [{ id, templateKey, title: templateEditor.title.trim(), description: templateEditor.description, icon: templateEditor.icon, version: 1, subtasks: steps, tags: [t('tasks.template_version_label', { version: 1 })] }, ...currentTemplates])
      }
    }
    setTemplateEditor(null)
    showToast(t('tasks.toast_template_saved'))
  }

  const handleDeleteTemplate = async (template: any) => {
    if (!api?.dbQuery || !template.id || String(template.templateKey || '').startsWith('builtin-')) return
    if (!(await confirm({ title: t('tasks.delete_template_title'), description: t('tasks.delete_template_description'), confirmLabel: t('common.delete'), tone: 'danger' }))) return
    await api.dbQuery('tasks', 'DELETE FROM task_template_steps WHERE template_id = ?', [template.id])
    await api.dbQuery('tasks', 'DELETE FROM task_templates WHERE id = ?', [template.id])
    setTemplates((currentTemplates) => currentTemplates.filter((item) => item.id !== template.id))
    showToast(t('tasks.toast_template_deleted'))
  }

  const handleUseTemplate = async (template: any) => {
    if (!api) return
    const todayYMD = toLocalDateKey(new Date())
    const startTime = getCurrentTimeValue()

    const templateKey = template.templateKey || `builtin-${template.id}`
    let templateId: number | null
    const existingTemplate = await api.dbQuery(
      'tasks',
      'SELECT id, version FROM task_templates WHERE template_key = ? LIMIT 1',
      [templateKey],
    )
    let templateVersion = Number(template.version || 1)
    if (existingTemplate?.data?.[0]) {
      templateId = existingTemplate.data[0].id
      templateVersion = Number(existingTemplate.data[0].version || templateVersion)
    } else {
      const createdTemplate = await api.dbQuery(
        'tasks',
        `INSERT INTO task_templates (template_key, title, description, icon, version)
         VALUES (?, ?, ?, ?, 1)`,
        [templateKey, template.title, t('tasks.template_created_desc'), template.icon || null],
      )
      templateId = createdTemplate?.data?.lastInsertRowid || createdTemplate?.data?.insertId || null
      if (templateId) {
        for (const [index, sub] of template.subtasks.entries()) {
          await api.dbQuery(
            'tasks',
            `INSERT INTO task_template_steps (template_id, title, description, priority, sort_order)
             VALUES (?, ?, '', 'mid', ?)`,
            [templateId, sub, index + 1],
          )
        }
      }
    }

    const templateRes = await api.dbQuery(
      'tasks',
      `
      INSERT INTO recurring_rules (
        title, description, frequency, interval, start_date, start_time, time_slots, template_id, template_version, priority, end_condition, missed_policy
      )
      VALUES (?, ?, 'custom', 1, ?, ?, ?, ?, ?, 'mid', 'count:1', 'skip')
    `,
      [template.title, t('tasks.template_created_desc'), todayYMD, startTime, startTime, templateId, templateVersion],
    )

    if (templateRes?.success) {
      const ruleId = templateRes.data.lastInsertRowid || templateRes.data.insertId
      for (const [index, sub] of template.subtasks.entries()) {
        await api.dbQuery(
          'tasks',
          `
          INSERT INTO recurring_rule_steps (rule_id, title, description, priority, sort_order)
          VALUES (?, ?, '', 'mid', ?)
        `,
          [ruleId, sub, index + 1],
        )
      }
      await runDueTaskGeneration()
      showToast(t('tasks.toast_template_imported'))
      setTaskTab('list')
      loadData()
    }
  }

  const activeTask = tasks.find((t) => t.id === selectedTaskId)
  const activeTaskTemplate = activeTask?.recur_rule_id
    ? rules.find((rule) => rule.id === activeTask.recur_rule_id)
    : null
  const activeTaskRule = activeTaskTemplate
  const todayKey = toLocalDateKey(new Date())
  const todayProjectedTasks = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setHours(23, 59, 59, 999)
    return projectCalendarOccurrences(tasks, rules, start, end, skippedOccurrences)
  }, [rules, skippedOccurrences, tasks])
  const executionTasks = useMemo(
    () => [
      ...tasks.filter((task) => !task.due_date || task.due_date <= todayKey),
      ...todayProjectedTasks.filter((task) => task.is_virtual),
    ],
    [tasks, todayKey, todayProjectedTasks],
  )
  const rootTasks = useMemo(
    () => executionTasks.filter((task) => !task.parent_id),
    [executionTasks],
  )
  const displayRootTasks = useMemo(() => {
    const seen = new Set<string>()
    return rootTasks.filter((task) => {
      if (!task.recur_rule_id || !task.due_date) return true
      const key = `${task.recur_rule_id}:${task.due_date}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [rootTasks])
  const expandedTaskGroup =
    expandedTaskGroupId === null
      ? null
      : displayRootTasks.find((task) => task.id === expandedTaskGroupId) ?? null
  const completionConfirmationCopy = completionConfirmationTask
    ? getCompletionConfirmationCopy(completionConfirmationTask)
    : null
  const openTaskCount = tasks.filter(
    (task) => task.is_completed !== 1 && task.status !== '已关闭',
  ).length
  const todayTaskCount = executionTasks.filter((task) => task.due_date === todayKey).length
  const overdueTaskCount = tasks.filter((task) => task.status === '已逾期').length
  const selectedRule = selectedRuleId
    ? rules.find((rule) => rule.id === selectedRuleId)
    : null
  const rulePreviewOccurrences = useMemo(
    () =>
      getNextTemplateOccurrences(
        {
          id: selectedRuleId || 0,
          title: ruleName,
          description: ruleDesc,
          frequency: ruleFreq,
          interval: ruleInterval,
          week_days: ruleWeekDays.join(','),
          month_days: ruleMonthDays.join(','),
          cron: ruleCron,
          start_date: ruleStartDate,
          start_time: ruleTime,
          time_slots: ruleTimes.join(','),
        },
        new Date(),
        5,
      ),
    [
      selectedRuleId,
      ruleName,
      ruleDesc,
      ruleFreq,
      ruleInterval,
      ruleWeekDays,
      ruleMonthDays,
      ruleCron,
      ruleStartDate,
      ruleTime,
      ruleTimes,
    ],
  )

  return (
    <div className="task-page">
      <header className="task-header">
        <div className="task-header__copy">
          <span className="task-header__eyebrow">{t('tasks.workspace_label')}</span>
          <h1>{t('tasks.title')}</h1>
          <p>{t('tasks.subtitle')}</p>
        </div>
        <div className="task-header__stats" aria-label={t('tasks.overview_label')}>
          <div className="task-stat">
            <ListTodo aria-hidden="true" />
            <span>{t('tasks.stat_open')}</span>
            <strong>{openTaskCount}</strong>
          </div>
          <div className="task-stat">
            <CalendarDays aria-hidden="true" />
            <span>{t('tasks.stat_today')}</span>
            <strong>{todayTaskCount}</strong>
          </div>
          <div className={`task-stat ${overdueTaskCount > 0 ? 'is-warning' : ''}`}>
            <AlertTriangle aria-hidden="true" />
            <span>{t('tasks.stat_overdue')}</span>
            <strong>{overdueTaskCount}</strong>
          </div>
        </div>
        <button
          type="button"
          className={`btn sm task-header__refresh ${isRefreshing ? 'is-refreshing' : ''}`}
          onClick={() => void refreshTaskData()}
          disabled={isRefreshing}
          aria-label={t('tasks.refresh')}
          title={t('tasks.refresh')}
        >
          <RefreshCw size={15} aria-hidden="true" />
          <span>{t('tasks.refresh')}</span>
        </button>
      </header>

      <nav className="task-navigation" aria-label={t('tasks.navigation_label')}>
        <div
          className="task-navigation__views"
          role="group"
          aria-label={t('tasks.view_modes_label')}
        >
          <button
            type="button"
            className={`task-navigation__view ${taskTab === 'list' ? 'active' : ''}`}
            aria-pressed={taskTab === 'list'}
            onClick={() => setTaskTab('list')}
          >
            <ListChecks aria-hidden="true" />
            <span>{t('tasks.tab_list')}</span>
          </button>
          <button
            type="button"
            className={`task-navigation__view ${taskTab === 'kanban' ? 'active' : ''}`}
            aria-pressed={taskTab === 'kanban'}
            onClick={() => setTaskTab('kanban')}
          >
            <Kanban aria-hidden="true" />
            <span>{t('tasks.tab_kanban')}</span>
          </button>
          <button
            type="button"
            className={`task-navigation__view ${taskTab === 'calendar' ? 'active' : ''}`}
            aria-pressed={taskTab === 'calendar'}
            onClick={() => setTaskTab('calendar')}
          >
            <CalendarDays aria-hidden="true" />
            <span>{t('tasks.tab_calendar')}</span>
          </button>
        </div>

      </nav>

      <div className="task-content">
        {/* TAB: KANBAN BOARD */}
        {taskTab === 'kanban' &&
          (tasks.length === 0 ? (
            <section className="task-board-empty" aria-labelledby="task-board-empty-title">
              <div className="task-board-empty__icon" aria-hidden="true">
                <ListTodo />
              </div>
              <h2 id="task-board-empty-title">{t('tasks.board_empty_title')}</h2>
              <p>{t('tasks.board_empty_description')}</p>
              <button type="button" className="btn primary" onClick={handleStartFirstTask}>
                <Plus size={16} aria-hidden="true" />
                {t('tasks.board_empty_action')}
              </button>
            </section>
          ) : (
            <div
              className="task-board-grid"
              style={{
                display: 'grid',
                gap: '12px',
                height: '100%',
              }}
            >
              {boardLanes.map((lane) => {
                const laneTasks = executionTasks.filter(
                  (t) =>
                    t.status === lane.dbVal ||
                    (lane.dbVal === '待处理' && t.status === '已逾期'),
                )
                const isDragTarget = dragOverStatus === lane.dbVal
                return (
                  <div
                    key={lane.key}
                    data-kanban-status={lane.dbVal}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDragOverStatus(lane.dbVal)
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverStatus(null)
                      }
                    }}
                    onDrop={async (event) => {
                      event.preventDefault()
                      setDragOverStatus(null)
                      const taskId = Number(event.dataTransfer.getData('text/plain'))
                      const task = tasks.find((candidate) => candidate.id === taskId)
                      await handleMoveTaskStatus(task, lane.dbVal)
                    }}
                    style={{
                      backgroundColor: isDragTarget
                        ? 'rgba(59, 130, 246, 0.08)'
                        : 'var(--bg-sidebar)',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      minHeight: '400px',
                      border: isDragTarget
                        ? '1px solid var(--color-accent)'
                        : '1px solid transparent',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 'bold',
                        fontSize: '13px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span>{getStatusLabel(lane.dbVal)}</span>
                      <span className="pill">{laneTasks.length}</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        flexGrow: 1,
                        overflowY: 'auto',
                      }}
                    >
                      {laneTasks.map((task) => (
                        <div
                          key={task.id}
                          className="card"
                          data-task-id={task.id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', String(task.id))
                          }}
                          onDragEnd={() => setDragOverStatus(null)}
                          style={{
                            padding: '12px',
                            cursor: 'grab',
                            borderColor:
                              task.status === '已逾期'
                                ? 'var(--color-danger)'
                                : 'var(--color-border)',
                            boxShadow:
                              task.status === '已逾期'
                                ? '0 0 4px rgba(239, 68, 68, 0.15)'
                                : 'var(--shadow-app)',
                          }}
                          onClick={() => {
                            void openCalendarTask(task)
                          }}
                        >
                          <h4
                            style={{
                              fontSize: '12.5px',
                              fontWeight: 600,
                              color: 'var(--text-main)',
                            }}
                          >
                            {task.status === '已逾期' && (
                              <span style={{ color: 'var(--color-danger)', marginRight: '4px' }}>
                                [{t('common.overdue')}]
                              </span>
                            )}
                            {task.title}
                          </h4>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginTop: '12px',
                            }}
                          >
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              {formatDue(task)}
                            </span>
                            <span
                              className={`pill ${task.priority === 'high' ? 'red' : task.priority === 'mid' ? 'yellow' : 'green'}`}
                              style={{ fontSize: '9px', transform: 'scale(0.85)' }}
                            >
                              {getPriorityLabel(task.priority)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

        {/* TAB: LIST & DETAIL PANEL */}
        {taskTab === 'list' && (
          <div className="task-list-layout">
            {/* Left list tree */}
            <section className="task-panel task-panel--list">
              <div className="task-panel__header">
                <div className="task-panel__header--row">
                  <div>
                  <strong>{t('tasks.instance_panel_title')}</strong>
                  <p>{t('tasks.instance_panel_desc')}</p>
                  </div>
                </div>
              </div>

              {/* Task rows */}
              <div className="task-list">
                {rootTasks.length === 0 ? (
                  <div className="task-list-empty">
                    <ListTodo aria-hidden="true" />
                    <strong>{t('tasks.board_empty_title')}</strong>
                    <p>{t('tasks.board_empty_description')}</p>
                  </div>
                ) : (
                  displayRootTasks.map((task) => {
                    const isSelected = selectedTaskId === task.id
                    const isOverdue = task.status === '已逾期'
                    const directSubtasks = tasks.filter((candidate) => candidate.parent_id === task.id)
                    const completedSubtaskCount = directSubtasks.filter(
                      (subtask) => subtask.is_completed === 1,
                    ).length
                    const isTaskGroupExpanded = expandedTaskGroup?.id === task.id
                    const repeatSummary = getRepeatSummary(task)
                    const sameDayOccurrences = task.recur_rule_id
                      ? rootTasks.filter(
                          (candidate) =>
                            candidate.recur_rule_id === task.recur_rule_id &&
                            candidate.due_date === task.due_date,
                        )
                      : []
                    const completedOccurrenceCount = sameDayOccurrences.filter(
                      (candidate) => candidate.is_completed === 1,
                    ).length
                    const occurrenceGroupKey = task.recur_rule_id && task.due_date
                      ? `${task.recur_rule_id}:${task.due_date}`
                      : null
                    const isOccurrenceGroupExpanded = occurrenceGroupKey !== null && expandedOccurrenceGroupKey === occurrenceGroupKey

                    return (
                      <div
                        key={task.id}
                        className={`task-row-group ${isTaskGroupExpanded ? 'is-expanded' : ''}`}
                      >
                        <div
                          className={`task-row ${isSelected ? 'is-selected' : ''} ${isOverdue ? 'is-overdue' : ''} ${
                            task.is_completed === 1 ? 'is-completed' : ''
                          }`}
                          role="button"
                          tabIndex={0}
                          aria-label={task.title}
                          onClick={() => void openCalendarTask(task)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void openCalendarTask(task)
                            }
                          }}
                        >
                          <button
                            type="button"
                            title={
                              task.is_completed === 1
                                ? t('tasks.reopen_task_action')
                                : isOverdue
                                  ? t('tasks.close_overdue_task_action')
                                  : t('tasks.complete_task_action')
                            }
                            aria-label={
                              task.is_completed === 1
                                ? t('tasks.reopen_task_action')
                                : isOverdue
                                  ? t('tasks.close_overdue_task_action')
                                  : t('tasks.complete_task_action')
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              if (task.is_virtual) {
                                void openCalendarTask(task)
                                return
                              }
                              requestTaskCompletionToggle(task, e.currentTarget)
                            }}
                            className="task-row__check"
                          >
                            {task.is_completed === 1 ? (
                              <Check size={16} color="var(--color-success)" />
                            ) : isOverdue ? (
                              <X size={16} color="var(--color-danger)" />
                            ) : (
                              <Circle
                                size={16}
                                color={isOverdue ? 'var(--color-danger)' : 'var(--text-muted)'}
                              />
                            )}
                          </button>
                          <div className="task-row__main">
                            <span className="task-row__title">{task.title}</span>
                            <span className="task-row__meta">
                              {getStatusLabel(task.status)}
                              {repeatSummary ? ` · ${repeatSummary}` : ''}
                              {sameDayOccurrences.length > 1
                                ? ` · ${t('tasks.multi_occurrence_progress', {
                                    completed: completedOccurrenceCount,
                                    total: sameDayOccurrences.length,
                                  })}`
                                : ''}
                            </span>
                            {task.progress > 0 && task.progress < 100 && (
                              <div className="task-row__progress">
                                <div style={{ width: `${task.progress}%` }} />
                              </div>
                            )}
                          </div>
                          <div className="task-row__footer">
                            <span className={`task-row__date ${isOverdue ? 'is-overdue-date' : ''}`}>
                              <span
                                className={`task-row__priority is-${task.priority}`}
                                role="img"
                                aria-label={getPriorityLabel(task.priority)}
                                title={getPriorityLabel(task.priority)}
                              >
                                <Flag size={13} aria-hidden="true" />
                              </span>
                              <span className="task-row__date-content">
                                {isOverdue && <strong>{t('common.overdue')}</strong>}
                                <time>{formatDue(task)}</time>
                              </span>
                            </span>
                            {directSubtasks.length > 0 && (
                              <button
                                type="button"
                                className="task-row__subtask-toggle"
                                aria-expanded={isTaskGroupExpanded}
                                aria-controls={`task-subtasks-${task.id}`}
                                aria-label={`${t('tasks.subtask_progress_summary', {
                                  completed: completedSubtaskCount,
                                  total: directSubtasks.length,
                                })} · ${
                                  isTaskGroupExpanded
                                    ? t('tasks.subtask_collapse')
                                    : t('tasks.subtask_expand', { count: directSubtasks.length })
                                }`}
                                title={
                                  isTaskGroupExpanded
                                    ? t('tasks.subtask_collapse')
                                    : t('tasks.subtask_expand', { count: directSubtasks.length })
                                }
                                onClick={(event) => {
                                  event.stopPropagation()
                                  toggleTaskGroup(task.id)
                                }}
                              >
                                {t('tasks.subtask_progress_compact', {
                                  completed: completedSubtaskCount,
                                  total: directSubtasks.length,
                                })}
                                {isTaskGroupExpanded ? (
                                  <ChevronUp aria-hidden="true" />
                                ) : (
                                  <ChevronDown aria-hidden="true" />
                                )}
                              </button>
                            )}
                            {sameDayOccurrences.length > 1 && (
                              <button
                                type="button"
                                className="task-row__subtask-toggle"
                                aria-expanded={isOccurrenceGroupExpanded}
                                aria-label={t('tasks.multi_occurrence_progress', {
                                  completed: completedOccurrenceCount,
                                  total: sameDayOccurrences.length,
                                })}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setExpandedOccurrenceGroupKey((current) =>
                                    current === occurrenceGroupKey ? null : occurrenceGroupKey,
                                  )
                                }}
                              >
                                {t('tasks.multi_occurrence_progress', {
                                  completed: completedOccurrenceCount,
                                  total: sameDayOccurrences.length,
                                })}
                                {isOccurrenceGroupExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                              </button>
                            )}
                          </div>
                        </div>

                        {isOccurrenceGroupExpanded && (
                          <div className="task-occurrence-list" aria-label={t('tasks.multi_occurrence_progress', {
                            completed: completedOccurrenceCount,
                            total: sameDayOccurrences.length,
                          })}>
                            {sameDayOccurrences.map((occurrence) => (
                              <button
                                type="button"
                                key={occurrence.id}
                                className={`task-occurrence-row ${occurrence.is_completed === 1 ? 'is-completed' : ''}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  requestTaskCompletionToggle(occurrence, event.currentTarget)
                                }}
                              >
                                <span>{occurrence.is_completed === 1 ? <Check size={14} /> : <Circle size={14} />}</span>
                                <span>{formatDue(occurrence)}</span>
                                <span>{getStatusLabel(occurrence.status)}</span>
                              </button>
                            ))}
                          </div>
                        )}

                      </div>
                    )
                  })
                )}
              </div>

              {expandedTaskGroup && (
                <section
                  id={`task-subtasks-${expandedTaskGroup.id}`}
                  className="task-expanded-group"
                  aria-label={t('tasks.subtask_detail_region')}
                >
                  <header className="task-expanded-group__header">
                    <div>
                      <span>{t('tasks.subtask_detail_region')}</span>
                      <strong>{expandedTaskGroup.title}</strong>
                    </div>
                    <button
                      type="button"
                      className="task-expanded-group__close"
                      onClick={() => toggleTaskGroup(expandedTaskGroup.id)}
                    >
                      <ChevronUp aria-hidden="true" />
                      {t('tasks.subtask_collapse')}
                    </button>
                  </header>
                  <div className="task-subtask-list">
                    {renderSubtaskRows(expandedTaskGroup.id)}
                  </div>
                </section>
              )}
            </section>

            {/* Right details panel */}
            <aside className="task-panel task-details-panel">
              {activeTask ? (
                <>
                  <div className="task-details-panel__header">
                    <span>{t('tasks.details_title')}</span>
                    <h3>{activeTask.title}</h3>
                  </div>
                  <div className="task-details-meta">
                    <div>
                      <span>{t('tasks.details_label_status')}</span>
                      <strong>{getStatusLabel(activeTask.status)}</strong>
                    </div>
                    <div>
                      <span>{t('tasks.details_due_prefix')}</span>
                      <strong>{formatDue(activeTask)}</strong>
                    </div>
                  </div>
                  <div className="task-details-field">
                    <span>{t('tasks.details_label_desc')}</span>
                    <textarea
                      className="form-field"
                      rows={4}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder={t('tasks.details_desc_placeholder')}
                    />
                  </div>
                  <div className="task-details-field">
                    <span>{t('tasks.details_label_status')}</span>
                    <div className="task-details-pills">
                      <span className="pill">
                        {getPriorityLabel(activeTask.priority)} {t('tasks.details_priority_suffix')}
                      </span>
                      <span className="pill">
                        {t('tasks.details_due_prefix')}{' '}
                        {formatDue(activeTask)}
                      </span>
                      {activeTaskTemplate && (
                        <span className="pill blue">
                          {t('tasks.details_template_prefix')} {activeTaskTemplate.title}
                        </span>
                      )}
                      {activeTask.instance_key && (
                        <span className="pill blue">
                          {t('tasks.details_instance_prefix')} {activeTask.instance_key}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Manual Progress Slider */}
                  {!activeTask.parent_id && tasks.some((c) => c.parent_id === activeTask.id) ? (
                    <div className="task-details-field">
                      <span>
                        {t('tasks.details_subtask_progress')}
                      </span>
                      <div className="task-details-progress">
                        <div className="task-details-progress__track">
                          <div style={{ width: `${activeTask.progress}%` }} />
                        </div>
                        <strong>{activeTask.progress}%</strong>
                      </div>
                      <p className="task-details-hint">
                        {t('tasks.details_subtask_progress_tip')}
                      </p>
                    </div>
                  ) : (
                    <div className="task-details-field">
                      <span>
                        {t('tasks.details_label_progress')}: {editProgress}%
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editProgress}
                        onChange={(e) => setEditProgress(parseInt(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                    </div>
                  )}

                  <button
                    className="btn primary task-details-save"
                    onClick={handleSaveDetails}
                  >
                    {t('tasks.btn_save_changes')}
                  </button>
                </>
              ) : (
                <div className="task-details-empty">
                  <div className="task-details-empty__icon" aria-hidden="true">
                    <ListTodo />
                  </div>
                  <strong>{t('tasks.details_empty_title')}</strong>
                  <p>{t('tasks.details_empty_description')}</p>
                  <button type="button" className="btn sm" onClick={openCreateDrawer}>
                    <Plus size={14} aria-hidden="true" />
                    {t('tasks.details_empty_action')}
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}

        {/* TAB: CALENDAR SCHEDULE */}
        {taskTab === 'calendar' && (
          <div
            className="card task-calendar"
            style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}
          >
            <div className="task-calendar__header">
              <div className="task-calendar__title-group">
                <strong>{t('tasks.calendar_title')}</strong>
                <span className="task-calendar__period">{calendarPeriodLabel}</span>
              </div>
              <div className="task-calendar__controls">
                <div className="task-calendar__navigation">
                  <button
                    type="button"
                    className="btn sm task-calendar__icon-button"
                    aria-label={t('tasks.calendar_previous')}
                    title={t('tasks.calendar_previous')}
                    onClick={() =>
                      setCalendarDate((current) => shiftCalendarDate(current, calendarMode, -1))
                    }
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setCalendarDate(new Date())}
                  >
                    {t('tasks.calendar_today')}
                  </button>
                  <button
                    type="button"
                    className="btn sm task-calendar__icon-button"
                    aria-label={t('tasks.calendar_next')}
                    title={t('tasks.calendar_next')}
                    onClick={() =>
                      setCalendarDate((current) => shiftCalendarDate(current, calendarMode, 1))
                    }
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
                <div className="task-calendar__mode-switch">
                  <button
                    type="button"
                    className={`btn sm ${calendarMode === 'day' ? 'primary' : ''}`}
                    aria-pressed={calendarMode === 'day'}
                    onClick={() => setCalendarMode('day')}
                  >
                    {t('tasks.calendar_mode_day')}
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${calendarMode === 'week' ? 'primary' : ''}`}
                    aria-pressed={calendarMode === 'week'}
                    onClick={() => setCalendarMode('week')}
                  >
                    {t('tasks.calendar_mode_week')}
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${calendarMode === 'month' ? 'primary' : ''}`}
                    aria-pressed={calendarMode === 'month'}
                    onClick={() => setCalendarMode('month')}
                  >
                    {t('tasks.calendar_mode_month')}
                  </button>
                </div>
              </div>
            </div>

            {calendarVisibleTasks.length === 0 ? (
              <div className="task-calendar__empty">
                <div className="task-calendar__empty-icon" aria-hidden="true">
                  <CalendarDays />
                </div>
                <strong>{t('tasks.calendar_empty_title')}</strong>
                <p>{t('tasks.calendar_empty_description')}</p>
              </div>
            ) : calendarMode === 'day' ? (
              <div className="task-calendar__day-list">
                {(calendarTasksByDate.get(toCalendarDateKey(calendarDate)) ?? []).map(
                  renderCalendarTask,
                )}
              </div>
            ) : calendarMode === 'week' ? (
              <div className="task-calendar__week">
                {calendarWeekDays.map((day) => {
                  const dateKey = toCalendarDateKey(day)
                  const dayTasks = calendarTasksByDate.get(dateKey) ?? []
                  return (
                    <div
                      key={dateKey}
                      className={`task-calendar__week-day ${
                        dateKey === calendarTodayKey ? 'today' : ''
                      }`}
                    >
                      <div className="task-calendar__day-heading">
                        {new Intl.DateTimeFormat(i18n.language, {
                          weekday: 'short',
                          month: 'numeric',
                          day: 'numeric',
                        }).format(day)}
                      </div>
                      {dayTasks.map(renderCalendarTask)}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="task-calendar__month">
                {t('tasks.calendar_month_headers')
                  .split(',')
                  .map((w, idx) => (
                    <div key={idx} className="task-calendar__month-header">
                      {w}
                    </div>
                  ))}
                {calendarMonthDays.map((day) => {
                  const dateKey = toCalendarDateKey(day)
                  const dayTasks = calendarTasksByDate.get(dateKey) ?? []
                  const isCurrentMonth = day.getMonth() === calendarDate.getMonth()
                  return (
                    <div
                      key={dateKey}
                      className={`task-calendar__month-day ${
                        isCurrentMonth ? '' : 'outside'
                      } ${dateKey === calendarTodayKey ? 'today' : ''}`}
                    >
                      <span className="task-calendar__month-day-number">{day.getDate()}</span>
                      {dayTasks.slice(0, 2).map(renderCalendarTask)}
                      {dayTasks.length > 2 && (
                        <span className="task-calendar__more">
                          {t('tasks.calendar_more_tasks', { count: dayTasks.length - 2 })}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB: RECURRING RULES */}
        {taskTab === 'recurring' && (
          <div className="task-template-layout">
            {/* Left rules list */}
            <section className="task-panel task-template-list-panel">
              <div className="task-panel__header task-panel__header--row">
                <div>
                  <strong>{t('tasks.recurring_rules_title')}</strong>
                  <p>{t('tasks.rules_empty_description')}</p>
                </div>
                <button
                  type="button"
                  className="btn sm primary task-row__subtask-action"
                  onClick={handleNewRule}
                  title={t('tasks.new_rule_tooltip')}
                  aria-label={t('tasks.new_rule_tooltip')}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="task-template-list">
                {rules.length === 0 ? (
                  <div className="task-rules-empty">
                    <strong>{t('tasks.rules_empty_title')}</strong>
                    <p>{t('tasks.rules_empty_description')}</p>
                    <button type="button" className="btn sm primary" onClick={handleNewRule}>
                      <Plus size={14} aria-hidden="true" />
                      {t('tasks.rules_empty_action')}
                    </button>
                  </div>
                ) : (
                  rules.map((rule) => (
                    <div
                      key={rule.id}
                      className={`task-template-item ${selectedRuleId === rule.id ? 'is-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={rule.title}
                      onClick={() => selectRule(rule)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectRule(rule)
                        }
                      }}
                    >
                      <strong>{rule.title}</strong>
                      <span>
                        {getFrequencyLabel(rule.frequency)} · {getTemplateStartDateKey(rule)}{' '}
                        {getTemplateStartTime(rule)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Right rule editor */}
            <section className="task-panel task-template-editor">
              <div className="task-panel__header task-panel__header--row">
                <div>
                  <strong>{t('tasks.config_rule_title')}</strong>
                  <p>
                    {selectedRule
                      ? `${getFrequencyLabel(selectedRule.frequency)} · ${getTemplateStartTime(selectedRule)}`
                      : t('tasks.rule_new_name')}
                  </p>
                </div>
                {selectedRuleId && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => handleDeleteRule(selectedRuleId)}
                  >
                    <Trash2 size={12} /> {t('common.delete')}
                  </button>
                )}
              </div>

              <div className="task-form-section">
                <label>
                  {t('tasks.rule_name_label')}
                </label>
                <input
                  className="form-field"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                />
              </div>

              <div className="task-form-section">
                <label>
                  {t('tasks.details_label_desc')}
                </label>
                <textarea
                  className="form-field"
                  rows={2}
                  value={ruleDesc}
                  onChange={(e) => setRuleDesc(e.target.value)}
                />
              </div>

              <div className="task-rule-schedule-grid">
                <div className="task-form-section">
                  <label>
                    {t('tasks.freq_label')}
                  </label>
                  <select
                    className="form-field"
                    value={ruleFreq}
                    onChange={(e) => setRuleFreq(e.target.value)}
                  >
                    <option value="custom">{t('tasks.freq_once')}</option>
                    <option value="daily">{t('tasks.freq_daily')}</option>
                    <option value="weekday">{t('tasks.freq_weekday')}</option>
                    <option value="weekly">{t('tasks.freq_weekly')}</option>
                    <option value="monthly">{t('tasks.freq_monthly')}</option>
                    {ruleFreq === 'cron' && (
                      <option value="cron" disabled>
                        {t('tasks.legacy_cron_label')}
                      </option>
                    )}
                  </select>
                </div>
                <div className="task-form-section">
                  <label>
                    {t('tasks.interval_label')}
                  </label>
                  <input
                    className="form-field"
                    type="number"
                    min={1}
                    value={ruleInterval}
                    onChange={(e) => setRuleInterval(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
                <div className="task-form-section">
                  <label>
                    {t('tasks.rule_start_date_label')}
                  </label>
                  <input
                    className="form-field"
                    type="date"
                    value={ruleStartDate}
                    onChange={(e) => setRuleStartDate(e.target.value)}
                  />
                </div>
                <div className="task-form-section">
                  <label>
                    {t('tasks.template_priority_label')}
                  </label>
                  <select
                    className="form-field"
                    value={rulePriority}
                    onChange={(e) => setRulePriority(e.target.value)}
                  >
                    <option value="high">{t('tasks.priority_high')}</option>
                    <option value="mid">{t('tasks.priority_mid')}</option>
                    <option value="low">{t('tasks.priority_low')}</option>
                  </select>
                </div>
              </div>

              {ruleFreq === 'cron' && (
                <div className="task-form-warning" role="alert">
                  {t('tasks.legacy_cron_warning')}
                </div>
              )}

              <div className="task-form-section">
                <label>{t('tasks.execution_times_label')}</label>
                <div className="task-rule-times">
                  {ruleTimes.map((time, index) => (
                    <div className="task-rule-time-row" key={`${index}-${time}`}>
                      <input
                        className="form-field"
                        type="time"
                        value={time}
                        onChange={(event) => {
                          const nextTimes = [...ruleTimes]
                          nextTimes[index] = event.target.value
                          setRuleTimes(nextTimes)
                          if (index === 0) setRuleTime(event.target.value)
                        }}
                      />
                      {ruleTimes.length > 1 && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setRuleTimes(ruleTimes.filter((_, timeIndex) => timeIndex !== index))}
                          aria-label={t('tasks.remove_execution_time')}
                          title={t('tasks.remove_execution_time')}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setRuleTimes([...ruleTimes, '18:00'])}
                  >
                    <Plus size={13} /> {t('tasks.add_execution_time')}
                  </button>
                </div>
                <span className="task-form-hint">{t('tasks.multiple_times_hint')}</span>
              </div>

              {ruleFreq === 'weekly' && (
                <div className="task-form-section">
                  <label>
                    {t('tasks.days_of_week_label')}
                  </label>
                  <div className="task-weekday-picker">
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                      const isActive = ruleWeekDays.includes(d)
                      const names = t('tasks.weekdays_short').split(',')
                      return (
                        <button
                          key={d}
                          type="button"
                          className="btn sm"
                          aria-pressed={isActive}
                          style={{
                            minWidth: '32px',
                            backgroundColor: isActive ? 'var(--color-accent)' : 'var(--bg-surface)',
                            color: isActive ? '#fff' : 'var(--text-main)',
                          }}
                          onClick={() => {
                            if (isActive) {
                              setRuleWeekDays(ruleWeekDays.filter((x) => x !== d))
                            } else {
                              setRuleWeekDays([...ruleWeekDays, d])
                            }
                          }}
                        >
                          {names[d]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {ruleFreq === 'monthly' && (
                <div className="task-form-section">
                  <label>{t('tasks.month_days_label')}</label>
                  <input
                    className="form-field"
                    value={ruleMonthDays.join(',')}
                    onChange={(event) =>
                      setRuleMonthDays(
                        event.target.value
                          .split(',')
                          .map((value) => Number(value.trim()))
                          .filter((value) => Number.isInteger(value) && (value === -1 || (value >= 1 && value <= 31))),
                      )
                    }
                    placeholder={t('tasks.month_days_placeholder')}
                  />
                  <span className="task-form-hint">{t('tasks.month_days_hint')}</span>
                </div>
              )}

              <div className="task-form-section">
                <label>
                  {t('tasks.holiday_strategy_label')}
                </label>
                <select
                  className="form-field"
                  value={ruleHolidayPolicy}
                  onChange={(e) => setRuleHolidayPolicy(e.target.value)}
                >
                  <option value="skip">{t('tasks.holiday_strategy_skip')}</option>
                  <option value="delay">{t('tasks.holiday_strategy_delay')}</option>
                  <option value="advance">{t('tasks.holiday_strategy_advance')}</option>
                </select>
              </div>

              <div className="task-form-section task-preview-section">
                <label>
                  {t('tasks.future_triggers_label')}
                </label>
                <div className="task-preview-pills">
                  {rulePreviewOccurrences.length === 0 ? (
                    <span className="pill blue">{t('tasks.future_triggers_empty')}</span>
                  ) : (
                    rulePreviewOccurrences.map((occurrence) => (
                      <span key={occurrence.instanceKey} className="pill blue">
                        {occurrence.dateKey} {occurrence.time}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <button
                type="button"
                className="btn primary task-template-save"
                onClick={handleSaveRule}
              >
                {t('tasks.btn_save_rule')}
              </button>
            </section>
          </div>
        )}

        {/* TAB: TEMPLATES */}
        {taskTab === 'templates' && (
          <div className="task-template-library">
            <div className="task-template-library__toolbar">
              <div>
                <strong>{t('tasks.tab_templates')}</strong>
                <p>{t('tasks.template_library_description')}</p>
              </div>
              <button type="button" className="btn primary sm" onClick={() => openTemplateEditor()}>
                <Plus size={14} aria-hidden="true" /> {t('tasks.new_template')}
              </button>
            </div>
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="task-template-card"
              >
                <div className="task-template-card__header">
                  <span>{tpl.icon}</span>
                  <h3>{tpl.title}</h3>
                </div>
                <ul>
                  {tpl.subtasks.map((st: string) => (
                    <li key={st}>{st}</li>
                  ))}
                </ul>
                <div className="task-template-card__tags">
                  {tpl.tags.map((t: string) => (
                    <span key={t} className="pill">
                      {t}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={() => handleUseTemplate(tpl)}
                >
                  {t('tasks.btn_use_template')}
                </button>
                {!String(tpl.templateKey || '').startsWith('builtin-') && (
                  <>
                    <button type="button" className="btn sm" onClick={() => openTemplateEditor(tpl)}>{t('common.edit')}</button>
                    <button type="button" className="btn danger sm" onClick={() => void handleDeleteTemplate(tpl)}>{t('common.delete')}</button>
                  </>
                )}
              </div>
            ))}
            {templateEditor && (
              <div className="task-template-editor-form">
                <strong>{templateEditor.id ? t('tasks.edit_template') : t('tasks.new_template')}</strong>
                <input className="form-field" value={templateEditor.title} placeholder={t('tasks.template_title_placeholder')} onChange={(event) => setTemplateEditor({ ...templateEditor, title: event.target.value })} />
                <input className="form-field" value={templateEditor.icon} placeholder={t('tasks.template_icon_placeholder')} onChange={(event) => setTemplateEditor({ ...templateEditor, icon: event.target.value })} />
                <textarea className="form-field" rows={2} value={templateEditor.description} placeholder={t('tasks.template_description_placeholder')} onChange={(event) => setTemplateEditor({ ...templateEditor, description: event.target.value })} />
                <textarea className="form-field" rows={5} value={templateEditor.subtasksText} placeholder={t('tasks.template_steps_placeholder')} onChange={(event) => setTemplateEditor({ ...templateEditor, subtasksText: event.target.value })} />
                <div className="task-template-editor-form__actions">
                  <button type="button" className="btn" onClick={() => setTemplateEditor(null)}>{t('common.cancel')}</button>
                  <button type="button" className="btn primary" onClick={() => void handleSaveTemplate()}>{t('common.save')}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: SCHEDULED CRON LOGS */}
        {taskTab === 'scheduled' && (
          <div
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              height: '100%',
              overflowY: 'auto',
            }}
          >
            <div>
              <strong style={{ fontSize: '14px' }}>{t('tasks.scheduled_log_title')}</strong>
              <p style={{ color: 'var(--text-muted)', fontSize: '11.5px', marginTop: '4px' }}>
                {t('tasks.scheduled_log_desc')}
              </p>
            </div>
            <div className="task-scheduled-log__table-wrap">
              <table className="task-scheduled-log__table">
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--color-border)',
                    textAlign: 'left',
                    color: 'var(--text-muted)',
                    fontSize: '11px',
                  }}
                >
                  <th style={{ padding: '8px' }}>{t('tasks.log_header_name')}</th>
                  <th style={{ padding: '8px' }}>{t('tasks.log_header_type')}</th>
                  <th style={{ padding: '8px' }}>{t('tasks.log_header_freq')}</th>
                  <th style={{ padding: '8px' }}>{t('tasks.log_header_status')}</th>
                  <th style={{ padding: '8px' }}>{t('tasks.log_header_next')}</th>
                  <th style={{ padding: '8px' }}>{t('tasks.log_header_ops')}</th>
                </tr>
              </thead>
              <tbody>
                {scheduledLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '16px 8px', color: 'var(--text-muted)' }}>
                      {t('tasks.scheduled_log_empty')}
                    </td>
                  </tr>
                ) : scheduledLogs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{log.name}</td>
                    <td style={{ padding: '10px 8px' }}>{log.action}</td>
                    <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>
                      {log.trigger}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span
                        className={`pill ${log.status === '运行中' || log.status === 'Running' ? 'yellow' : log.status === '已完成' || log.status === 'Finished' ? 'green' : 'blue'}`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>
                      {log.nextRun}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          const rule = rules.find((candidate) => candidate.id === log.id)
                          if (rule) selectRule(rule)
                          setTaskTab('list')
                        }}
                      >
                        {t('tasks.btn_view_rule')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {drawerMode && (
        <div className="task-drawer-backdrop" role="presentation" onMouseDown={() => setDrawerMode(null)}>
          <aside className="task-drawer" role="dialog" aria-modal="true" aria-label={drawerMode === 'create' ? t('tasks.drawer_create_title') : t('tasks.drawer_edit_title')} onMouseDown={(event) => event.stopPropagation()}>
            <header className="task-drawer__header">
              <h2>{drawerMode === 'create' ? t('tasks.drawer_create_title') : t('tasks.drawer_edit_title')}</h2>
              <button type="button" className="btn sm task-drawer__close" onClick={() => setDrawerMode(null)} aria-label={t('tasks.drawer_close')} title={t('tasks.drawer_close')}><X size={16} /></button>
            </header>
            <div className="task-drawer__body">
              <label className="task-form-section"><span>{t('tasks.details_label_title')}</span><input autoFocus className="form-field" value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} /></label>
              <label className="task-form-section"><span>{t('tasks.details_label_desc')}</span><textarea className="form-field" rows={4} value={taskDraft.description} onChange={(event) => setTaskDraft({ ...taskDraft, description: event.target.value })} placeholder={t('tasks.details_desc_placeholder')} /></label>
              <div className="task-drawer__grid">
                <div className="task-form-section">
                  <span>{t('tasks.details_due_prefix')}</span>
                  <div className="task-due-picker">
                    <input
                      className="form-field"
                      type="datetime-local"
                      step={1}
                      value={`${taskDraft.dueDate}T${normalizeTaskDueTime(taskDraft.time)}`}
                      onChange={(event) => {
                        const [dueDate, time = '23:59:59'] = event.target.value.split('T')
                        setTaskDraft({ ...taskDraft, dueDate, time: normalizeTaskDueTime(time) })
                      }}
                    />
                  </div>
                </div>
                <label className="task-form-section"><span>{t('tasks.quick_add_priority_label')}</span><select className="form-field" value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value })}><option value="high">{t('tasks.priority_high')}</option><option value="mid">{t('tasks.priority_mid')}</option><option value="low">{t('tasks.priority_low')}</option></select></label>
              </div>
              <label className="task-drawer__recurring-setting">
                <span className="task-drawer__recurring-copy">
                  <strong>{t('tasks.recurring_task_checkbox_label')}</strong>
                  <small>{t('tasks.recurring_task_hint')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={taskDraft.repeat !== 'none'}
                  onChange={(event) => {
                    const recurring = event.target.checked
                    setTaskDraft({ ...taskDraft, repeat: recurring ? ruleFreq : 'none' })
                    if (recurring) setRuleStartDate(taskDraft.dueDate)
                    setIsRulePanelExpanded(recurring)
                  }}
                />
              </label>
              {taskDraft.repeat !== 'none' && (
                <div className="task-drawer__rule-panel">
                  <button type="button" className="task-drawer__rule-summary" onClick={() => setIsRulePanelExpanded((current) => !current)} aria-expanded={isRulePanelExpanded}>
                    <span>
                      <strong>{t('tasks.advanced_repeat_label')}</strong>
                      <small>{getFrequencyLabel(ruleFreq)} · {ruleTimes.join(', ')}</small>
                    </span>
                    {isRulePanelExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                  </button>
                  {isRulePanelExpanded && (
                    <div className="task-drawer__rule-editor">
                      <label className="task-form-section"><span>{t('tasks.freq_label')}</span><select className="form-field" value={ruleFreq} onChange={(event) => setRuleFreq(event.target.value)}><option value="daily">{t('tasks.freq_daily')}</option><option value="weekday">{t('tasks.freq_weekday')}</option><option value="weekly">{t('tasks.freq_weekly')}</option><option value="monthly">{t('tasks.freq_monthly')}</option></select></label>
                      <label className="task-form-section"><span>{t('tasks.interval_label')}</span><input className="form-field" type="number" min={1} value={ruleInterval} onChange={(event) => setRuleInterval(Math.max(1, Number(event.target.value) || 1))} /></label>
                      <label className="task-form-section"><span>{t('tasks.rule_start_date_label')}</span><input className="form-field" type="date" value={ruleStartDate} onChange={(event) => setRuleStartDate(event.target.value)} /></label>
                      <label className="task-form-section"><span>{t('tasks.template_priority_label')}</span><select className="form-field" value={rulePriority} onChange={(event) => setRulePriority(event.target.value)}><option value="high">{t('tasks.priority_high')}</option><option value="mid">{t('tasks.priority_mid')}</option><option value="low">{t('tasks.priority_low')}</option></select></label>
                      <div className="task-form-section"><span>{t('tasks.schedule_time_label')}</span><div className="task-drawer__times-editor">{ruleTimes.map((time, index) => <div className="task-drawer__time-row" key={`${time}-${index}`}><input className="form-field" type="time" value={time} onChange={(event) => setRuleTimes(ruleTimes.map((current, currentIndex) => currentIndex === index ? event.target.value : current))} />{ruleTimes.length > 1 && <button type="button" className="btn sm" onClick={() => setRuleTimes(ruleTimes.filter((_, currentIndex) => currentIndex !== index))}>{t('common.delete')}</button>}</div>)}<button type="button" className="btn sm" onClick={() => setRuleTimes([...ruleTimes, '09:00'])}>{t('tasks.add_time')}</button></div></div>
                      {ruleFreq === 'weekly' && <label className="task-form-section"><span>{t('tasks.week_days_label')}</span><input className="form-field" value={ruleWeekDays.join(',')} onChange={(event) => setRuleWeekDays(event.target.value.split(',').map(Number).filter((value) => value >= 1 && value <= 7))} placeholder="1,3,5" /></label>}
                      {ruleFreq === 'monthly' && <label className="task-form-section"><span>{t('tasks.month_days_label')}</span><input className="form-field" value={ruleMonthDays.join(',')} onChange={(event) => setRuleMonthDays(event.target.value.split(',').map(Number).filter((value) => value === -1 || (value >= 1 && value <= 31)))} placeholder="1,15,-1" /></label>}
                      <label className="task-form-section"><span>{t('tasks.holiday_strategy_label')}</span><select className="form-field" value={ruleHolidayPolicy} onChange={(event) => setRuleHolidayPolicy(event.target.value)}><option value="skip">{t('tasks.holiday_strategy_skip')}</option><option value="delay">{t('tasks.holiday_strategy_delay')}</option><option value="advance">{t('tasks.holiday_strategy_advance')}</option></select></label>
                      {drawerMode === 'edit' && activeTaskRule && taskDraft.repeat !== 'none' && <label className="task-form-section"><span>{t('tasks.edit_rule_scope_label')}</span><select className="form-field" value={editRuleScope} onChange={(event) => setEditRuleScope(event.target.value as 'single' | 'future' | 'all')}><option value="single">{t('tasks.edit_rule_scope_single')}</option><option value="future">{t('tasks.edit_rule_scope_future')}</option><option value="all">{t('tasks.edit_rule_scope_all')}</option></select></label>}
                    </div>
                  )}
                </div>
              )}
            </div>
            <footer className="task-drawer__footer">
              {drawerMode === 'edit' && activeTask && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={(event) => openTaskDeletionConfirmation(activeTask, event.currentTarget)}
                >
                  {t('tasks.delete_task')}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setDrawerMode(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn primary" onClick={handleSaveDrawer}>{t('tasks.btn_save_changes')}</button>
            </footer>
          </aside>
        </div>
      )}
      {completionConfirmationTask && completionConfirmationCopy && (
        <AccessibleDialog
          title={completionConfirmationCopy.title}
          role="alertdialog"
          onClose={() => {
            if (!isCompletionConfirming) setCompletionConfirmationTask(null)
          }}
          returnFocus={() => completionTriggerRef.current?.focus()}
          contentClassName="task-completion-confirm"
        >
          <p className="task-completion-confirm__copy">
            {completionConfirmationCopy.description}
          </p>
          <div className="task-completion-confirm__actions">
            <button
              type="button"
              className="btn"
              disabled={isCompletionConfirming}
              onClick={() => setCompletionConfirmationTask(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={isCompletionConfirming}
              onClick={() => void confirmTaskCompletionToggle()}
            >
              {completionConfirmationCopy.action}
            </button>
          </div>
        </AccessibleDialog>
      )}
      {deletionConfirmationTask && (
        <AccessibleDialog
          title={t('tasks.delete_dialog_title')}
          role="alertdialog"
          onClose={() => {
            if (!isDeletingTask) setDeletionConfirmationTask(null)
          }}
          returnFocus={() => deletionTriggerRef.current?.focus()}
          initialFocusRef={deletionCancelButtonRef}
          contentClassName="task-delete-confirm"
        >
          <p className="task-delete-confirm__copy">
            {t('tasks.delete_dialog_description', { title: deletionConfirmationTask.title })}
          </p>
          {isRecurringRootTask(deletionConfirmationTask) && (
            <fieldset className="task-delete-confirm__scopes">
              <legend>{t('tasks.delete_scope_label')}</legend>
              <label className="task-delete-confirm__scope">
                <input
                  type="radio"
                  name="task-delete-scope"
                  value="single"
                  checked={deletionScope === 'single'}
                  disabled={isDeletingTask}
                  onChange={() => setDeletionScope('single')}
                />
                <span>
                  <strong>{t('tasks.delete_scope_single_title')}</strong>
                  <small>{t('tasks.delete_scope_single_description')}</small>
                </span>
              </label>
              <label className="task-delete-confirm__scope">
                <input
                  type="radio"
                  name="task-delete-scope"
                  value="end-repeat"
                  checked={deletionScope === 'end-repeat'}
                  disabled={isDeletingTask}
                  onChange={() => setDeletionScope('end-repeat')}
                />
                <span>
                  <strong>{t('tasks.delete_scope_end_repeat_title')}</strong>
                  <small>{t('tasks.delete_scope_end_repeat_description')}</small>
                </span>
              </label>
              <label className="task-delete-confirm__scope">
                <input
                  type="radio"
                  name="task-delete-scope"
                  value="delete-repeat"
                  checked={deletionScope === 'delete-repeat'}
                  disabled={isDeletingTask}
                  onChange={() => setDeletionScope('delete-repeat')}
                />
                <span>
                  <strong>{t('tasks.delete_scope_delete_repeat_title')}</strong>
                  <small>{t('tasks.delete_scope_delete_repeat_description')}</small>
                </span>
              </label>
            </fieldset>
          )}
          <div className="task-delete-confirm__actions">
            <button
              ref={deletionCancelButtonRef}
              type="button"
              className="btn"
              disabled={isDeletingTask}
              onClick={() => setDeletionConfirmationTask(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={isDeletingTask}
              onClick={() => void confirmTaskDeletion()}
            >
              {t('common.delete')}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </div>
  )
}

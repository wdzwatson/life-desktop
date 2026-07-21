import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  X,
  Kanban,
  ListChecks,
  ListTodo,
  Trash2,
  Plus,
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
  toLocalDateKey,
} from './taskScheduleUtils'
import './Tasks.css'

const getCurrentTimeValue = () => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export const Tasks: React.FC = () => {
  const { t, i18n } = useTranslation()

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

  // DB States
  const [tasks, setTasks] = useState<any[]>([])
  const [translations, setTranslations] = useState<any[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)

  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null)
  const [taskDraft, setTaskDraft] = useState({
    title: '',
    description: '',
    dueDate: toLocalDateKey(new Date()),
    time: getCurrentTimeValue(),
    priority: 'mid',
    repeat: 'none',
  })

  // Detail Panel Edit State
  const [editDesc, setEditDesc] = useState('')
  const [editProgress, setEditProgress] = useState(0)

  // Recurring Rules States
  const [rules, setRules] = useState<any[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null)
  const [ruleName, setRuleName] = useState('')
  const [ruleDesc, setRuleDesc] = useState('')
  const [ruleFreq, setRuleFreq] = useState('daily')
  const [ruleInterval, setRuleInterval] = useState(1)
  const [ruleStartDate, setRuleStartDate] = useState(() => toLocalDateKey(new Date()))
  const [ruleTime, setRuleTime] = useState('09:00')
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

  useEffect(() => {
    if (!['list', 'kanban', 'calendar'].includes(taskTab)) {
      setTaskTab('list')
    }
  }, [setTaskTab, taskTab])

  useEffect(() => {
    setTemplates([
      {
        id: 1,
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
        title: t('tasks.template_study_title'),
        icon: '📚',
        subtasks: [
          t('tasks.template_study_sub_1'),
          t('tasks.template_study_sub_2'),
          t('tasks.template_study_sub_3'),
        ],
        tags: [t('tasks.template_study_tag_1'), t('tasks.template_study_tag_2')],
      },
    ])

  }, [i18n.language])

  const api = (window as any).electronAPI

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

  const calendarTasksByDate = useMemo(() => groupTasksByDueDate(tasks), [tasks])
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

  const openCalendarTask = (task: any) => {
    selectTaskForDetails(task)
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
    setTaskDraft({
      title: '',
      description: '',
      dueDate: toLocalDateKey(new Date()),
      time: getCurrentTimeValue(),
      priority: 'mid',
      repeat: 'none',
    })
    setDrawerMode('create')
  }

  const selectTaskForDetails = (task: any) => {
    setSelectedTaskId(task.id)
    setEditDesc(task.description || '')
    setEditProgress(task.progress || 0)
    const rule = task.recur_rule_id ? rules.find((candidate) => candidate.id === task.recur_rule_id) : null
    setTaskDraft({
      title: task.title || '',
      description: task.description || '',
      dueDate: task.due_date || toLocalDateKey(new Date()),
      time: rule ? getTemplateStartTime(rule) : '09:00',
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

  // Select a rule and map to inputs
  const selectRule = (rule: any) => {
    setSelectedRuleId(rule.id)
    setRuleName(rule.title)
    setRuleDesc(rule.description || '')
    setRuleFreq(rule.frequency)
    setRuleInterval(rule.interval || 1)
    setRuleStartDate(getTemplateStartDateKey(rule))
    setRuleTime(getTemplateStartTime(rule))
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
                  : t('tasks.complete_task_action')
              }
              aria-label={
                child.is_completed === 1
                  ? t('tasks.reopen_task_action')
                  : t('tasks.complete_task_action')
              }
              onClick={(e) => {
                e.stopPropagation()
                toggleTaskDone(child)
              }}
              className="task-row__check"
            >
              {child.is_completed === 1 ? (
                <Check size={14} color="var(--color-success)" />
              ) : (
                <Circle size={14} color="var(--text-muted)" />
              )}
            </button>
            <span className="task-row__date">
              {child.due_date}
            </span>
            <span className="task-row__title">{child.title}</span>
            <span
              className={`pill ${child.priority === 'high' ? 'red' : child.priority === 'mid' ? 'yellow' : 'green'}`}
            >
              {getPriorityLabel(child.priority)}
            </span>
            <button
              type="button"
              className="btn sm task-row__subtask-action"
              onClick={(e) => {
                e.stopPropagation()
                handleAddSubtask(child.id)
              }}
              title={t('tasks.add_subtask_tooltip')}
              aria-label={t('tasks.add_subtask_tooltip')}
            >
              <Plus size={13} aria-hidden="true" />
            </button>
          </div>,
          ...renderSubtaskRows(child.id, depth + 1, nextVisited),
        ]
      })

  const handleSaveDrawer = async () => {
    if (!api || !taskDraft.title.trim()) return

    if (drawerMode === 'create') {
      const frequency = taskDraft.repeat === 'none' ? 'custom' : taskDraft.repeat
      const res = await api.dbQuery(
        'tasks',
        `INSERT INTO recurring_rules (title, description, frequency, interval, start_date, start_time, priority, end_condition, missed_policy)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'skip')`,
        [taskDraft.title.trim(), taskDraft.description, frequency, taskDraft.dueDate, taskDraft.time, taskDraft.priority, frequency === 'custom' ? 'count:1' : 'never'],
      )
      if (res?.success) {
        await runDueTaskGeneration()
        showToast(t('tasks.toast_task_added'))
      }
    } else if (activeTask) {
      await api.dbQuery(
        'tasks',
        'UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ? WHERE id = ?',
        [taskDraft.title.trim(), taskDraft.description, taskDraft.priority, taskDraft.dueDate, activeTask.id],
      )
      if (activeTask.recur_rule_id) {
        await api.dbQuery(
          'tasks',
          'UPDATE recurring_rules SET title = ?, description = ?, frequency = ?, start_date = ?, start_time = ?, priority = ? WHERE id = ?',
          [taskDraft.title.trim(), taskDraft.description, taskDraft.repeat === 'none' ? 'custom' : taskDraft.repeat, taskDraft.dueDate, taskDraft.time, taskDraft.priority, activeTask.recur_rule_id],
        )
      }
      showToast(t('tasks.toast_details_updated'))
    }

    setDrawerMode(null)
    await loadData()
  }

  // Subtask creation
  const handleAddSubtask = async (parentId: number) => {
    if (!api) return
    const title = window.prompt(t('tasks.prompt_subtask_title'))
    if (!title?.trim()) return
    const parentTask = tasks.find((task) => task.id === parentId)

    const query = `
      INSERT INTO tasks (
        title, description, priority, status, due_date, parent_id, recur_rule_id, instance_key, is_completed, progress
      )
      VALUES (?, '', 'mid', '待处理', ?, ?, ?, ?, 0, 0)
    `
    const res = await api.dbQuery('tasks', query, [
      title.trim(),
      parentTask?.due_date || toLocalDateKey(new Date()),
      parentId,
      parentTask?.recur_rule_id || null,
      parentTask?.instance_key || null,
    ])

    if (res?.success) {
      showToast(t('tasks.toast_subtask_added'))
      loadData()
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

    const weekDaysStr = ruleWeekDays.join(',')
    const monthDaysStr = ruleMonthDays.join(',')

    if (selectedRuleId) {
      // Update
      const query = `
        UPDATE recurring_rules 
        SET title = ?, description = ?, frequency = ?, interval = ?, week_days = ?, month_days = ?, cron = ?, start_date = ?, start_time = ?, priority = ?, missed_policy = ?
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
        ruleTime,
        rulePriority,
        ruleHolidayPolicy,
        selectedRuleId,
      ])
      showToast(t('tasks.toast_rule_modified'))
    } else {
      // Create new
      const query = `
        INSERT INTO recurring_rules (
          title, description, frequency, interval, week_days, month_days, cron, start_date, start_time, priority, missed_policy
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        ruleTime,
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
    setRulePriority('mid')
    setRuleWeekDays([])
    setRuleMonthDays([])
    setRuleCron('')
  }

  const handleDeleteRule = async (id: number) => {
    if (!api || !window.confirm(t('tasks.prompt_delete_rule_confirm'))) return
    await api.dbQuery('tasks', 'DELETE FROM recurring_rule_steps WHERE rule_id = ?', [id])
    await api.dbQuery('tasks', 'DELETE FROM recurring_rules WHERE id = ?', [id])
    setSelectedRuleId(null)
    showToast(t('tasks.toast_rule_deleted'))
    loadData()
  }

  const handleUseTemplate = async (template: any) => {
    if (!api) return
    const todayYMD = toLocalDateKey(new Date())
    const startTime = getCurrentTimeValue()

    const templateRes = await api.dbQuery(
      'tasks',
      `
      INSERT INTO recurring_rules (
        title, description, frequency, interval, start_date, start_time, priority, end_condition, missed_policy
      )
      VALUES (?, ?, 'custom', 1, ?, ?, 'mid', 'count:1', 'skip')
    `,
      [template.title, t('tasks.template_created_desc'), todayYMD, startTime],
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
  const rootTasks = useMemo(() => tasks.filter((task) => !task.parent_id), [tasks])
  const todayKey = toLocalDateKey(new Date())
  const openTaskCount = tasks.filter(
    (task) => task.is_completed !== 1 && task.status !== '已关闭',
  ).length
  const todayTaskCount = tasks.filter((task) => task.due_date === todayKey).length
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
                const laneTasks = tasks.filter(
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
                            selectTaskForDetails(task)
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
                              {task.due_date || t('tasks.due_date_not_set')}
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
                  <button type="button" className="btn primary" onClick={openCreateDrawer}>
                    <Plus size={16} aria-hidden="true" />
                    {t('tasks.drawer_create_title')}
                  </button>
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
                  rootTasks.map((task) => {
                    const isSelected = selectedTaskId === task.id
                    const isOverdue = task.status === '已逾期'

                    return (
                      <div key={task.id} className="task-row-group">
                        <div
                          className={`task-row ${isSelected ? 'is-selected' : ''} ${isOverdue ? 'is-overdue' : ''} ${
                            task.is_completed === 1 ? 'is-completed' : ''
                          }`}
                          role="button"
                          tabIndex={0}
                          aria-label={task.title}
                          onClick={() => selectTaskForDetails(task)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              selectTaskForDetails(task)
                            }
                          }}
                        >
                          <button
                            type="button"
                            title={
                              task.is_completed === 1
                                ? t('tasks.reopen_task_action')
                                : t('tasks.complete_task_action')
                            }
                            aria-label={
                              task.is_completed === 1
                                ? t('tasks.reopen_task_action')
                                : t('tasks.complete_task_action')
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTaskDone(task)
                            }}
                            className="task-row__check"
                          >
                            {task.is_completed === 1 ? (
                              <Check size={16} color="var(--color-success)" />
                            ) : (
                              <Circle
                                size={16}
                                color={isOverdue ? 'var(--color-danger)' : 'var(--text-muted)'}
                              />
                            )}
                          </button>
                          <span className="task-row__date">
                            {isOverdue ? t('common.overdue') : task.due_date}
                          </span>
                          <div className="task-row__main">
                            <span className="task-row__title">{task.title}</span>
                            <span className="task-row__meta">
                              {getStatusLabel(task.status)}
                              {task.recur_rule_id ? ` · ${t('tasks.details_template_prefix')}` : ''}
                            </span>
                            {task.progress > 0 && task.progress < 100 && (
                              <div className="task-row__progress">
                                <div style={{ width: `${task.progress}%` }} />
                              </div>
                            )}
                          </div>
                          <span
                            className={`pill ${task.priority === 'high' ? 'red' : task.priority === 'mid' ? 'yellow' : 'green'}`}
                          >
                            {getPriorityLabel(task.priority)}
                          </span>
                          <button
                            type="button"
                            className="btn sm task-row__subtask-action"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAddSubtask(task.id)
                            }}
                            title={t('tasks.add_subtask_tooltip')}
                            aria-label={t('tasks.add_subtask_tooltip')}
                          >
                            <Plus size={13} aria-hidden="true" />
                          </button>
                        </div>

                        {renderSubtaskRows(task.id)}
                      </div>
                    )
                  })
                )}
              </div>
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
                      <strong>{activeTask.due_date || t('tasks.due_date_not_set')}</strong>
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
                        {activeTask.due_date || t('tasks.due_date_not_set')}
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
                    <option value="cron">{t('tasks.freq_cron')}</option>
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
                    {t('tasks.time_label')}
                  </label>
                  <input
                    className="form-field"
                    type="time"
                    value={ruleTime}
                    onChange={(e) => setRuleTime(e.target.value)}
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

              {ruleFreq === 'cron' && (
                <div className="task-form-section">
                  <label>
                    {t('tasks.freq_cron')}
                  </label>
                  <input
                    className="form-field"
                    value={ruleCron}
                    onChange={(e) => setRuleCron(e.target.value)}
                    placeholder={t('tasks.cron_placeholder')}
                  />
                  <span className="task-form-hint">
                    {t('tasks.cron_hint')}
                  </span>
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
              </div>
            ))}
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
                          setTaskTab('recurring')
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
                <label className="task-form-section"><span>{t('tasks.details_due_prefix')}</span><input className="form-field" type="date" value={taskDraft.dueDate} onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })} /></label>
                <label className="task-form-section"><span>{t('tasks.time_label')}</span><input className="form-field" type="time" value={taskDraft.time} onChange={(event) => setTaskDraft({ ...taskDraft, time: event.target.value })} /></label>
                <label className="task-form-section"><span>{t('tasks.quick_add_priority_label')}</span><select className="form-field" value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value })}><option value="high">{t('tasks.priority_high')}</option><option value="mid">{t('tasks.priority_mid')}</option><option value="low">{t('tasks.priority_low')}</option></select></label>
                <label className="task-form-section"><span>{t('tasks.repeat_label')}</span><select className="form-field" value={taskDraft.repeat} onChange={(event) => setTaskDraft({ ...taskDraft, repeat: event.target.value })}><option value="none">{t('tasks.repeat_none')}</option><option value="daily">{t('tasks.freq_daily')}</option><option value="weekday">{t('tasks.freq_weekday')}</option><option value="weekly">{t('tasks.freq_weekly')}</option><option value="monthly">{t('tasks.freq_monthly')}</option></select></label>
              </div>
            </div>
            <footer className="task-drawer__footer"><button type="button" className="btn" onClick={() => setDrawerMode(null)}>{t('common.cancel')}</button><button type="button" className="btn primary" onClick={handleSaveDrawer}>{t('tasks.btn_save_changes')}</button></footer>
          </aside>
        </div>
      )}
    </div>
  )
}

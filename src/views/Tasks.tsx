import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDatePicker, { registerLocale } from 'react-datepicker'
import { enUS, zhCN } from 'date-fns/locale'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../components/AccessibleDialog'
import { useConfirmation } from '../components/ConfirmationProvider'
import { DateTimePicker, TimePicker } from '../components/DateTimePicker'
import { Dropdown } from '../components/Dropdown'
import { ViewportPortal } from '../components/ViewportPortal'
import { useDrawerTransition } from '../components/useDrawerTransition'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  CornerDownRight,
  Flag,
  Hourglass,
  ListTree,
  X,
  Kanban,
  ListChecks,
  ListTodo,
  Trash2,
  Plus,
  RefreshCw,
  Search,
  Undo2,
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
  parseRuleNumberList,
  getTemplateStartDateKey,
  getTemplateStartTime,
  getTemplateTimes,
  serializeRuleWeekDays,
  toLocalDateKey,
} from './taskScheduleUtils'
import { projectCalendarOccurrences } from './taskOccurrenceProjection'
import { getTaskDuePresentation } from './taskDuePresentationUtils'
import {
  canBindTaskToParent,
  formatTaskCode,
  getTaskAncestorPath,
  getTaskDescendantIds,
  parseTaskCode,
} from './taskHierarchyUtils'
import { getAutomaticTaskStatus, TASK_STATUS } from '../taskWorkflow'
import {
  buildCompleteTaskTreeMutation,
  buildAggregateTaskMutation,
  buildCloseTaskTreeMutation,
  buildReopenTaskTreeMutation,
  buildResolveTaskTreeMutation,
} from '../taskTreeMutation'
import './Tasks.css'

const getCurrentTimeValue = () => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

const getDefaultDueTime = () => '23:59:59'

const getDefaultScheduleTime = () => '09:00'
const DEFAULT_MISSED_POLICY = 'accumulate'

const normalizeScheduleTime = (value: string | null | undefined) => {
  if (!value) return getDefaultScheduleTime()
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value.slice(0, 5)
  return /^\d{2}:\d{2}$/.test(value) ? value : getDefaultScheduleTime()
}

const normalizeTaskDueTime = (value: string | null | undefined) => {
  if (!value) return '23:59:59'
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
}

const toLocalTimeValue = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(
    date.getSeconds(),
  ).padStart(2, '0')}`

const toLocalDateTime = (dateKey: string, time: string | null | undefined): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour = 0, minute = 0, second = 0] = normalizeTaskDueTime(time).split(':').map(Number)
  const result = new Date(year, month - 1, day, hour, minute, second)
  return result.getFullYear() === year &&
    result.getMonth() === month - 1 &&
    result.getDate() === day
    ? result
    : null
}

const toLocalDate = (dateKey: string) => toLocalDateTime(dateKey, '00:00:00')

registerLocale('zh-CN', zhCN)
registerLocale('en-US', enUS)

type TaskDeletionScope = 'single' | 'end-repeat' | 'delete-repeat' | 'delete-all-repeat'

type TaskDraft = {
  title: string
  description: string
  startDate: string
  startTime: string
  dueDate: string
  time: string
  priority: string
  requiresReview: boolean
  repeat: string
  parentId: number | null
}

export const Tasks: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { confirm } = useConfirmation()
  const datePickerLocale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'

  const getRuleScheduleSummary = (rule: any) => {
    if (rule.frequency === 'custom') return t('tasks.freq_once')
    if (rule.schedule_mode === 'interval') {
      return t('tasks.rule_summary_interval', {
        count: Math.max(1, Number(rule.interval) || 1),
      })
    }

    const weekdayNames = t('tasks.weekdays_sunday_first').split(',')
    const selectedWeekDays = parseRuleNumberList(rule.week_days, 0, 6)
    const selectedMonthDays = parseRuleNumberList(rule.month_days, 1, 31)
    const excludedWeekDays = parseRuleNumberList(rule.excluded_week_days, 0, 6)
    const excludedMonthDays = parseRuleNumberList(rule.excluded_month_days, 1, 31)
    const conditions: string[] = []

    if (selectedWeekDays.length > 0) {
      conditions.push(
        t('tasks.rule_summary_weekdays', {
          days: selectedWeekDays
            .sort((left, right) => left - right)
            .map((day) => weekdayNames[day])
            .join(t('tasks.rule_value_separator')),
        }),
      )
    }
    if (selectedMonthDays.length > 0) {
      conditions.push(
        t('tasks.rule_summary_month_days', {
          days: selectedMonthDays
            .sort((left, right) => left - right)
            .join(t('tasks.rule_value_separator')),
        }),
      )
    }

    if (rule.schedule_mode !== 'rules' && conditions.length === 0) {
      if (rule.frequency === 'weekday') return t('tasks.repeat_summary_weekday')
      if (rule.frequency === 'weekly') return t('tasks.repeat_summary_weekly')
      if (rule.frequency === 'monthly') return t('tasks.repeat_summary_monthly')
      if (rule.frequency === 'cron') return rule.cron || t('tasks.freq_cron')
    }

    const baseSummary =
      conditions.length > 0
        ? conditions.join(t('tasks.rule_condition_separator'))
        : t('tasks.rule_summary_every_day')
    const exclusions: string[] = []
    if (excludedWeekDays.length > 0) {
      exclusions.push(
        t('tasks.rule_summary_excluded_weekdays', {
          days: excludedWeekDays
            .sort((left, right) => left - right)
            .map((day) => weekdayNames[day])
            .join(t('tasks.rule_value_separator')),
        }),
      )
    }
    if (excludedMonthDays.length > 0) {
      exclusions.push(
        t('tasks.rule_summary_excluded_month_days', {
          days: excludedMonthDays
            .sort((left, right) => left - right)
            .join(t('tasks.rule_value_separator')),
        }),
      )
    }

    return exclusions.length > 0
      ? t('tasks.rule_summary_with_exclusions', {
          schedule: baseSummary,
          exclusions: exclusions.join(t('tasks.rule_condition_separator')),
        })
      : baseSummary
  }

  const getRuleTimesSummary = (rule: any) => {
    const times = getTemplateTimes(rule)
    return t('tasks.rule_summary_time_instances', {
      count: times.length,
      times: times.join(' / '),
    })
  }

  const getRuleRangeSummary = (rule: any) =>
    t('tasks.rule_summary_range', {
      start: getTemplateStartDateKey(rule),
      end: rule.end_date || t('tasks.rule_summary_permanent'),
    })

  const getRuleStatus = (rule: any) => {
    const today = toLocalDateKey(new Date())
    const start = getTemplateStartDateKey(rule)
    if (today < start) return { key: 'upcoming', label: t('tasks.rule_status_upcoming') }
    if (rule.end_date && today > rule.end_date) {
      return { key: 'ended', label: t('tasks.rule_status_ended') }
    }
    return { key: 'active', label: t('tasks.rule_status_active') }
  }

  const getOccurrenceScheduleTime = (task: any) => {
    const instanceTime = /T(\d{2}:\d{2})/.exec(String(task.instance_key || ''))?.[1]
    return normalizeScheduleTime(
      task.start_time || task.occurrence_time || instanceTime || task.due_time,
    )
  }

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

  const getPriorityBadgeLabel = (priority: string) => {
    switch (priority) {
      case 'high':
        return t('tasks.priority_badge_high')
      case 'mid':
        return t('tasks.priority_badge_mid')
      case 'low':
        return t('tasks.priority_badge_low')
      default:
        return t('tasks.priority_badge_mid')
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
      case '待处理':
        return t('tasks.lane_todo')
      case '进行中':
        return t('tasks.lane_inprogress')
      case '待审核':
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
  const [completionConfirmationTask, setCompletionConfirmationTask] = useState<any | null>(null)
  const [isCompletionConfirming, setIsCompletionConfirming] = useState(false)
  const completionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [deletionConfirmationTask, setDeletionConfirmationTask] = useState<any | null>(null)
  const [deletionScope, setDeletionScope] = useState<TaskDeletionScope>('single')
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showClosedTasks, setShowClosedTasks] = useState(false)
  const [taskQuery, setTaskQuery] = useState('')
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')
  const deletionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const deletionCancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const expandedSubtaskPanelRef = useRef<HTMLElement | null>(null)

  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null)
  const {
    isDrawerOpen: isTaskDrawerOpen,
    isDrawerMounted: isTaskDrawerMounted,
    openDrawer: animateTaskDrawerOpen,
    closeDrawer: closeTaskDrawer,
    drawerOverlayRef: taskDrawerOverlayRef,
    drawerPanelRef: taskDrawerPanelRef,
  } = useDrawerTransition(() => setDrawerMode(null))
  const [drawerErrors, setDrawerErrors] = useState<{
    title?: string
    timeWindow?: string
    ruleStartDate?: string
    ruleEndDate?: string
    hierarchy?: string
  }>({})
  const drawerTitleInputRef = useRef<HTMLInputElement | null>(null)
  const drawerStartDatePickerRef = useRef<ReactDatePicker | null>(null)
  const drawerDueDatePickerRef = useRef<ReactDatePicker | null>(null)
  const drawerRuleStartDatePickerRef = useRef<ReactDatePicker | null>(null)
  const drawerRuleTimePickerRefs = useRef<Array<ReactDatePicker | null>>([])
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({
    title: '',
    description: '',
    startDate: toLocalDateKey(new Date()),
    startTime: getCurrentTimeValue(),
    dueDate: '',
    time: getDefaultDueTime(),
    priority: 'mid',
    requiresReview: false,
    repeat: 'none',
    parentId: null,
  })
  const [parentTaskCode, setParentTaskCode] = useState('')
  const [peerTaskIds, setPeerTaskIds] = useState<number[]>([])
  const [isPeerDropdownOpen, setIsPeerDropdownOpen] = useState(false)
  const [peerTaskQuery, setPeerTaskQuery] = useState('')
  const [peerTaskVisibleCount, setPeerTaskVisibleCount] = useState(20)
  const peerDropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!drawerMode) return

    const closeDrawerDatePickersOnOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (
        event.target.closest('.react-datepicker-popper') ||
        event.target.closest('.task-date-picker__trigger')
      ) {
        return
      }
      drawerStartDatePickerRef.current?.setOpen(false)
      drawerDueDatePickerRef.current?.setOpen(false)
      drawerRuleStartDatePickerRef.current?.setOpen(false)
      drawerRuleTimePickerRefs.current.forEach((picker) => picker?.setOpen(false))
    }

    document.addEventListener('pointerdown', closeDrawerDatePickersOnOutsidePointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', closeDrawerDatePickersOnOutsidePointerDown, true)
  }, [drawerMode])

  useEffect(() => {
    if (!isPeerDropdownOpen) return

    const closePeerDropdownOnOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !peerDropdownRef.current?.contains(event.target)) {
        setIsPeerDropdownOpen(false)
      }
    }

    document.addEventListener('pointerdown', closePeerDropdownOnOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', closePeerDropdownOnOutsidePointerDown)
  }, [isPeerDropdownOpen])

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
  const [ruleScheduleMode, setRuleScheduleMode] = useState<'rules' | 'interval'>('rules')
  const [ruleInterval, setRuleInterval] = useState(1)
  const [ruleStartDate, setRuleStartDate] = useState(() => toLocalDateKey(new Date()))
  const [ruleEndDate, setRuleEndDate] = useState('')
  const [ruleTime, setRuleTime] = useState('09:00')
  const [ruleTimes, setRuleTimes] = useState<string[]>(['09:00'])
  const [ruleStepsText, setRuleStepsText] = useState('')
  const [rulePriority, setRulePriority] = useState('mid')
  const [ruleWeekDays, setRuleWeekDays] = useState<number[]>([]) // 0=Sun...6=Sat
  const [ruleMonthDays, setRuleMonthDays] = useState<number[]>([])
  const [ruleExcludedWeekDays, setRuleExcludedWeekDays] = useState<number[]>([])
  const [ruleExcludedMonthDays, setRuleExcludedMonthDays] = useState<number[]>([])
  const [ruleCron, setRuleCron] = useState('')

  // Calendar Mode State ('day' | 'week' | 'month')
  const [calendarMode, setCalendarMode] = useState<'day' | 'week' | 'month'>('week')
  const [calendarDate, setCalendarDate] = useState(() => new Date())

  // Templates
  const [templates, setTemplates] = useState<any[]>([])
  const [templateEditor, setTemplateEditor] = useState<any | null>(null)
  const [isRulePanelExpanded, setIsRulePanelExpanded] = useState(false)
  const [isMonthDayPickerExpanded, setIsMonthDayPickerExpanded] = useState(false)
  const [isRuleExclusionsExpanded, setIsRuleExclusionsExpanded] = useState(false)
  const [isExcludedMonthDayPickerExpanded, setIsExcludedMonthDayPickerExpanded] = useState(false)
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
        const loaded = await Promise.all(
          rows.map(async (template: any) => {
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
          }),
        )
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
        const ruleStatus = getRuleStatus(rule)
        return {
          id: rule.id,
          name: rule.title,
          action: t('tasks.log_rule_action'),
          trigger: `${getRuleScheduleSummary(rule)} · ${getRuleTimesSummary(rule)} · ${getRuleRangeSummary(rule)}`,
          status: ruleStatus.label,
          statusKey: ruleStatus.key,
          nextRun: nextOccurrence
            ? `${nextOccurrence.dateKey} ${nextOccurrence.time}`
            : t('tasks.log_rule_next_calculated'),
        }
      }),
    [rules, t],
  )

  const boardLanes = useMemo(
    () => [
      { key: 'lane_todo', dbVal: '待处理' },
      { key: 'lane_inprogress', dbVal: '进行中' },
      { key: 'lane_review', dbVal: '待审核' },
      { key: 'lane_closed', dbVal: '已关闭' },
    ],
    [],
  )
  const taskMatchesQuery = useCallback(
    (task: any) => {
      const query = taskQuery.trim().toLowerCase()
      if (!query) return true
      const code = task.is_virtual ? '' : formatTaskCode(task.id).toLowerCase()
      return (
        code.includes(query) ||
        String(task.title || '')
          .toLowerCase()
          .includes(query)
      )
    },
    [taskQuery],
  )
  const taskMatchesFilters = useCallback(
    (task: any) => {
      if (taskQuery.trim() && taskMatchesQuery(task)) return true
      if (!showClosedTasks && task.status === TASK_STATUS.closed) return false
      if (!task.due_date) return !dueDateFrom && !dueDateTo
      if (dueDateFrom && task.due_date < dueDateFrom) return false
      if (dueDateTo && task.due_date > dueDateTo) return false
      return taskMatchesQuery(task)
    },
    [dueDateFrom, dueDateTo, showClosedTasks, taskMatchesQuery, taskQuery],
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
    return projectCalendarOccurrences(tasks, rules, start, end, skippedOccurrences).filter(
      taskMatchesFilters,
    )
  }, [calendarVisibleDays, rules, skippedOccurrences, taskMatchesFilters, tasks])
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
        'INSERT OR IGNORE INTO recurring_instances (recur_rule_id, date_key) VALUES (?, ?)',
        [task.recur_rule_id, task.due_date],
      )
      const instanceResult = await api.dbQuery(
        'tasks',
        'SELECT id FROM recurring_instances WHERE recur_rule_id = ? AND date_key = ?',
        [task.recur_rule_id, task.due_date],
      )
      const recurringInstanceId = instanceResult?.data?.[0]?.id
      if (!recurringInstanceId) return
      await api.dbQuery(
        'tasks',
        `INSERT OR IGNORE INTO tasks (title, description, priority, status, requires_review,
          start_date, start_time, due_date, due_time, recur_rule_id, template_id,
          template_version, recurring_instance_id, instance_key, recur_instance_root, parent_id, task_kind, relation_kind, progress)
         VALUES (?, ?, ?, '待处理', ?, ?, '00:00:00', ?, '23:59:59', ?, ?, ?, ?, NULL, 1, ?, 'recurring_date_instance', ?, 0)`,
        [
          task.title,
          task.description || '',
          task.priority,
          task.requires_review ? 1 : 0,
          task.due_date,
          task.due_date,
          task.recur_rule_id,
          task.template_id || null,
          task.template_version || null,
          recurringInstanceId,
          task.parent_id || null,
        ],
      )
      const result = await api.dbQuery(
        'tasks',
        'SELECT * FROM tasks WHERE recurring_instance_id = ? AND recur_instance_root = 1 LIMIT 1',
        [recurringInstanceId],
      )
      const materialized = result?.data?.[0]
      if (materialized) {
        await api.dbQuery(
          'tasks',
          `INSERT OR IGNORE INTO tasks (title, description, priority, status, requires_review,
            start_date, start_time, due_date, due_time, recur_rule_id, template_id,
            template_version, recurring_instance_id, instance_key, parent_id, task_kind, relation_kind, progress)
           VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recurring_execution', 'recurring_occurrence', 0)`,
          [
            task.title,
            task.description || '',
            task.priority,
            task.requires_review ? 1 : 0,
            task.due_date,
            task.due_time || task.occurrence_time || '09:00',
            task.due_date,
            normalizeTaskDueTime(task.due_time || task.occurrence_time || '09:00'),
            task.recur_rule_id,
            task.template_id || null,
            task.template_version || null,
            recurringInstanceId,
            task.instance_key,
            materialized.id,
          ],
        )
        const childResult = await api.dbQuery(
          'tasks',
          'SELECT id FROM tasks WHERE recurring_instance_id = ? AND instance_key = ? AND parent_id = ? LIMIT 1',
          [recurringInstanceId, task.instance_key, materialized.id],
        )
        const childId = childResult?.data?.[0]?.id
        const steps = await api.dbQuery(
          'tasks',
          'SELECT * FROM recurring_rule_steps WHERE rule_id = ? ORDER BY sort_order ASC, id ASC',
          [task.recur_rule_id],
        )
        for (const step of steps?.data ?? []) {
          await api.dbQuery(
            'tasks',
            `INSERT INTO tasks (title, description, priority, status, requires_review,
              start_date, start_time, due_date, due_time, recur_rule_id, template_id,
              template_version, recurring_instance_id, instance_key, parent_id, task_kind, relation_kind, progress)
             SELECT ?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 'manual_child', 0
             WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE parent_id = ? AND title = ?)`,
            [
              step.title,
              step.description || '',
              step.priority || task.priority,
              task.requires_review ? 1 : 0,
              task.due_date,
              task.due_time || task.occurrence_time || '09:00',
              task.due_date,
              normalizeTaskDueTime(task.due_time || task.occurrence_time || '09:00'),
              task.recur_rule_id,
              task.template_id || null,
              task.template_version || null,
              recurringInstanceId,
              null,
              childId,
              childId,
              step.title,
            ],
          )
        }
      }
      await loadData()
      if (materialized) selectTaskForDetails(materialized)
      return
    }
    selectTaskForDetails(task)
  }

  const formatDue = (task: any) => {
    const due = getTaskDuePresentation(task.due_date, task.due_time)
    if (!due.dateKey) return t('tasks.due_date_not_set')
    return due.time ? `${due.dateKey} ${due.time}` : due.dateKey
  }

  const formatCompactDue = (task: any) => {
    const due = getTaskDuePresentation(task.due_date, task.due_time)
    if (!due.dateKey) return t('tasks.due_date_not_set')
    const date = due.dateKey.slice(-5)
    const time = due.time
    return time ? `${date} ${time}` : date
  }

  const renderCalendarTask = (task: any) => (
    <button
      key={task.id}
      type="button"
      className="task-calendar__task"
      onClick={() => openCalendarTask(task)}
    >
      <span className="task-calendar__task-title">
        {!task.is_virtual && <span className="task-code">{formatTaskCode(task.id)}</span>}
        {task.title}
      </span>
      <span className="task-calendar__task-meta">
        {task.parent_id && <span>↳ {formatTaskCode(task.parent_id)} · </span>}
        {getPriorityLabel(task.priority)} · {getStatusLabel(task.status)}
      </span>
    </button>
  )

  const openCreateDrawer = () => {
    setSelectedTaskId(null)
    setDrawerErrors({})
    setIsRulePanelExpanded(false)
    setIsMonthDayPickerExpanded(false)
    setIsRuleExclusionsExpanded(false)
    setIsExcludedMonthDayPickerExpanded(false)
    setEditRuleScope('future')
    setRuleFreq('daily')
    setRuleScheduleMode('rules')
    setRuleInterval(1)
    setRuleStartDate(toLocalDateKey(new Date()))
    setRuleEndDate('')
    setRuleTimes(['09:00'])
    setRuleStepsText('')
    setRuleWeekDays([])
    setRuleMonthDays([])
    setRuleExcludedWeekDays([])
    setRuleExcludedMonthDays([])
    setParentTaskCode('')
    setTaskDraft({
      title: '',
      description: '',
      startDate: toLocalDateKey(new Date()),
      startTime: getCurrentTimeValue(),
      dueDate: '',
      time: getDefaultDueTime(),
      priority: 'mid',
      requiresReview: false,
      repeat: 'none',
      parentId: null,
    })
    setDrawerMode('create')
    animateTaskDrawerOpen()
  }

  useEffect(() => {
    const handleCreateTask = () => openCreateDrawer()
    window.addEventListener('task:create', handleCreateTask)
    return () => window.removeEventListener('task:create', handleCreateTask)
  }, [])

  const selectTaskForDetails = (task: any) => {
    setSelectedTaskId(task.id)
    setDrawerErrors({})
    setEditDesc(task.description || '')
    setEditProgress(task.progress || 0)
    setParentTaskCode(task.parent_id ? formatTaskCode(task.parent_id) : '')
    const rule = task.recur_rule_id
      ? rules.find((candidate) => candidate.id === task.recur_rule_id)
      : null
    setIsRulePanelExpanded(Boolean(rule && rule.frequency !== 'custom'))
    setIsMonthDayPickerExpanded(false)
    setIsRuleExclusionsExpanded(Boolean(rule?.excluded_week_days || rule?.excluded_month_days))
    setIsExcludedMonthDayPickerExpanded(false)
    setEditRuleScope('future')
    if (rule) {
      setRuleFreq(rule.frequency || 'daily')
      setRuleScheduleMode(rule.schedule_mode === 'interval' ? 'interval' : 'rules')
      setRuleInterval(Math.max(1, Number(rule.interval || 1)))
      setRuleStartDate(getTemplateStartDateKey(rule))
      setRuleEndDate(rule.end_date || '')
      setRuleTimes(getTemplateTimes(rule))
      setRuleWeekDays(
        String(rule.week_days || '')
          .split(',')
          .map(Number)
          .filter((value) => value >= 0 && value <= 6),
      )
      setRuleMonthDays(
        String(rule.month_days || '')
          .split(',')
          .map(Number)
          .filter(Boolean),
      )
      setRuleExcludedWeekDays(
        String(rule.excluded_week_days || '')
          .split(',')
          .map(Number)
          .filter((value) => value >= 0 && value <= 6),
      )
      setRuleExcludedMonthDays(
        String(rule.excluded_month_days || '')
          .split(',')
          .map(Number)
          .filter((value) => value >= 1 && value <= 31),
      )
      setRulePriority(rule.priority || task.priority || 'mid')
      if (api?.dbQuery && task.recur_rule_id) {
        void api
          .dbQuery(
            'tasks',
            'SELECT title FROM recurring_rule_steps WHERE rule_id = ? ORDER BY sort_order ASC, id ASC',
            [task.recur_rule_id],
          )
          .then((result: any) =>
            setRuleStepsText((result?.data ?? []).map((step: any) => step.title).join('\n')),
          )
      }
    } else {
      setRuleStepsText('')
    }
    setTaskDraft({
      title: task.title || '',
      description: task.description || '',
      startDate: task.start_date || task.due_date || toLocalDateKey(new Date()),
      startTime: normalizeTaskDueTime(task.start_time || '00:00:00'),
      dueDate: task.due_date || toLocalDateKey(new Date()),
      time: normalizeTaskDueTime(task.due_time),
      priority: task.priority || 'mid',
      requiresReview: Boolean(task.requires_review),
      repeat: rule && rule.frequency !== 'custom' ? rule.frequency : 'none',
      parentId: task.parent_id ?? null,
    })
    setDrawerMode('edit')
    animateTaskDrawerOpen()
  }

  const getCurrentRuleScheduleSummary = () => {
    return getRuleScheduleSummary({
      frequency: ruleFreq,
      schedule_mode: ruleScheduleMode,
      interval: ruleInterval,
      week_days: ruleWeekDays.join(','),
      month_days: ruleMonthDays.join(','),
      excluded_week_days: ruleExcludedWeekDays.join(','),
      excluded_month_days: ruleExcludedMonthDays.join(','),
    })
  }

  const getCurrentRuleRangeSummary = () =>
    t('tasks.rule_summary_range', {
      start: ruleStartDate,
      end: ruleEndDate || t('tasks.rule_summary_permanent'),
    })

  const getRepeatSummary = (task: any) => {
    if (!task.recur_rule_id) return null

    const rule = rules.find((candidate) => candidate.id === task.recur_rule_id)
    if (!rule || rule.frequency === 'custom') return null
    return {
      schedule: getRuleScheduleSummary(rule),
      times: getRuleTimesSummary(rule),
      range: getRuleRangeSummary(rule),
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

  const loadData = async () => {
    if (api) {
      // Load Tasks
      const res = await api.dbQuery(
        'tasks',
        "SELECT * FROM tasks ORDER BY COALESCE(due_date, created_at) ASC, COALESCE(due_time, '23:59:59') ASC, id ASC",
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

      const skippedRes = await api.dbQuery(
        'tasks',
        'SELECT recur_rule_id, instance_key FROM recurring_rule_occurrence_exceptions',
      )
      if (skippedRes?.success) {
        setSkippedOccurrences(
          new Set(skippedRes.data.map((item: any) => `${item.recur_rule_id}:${item.instance_key}`)),
        )
      }
    }
  }

  const refreshAncestorProgress = async (startingTaskIds: Array<number | null | undefined>) => {
    if (!api) return

    const startingIds = startingTaskIds.filter((id): id is number => Number.isInteger(id))
    for (const startingId of startingIds) {
      let taskId: number | null = startingId
      const visited = new Set<number>()
      while (taskId && !visited.has(taskId)) {
        visited.add(taskId)
        const taskResult: any = await api.dbQuery(
          'tasks',
          'SELECT id, parent_id, start_date, start_time, due_date, due_time FROM tasks WHERE id = ?',
          [taskId],
        )
        const childResult: any = await api.dbQuery(
          'tasks',
          'SELECT progress, status, is_completed FROM tasks WHERE parent_id = ?',
          [taskId],
        )
        const task: { id: number; parent_id?: number | null; start_date?: string; start_time?: string; due_date?: string; due_time?: string } | undefined = taskResult?.data?.[0]
        const children = childResult?.data ?? []
        if (!task) break

        if (children.length > 0) {
          const progress = Math.round(
            children.reduce((sum: number, child: any) => sum + Number(child.progress || 0), 0) /
              children.length,
          )
          await api.dbQuery('tasks', 'UPDATE tasks SET progress = ? WHERE id = ?', [
            progress,
            taskId,
          ])

          const aggregate = buildAggregateTaskMutation(taskId)
          await api.dbQuery('tasks', aggregate.sql, aggregate.params)
        }
        taskId = task.parent_id ? Number(task.parent_id) : null
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

  useEffect(() => {
    return api?.onTasksChanged?.(() => {
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
  const selectRule = async (rule: any) => {
    setSelectedRuleId(rule.id)
    setRuleName(rule.title)
    setRuleDesc(rule.description || '')
    setRuleFreq(rule.frequency)
    setRuleScheduleMode(rule.schedule_mode === 'interval' ? 'interval' : 'rules')
    setRuleInterval(rule.interval || 1)
    setRuleStartDate(getTemplateStartDateKey(rule))
    setRuleEndDate(rule.end_date || '')
    setRuleTime(getTemplateStartTime(rule))
    setRuleTimes(getTemplateTimes(rule))
    setRulePriority(rule.priority || 'mid')
    setRuleWeekDays(
      (rule.week_days || '')
        .split(',')
        .map((x: string) => parseInt(x))
        .filter((value: number) => value >= 0 && value <= 6),
    )
    setRuleMonthDays(
      (rule.month_days || '')
        .split(',')
        .filter(Boolean)
        .map((x: string) => parseInt(x)),
    )
    setRuleExcludedWeekDays(
      (rule.excluded_week_days || '')
        .split(',')
        .filter(Boolean)
        .map((x: string) => parseInt(x)),
    )
    setRuleExcludedMonthDays(
      (rule.excluded_month_days || '')
        .split(',')
        .filter(Boolean)
        .map((x: string) => parseInt(x)),
    )
    setRuleCron(rule.cron || '')
    if (api?.dbQuery) {
      const stepsResult = await api.dbQuery(
        'tasks',
        'SELECT title FROM recurring_rule_steps WHERE rule_id = ? ORDER BY sort_order ASC, id ASC',
        [rule.id],
      )
      setRuleStepsText((stepsResult?.data ?? []).map((step: any) => step.title).join('\n'))
    } else {
      setRuleStepsText('')
    }
  }

  // Task checkmark click toggle
  const toggleTaskDone = async (task: any) => {
    if (!api) return
    const nextDone = task.is_completed === 1 ? 0 : 1
    const mutation = nextDone
      ? tasks.some((candidate) => candidate.parent_id === task.id)
        ? buildCloseTaskTreeMutation(task.id)
        : buildCompleteTaskTreeMutation(task.id)
      : buildReopenTaskTreeMutation(task.id)
    const result = await api.dbQuery('tasks', mutation.sql, mutation.params)
    if (!result?.success) return

    await refreshAncestorProgress([task.parent_id])

    showToast(nextDone ? t('tasks.toast_completed') : t('tasks.toast_reopened'))
    await loadData()
  }

  const reviewTask = async (task: any, approved: boolean) => {
    if (!api || task.status !== TASK_STATUS.review) return
    const mutation = approved
      ? buildResolveTaskTreeMutation(task.id, TASK_STATUS.closed)
      : buildReopenTaskTreeMutation(task.id)
    const result = await api.dbQuery('tasks', mutation.sql, mutation.params)
    if (result?.success) {
      await refreshAncestorProgress([task.parent_id])
      await loadData()
    }
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

  const resolveOverdueTask = async (
    status: typeof TASK_STATUS.review | typeof TASK_STATUS.closed,
  ) => {
    const task = completionConfirmationTask
    if (
      !api ||
      !task ||
      task.status !== TASK_STATUS.overdue ||
      isCompletionConfirming ||
      (status === TASK_STATUS.review && !task.requires_review)
    )
      return

    setIsCompletionConfirming(true)
    try {
      const mutation = buildResolveTaskTreeMutation(task.id, status)
      const result = await api.dbQuery('tasks', mutation.sql, mutation.params)
      if (!result?.success) return
      await refreshAncestorProgress([task.parent_id])
      setCompletionConfirmationTask(null)
      await loadData()
    } finally {
      setIsCompletionConfirming(false)
    }
  }

  const getCompletionConfirmationCopy = (task: any) => {
    const hasSubtasks = tasks.some((candidate) => candidate.parent_id === task.id)
    if (task.is_completed === 1) {
      return {
        title: t('tasks.confirm_reopen_title'),
        description: hasSubtasks
          ? t('tasks.confirm_reopen_with_subtasks_description', { title: task.title })
          : t('tasks.confirm_reopen_description', { title: task.title }),
        action: t('tasks.confirm_reopen_action'),
      }
    }

    if (task.status === '已逾期') {
      return {
        title: t('tasks.confirm_resolve_overdue_title'),
        description: hasSubtasks
          ? t('tasks.confirm_resolve_overdue_with_subtasks_description', { title: task.title })
          : t('tasks.confirm_resolve_overdue_description', { title: task.title }),
        action: null,
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
                child.status === TASK_STATUS.review
                  ? t('tasks.lane_review')
                  : child.status === TASK_STATUS.closed
                    ? t('tasks.lane_closed')
                    : child.is_completed === 1
                      ? t('tasks.reopen_task_action')
                      : isChildOverdue
                        ? t('tasks.close_overdue_task_action')
                        : t('tasks.complete_task_action')
              }
              aria-label={
                child.status === TASK_STATUS.review
                  ? t('tasks.lane_review')
                  : child.status === TASK_STATUS.closed
                    ? t('tasks.lane_closed')
                    : child.is_completed === 1
                      ? t('tasks.reopen_task_action')
                      : isChildOverdue
                        ? t('tasks.close_overdue_task_action')
                        : t('tasks.complete_task_action')
              }
              onClick={(e) => {
                e.stopPropagation()
                requestTaskCompletionToggle(child, e.currentTarget)
              }}
              disabled={child.status === TASK_STATUS.review || child.status === TASK_STATUS.closed}
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
            <span
              className={`task-row__date ${child.status === '已逾期' ? 'is-overdue-date' : ''}`}
            >
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
            <span className="task-row__title">
              <span className="task-code">{formatTaskCode(child.id)}</span>
              {child.title}
            </span>
          </div>,
          ...renderSubtaskRows(child.id, depth + 1, nextVisited),
        ]
      })

  const toggleTaskGroup = (taskId: number) => {
    setExpandedTaskGroupId((current) => (current === taskId ? null : taskId))
  }

  useEffect(() => {
    if (expandedTaskGroupId === null) return

    const frame = window.requestAnimationFrame(() => {
      const panel = expandedSubtaskPanelRef.current
      if (!panel) return
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      panel.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [expandedTaskGroupId])

  const handleSaveDrawer = async () => {
    const nextErrors: {
      title?: string
      timeWindow?: string
      ruleStartDate?: string
      ruleEndDate?: string
      hierarchy?: string
    } = {}
    if (!taskDraft.title.trim()) nextErrors.title = t('tasks.validation_title_required')
    if (taskDraft.repeat !== 'none' && !ruleStartDate) {
      nextErrors.ruleStartDate = t('tasks.validation_rule_start_date_required')
    }
    if (
      taskDraft.repeat === 'none' &&
      taskDraft.dueDate &&
      `${taskDraft.dueDate}T${normalizeTaskDueTime(taskDraft.time)}` <
        `${taskDraft.startDate}T${normalizeTaskDueTime(taskDraft.startTime)}`
    ) {
      nextErrors.timeWindow = t('tasks.invalid_time_window')
    }
    if (taskDraft.repeat !== 'none' && ruleEndDate && ruleEndDate < ruleStartDate) {
      nextErrors.ruleEndDate = t('tasks.validation_rule_end_date_before_start')
    }
    if (taskDraft.parentId !== null) {
      const parent = tasks.find((task) => task.id === taskDraft.parentId)
      if (!canBindTaskToParent(tasks, selectedTaskId, taskDraft.parentId)) {
        nextErrors.hierarchy = t('tasks.parent_task_cycle_error')
      }
      if (
        !parent ||
        (parent.status === TASK_STATUS.closed && parent.id !== activeTask?.parent_id)
      ) {
        nextErrors.hierarchy = t('tasks.parent_task_unavailable_error')
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setDrawerErrors(nextErrors)
      window.requestAnimationFrame(() => {
        if (nextErrors.title) drawerTitleInputRef.current?.focus()
      })
      return
    }
    setDrawerErrors({})

    if (!api) return

    const targetParentId = taskDraft.parentId

    if (drawerMode === 'create') {
      if (taskDraft.repeat === 'none') {
        const result = await api.dbQuery(
          'tasks',
          `INSERT INTO tasks (title, description, priority, status, requires_review, start_date, start_time, due_date, due_time, parent_id, task_kind, relation_kind, progress)
           VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, 'normal', ?, 0)`,
          [
            taskDraft.title.trim(),
            taskDraft.description,
            taskDraft.priority,
            taskDraft.requiresReview ? 1 : 0,
            taskDraft.startDate,
            normalizeTaskDueTime(taskDraft.startTime),
            taskDraft.dueDate || null,
            normalizeTaskDueTime(taskDraft.time),
            targetParentId,
            targetParentId === null ? 'root' : 'manual_child',
          ],
        )
        const createdTaskId = Number(result?.data?.lastInsertRowid)
        if (result?.success && createdTaskId) {
          await refreshAncestorProgress([targetParentId])
          showToast(t('tasks.toast_task_added'))
        }
      } else {
        const effectiveTimes = ruleTimes.length > 0 ? ruleTimes : ['09:00']
        const res = await api.dbQuery(
          'tasks',
          `INSERT INTO recurring_rules (title, description, frequency, schedule_mode, interval, week_days, month_days, excluded_week_days, excluded_month_days, start_date, end_date, start_time, time_slots, priority, requires_review, parent_id, end_condition, missed_policy)
           VALUES (?, ?, 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'never', ?)`,
          [
            taskDraft.title.trim(),
            taskDraft.description,
            ruleScheduleMode,
            ruleInterval,
            ruleScheduleMode === 'rules' ? ruleWeekDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleMonthDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleExcludedWeekDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleExcludedMonthDays.join(',') : '',
            ruleStartDate,
            ruleEndDate || null,
            effectiveTimes[0],
            effectiveTimes.join(','),
            taskDraft.priority,
            taskDraft.requiresReview ? 1 : 0,
            targetParentId,
            DEFAULT_MISSED_POLICY,
          ],
        )
        if (res?.success) {
          const ruleId = res.data?.lastInsertRowid || res.data?.insertId
          const steps = ruleStepsText.split('\n').map((step) => step.trim()).filter(Boolean)
          if (ruleId) {
            for (const [index, step] of steps.entries()) {
              await api.dbQuery(
                'tasks',
                'INSERT INTO recurring_rule_steps (rule_id, title, description, priority, sort_order) VALUES (?, ?, \'\', ?, ?)',
                [ruleId, step, taskDraft.priority, index + 1],
              )
            }
          }
          await runDueTaskGeneration()
          showToast(t('tasks.toast_task_added'))
        }
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
      const isChangingToNonRecurring = Boolean(
        activeTask.recur_rule_id && taskDraft.repeat === 'none',
      )
      const isChangingToRecurring = Boolean(
        !activeTask.recur_rule_id && taskDraft.repeat !== 'none',
      )

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
         SET title = ?, description = ?, priority = ?, requires_review = ?, start_date = ?, start_time = ?, due_date = ?, due_time = ?,
             recur_rule_id = CASE WHEN ? THEN NULL ELSE recur_rule_id END,
             template_id = CASE WHEN ? THEN NULL ELSE template_id END,
             template_version = CASE WHEN ? THEN NULL ELSE template_version END,
             instance_key = CASE WHEN ? THEN NULL ELSE instance_key END,
             recur_instance_root = CASE WHEN ? THEN 0 ELSE recur_instance_root END,
             parent_id = ?
         WHERE id = ?`,
        [
          taskDraft.title.trim(),
          taskDraft.description,
          taskDraft.priority,
          taskDraft.requiresReview ? 1 : 0,
          taskDraft.startDate,
          normalizeTaskDueTime(taskDraft.startTime),
          taskDraft.dueDate,
          normalizeTaskDueTime(taskDraft.time),
          isChangingToNonRecurring ? 1 : 0,
          isChangingToNonRecurring ? 1 : 0,
          isChangingToNonRecurring ? 1 : 0,
          isChangingToNonRecurring ? 1 : 0,
          isChangingToNonRecurring ? 1 : 0,
          targetParentId,
          activeTask.id,
        ],
      )

      if (isChangingToRecurring) {
        const effectiveTimes = ruleTimes.length > 0 ? ruleTimes : ['09:00']
        const ruleResult = await api.dbQuery(
          'tasks',
          `INSERT INTO recurring_rules
           (title, description, frequency, schedule_mode, interval, week_days, month_days, excluded_week_days, excluded_month_days, start_date, end_date, start_time, time_slots, priority, requires_review, parent_id, end_condition, missed_policy)
           VALUES (?, ?, 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'never', ?)`,
          [
            taskDraft.title.trim(),
            taskDraft.description,
            ruleScheduleMode,
            ruleInterval,
            ruleScheduleMode === 'rules' ? ruleWeekDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleMonthDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleExcludedWeekDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleExcludedMonthDays.join(',') : '',
            ruleStartDate,
            ruleEndDate || null,
            effectiveTimes[0],
            effectiveTimes.join(','),
            taskDraft.priority,
            taskDraft.requiresReview ? 1 : 0,
            targetParentId,
            DEFAULT_MISSED_POLICY,
          ],
        )
        const ruleId = ruleResult?.data?.lastInsertRowid || ruleResult?.data?.insertId
        if (ruleId) {
          await api.dbQuery(
            'tasks',
            `UPDATE tasks
             SET recur_rule_id = ?, instance_key = ?, recur_instance_root = 1,
                 start_date = ?, start_time = ?, due_date = ?, due_time = '23:59:59'
             WHERE id = ?`,
            [
              ruleId,
              `${ruleStartDate}T${normalizeScheduleTime(effectiveTimes[0])}`,
              ruleStartDate,
              normalizeScheduleTime(effectiveTimes[0]),
              ruleStartDate,
              activeTask.id,
            ],
          )
          const steps = ruleStepsText.split('\n').map((step) => step.trim()).filter(Boolean)
          for (const [index, step] of steps.entries()) {
            await api.dbQuery(
              'tasks',
              'INSERT INTO recurring_rule_steps (rule_id, title, description, priority, sort_order) VALUES (?, ?, \'\', ?, ?)',
              [ruleId, step, taskDraft.priority, index + 1],
            )
          }
        }
      } else if (
        activeTask.recur_rule_id &&
        !isChangingToNonRecurring &&
        editRuleScope !== 'single'
      ) {
        await api.dbQuery(
          'tasks',
          'UPDATE recurring_rules SET title = ?, description = ?, frequency = ?, schedule_mode = ?, interval = ?, week_days = ?, month_days = ?, excluded_week_days = ?, excluded_month_days = ?, start_date = ?, end_date = ?, start_time = ?, time_slots = ?, priority = ?, requires_review = ?, parent_id = ? WHERE id = ?',
          [
            taskDraft.title.trim(),
            taskDraft.description,
            'daily',
            ruleScheduleMode,
            ruleInterval,
            ruleScheduleMode === 'rules' ? ruleWeekDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleMonthDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleExcludedWeekDays.join(',') : '',
            ruleScheduleMode === 'rules' ? ruleExcludedMonthDays.join(',') : '',
            ruleStartDate,
            ruleEndDate || null,
            ruleTimes[0],
            ruleTimes.join(','),
            taskDraft.priority,
            taskDraft.requiresReview ? 1 : 0,
            targetParentId,
            activeTask.recur_rule_id,
          ],
        )
        const steps = ruleStepsText.split('\n').map((step) => step.trim()).filter(Boolean)
        await api.dbQuery('tasks', 'DELETE FROM recurring_rule_steps WHERE rule_id = ?', [activeTask.recur_rule_id])
        for (const [index, step] of steps.entries()) {
          await api.dbQuery(
            'tasks',
            'INSERT INTO recurring_rule_steps (rule_id, title, description, priority, sort_order) VALUES (?, ?, \'\', ?, ?)',
            [activeTask.recur_rule_id, step, taskDraft.priority, index + 1],
          )
        }
      }
      const nextPeerTaskIds = peerTaskIds.filter((peerId) =>
        tasks.some(
          (task) =>
            task.id === peerId && task.parent_id === targetParentId && task.id !== activeTask.id,
        ),
      )
      await api.dbQuery(
        'tasks',
        'DELETE FROM task_peer_links WHERE task_id = ? OR peer_task_id = ?',
        [activeTask.id, activeTask.id],
      )
      for (const peerId of nextPeerTaskIds) {
        await api.dbQuery(
          'tasks',
          'INSERT OR IGNORE INTO task_peer_links (task_id, peer_task_id) VALUES (?, ?)',
          [Math.min(activeTask.id, peerId), Math.max(activeTask.id, peerId)],
        )
      }
      await refreshAncestorProgress([activeTask.parent_id, targetParentId])
      showToast(t('tasks.toast_details_updated'))
    }

    closeTaskDrawer()
    await loadData()
  }

  const isRecurringRootTask = (task: any) =>
    Boolean(
      task?.recur_rule_id &&
        (task.recurring_instance_id || task.instance_key) &&
        task.recur_instance_root === 1,
    )

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
    // Legacy selector shape retained for migration-aware consumers:
    // SELECT id FROM tasks WHERE recur_rule_id = ? AND parent_id IS NULL

    const result = afterOccurrence?.due_date
      ? await api.dbQuery(
          'tasks',
          `
            SELECT id FROM tasks
            WHERE recur_rule_id = ?
              AND recur_instance_root = 1
              AND is_completed = 0
              AND (due_date > ? OR due_date = ?)
          `,
          [
            ruleId,
            afterOccurrence.due_date,
            afterOccurrence.due_date,
          ],
        )
      : await api.dbQuery(
          'tasks',
          'SELECT id FROM tasks WHERE recur_rule_id = ? AND recur_instance_root = 1 AND is_completed = 0',
          [ruleId],
        )

    for (const task of result?.data ?? []) {
      await deleteTaskTree(task.id)
    }
  }

  const deleteAllRecurringTaskTrees = async (ruleId: number) => {
    if (!api) return
    // Legacy selector shape retained for migration-aware consumers:
    // SELECT id FROM tasks WHERE recur_rule_id = ? AND parent_id IS NULL

    const result = await api.dbQuery(
      'tasks',
      'SELECT id FROM tasks WHERE recur_rule_id = ? AND recur_instance_root = 1',
      [ruleId],
    )

    for (const task of result?.data ?? []) {
      await deleteTaskTree(task.id)
    }
  }

  const deleteRecurringRule = async (ruleId: number) => {
    if (!api) return
    await api.dbQuery('tasks', 'DELETE FROM recurring_rule_steps WHERE rule_id = ?', [ruleId])
    await api.dbQuery(
      'tasks',
      'DELETE FROM recurring_rule_occurrence_exceptions WHERE recur_rule_id = ?',
      [ruleId],
    )
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
      if (canManageRepeat && (deletionScope === 'single' || deletionScope === 'end-repeat')) {
        const occurrenceKeys = task.instance_key
          ? [task.instance_key]
          : (
              await api.dbQuery(
                'tasks',
                'SELECT instance_key FROM tasks WHERE parent_id = ? AND instance_key IS NOT NULL',
                [task.id],
              )
            )?.data?.map((row: any) => row.instance_key) ?? []
        for (const occurrenceKey of occurrenceKeys) {
          await api.dbQuery(
            'tasks',
            'INSERT OR IGNORE INTO recurring_rule_occurrence_exceptions (recur_rule_id, instance_key) VALUES (?, ?)',
            [task.recur_rule_id, occurrenceKey],
          )
        }
      }

      if (canManageRepeat && deletionScope === 'delete-all-repeat') {
        await deleteAllRecurringTaskTrees(task.recur_rule_id)
        await deleteRecurringRule(task.recur_rule_id)
        showToast(t('tasks.toast_repeat_all_deleted'))
      } else {
        await deleteTaskTree(task.id)
      }

      if (canManageRepeat && deletionScope === 'end-repeat') {
        await deleteUnfinishedRecurringTaskTrees(task.recur_rule_id, task)
        await deleteRecurringRule(task.recur_rule_id)
        showToast(t('tasks.toast_repeat_ended'))
      } else if (canManageRepeat && deletionScope === 'delete-repeat') {
        await deleteUnfinishedRecurringTaskTrees(task.recur_rule_id)
        await deleteRecurringRule(task.recur_rule_id)
        showToast(t('tasks.toast_repeat_deleted'))
      } else if (deletionScope !== 'delete-all-repeat') {
        showToast(t('tasks.toast_task_deleted'))
      }

      setExpandedTaskGroupId(null)
      setSelectedTaskId(null)
      closeTaskDrawer()
      setDeletionConfirmationTask(null)
      await loadData()
    } finally {
      setIsDeletingTask(false)
    }
  }

  // Save Task Detail modifications
  const handleSaveDetails = async () => {
    if (!selectedTaskId || !api) return

    const isCompleted = editProgress === 100 ? 1 : 0
    const isCompletingTask = isCompleted === 1 && activeTask?.is_completed !== 1

    // Completing from the details panel must use the same tree mutation as the
    // task-row checkmark so every unfinished descendant is completed atomically.
    if (isCompletingTask) {
      const mutation = buildCompleteTaskTreeMutation(selectedTaskId)
      const result = api.dbTransaction
        ? await api.dbTransaction('tasks', [
            {
              sql: 'UPDATE tasks SET description = ? WHERE id = ?',
              params: [editDesc, selectedTaskId],
            },
            mutation,
          ])
        : await api.dbQuery('tasks', 'UPDATE tasks SET description = ? WHERE id = ?', [
            editDesc,
            selectedTaskId,
          ])

      if (api.dbTransaction) {
        if (!result?.success) return
      } else {
        if (!result?.success) return
        const mutationResult = await api.dbQuery('tasks', mutation.sql, mutation.params)
        if (!mutationResult?.success) return
      }

      await refreshAncestorProgress([activeTask?.parent_id])
      showToast(t('tasks.toast_details_updated'))
      await loadData()
      return
    }

    const status = isCompleted
      ? activeTask?.requires_review
        ? TASK_STATUS.review
        : TASK_STATUS.closed
      : getAutomaticTaskStatus({ ...activeTask, is_completed: 0, status: TASK_STATUS.inProgress })

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
      await refreshAncestorProgress([activeTask?.parent_id])
      showToast(t('tasks.toast_details_updated'))
      await loadData()
    }
  }

  // Save / Create Recurring Rule
  const handleSaveRule = async () => {
    if (!api) return

    if (ruleFreq === 'cron') {
      showToast(t('tasks.legacy_cron_save_blocked'))
      return
    }

    if (ruleEndDate && ruleEndDate < ruleStartDate) {
      showToast(t('tasks.validation_rule_end_date_before_start'))
      return
    }

    if (!api) return

    const weekDaysStr = ruleScheduleMode === 'rules' ? ruleWeekDays.join(',') : ''
    const monthDaysStr = ruleScheduleMode === 'rules' ? ruleMonthDays.join(',') : ''
    const excludedWeekDaysStr = ruleScheduleMode === 'rules' ? ruleExcludedWeekDays.join(',') : ''
    const excludedMonthDaysStr = ruleScheduleMode === 'rules' ? ruleExcludedMonthDays.join(',') : ''
    const timeSlots = ruleTimes.length > 0 ? ruleTimes : [ruleTime]
    const primaryTime = timeSlots[0] || '09:00'
    const timeSlotsStr = timeSlots.join(',')
    const steps = ruleStepsText
      .split('\n')
      .map((step) => step.trim())
      .filter(Boolean)

    if (selectedRuleId) {
      // Update
      const query = `
        UPDATE recurring_rules 
        SET title = ?, description = ?, frequency = 'daily', schedule_mode = ?, interval = ?, week_days = ?, month_days = ?, excluded_week_days = ?, excluded_month_days = ?, cron = ?, start_date = ?, end_date = ?, start_time = ?, time_slots = ?, priority = ?
        WHERE id = ?
      `
      await api.dbQuery('tasks', query, [
        ruleName,
        ruleDesc,
        ruleScheduleMode,
        ruleInterval,
        weekDaysStr,
        monthDaysStr,
        excludedWeekDaysStr,
        excludedMonthDaysStr,
        ruleCron,
        ruleStartDate,
        ruleEndDate || null,
        primaryTime,
        timeSlotsStr,
        rulePriority,
        selectedRuleId,
      ])
      await api.dbQuery('tasks', 'DELETE FROM recurring_rule_steps WHERE rule_id = ?', [selectedRuleId])
      for (const [index, step] of steps.entries()) {
        await api.dbQuery(
          'tasks',
          'INSERT INTO recurring_rule_steps (rule_id, title, description, priority, sort_order) VALUES (?, ?, \'\', ?, ?)',
          [selectedRuleId, step, rulePriority, index + 1],
        )
      }
      showToast(t('tasks.toast_rule_modified'))
    } else {
      // Create new
      const query = `
        INSERT INTO recurring_rules (
          title, description, frequency, schedule_mode, interval, week_days, month_days, excluded_week_days, excluded_month_days, cron, start_date, end_date, start_time, time_slots, priority, missed_policy
        )
        VALUES (?, ?, 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      const result = await api.dbQuery('tasks', query, [
        ruleName,
        ruleDesc,
        ruleScheduleMode,
        ruleInterval,
        weekDaysStr,
        monthDaysStr,
        excludedWeekDaysStr,
        excludedMonthDaysStr,
        ruleCron,
        ruleStartDate,
        ruleEndDate || null,
        primaryTime,
        timeSlotsStr,
        rulePriority,
        DEFAULT_MISSED_POLICY,
      ])
      const ruleId = result?.data?.lastInsertRowid || result?.data?.insertId
      if (ruleId) {
        for (const [index, step] of steps.entries()) {
          await api.dbQuery(
            'tasks',
            'INSERT INTO recurring_rule_steps (rule_id, title, description, priority, sort_order) VALUES (?, ?, \'\', ?, ?)',
            [ruleId, step, rulePriority, index + 1],
          )
        }
      }
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
    setRuleScheduleMode('rules')
    setRuleInterval(1)
    setRuleStartDate(toLocalDateKey(new Date()))
    setRuleEndDate('')
    setRuleTime('09:00')
    setRuleTimes(['09:00'])
    setRuleStepsText('')
    setRulePriority('mid')
    setRuleWeekDays([])
    setRuleMonthDays([])
    setRuleExcludedWeekDays([])
    setRuleExcludedMonthDays([])
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
    setTemplateEditor(
      template
        ? {
            id: template.id,
            templateKey: template.templateKey,
            title: template.title,
            description: template.description || '',
            icon: template.icon || '🧩',
            subtasksText: (template.subtasks || []).join('\n'),
          }
        : { id: null, templateKey: '', title: '', description: '', icon: '🧩', subtasksText: '' },
    )
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
        [
          templateEditor.title.trim(),
          templateEditor.description,
          templateEditor.icon,
          version,
          templateEditor.id,
        ],
      )
      await api.dbQuery('tasks', 'DELETE FROM task_template_steps WHERE template_id = ?', [
        templateEditor.id,
      ])
      for (const [index, step] of steps.entries()) {
        await api.dbQuery(
          'tasks',
          `INSERT INTO task_template_steps (template_id, title, description, priority, sort_order) VALUES (?, ?, '', 'mid', ?)`,
          [templateEditor.id, step, index + 1],
        )
      }
      setTemplates((currentTemplates) =>
        currentTemplates.map((template) =>
          template.id === templateEditor.id
            ? {
                ...template,
                title: templateEditor.title.trim(),
                description: templateEditor.description,
                icon: templateEditor.icon,
                version,
                subtasks: steps,
                tags: [t('tasks.template_version_label', { version })],
              }
            : template,
        ),
      )
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
        setTemplates((currentTemplates) => [
          {
            id,
            templateKey,
            title: templateEditor.title.trim(),
            description: templateEditor.description,
            icon: templateEditor.icon,
            version: 1,
            subtasks: steps,
            tags: [t('tasks.template_version_label', { version: 1 })],
          },
          ...currentTemplates,
        ])
      }
    }
    setTemplateEditor(null)
    showToast(t('tasks.toast_template_saved'))
  }

  const handleDeleteTemplate = async (template: any) => {
    if (!api?.dbQuery || !template.id || String(template.templateKey || '').startsWith('builtin-'))
      return
    if (
      !(await confirm({
        title: t('tasks.delete_template_title'),
        description: t('tasks.delete_template_description'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    await api.dbQuery('tasks', 'DELETE FROM task_template_steps WHERE template_id = ?', [
      template.id,
    ])
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
      [
        template.title,
        t('tasks.template_created_desc'),
        todayYMD,
        startTime,
        startTime,
        templateId,
        templateVersion,
      ],
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
  useEffect(() => {
    if (!api || drawerMode !== 'edit' || !activeTask) {
      setPeerTaskIds([])
      return
    }

    let cancelled = false
    void api
      .dbQuery(
        'tasks',
        `SELECT CASE WHEN task_id = ? THEN peer_task_id ELSE task_id END AS id
         FROM task_peer_links
         WHERE task_id = ? OR peer_task_id = ?`,
        [activeTask.id, activeTask.id, activeTask.id],
      )
      .then((result: any) => {
        if (cancelled) return
        setPeerTaskIds(result?.success ? result.data.map((row: { id: number }) => row.id) : [])
      })

    return () => {
      cancelled = true
    }
  }, [activeTask, api, drawerMode])
  const drawerDescendantIds = useMemo(() => {
    return selectedTaskId ? getTaskDescendantIds(tasks, selectedTaskId) : new Set<number>()
  }, [selectedTaskId, tasks])
  const eligibleParentTasks = tasks.filter(
    (task) =>
      task.id !== selectedTaskId &&
      !drawerDescendantIds.has(task.id) &&
      (task.status !== TASK_STATUS.closed || task.id === activeTask?.parent_id) &&
      !task.is_virtual,
  )
  const parentTaskOptions = (() => {
    return eligibleParentTasks.map((task) => {
      const path = getTaskAncestorPath(tasks, task.id)
        .map((node) => node.title)
        .join(' / ')
      return { id: task.id, code: formatTaskCode(task.id), label: path }
    })
  })()
  const selectedParentTask =
    taskDraft.parentId == null ? null : tasks.find((task) => task.id === taskDraft.parentId)
  const activeTaskPath = activeTask ? getTaskAncestorPath(tasks, activeTask.id) : []
  const eligiblePeerTasks = activeTask
    ? tasks.filter(
        (task) =>
          task.id !== activeTask.id && task.parent_id === taskDraft.parentId && !task.is_virtual,
      )
    : []
  const filteredPeerTasks = useMemo(() => {
    const query = peerTaskQuery.trim().toLowerCase()
    if (!query) return eligiblePeerTasks
    return eligiblePeerTasks.filter((task) => {
      const code = formatTaskCode(task.id).toLowerCase()
      return (
        code.includes(query) ||
        String(task.title || '')
          .toLowerCase()
          .includes(query)
      )
    })
  }, [eligiblePeerTasks, peerTaskQuery])
  const visiblePeerTasks = filteredPeerTasks.slice(0, peerTaskVisibleCount)
  const canLoadMorePeerTasks = visiblePeerTasks.length < filteredPeerTasks.length
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const selectedPeerTasks = peerTaskIds
    // Keep selected links visible even when the option list is filtered or has not loaded that row yet.
    .map((peerId) => tasksById.get(peerId))
    .filter((task): task is any => Boolean(task))

  useEffect(() => {
    setPeerTaskVisibleCount(20)
    setPeerTaskQuery('')
    setIsPeerDropdownOpen(false)
  }, [activeTask?.id, taskDraft.parentId])
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
      ...tasks.filter((task) =>
        task.start_date ? task.start_date <= todayKey : !task.due_date || task.due_date <= todayKey,
      ),
      ...todayProjectedTasks.filter((task) => task.is_virtual),
    ],
    [tasks, todayKey, todayProjectedTasks],
  )
  const filteredExecutionTasks = useMemo(
    () => executionTasks.filter(taskMatchesFilters),
    [executionTasks, taskMatchesFilters],
  )
  const listProjectedTasks = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 370)
    const nearestByRule = new Map<number, any>()
    const openRuleIds = new Set(
      tasks
        .filter(
          (task) => task.recur_rule_id && !task.parent_id && task.status !== TASK_STATUS.closed,
        )
        .map((task) => Number(task.recur_rule_id)),
    )

    for (const task of projectCalendarOccurrences(tasks, rules, start, end, skippedOccurrences)) {
      if (
        !task.is_virtual ||
        !task.recur_rule_id ||
        openRuleIds.has(Number(task.recur_rule_id)) ||
        nearestByRule.has(task.recur_rule_id)
      )
        continue
      nearestByRule.set(task.recur_rule_id, task)
    }

    return [...nearestByRule.values()]
  }, [rules, skippedOccurrences, tasks])
  const isRecurringOccurrenceTask = (task: any) => {
    if (!task?.parent_id || !task.recur_rule_id || !task.instance_key) return false
    const parent = tasks.find((candidate) => candidate.id === task.parent_id)
    return Boolean(
      parent?.recur_rule_id === task.recur_rule_id &&
        parent.recur_instance_root === 1 &&
        !parent.instance_key &&
        parent.recurring_instance_id === task.recurring_instance_id,
    )
  }
  const hasActualSubtasks = (task: any) =>
    tasks.some(
      (candidate) => candidate.parent_id === task.id && !isRecurringOccurrenceTask(candidate),
    )
  const listTasks = useMemo(() => [...tasks, ...listProjectedTasks], [listProjectedTasks, tasks])
  const rootTasks = useMemo(
    () =>
      listTasks.filter(
        (task) =>
          !task.parent_id &&
          // Timed recurring tasks belong under their date-level instance.
          // Keep virtual projections visible until they are materialized.
          !(task.recur_rule_id && task.instance_key && task.recur_instance_root === 1 && !task.is_virtual),
      ),
    [listTasks],
  )
  const displayRootTasks = useMemo(() => {
    const seen = new Set<string>()
    const statusOrder: Record<string, number> = {
      已逾期: 0,
      待审核: 1,
      进行中: 2,
      待处理: 3,
      已关闭: 4,
    }
    const priorityOrder: Record<string, number> = { high: 0, mid: 1, low: 2 }

    return rootTasks
      .filter((task) => {
        if (taskMatchesFilters(task)) return true
        if (!taskQuery.trim()) return false
        return [...getTaskDescendantIds(tasks, task.id)].some((id) => {
          const descendant = tasks.find((candidate) => candidate.id === id)
          return descendant ? taskMatchesFilters(descendant) : false
        })
      })
      .filter((task) => {
        if (!task.recur_rule_id || !task.due_date) return true
        const key = `${task.recur_rule_id}:${task.due_date}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((left, right) => {
        const statusDifference =
          (statusOrder[left.status] ?? Number.MAX_SAFE_INTEGER) -
          (statusOrder[right.status] ?? Number.MAX_SAFE_INTEGER)
        if (statusDifference !== 0) return statusDifference

        const priorityDifference =
          (priorityOrder[left.priority] ?? Number.MAX_SAFE_INTEGER) -
          (priorityOrder[right.priority] ?? Number.MAX_SAFE_INTEGER)
        if (priorityDifference !== 0) return priorityDifference

        const leftDueAt = `${left.due_date || '9999-12-31'}T${left.due_time || '23:59:59'}`
        const rightDueAt = `${right.due_date || '9999-12-31'}T${right.due_time || '23:59:59'}`
        const dueDifference = leftDueAt.localeCompare(rightDueAt)
        return dueDifference !== 0 ? dueDifference : Number(left.id) - Number(right.id)
      })
  }, [rootTasks, taskMatchesFilters, taskQuery, tasks])
  useEffect(() => {
    if (!taskQuery.trim()) return
    const matchedTask = tasks.find(taskMatchesQuery)
    if (!matchedTask) return
    const root = getTaskAncestorPath(tasks, matchedTask.id)[0]
    if (root) setExpandedTaskGroupId(root.id)
  }, [taskMatchesQuery, taskQuery, tasks])
  const completionConfirmationCopy = completionConfirmationTask
    ? getCompletionConfirmationCopy(completionConfirmationTask)
    : null
  const openTaskCount = tasks.filter(
    (task) => task.is_completed !== 1 && task.status !== '已关闭',
  ).length
  const todayTaskCount = filteredExecutionTasks.filter((task) => task.due_date === todayKey).length
  const overdueTaskCount = tasks.filter((task) => task.status === '已逾期').length
  const selectedRule = selectedRuleId ? rules.find((rule) => rule.id === selectedRuleId) : null
  const rulePreviewOccurrences = useMemo(
    () =>
      getNextTemplateOccurrences(
        {
          id: selectedRuleId || 0,
          title: ruleName,
          description: ruleDesc,
          frequency: ruleFreq,
          interval: ruleInterval,
          week_days: serializeRuleWeekDays(ruleFreq, ruleWeekDays, ruleStartDate),
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
        <div className="task-navigation__tools" aria-label={t('tasks.workflow_tools_label')}>
          <label className="task-navigation__search">
            <Search size={14} aria-hidden="true" />
            <input
              className="form-field"
              value={taskQuery}
              onChange={(event) => setTaskQuery(event.target.value)}
              placeholder={t('tasks.search_placeholder')}
              aria-label={t('tasks.search_placeholder')}
            />
          </label>
          <label className="task-navigation__checkbox">
            <input
              type="checkbox"
              checked={showClosedTasks}
              onChange={(event) => setShowClosedTasks(event.target.checked)}
            />
            <span>{t('tasks.filter_show_closed')}</span>
          </label>
          <div
            className="task-navigation__date-range"
            aria-label={t('tasks.filter_due_date_range')}
          >
            <span className="task-navigation__date-range-label">{t('tasks.filter_due_date')}</span>
            <DateTimePicker
              value={dueDateFrom ? toLocalDate(dueDateFrom) : null}
              onChange={(date: Date | null) => setDueDateFrom(date ? toLocalDateKey(date) : '')}
              clearable
              locale={datePickerLocale}
              portalId="task-filter-datepicker-portal"
              popperPlacement="bottom-end"
              className="task-navigation__date-input"
              placeholder={t('tasks.filter_start_date')}
              ariaLabel={t('tasks.filter_start_date')}
            />
            <span className="task-navigation__date-range-separator" aria-hidden="true">
              {t('tasks.filter_date_range_to')}
            </span>
            <DateTimePicker
              value={dueDateTo ? toLocalDate(dueDateTo) : null}
              onChange={(date: Date | null) => setDueDateTo(date ? toLocalDateKey(date) : '')}
              clearable
              locale={datePickerLocale}
              portalId="task-filter-datepicker-portal"
              popperPlacement="bottom-end"
              className="task-navigation__date-input"
              placeholder={t('tasks.filter_end_date')}
              ariaLabel={t('tasks.filter_end_date')}
            />
          </div>
        </div>
      </nav>

      <div key={taskTab} className="task-content tab-panel-transition" role="tabpanel">
        {/* TAB: KANBAN BOARD */}
        {taskTab === 'kanban' &&
          (filteredExecutionTasks.length === 0 ? (
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
                const laneTasks = filteredExecutionTasks.filter(
                  (t) =>
                    t.status === lane.dbVal || (lane.dbVal === '待处理' && t.status === '已逾期'),
                )
                return (
                  <div
                    key={lane.key}
                    data-kanban-status={lane.dbVal}
                    style={{
                      backgroundColor: 'var(--bg-sidebar)',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      minHeight: '400px',
                      border: '1px solid transparent',
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
                      {laneTasks.map((task) => {
                        const parentTask = task.parent_id
                          ? tasks.find((candidate) => candidate.id === task.parent_id)
                          : null
                        return (
                          <div
                            key={task.id}
                            className={`card task-board-card ${
                              task.status === '已逾期' ? 'is-overdue' : ''
                            }`}
                            data-task-id={task.id}
                            data-task-status={task.status}
                            role="button"
                            tabIndex={0}
                            style={{
                              padding: '12px',
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              void openCalendarTask(task)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                void openCalendarTask(task)
                              }
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
                              {!task.is_virtual && (
                                <span className="task-code">{formatTaskCode(task.id)}</span>
                              )}
                              {task.title}
                            </h4>
                            {parentTask && (
                              <button
                                type="button"
                                className="task-hierarchy-context"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void openCalendarTask(parentTask)
                                }}
                              >
                                <CornerDownRight size={12} aria-hidden="true" />
                                {formatTaskCode(parentTask.id)} {parentTask.title}
                              </button>
                            )}
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
                            {task.status === TASK_STATUS.review && (
                              <div
                                className="task-review-actions"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="btn sm btn-icon task-review-action task-review-action--reject"
                                  title={t('tasks.review_reject_action')}
                                  aria-label={t('tasks.review_reject_action')}
                                  onClick={() => void reviewTask(task, false)}
                                >
                                  <Undo2 aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="btn sm btn-icon primary task-review-action task-review-action--approve"
                                  title={t('tasks.review_approve_action')}
                                  aria-label={t('tasks.review_approve_action')}
                                  onClick={() => void reviewTask(task, true)}
                                >
                                  <Check aria-hidden="true" />
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
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
                {displayRootTasks.length === 0 ? (
                  <div className="task-list-empty">
                    <ListTodo aria-hidden="true" />
                    <strong>{t('tasks.board_empty_title')}</strong>
                    <p>{t('tasks.board_empty_description')}</p>
                  </div>
                ) : (
                  displayRootTasks.map((task) => {
                    const isSelected = selectedTaskId === task.id
                    const isOverdue = task.status === '已逾期'
                    const directSubtasks = tasks.filter(
                      (candidate) =>
                        candidate.parent_id === task.id &&
                        !isRecurringOccurrenceTask(candidate),
                    )
                    const completedSubtaskCount = directSubtasks.filter(
                      (subtask) => subtask.is_completed === 1,
                    ).length
                    const isTaskGroupExpanded = expandedTaskGroupId === task.id
                    const repeatSummary = getRepeatSummary(task)
                    const sameDayOccurrences = task.recur_rule_id
                      ? tasks.filter(
                          (candidate) =>
                            candidate.parent_id === task.id &&
                            candidate.recur_rule_id === task.recur_rule_id &&
                            candidate.due_date === task.due_date &&
                            Boolean(candidate.instance_key),
                        )
                      : []
                    const orderedSameDayOccurrences = [...sameDayOccurrences].sort((left, right) =>
                      getOccurrenceScheduleTime(left).localeCompare(
                        getOccurrenceScheduleTime(right),
                      ),
                    )
                    const completedOccurrenceCount = orderedSameDayOccurrences.filter(
                      (candidate) => candidate.is_completed === 1,
                    ).length
                    const occurrenceGroupKey =
                      task.recur_rule_id && task.due_date
                        ? `${task.recur_rule_id}:${task.due_date}`
                        : null
                    const isOccurrenceGroupExpanded =
                      occurrenceGroupKey !== null &&
                      expandedOccurrenceGroupKey === occurrenceGroupKey

                    return (
                      <div
                        key={task.id}
                        className={`task-row-group ${isTaskGroupExpanded ? 'is-expanded' : ''}`}
                      >
                        <div
                          className={`task-row ${isSelected ? 'is-selected' : ''} ${
                            isOverdue ? 'is-overdue' : ''
                          } ${task.status === TASK_STATUS.pending ? 'is-todo' : ''} ${
                            task.status === TASK_STATUS.inProgress ? 'is-in-progress' : ''
                          } ${task.status === TASK_STATUS.review ? 'is-review' : ''} ${
                            task.status === TASK_STATUS.closed ? 'is-closed' : ''
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
                          <div className="task-row__lead">
                            <span
                              className={`task-row__priority-badge is-${task.priority}`}
                              role="img"
                              aria-label={getPriorityLabel(task.priority)}
                              title={getPriorityLabel(task.priority)}
                            >
                              {getPriorityBadgeLabel(task.priority)}
                            </span>
                            <button
                              type="button"
                              title={
                                task.status === TASK_STATUS.review
                                  ? t('tasks.lane_review')
                                  : task.status === TASK_STATUS.closed
                                    ? t('tasks.lane_closed')
                                    : task.is_completed === 1
                                      ? t('tasks.reopen_task_action')
                                      : isOverdue
                                        ? t('tasks.close_overdue_task_action')
                                        : t('tasks.complete_task_action')
                              }
                              aria-label={
                                task.status === TASK_STATUS.review
                                  ? t('tasks.lane_review')
                                  : task.status === TASK_STATUS.closed
                                    ? t('tasks.lane_closed')
                                    : task.is_completed === 1
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
                              disabled={
                                task.status === TASK_STATUS.review ||
                                task.status === TASK_STATUS.closed
                              }
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
                          </div>
                          <div className="task-row__main">
                            <div className="task-row__heading">
                              <span className="task-row__title">
                                {!task.is_virtual && (
                                  <span className="task-code">{formatTaskCode(task.id)}</span>
                                )}
                                {task.title}
                              </span>
                              <span
                                className="task-row__deadline"
                                title={`${t('tasks.details_due_prefix')}: ${formatDue(task)}`}
                              >
                                <Hourglass size={13} aria-hidden="true" />
                                <time>
                                  {orderedSameDayOccurrences.length > 1
                                    ? String(task.due_date || '').slice(-5)
                                    : formatCompactDue(task)}
                                </time>
                              </span>
                            </div>
                            <span className="task-row__meta">
                              <span className="task-row__status" data-status={task.status}>
                                {getStatusLabel(task.status)}
                              </span>
                            </span>
                            {repeatSummary && (
                              <div className="task-row__recurrence">
                                <div className="task-row__recurrence-schedule">
                                  <RefreshCw size={11} aria-hidden="true" />
                                  <span>{repeatSummary.schedule}</span>
                                </div>
                                <div className="task-row__recurrence-details">
                                  <span>
                                    <Clock3 size={11} aria-hidden="true" />
                                    {repeatSummary.times}
                                  </span>
                                  <span>
                                    <CalendarDays size={11} aria-hidden="true" />
                                    {repeatSummary.range}
                                  </span>
                                </div>
                              </div>
                            )}
                            {task.progress > 0 && task.progress < 100 && (
                              <div className="task-row__progress">
                                <div style={{ width: `${task.progress}%` }} />
                              </div>
                            )}
                          </div>
                          <div className="task-row__footer">
                            {task.status === TASK_STATUS.review && (
                              <span
                                className="task-review-actions"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="btn sm btn-icon task-review-action task-review-action--reject"
                                  title={t('tasks.review_reject_action')}
                                  aria-label={t('tasks.review_reject_action')}
                                  onClick={() => void reviewTask(task, false)}
                                >
                                  <Undo2 aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="btn sm btn-icon primary task-review-action task-review-action--approve"
                                  title={t('tasks.review_approve_action')}
                                  aria-label={t('tasks.review_approve_action')}
                                  onClick={() => void reviewTask(task, true)}
                                >
                                  <Check aria-hidden="true" />
                                </button>
                              </span>
                            )}
                            {orderedSameDayOccurrences.length > 1 && (
                              <span className="task-row__occurrence-times">
                                {orderedSameDayOccurrences.map((occurrence) => (
                                  <span key={occurrence.id}>
                                    <Clock3 size={11} aria-hidden="true" />
                                    {getOccurrenceScheduleTime(occurrence)}
                                  </span>
                                ))}
                              </span>
                            )}
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
                            {orderedSameDayOccurrences.length > 1 && (
                              <button
                                type="button"
                                className="task-row__subtask-toggle"
                                aria-expanded={isOccurrenceGroupExpanded}
                                aria-label={t('tasks.multi_occurrence_progress', {
                                  completed: completedOccurrenceCount,
                                  total: orderedSameDayOccurrences.length,
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
                                  total: orderedSameDayOccurrences.length,
                                })}
                                {isOccurrenceGroupExpanded ? (
                                  <ChevronUp aria-hidden="true" />
                                ) : (
                                  <ChevronDown aria-hidden="true" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {isOccurrenceGroupExpanded && (
                          <div
                            className="task-occurrence-list"
                            aria-label={t('tasks.multi_occurrence_progress', {
                              completed: completedOccurrenceCount,
                              total: orderedSameDayOccurrences.length,
                            })}
                          >
                            {orderedSameDayOccurrences.map((occurrence) => (
                              (() => {
                                const occurrenceSubtasks = tasks.filter(
                                  (candidate) => candidate.parent_id === occurrence.id,
                                )
                                return (
                                  <div
                                    key={occurrence.id}
                                    className={`task-occurrence-row ${occurrence.is_completed === 1 ? 'is-completed' : ''}`}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      selectTaskForDetails(occurrence)
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        selectTaskForDetails(occurrence)
                                      }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${occurrence.title} ${getOccurrenceScheduleTime(occurrence)}`}
                                  >
                                    <button
                                      type="button"
                                      className="task-occurrence-row__check"
                                      aria-label={
                                        occurrence.is_completed === 1
                                          ? t('tasks.reopen_task_action')
                                          : t('tasks.complete_task_action')
                                      }
                                      title={
                                        occurrence.is_completed === 1
                                          ? t('tasks.reopen_task_action')
                                          : t('tasks.complete_task_action')
                                      }
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        requestTaskCompletionToggle(occurrence, event.currentTarget)
                                      }}
                                    >
                                      {occurrence.is_completed === 1 ? (
                                        <Check size={14} />
                                      ) : (
                                        <Circle size={14} />
                                      )}
                                    </button>
                                    <span className="task-occurrence-row__content">
                                      <strong className="task-occurrence-row__title">
                                        {occurrence.title}
                                      </strong>
                                      <span className="task-occurrence-row__meta">
                                        <time className="task-occurrence-row__time">
                                          <Clock3 size={13} aria-hidden="true" />
                                          {getOccurrenceScheduleTime(occurrence)}
                                        </time>
                                        <span>{getStatusLabel(occurrence.status)}</span>
                                      </span>
                                      {occurrenceSubtasks.length > 0 && (
                                        <span className="task-occurrence-row__subtasks">
                                          {occurrenceSubtasks.map((subtask) => (
                                            <span key={subtask.id}>{subtask.title}</span>
                                          ))}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                )
                              })()
                            ))}
                          </div>
                        )}
                        {isTaskGroupExpanded && (
                          <section
                            id={`task-subtasks-${task.id}`}
                            className="task-expanded-group"
                            aria-label={t('tasks.subtask_detail_region')}
                            ref={expandedSubtaskPanelRef}
                            tabIndex={-1}
                          >
                            <header className="task-expanded-group__header">
                              <div>
                                <span>{t('tasks.subtask_detail_region')}</span>
                                <strong>
                                  {formatTaskCode(task.id)} {task.title}
                                </strong>
                              </div>
                              <button
                                type="button"
                                className="task-expanded-group__close"
                                onClick={() => toggleTaskGroup(task.id)}
                              >
                                <ChevronUp aria-hidden="true" />
                                {t('tasks.subtask_collapse')}
                              </button>
                            </header>
                            <div className="task-subtask-list">{renderSubtaskRows(task.id)}</div>
                          </section>
                        )}
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
                    <h3>
                      <span className="task-code">{formatTaskCode(activeTask.id)}</span>
                      {activeTask.title}
                    </h3>
                    {activeTaskPath.length > 1 && (
                      <nav
                        className="task-details-path"
                        aria-label={t('tasks.hierarchy_section_title')}
                      >
                        {activeTaskPath.map((task, index) => (
                          <React.Fragment key={task.id}>
                            {index > 0 && <span aria-hidden="true">/</span>}
                            <button
                              type="button"
                              onClick={() => void openCalendarTask(task)}
                              aria-current={task.id === activeTask.id ? 'page' : undefined}
                            >
                              {formatTaskCode(task.id)}
                            </button>
                          </React.Fragment>
                        ))}
                      </nav>
                    )}
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
                        {t('tasks.details_due_prefix')} {formatDue(activeTask)}
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
                  {hasActualSubtasks(activeTask) ? (
                    <div className="task-details-field">
                      <span>{t('tasks.details_subtask_progress')}</span>
                      <div className="task-details-progress">
                        <div className="task-details-progress__track">
                          <div style={{ width: `${activeTask.progress}%` }} />
                        </div>
                        <strong>{activeTask.progress}%</strong>
                      </div>
                      <p className="task-details-hint">{t('tasks.details_subtask_progress_tip')}</p>
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

                  <button className="btn primary task-details-save" onClick={handleSaveDetails}>
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
                  rules.map((rule) => {
                    const status = getRuleStatus(rule)
                    return (
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
                        <div className="task-template-item__heading">
                          <strong>{rule.title}</strong>
                          <span className="task-template-item__status" data-status={status.key}>
                            {status.label}
                          </span>
                        </div>
                        <span className="task-template-item__detail">
                          <CalendarDays size={12} aria-hidden="true" />
                          <span>{getRuleScheduleSummary(rule)}</span>
                        </span>
                        <span className="task-template-item__detail is-times">
                          <Clock3 size={12} aria-hidden="true" />
                          <span>{getRuleTimesSummary(rule)}</span>
                        </span>
                        <span className="task-template-item__range">
                          {getRuleRangeSummary(rule)}
                        </span>
                      </div>
                    )
                  })
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
                      ? `${getRuleScheduleSummary(selectedRule)} · ${getRuleTimesSummary(selectedRule)}`
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
                <label>{t('tasks.rule_name_label')}</label>
                <input
                  className="form-field"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                />
              </div>

              <div className="task-form-section">
                <label>{t('tasks.details_label_desc')}</label>
                <textarea
                  className="form-field"
                  rows={2}
                  value={ruleDesc}
                  onChange={(e) => setRuleDesc(e.target.value)}
                />
              </div>

              <div className="task-rule-schedule-grid">
                <div className="task-form-section">
                  <label>{t('tasks.schedule_mode_label')}</label>
                  <Dropdown
                    className="form-field"
                    value={ruleScheduleMode}
                    onChange={(e) => setRuleScheduleMode(e.target.value as 'rules' | 'interval')}
                  >
                    <option value="rules">{t('tasks.schedule_mode_rules')}</option>
                    <option value="interval">{t('tasks.schedule_mode_interval')}</option>
                  </Dropdown>
                </div>
                {ruleScheduleMode === 'interval' && (
                  <div className="task-form-section">
                    <label>{t('tasks.interval_days_label')}</label>
                    <input
                      className="form-field"
                      type="number"
                      min={1}
                      value={ruleInterval}
                      onChange={(e) => setRuleInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>
                )}
                <div className="task-form-section">
                  <label>{t('tasks.rule_start_date_label')}</label>
                  <DateTimePicker
                    value={toLocalDate(ruleStartDate)}
                    onChange={(date: Date | null) => {
                      if (date) setRuleStartDate(toLocalDateKey(date))
                    }}
                    locale={datePickerLocale}
                    portalId="task-filter-datepicker-portal"
                    popperPlacement="bottom-end"
                    className="task-navigation__date-input"
                    ariaLabel={t('tasks.rule_start_date_label')}
                  />
                </div>
                <div className="task-form-section">
                  <label>{t('tasks.rule_end_date_label')}</label>
                  <DateTimePicker
                    value={ruleEndDate ? toLocalDate(ruleEndDate) : null}
                    clearable
                    minDate={ruleStartDate ? (toLocalDate(ruleStartDate) ?? undefined) : undefined}
                    onChange={(date) => setRuleEndDate(date ? toLocalDateKey(date) : '')}
                    ariaLabel={t('tasks.rule_end_date_label')}
                  />
                </div>
                <div className="task-form-section">
                  <label>{t('tasks.template_priority_label')}</label>
                  <Dropdown
                    className="form-field"
                    value={rulePriority}
                    onChange={(e) => setRulePriority(e.target.value)}
                  >
                    <option value="high">{t('tasks.priority_high')}</option>
                    <option value="mid">{t('tasks.priority_mid')}</option>
                    <option value="low">{t('tasks.priority_low')}</option>
                  </Dropdown>
                </div>
              </div>

              <div className="task-form-section">
                <label>{t('tasks.daily_generation_times_label')}</label>
                <div className="task-rule-times">
                  {ruleTimes.map((time, index) => (
                    <div className="task-rule-time-row" key={`${index}-${time}`}>
                      <TimePicker
                        value={time}
                        timeInputLabel={t('tasks.time_picker_time_label')}
                        onChange={(nextTime) => {
                          const nextTimes = [...ruleTimes]
                          nextTimes[index] = nextTime
                          setRuleTimes(nextTimes)
                          if (index === 0) setRuleTime(nextTime)
                        }}
                        ariaLabel={t('tasks.rule_occurrence_time', { index: index + 1 })}
                      />
                      {ruleTimes.length > 1 && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() =>
                            setRuleTimes(ruleTimes.filter((_, timeIndex) => timeIndex !== index))
                          }
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
                <span className="task-form-hint">{t('tasks.instance_start_times_hint')}</span>
              </div>

              <div className="task-form-section">
                <label>{t('tasks.rule_steps_label')}</label>
                <textarea
                  className="form-field"
                  rows={4}
                  value={ruleStepsText}
                  onChange={(event) => setRuleStepsText(event.target.value)}
                  placeholder={t('tasks.rule_steps_placeholder')}
                />
                <span className="task-form-hint">{t('tasks.rule_steps_hint')}</span>
              </div>

              {ruleScheduleMode === 'rules' && (
                <>
                  <div className="task-form-section">
                    <label>{t('tasks.week_days_label')}</label>
                    <div className="task-weekday-picker">
                      {[0, 1, 2, 3, 4, 5, 6].map((day, index) => {
                        const selected = ruleWeekDays.includes(day)
                        return (
                          <button
                            key={day}
                            type="button"
                            className="btn sm"
                            aria-pressed={selected}
                            onClick={() =>
                              setRuleWeekDays(
                                selected
                                  ? ruleWeekDays.filter((value) => value !== day)
                                  : [...ruleWeekDays, day],
                              )
                            }
                          >
                            {t('tasks.weekdays_sunday_first').split(',')[index]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="task-form-section">
                    <label>{t('tasks.month_days_label')}</label>
                    <div className="task-monthday-picker">
                      {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => {
                        const selected = ruleMonthDays.includes(day)
                        return (
                          <button
                            key={day}
                            type="button"
                            className="btn sm"
                            aria-pressed={selected}
                            onClick={() =>
                              setRuleMonthDays(
                                selected
                                  ? ruleMonthDays.filter((value) => value !== day)
                                  : [...ruleMonthDays, day],
                              )
                            }
                          >
                            {day}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="task-form-section">
                    <label>{t('tasks.excluded_week_days_label')}</label>
                    <div className="task-weekday-picker">
                      {[0, 1, 2, 3, 4, 5, 6].map((day, index) => {
                        const selected = ruleExcludedWeekDays.includes(day)
                        return (
                          <button
                            key={day}
                            type="button"
                            className="btn sm"
                            aria-pressed={selected}
                            onClick={() =>
                              setRuleExcludedWeekDays(
                                selected
                                  ? ruleExcludedWeekDays.filter((value) => value !== day)
                                  : [...ruleExcludedWeekDays, day],
                              )
                            }
                          >
                            {t('tasks.weekdays_sunday_first').split(',')[index]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="task-form-section">
                    <label>{t('tasks.excluded_month_days_label')}</label>
                    <div className="task-monthday-picker">
                      {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => {
                        const selected = ruleExcludedMonthDays.includes(day)
                        return (
                          <button
                            key={day}
                            type="button"
                            className="btn sm"
                            aria-pressed={selected}
                            onClick={() =>
                              setRuleExcludedMonthDays(
                                selected
                                  ? ruleExcludedMonthDays.filter((value) => value !== day)
                                  : [...ruleExcludedMonthDays, day],
                              )
                            }
                          >
                            {day}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}

              <div className="task-form-section task-preview-section">
                <label>{t('tasks.future_triggers_label')}</label>
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
              <div key={tpl.id} className="task-template-card">
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
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => openTemplateEditor(tpl)}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="btn danger sm"
                      onClick={() => void handleDeleteTemplate(tpl)}
                    >
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </div>
            ))}
            {templateEditor && (
              <div className="task-template-editor-form">
                <strong>
                  {templateEditor.id ? t('tasks.edit_template') : t('tasks.new_template')}
                </strong>
                <input
                  className="form-field"
                  value={templateEditor.title}
                  placeholder={t('tasks.template_title_placeholder')}
                  onChange={(event) =>
                    setTemplateEditor({ ...templateEditor, title: event.target.value })
                  }
                />
                <input
                  className="form-field"
                  value={templateEditor.icon}
                  placeholder={t('tasks.template_icon_placeholder')}
                  onChange={(event) =>
                    setTemplateEditor({ ...templateEditor, icon: event.target.value })
                  }
                />
                <textarea
                  className="form-field"
                  rows={2}
                  value={templateEditor.description}
                  placeholder={t('tasks.template_description_placeholder')}
                  onChange={(event) =>
                    setTemplateEditor({ ...templateEditor, description: event.target.value })
                  }
                />
                <textarea
                  className="form-field"
                  rows={5}
                  value={templateEditor.subtasksText}
                  placeholder={t('tasks.template_steps_placeholder')}
                  onChange={(event) =>
                    setTemplateEditor({ ...templateEditor, subtasksText: event.target.value })
                  }
                />
                <div className="task-template-editor-form__actions">
                  <button type="button" className="btn" onClick={() => setTemplateEditor(null)}>
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void handleSaveTemplate()}
                  >
                    {t('common.save')}
                  </button>
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
                  ) : (
                    scheduledLogs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '10px 8px', fontWeight: 600 }}>{log.name}</td>
                        <td style={{ padding: '10px 8px' }}>{log.action}</td>
                        <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>
                          {log.trigger}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span
                            className={`pill ${log.statusKey === 'active' ? 'green' : log.statusKey === 'ended' ? '' : 'blue'}`}
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {drawerMode && isTaskDrawerMounted && (
        <ViewportPortal>
          <div
            ref={taskDrawerOverlayRef}
            className={`drawer-motion-overlay task-drawer-backdrop ${isTaskDrawerOpen ? 'is-open' : 'is-closing'}`}
            role="presentation"
            aria-hidden={!isTaskDrawerOpen}
            onMouseDown={closeTaskDrawer}
          >
            <aside
              ref={taskDrawerPanelRef}
              className="drawer-motion-panel task-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={
                drawerMode === 'create'
                  ? t('tasks.drawer_create_title')
                  : t('tasks.drawer_edit_title')
              }
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="task-drawer__header">
                <h2>
                  {drawerMode === 'create'
                    ? t('tasks.drawer_create_title')
                    : t('tasks.drawer_edit_title')}
                </h2>
                <button
                  type="button"
                  className="btn btn-icon-close task-drawer__close"
                  onClick={closeTaskDrawer}
                  aria-label={t('tasks.drawer_close')}
                  title={t('tasks.drawer_close')}
                >
                  <X size={16} />
                </button>
              </header>
              <div className="task-drawer__body">
                <label className="task-form-section">
                  <span>{t('tasks.details_label_title')}</span>
                  <input
                    ref={drawerTitleInputRef}
                    autoFocus
                    className={`form-field ${drawerErrors.title ? 'is-invalid' : ''}`}
                    value={taskDraft.title}
                    onChange={(event) => {
                      setTaskDraft({ ...taskDraft, title: event.target.value })
                      if (drawerErrors.title && event.target.value.trim()) {
                        setDrawerErrors((current) => ({ ...current, title: undefined }))
                      }
                    }}
                    aria-invalid={Boolean(drawerErrors.title)}
                    aria-describedby={drawerErrors.title ? 'task-title-error' : undefined}
                  />
                  {drawerErrors.title && (
                    <small id="task-title-error" className="task-field-error" role="alert">
                      {drawerErrors.title}
                    </small>
                  )}
                </label>
                <label className="task-form-section">
                  <span>{t('tasks.details_label_desc')}</span>
                  <textarea
                    className="form-field"
                    rows={4}
                    value={taskDraft.description}
                    onChange={(event) =>
                      setTaskDraft({ ...taskDraft, description: event.target.value })
                    }
                    placeholder={t('tasks.details_desc_placeholder')}
                  />
                </label>
                <section className="task-drawer__hierarchy-section">
                  <header className="task-drawer__section-header">
                    <span className="task-drawer__section-icon" aria-hidden="true">
                      <ListTree size={16} />
                    </span>
                    <span>
                      <strong>{t('tasks.hierarchy_section_title')}</strong>
                      <small>{t('tasks.hierarchy_section_hint')}</small>
                    </span>
                  </header>
                  <label className="task-form-section">
                    <span>{t('tasks.parent_task_label')}</span>
                    <input
                      className={`form-field ${drawerErrors.hierarchy ? 'is-invalid' : ''}`}
                      value={parentTaskCode}
                      list="task-parent-options"
                      placeholder={t('tasks.parent_task_code_placeholder')}
                      aria-describedby="task-parent-hint"
                      onChange={(event) => {
                        const value = event.target.value
                        const parentId = value ? parseTaskCode(value) : null
                        setParentTaskCode(value)
                        setTaskDraft({ ...taskDraft, parentId })
                        setPeerTaskIds((current) =>
                          current.filter((peerId) =>
                            tasks.some((task) => task.id === peerId && task.parent_id === parentId),
                          ),
                        )
                        if (drawerErrors.hierarchy) {
                          setDrawerErrors((current) => ({ ...current, hierarchy: undefined }))
                        }
                      }}
                    />
                    <datalist id="task-parent-options">
                      {parentTaskOptions.map((option) => (
                        <option key={option.id} value={option.code} label={option.label} />
                      ))}
                    </datalist>
                    {selectedParentTask && (
                      <div className="task-drawer__parent-preview">
                        <span>{formatTaskCode(selectedParentTask.id)}</span>
                        <strong>{selectedParentTask.title}</strong>
                      </div>
                    )}
                    <small id="task-parent-hint" className="task-form-hint">
                      {t('tasks.parent_task_select_hint')}
                    </small>
                    {drawerErrors.hierarchy && (
                      <small className="task-field-error" role="alert">
                        {drawerErrors.hierarchy}
                      </small>
                    )}
                  </label>
                </section>

                {drawerMode === 'edit' && (
                  <section className="task-drawer__hierarchy-section">
                    <header className="task-drawer__section-header">
                      <span className="task-drawer__section-icon" aria-hidden="true">
                        <ListChecks size={16} />
                      </span>
                      <span>
                        <strong>{t('tasks.peer_tasks_title')}</strong>
                        <small>{t('tasks.peer_tasks_hint')}</small>
                      </span>
                    </header>
                    {eligiblePeerTasks.length === 0 ? (
                      <p className="task-drawer__peer-empty">{t('tasks.peer_tasks_empty')}</p>
                    ) : (
                      <div className="task-drawer__peer-picker" ref={peerDropdownRef}>
                        <button
                          type="button"
                          className="task-drawer__peer-trigger"
                          aria-expanded={isPeerDropdownOpen}
                          aria-controls="task-peer-options"
                          onClick={() => setIsPeerDropdownOpen((current) => !current)}
                        >
                          <span className="task-drawer__peer-trigger-values">
                            {selectedPeerTasks.length > 0 ? (
                              selectedPeerTasks.map((peer) => (
                                <span className="task-drawer__peer-selection" key={peer.id}>
                                  <span className="task-code">{formatTaskCode(peer.id)}</span>
                                  <span title={peer.title}>{peer.title}</span>
                                </span>
                              ))
                            ) : (
                              <span>{t('tasks.peer_tasks_select')}</span>
                            )}
                          </span>
                          {isPeerDropdownOpen ? (
                            <ChevronUp size={15} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={15} aria-hidden="true" />
                          )}
                        </button>
                        {isPeerDropdownOpen && (
                          <div className="task-drawer__peer-dropdown" id="task-peer-options">
                            <label className="task-drawer__peer-search">
                              <Search size={14} aria-hidden="true" />
                              <input
                                className="form-field"
                                autoFocus
                                value={peerTaskQuery}
                                placeholder={t('tasks.peer_tasks_search_placeholder')}
                                onChange={(event) => {
                                  setPeerTaskQuery(event.target.value)
                                  setPeerTaskVisibleCount(20)
                                }}
                              />
                            </label>
                            <div
                              className="task-drawer__peer-list"
                              onScroll={(event) => {
                                const element = event.currentTarget
                                if (
                                  canLoadMorePeerTasks &&
                                  element.scrollHeight - element.scrollTop - element.clientHeight <
                                    28
                                ) {
                                  setPeerTaskVisibleCount((count) => count + 20)
                                }
                              }}
                            >
                              {visiblePeerTasks.map((peer) => {
                                const selected = peerTaskIds.includes(peer.id)
                                return (
                                  <label className="task-drawer__peer-option" key={peer.id}>
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={(event) =>
                                        setPeerTaskIds((current) =>
                                          event.target.checked
                                            ? [...current, peer.id]
                                            : current.filter((id) => id !== peer.id),
                                        )
                                      }
                                    />
                                    <span className="task-code">{formatTaskCode(peer.id)}</span>
                                    <span>{peer.title}</span>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {taskDraft.repeat === 'none' && (
                  <div className="task-drawer__schedule-section">
                    <div className="task-drawer__grid">
                      <div className="task-form-section">
                        <span>{t('tasks.details_start_prefix')}</span>
                        <div className="task-due-picker">
                          <DateTimePicker
                            ref={drawerStartDatePickerRef}
                            clearable
                            value={toLocalDateTime(taskDraft.startDate, taskDraft.startTime)}
                            onInputClick={() => {
                              drawerDueDatePickerRef.current?.setOpen(false)
                              drawerRuleStartDatePickerRef.current?.setOpen(false)
                            }}
                            onChange={(date: Date | null) => {
                              if (!date) {
                                setTaskDraft({ ...taskDraft, startDate: '', startTime: '' })
                                return
                              }
                              const startDate = toLocalDateKey(date)
                              setTaskDraft({
                                ...taskDraft,
                                startDate,
                                startTime: toLocalTimeValue(date),
                              })
                              if (drawerErrors.timeWindow) {
                                setDrawerErrors((current) => ({
                                  ...current,
                                  timeWindow: undefined,
                                }))
                              }
                            }}
                            timeInputLabel={t('tasks.time_picker_time_label')}
                            mode="date-time"
                            locale={datePickerLocale}
                            portalId="task-drawer-datepicker-portal"
                            popperPlacement="bottom-end"
                            ariaLabel={t('tasks.details_start_prefix')}
                            ariaInvalid={drawerErrors.timeWindow ? 'true' : undefined}
                            ariaDescribedBy={
                              drawerErrors.timeWindow ? 'task-time-window-error' : undefined
                            }
                          />
                        </div>
                      </div>
                      <div className="task-form-section">
                        <span>{t('tasks.details_due_prefix')}</span>
                        <div className="task-due-picker">
                          <DateTimePicker
                            ref={drawerDueDatePickerRef}
                            clearable
                            value={toLocalDateTime(taskDraft.dueDate, taskDraft.time)}
                            onInputClick={() => {
                              drawerStartDatePickerRef.current?.setOpen(false)
                              drawerRuleStartDatePickerRef.current?.setOpen(false)
                            }}
                            onChange={(date: Date | null) => {
                              if (!date) {
                                setTaskDraft({ ...taskDraft, dueDate: '', time: '' })
                                return
                              }
                              setTaskDraft({
                                ...taskDraft,
                                dueDate: toLocalDateKey(date),
                                time: toLocalTimeValue(date),
                              })
                              if (drawerErrors.timeWindow) {
                                setDrawerErrors((current) => ({
                                  ...current,
                                  timeWindow: undefined,
                                }))
                              }
                            }}
                            timeInputLabel={t('tasks.time_picker_time_label')}
                            mode="date-time"
                            locale={datePickerLocale}
                            portalId="task-drawer-datepicker-portal"
                            popperPlacement="bottom-end"
                            ariaLabel={t('tasks.details_due_prefix')}
                            ariaInvalid={drawerErrors.timeWindow ? 'true' : undefined}
                            ariaDescribedBy={
                              drawerErrors.timeWindow ? 'task-time-window-error' : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                    {drawerErrors.timeWindow && (
                      <p id="task-time-window-error" className="task-field-error" role="alert">
                        {drawerErrors.timeWindow}
                      </p>
                    )}
                  </div>
                )}
                <div className="task-drawer__schedule-section">
                  <label className="task-form-section">
                    <span>{t('tasks.quick_add_priority_label')}</span>
                    <Dropdown
                      className="form-field"
                      value={taskDraft.priority}
                      onChange={(event) =>
                        setTaskDraft({ ...taskDraft, priority: event.target.value })
                      }
                    >
                      <option value="high">{t('tasks.priority_high')}</option>
                      <option value="mid">{t('tasks.priority_mid')}</option>
                      <option value="low">{t('tasks.priority_low')}</option>
                    </Dropdown>
                  </label>
                </div>
                <label className="task-drawer__recurring-setting">
                  <span className="task-drawer__recurring-copy">
                    <strong>{t('tasks.requires_review_label')}</strong>
                    <small>{t('tasks.requires_review_hint')}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={taskDraft.requiresReview}
                    onChange={(event) =>
                      setTaskDraft({ ...taskDraft, requiresReview: event.target.checked })
                    }
                  />
                </label>
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
                      if (recurring) setRuleStartDate(taskDraft.startDate)
                      setIsRulePanelExpanded(recurring)
                    }}
                  />
                </label>
                {taskDraft.repeat !== 'none' && (
                  <div className="task-drawer__rule-panel">
                    <button
                      type="button"
                      className="task-drawer__rule-summary"
                      onClick={() => setIsRulePanelExpanded((current) => !current)}
                      aria-expanded={isRulePanelExpanded}
                    >
                      <span className="task-rule-summary__icon" aria-hidden="true">
                        <RefreshCw size={16} />
                      </span>
                      <span className="task-rule-summary__copy">
                        <strong>{getCurrentRuleScheduleSummary()}</strong>
                        <small>
                          {t('tasks.rule_summary_time_instances', {
                            count: ruleTimes.length,
                            times: ruleTimes.join(' / '),
                          })}{' '}
                          · {getCurrentRuleRangeSummary()}
                        </small>
                      </span>
                      <span className="task-rule-summary__action">
                        {isRulePanelExpanded
                          ? t('tasks.rule_action_collapse')
                          : t('tasks.rule_action_edit')}
                        {isRulePanelExpanded ? (
                          <ChevronUp size={16} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={16} aria-hidden="true" />
                        )}
                      </span>
                    </button>
                    {isRulePanelExpanded && (
                      <div className="task-drawer__rule-editor">
                        <section className="task-rule-section">
                          <header className="task-rule-section__header">
                            <span className="task-rule-section__number">1</span>
                            <span>
                              <strong>{t('tasks.rule_section_schedule')}</strong>
                              <small>{getCurrentRuleScheduleSummary()}</small>
                            </span>
                          </header>
                          <div
                            className="task-rule-mode-control"
                            role="group"
                            aria-label={t('tasks.schedule_mode_label')}
                          >
                            <button
                              type="button"
                              aria-pressed={ruleScheduleMode === 'rules'}
                              onClick={() => setRuleScheduleMode('rules')}
                            >
                              <CalendarDays size={15} aria-hidden="true" />
                              {t('tasks.schedule_mode_rules')}
                            </button>
                            <button
                              type="button"
                              aria-pressed={ruleScheduleMode === 'interval'}
                              onClick={() => setRuleScheduleMode('interval')}
                            >
                              <RefreshCw size={15} aria-hidden="true" />
                              {t('tasks.schedule_mode_interval')}
                            </button>
                          </div>

                          {ruleScheduleMode === 'interval' ? (
                            <label className="task-rule-interval-field">
                              <span>{t('tasks.rule_interval_prefix')}</span>
                              <input
                                className="form-field"
                                type="number"
                                min={1}
                                value={ruleInterval}
                                aria-label={t('tasks.interval_days_label')}
                                onChange={(event) =>
                                  setRuleInterval(Math.max(1, Number(event.target.value) || 1))
                                }
                              />
                              <span>{t('tasks.rule_interval_suffix')}</span>
                            </label>
                          ) : (
                            <div className="task-rule-condition-list">
                              <div className="task-rule-condition">
                                <div className="task-rule-condition__label">
                                  <strong>{t('tasks.week_days_label')}</strong>
                                  <small>{t('tasks.rule_condition_optional')}</small>
                                </div>
                                <div className="task-weekday-picker">
                                  {[0, 1, 2, 3, 4, 5, 6].map((day, index) => {
                                    const selected = ruleWeekDays.includes(day)
                                    return (
                                      <button
                                        key={day}
                                        type="button"
                                        aria-pressed={selected}
                                        onClick={() =>
                                          setRuleWeekDays(
                                            selected
                                              ? ruleWeekDays.filter((value) => value !== day)
                                              : [...ruleWeekDays, day],
                                          )
                                        }
                                      >
                                        {t('tasks.weekdays_sunday_first').split(',')[index]}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>

                              <div className="task-rule-condition">
                                <div className="task-rule-condition__label">
                                  <strong>{t('tasks.month_days_label')}</strong>
                                  <small>
                                    {ruleMonthDays.length > 0
                                      ? t('tasks.rule_selected_count', {
                                          count: ruleMonthDays.length,
                                        })
                                      : t('tasks.rule_condition_optional')}
                                  </small>
                                </div>
                                <button
                                  type="button"
                                  className="task-rule-picker-toggle"
                                  aria-expanded={isMonthDayPickerExpanded}
                                  onClick={() => setIsMonthDayPickerExpanded((current) => !current)}
                                >
                                  <span>
                                    {ruleMonthDays.length > 0
                                      ? [...ruleMonthDays]
                                          .sort((left, right) => left - right)
                                          .join(t('tasks.rule_value_separator'))
                                      : t('tasks.rule_no_month_days')}
                                  </span>
                                  {isMonthDayPickerExpanded ? (
                                    <ChevronUp size={15} aria-hidden="true" />
                                  ) : (
                                    <ChevronDown size={15} aria-hidden="true" />
                                  )}
                                </button>
                                {isMonthDayPickerExpanded && (
                                  <div className="task-monthday-picker">
                                    {Array.from({ length: 31 }, (_, index) => index + 1).map(
                                      (day) => {
                                        const selected = ruleMonthDays.includes(day)
                                        return (
                                          <button
                                            key={day}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() =>
                                              setRuleMonthDays(
                                                selected
                                                  ? ruleMonthDays.filter((value) => value !== day)
                                                  : [...ruleMonthDays, day],
                                              )
                                            }
                                          >
                                            {day}
                                          </button>
                                        )
                                      },
                                    )}
                                  </div>
                                )}
                              </div>

                              <button
                                type="button"
                                className="task-rule-exclusions-toggle"
                                aria-expanded={isRuleExclusionsExpanded}
                                onClick={() => setIsRuleExclusionsExpanded((current) => !current)}
                              >
                                <Plus size={14} aria-hidden="true" />
                                {t('tasks.rule_exclusions_label')}
                                {ruleExcludedWeekDays.length + ruleExcludedMonthDays.length > 0 && (
                                  <span>
                                    {ruleExcludedWeekDays.length + ruleExcludedMonthDays.length}
                                  </span>
                                )}
                              </button>

                              {isRuleExclusionsExpanded && (
                                <div className="task-rule-exclusions">
                                  <div className="task-rule-condition">
                                    <div className="task-rule-condition__label">
                                      <strong>{t('tasks.excluded_week_days_label')}</strong>
                                    </div>
                                    <div className="task-weekday-picker">
                                      {[0, 1, 2, 3, 4, 5, 6].map((day, index) => {
                                        const selected = ruleExcludedWeekDays.includes(day)
                                        return (
                                          <button
                                            key={day}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() =>
                                              setRuleExcludedWeekDays(
                                                selected
                                                  ? ruleExcludedWeekDays.filter(
                                                      (value) => value !== day,
                                                    )
                                                  : [...ruleExcludedWeekDays, day],
                                              )
                                            }
                                          >
                                            {t('tasks.weekdays_sunday_first').split(',')[index]}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <div className="task-rule-condition">
                                    <div className="task-rule-condition__label">
                                      <strong>{t('tasks.excluded_month_days_label')}</strong>
                                      <small>
                                        {t('tasks.rule_selected_count', {
                                          count: ruleExcludedMonthDays.length,
                                        })}
                                      </small>
                                    </div>
                                    <button
                                      type="button"
                                      className="task-rule-picker-toggle"
                                      aria-expanded={isExcludedMonthDayPickerExpanded}
                                      onClick={() =>
                                        setIsExcludedMonthDayPickerExpanded((current) => !current)
                                      }
                                    >
                                      <span>
                                        {ruleExcludedMonthDays.length > 0
                                          ? [...ruleExcludedMonthDays]
                                              .sort((left, right) => left - right)
                                              .join(t('tasks.rule_value_separator'))
                                          : t('tasks.rule_no_excluded_month_days')}
                                      </span>
                                      {isExcludedMonthDayPickerExpanded ? (
                                        <ChevronUp size={15} aria-hidden="true" />
                                      ) : (
                                        <ChevronDown size={15} aria-hidden="true" />
                                      )}
                                    </button>
                                    {isExcludedMonthDayPickerExpanded && (
                                      <div className="task-monthday-picker">
                                        {Array.from({ length: 31 }, (_, index) => index + 1).map(
                                          (day) => {
                                            const selected = ruleExcludedMonthDays.includes(day)
                                            return (
                                              <button
                                                key={day}
                                                type="button"
                                                aria-pressed={selected}
                                                onClick={() =>
                                                  setRuleExcludedMonthDays(
                                                    selected
                                                      ? ruleExcludedMonthDays.filter(
                                                          (value) => value !== day,
                                                        )
                                                      : [...ruleExcludedMonthDays, day],
                                                  )
                                                }
                                              >
                                                {day}
                                              </button>
                                            )
                                          },
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </section>

                        <section className="task-rule-section">
                          <header className="task-rule-section__header">
                            <span className="task-rule-section__number">2</span>
                            <span>
                              <strong>{t('tasks.rule_section_frequency')}</strong>
                              <small>
                                {t('tasks.rule_summary_time_instances', {
                                  count: ruleTimes.length,
                                  times: ruleTimes.join(' / '),
                                })}
                              </small>
                            </span>
                          </header>
                          <div className="task-drawer__times-editor">
                            {ruleTimes.map((time, index) => (
                              <div className="task-drawer__time-row" key={`${time}-${index}`}>
                                <span className="task-rule-time-index">{index + 1}</span>
                                <TimePicker
                                  ref={(picker) => {
                                    drawerRuleTimePickerRefs.current[index] = picker
                                  }}
                                  value={time}
                                  timeInputLabel={t('tasks.time_picker_time_label')}
                                  ariaLabel={t('tasks.rule_occurrence_time', { index: index + 1 })}
                                  onInputClick={() => {
                                    drawerStartDatePickerRef.current?.setOpen(false)
                                    drawerDueDatePickerRef.current?.setOpen(false)
                                    drawerRuleStartDatePickerRef.current?.setOpen(false)
                                    drawerRuleTimePickerRefs.current.forEach(
                                      (picker, pickerIndex) => {
                                        if (pickerIndex !== index) picker?.setOpen(false)
                                      },
                                    )
                                  }}
                                  onChange={(nextTime) =>
                                    setRuleTimes(
                                      ruleTimes.map((current, currentIndex) =>
                                        currentIndex === index ? nextTime : current,
                                      ),
                                    )
                                  }
                                />
                                {ruleTimes.length > 1 && (
                                  <button
                                    type="button"
                                    className="btn btn-icon-close"
                                    aria-label={t('tasks.remove_execution_time')}
                                    title={t('tasks.remove_execution_time')}
                                    onClick={() =>
                                      setRuleTimes(
                                        ruleTimes.filter(
                                          (_, currentIndex) => currentIndex !== index,
                                        ),
                                      )
                                    }
                                  >
                                    <Trash2 size={14} aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              className="task-rule-add-time"
                              onClick={() => setRuleTimes([...ruleTimes, '09:00'])}
                            >
                              <Plus size={14} aria-hidden="true" />
                              {t('tasks.add_time')}
                            </button>
                          </div>
                          <p className="task-rule-section__hint">
                            {t('tasks.instance_start_times_hint')}
                          </p>
                        </section>

                        <section className="task-rule-section">
                          <header className="task-rule-section__header">
                            <span className="task-rule-section__number">3</span>
                            <span>
                              <strong>{t('tasks.rule_section_deadline')}</strong>
                              <small>{t('tasks.rule_instance_deadline_summary')}</small>
                            </span>
                          </header>
                          <p className="task-rule-section__hint">
                            {t('tasks.rule_instance_deadline_hint')}
                          </p>
                        </section>

                        <section className="task-rule-section">
                          <header className="task-rule-section__header">
                            <span className="task-rule-section__number">4</span>
                            <span>
                              <strong>{t('tasks.rule_steps_label')}</strong>
                              <small>{t('tasks.rule_steps_hint')}</small>
                            </span>
                          </header>
                          <textarea
                            className="form-field"
                            rows={4}
                            value={ruleStepsText}
                            onChange={(event) => setRuleStepsText(event.target.value)}
                            placeholder={t('tasks.rule_steps_placeholder')}
                          />
                        </section>

                        <section className="task-rule-section">
                          <header className="task-rule-section__header">
                            <span className="task-rule-section__number">5</span>
                            <span>
                              <strong>{t('tasks.rule_section_range')}</strong>
                              <small>{getCurrentRuleRangeSummary()}</small>
                            </span>
                          </header>
                          <div className="task-rule-range-grid">
                            <div className="task-form-section">
                              <span>{t('tasks.rule_start_date_label')}</span>
                              <DateTimePicker
                                ref={drawerRuleStartDatePickerRef}
                                value={toLocalDate(ruleStartDate)}
                                onInputClick={() => {
                                  drawerStartDatePickerRef.current?.setOpen(false)
                                  drawerDueDatePickerRef.current?.setOpen(false)
                                  drawerRuleStartDatePickerRef.current?.setOpen(true)
                                }}
                                onChange={(date: Date | null) => {
                                  if (date) setRuleStartDate(toLocalDateKey(date))
                                }}
                                locale={datePickerLocale}
                                portalId="task-drawer-datepicker-portal"
                                popperPlacement="bottom-end"
                                ariaLabel={t('tasks.rule_start_date_label')}
                              />
                              {drawerErrors.ruleStartDate && (
                                <small className="task-field-error" role="alert">
                                  {drawerErrors.ruleStartDate}
                                </small>
                              )}
                            </div>
                            <label className="task-form-section">
                              <span>{t('tasks.rule_end_date_label')}</span>
                              <DateTimePicker
                                value={ruleEndDate ? toLocalDate(ruleEndDate) : null}
                                clearable
                                minDate={
                                  ruleStartDate
                                    ? (toLocalDate(ruleStartDate) ?? undefined)
                                    : undefined
                                }
                                ariaLabel={t('tasks.rule_end_date_label')}
                                ariaInvalid={drawerErrors.ruleEndDate ? 'true' : undefined}
                                onChange={(date) => {
                                  setRuleEndDate(date ? toLocalDateKey(date) : '')
                                  if (drawerErrors.ruleEndDate) {
                                    setDrawerErrors((current) => ({
                                      ...current,
                                      ruleEndDate: undefined,
                                    }))
                                  }
                                }}
                              />
                              {drawerErrors.ruleEndDate && (
                                <small className="task-field-error" role="alert">
                                  {drawerErrors.ruleEndDate}
                                </small>
                              )}
                            </label>
                          </div>
                        </section>

                        {drawerMode === 'edit' && activeTaskRule && (
                          <div className="task-rule-instance-note">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <span>{t('tasks.rule_instance_unchanged_note')}</span>
                          </div>
                        )}
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
                    onClick={(event) =>
                      openTaskDeletionConfirmation(activeTask, event.currentTarget)
                    }
                  >
                    {t('tasks.delete_task')}
                  </button>
                )}
                <button type="button" className="btn" onClick={closeTaskDrawer}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn primary" onClick={handleSaveDrawer}>
                  {drawerMode === 'create'
                    ? t('tasks.btn_create_task')
                    : t('tasks.btn_save_changes')}
                </button>
              </footer>
            </aside>
          </div>
        </ViewportPortal>
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
          <p className="task-completion-confirm__copy">{completionConfirmationCopy.description}</p>
          {completionConfirmationTask.status === TASK_STATUS.overdue ? (
            <div className="task-completion-confirm__actions task-completion-confirm__actions--overdue">
              <button
                type="button"
                className="btn"
                disabled={isCompletionConfirming}
                onClick={() => setCompletionConfirmationTask(null)}
              >
                {t('common.cancel')}
              </button>
              {Boolean(completionConfirmationTask.requires_review) && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={isCompletionConfirming}
                  onClick={() => void resolveOverdueTask(TASK_STATUS.review)}
                >
                  {t('tasks.confirm_resolve_overdue_review_action')}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={isCompletionConfirming}
                onClick={() => void resolveOverdueTask(TASK_STATUS.closed)}
              >
                {t('tasks.confirm_resolve_overdue_close_action')}
              </button>
            </div>
          ) : (
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
          )}
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
              <label className="task-delete-confirm__scope task-delete-confirm__scope--danger">
                <input
                  type="radio"
                  name="task-delete-scope"
                  value="delete-all-repeat"
                  checked={deletionScope === 'delete-all-repeat'}
                  disabled={isDeletingTask}
                  onChange={() => setDeletionScope('delete-all-repeat')}
                />
                <span>
                  <strong>{t('tasks.delete_scope_delete_all_repeat_title')}</strong>
                  <small>{t('tasks.delete_scope_delete_all_repeat_description')}</small>
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

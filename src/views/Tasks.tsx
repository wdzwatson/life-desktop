import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
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
import './Tasks.css'

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

  // Quick Add State
  const [quickTitle, setQuickTitle] = useState('')
  const [quickPriority, setQuickPriority] = useState('mid')
  const [quickDueDate] = useState('')
  const quickTitleInputRef = useRef<HTMLInputElement | null>(null)

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
  const [ruleTime, setRuleTime] = useState('09:00')
  const [ruleWeekDays, setRuleWeekDays] = useState<number[]>([]) // 1=Mon...7=Sun
  const [ruleMonthDays, setRuleMonthDays] = useState<number[]>([])
  const [ruleCron, setRuleCron] = useState('')
  const [ruleHolidayPolicy, setRuleHolidayPolicy] = useState('skip')

  // Calendar Mode State ('day' | 'week' | 'month')
  const [calendarMode, setCalendarMode] = useState<'day' | 'week' | 'month'>('week')
  const [calendarDate, setCalendarDate] = useState(() => new Date())

  // Templates
  const [templates, setTemplates] = useState<any[]>([])

  // Scheduled table logs
  const [scheduledLogs, setScheduledLogs] = useState<any[]>([])

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

    setScheduledLogs([
      {
        id: 1,
        name: t('tasks.log_backup_name'),
        action: t('tasks.log_backup_action'),
        trigger: t('tasks.log_backup_trigger'),
        status: t('tasks.log_backup_status'),
        nextRun: t('tasks.log_backup_next'),
      },
      {
        id: 2,
        name: t('tasks.log_scan_name'),
        action: t('tasks.log_scan_action'),
        trigger: t('tasks.log_scan_trigger'),
        status: t('tasks.log_scan_status'),
        nextRun: t('tasks.log_scan_next'),
      },
      {
        id: 3,
        name: t('tasks.log_archive_name'),
        action: t('tasks.log_archive_action'),
        trigger: t('tasks.log_archive_trigger'),
        status: t('tasks.log_archive_status'),
        nextRun: t('tasks.log_archive_next'),
      },
    ])
  }, [i18n.language])

  const api = (window as any).electronAPI

  const calendarTasksByDate = useMemo(() => groupTasksByDueDate(tasks), [tasks])
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
    setSelectedTaskId(task.id)
    setEditDesc(task.description || '')
    setEditProgress(task.progress || 0)
    setTaskTab('list')
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

  const handleStartFirstTask = () => {
    setTaskTab('list')
    setTimeout(() => quickTitleInputRef.current?.focus(), 0)
  }

  const loadData = async () => {
    if (api) {
      // Load Tasks
      const res = await api.dbQuery('tasks', 'SELECT * FROM tasks')
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
      const rulesRes = await api.dbQuery('tasks', 'SELECT * FROM recurring_rules')
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
        'UPDATE tasks SET is_completed = 1, status = ?, progress = 100 WHERE parent_id = ?',
        ['已关闭', task.id],
      )
    }

    showToast(nextDone ? t('tasks.toast_completed') : t('tasks.toast_reopened'))
    loadData()
  }

  // Quick Add task submit
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickTitle.trim() || !api) return

    let finalTitle = quickTitle
    let extractedPriority = quickPriority
    let extractedDueDate = quickDueDate || new Date().toISOString().slice(0, 10)

    // NLP parser mock (like Todoist)
    if (finalTitle.includes('#高') || finalTitle.toLowerCase().includes('#high')) {
      extractedPriority = 'high'
      finalTitle = finalTitle.replace('#高', '').replace(/#high/i, '')
    } else if (finalTitle.includes('#中') || finalTitle.toLowerCase().includes('#mid')) {
      extractedPriority = 'mid'
      finalTitle = finalTitle.replace('#中', '').replace(/#mid/i, '')
    } else if (finalTitle.includes('#低') || finalTitle.toLowerCase().includes('#low')) {
      extractedPriority = 'low'
      finalTitle = finalTitle.replace('#低', '').replace(/#low/i, '')
    }

    if (finalTitle.includes('明天') || finalTitle.toLowerCase().includes('tomorrow')) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      extractedDueDate = tomorrow.toISOString().slice(0, 10)
      finalTitle = finalTitle.replace('明天', '').replace(/tomorrow/i, '')
    } else if (finalTitle.includes('今天') || finalTitle.toLowerCase().includes('today')) {
      extractedDueDate = new Date().toISOString().slice(0, 10)
      finalTitle = finalTitle.replace('今天', '').replace(/today/i, '')
    }

    const query = `
      INSERT INTO tasks (title, description, priority, status, due_date, is_completed, progress)
      VALUES (?, ?, ?, '待处理', ?, 0, 0)
    `
    const res = await api.dbQuery('tasks', query, [
      finalTitle.trim(),
      '',
      extractedPriority,
      extractedDueDate,
    ])

    if (res?.success) {
      showToast(t('tasks.toast_task_added'))
      setQuickTitle('')
      loadData()
    }
  }

  // Subtask creation
  const handleAddSubtask = async (parentId: number) => {
    if (!api) return
    const title = window.prompt(t('tasks.prompt_subtask_title'))
    if (!title?.trim()) return

    const query = `
      INSERT INTO tasks (title, description, priority, status, due_date, parent_id, is_completed, progress)
      VALUES (?, '', 'mid', '待处理', ?, ?, 0, 0)
    `
    const res = await api.dbQuery('tasks', query, [
      title.trim(),
      new Date().toISOString().slice(0, 10),
      parentId,
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
        SET title = ?, description = ?, frequency = ?, interval = ?, week_days = ?, month_days = ?, cron = ?, missed_policy = ?
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
        ruleHolidayPolicy,
        selectedRuleId,
      ])
      showToast(t('tasks.toast_rule_modified'))
    } else {
      // Create new
      const query = `
        INSERT INTO recurring_rules (title, description, frequency, interval, week_days, month_days, cron, missed_policy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      await api.dbQuery('tasks', query, [
        ruleName,
        ruleDesc,
        ruleFreq,
        ruleInterval,
        weekDaysStr,
        monthDaysStr,
        ruleCron,
        ruleHolidayPolicy,
      ])
      showToast(t('tasks.toast_rule_created'))
    }
    loadData()
  }

  const handleNewRule = () => {
    setSelectedRuleId(null)
    setRuleName(t('tasks.rule_new_name'))
    setRuleDesc('')
    setRuleFreq('daily')
    setRuleInterval(1)
    setRuleWeekDays([])
    setRuleMonthDays([])
    setRuleCron('')
  }

  const handleDeleteRule = async (id: number) => {
    if (!api || !window.confirm(t('tasks.prompt_delete_rule_confirm'))) return
    await api.dbQuery('tasks', 'DELETE FROM recurring_rules WHERE id = ?', [id])
    setSelectedRuleId(null)
    showToast(t('tasks.toast_rule_deleted'))
    loadData()
  }

  const handleUseTemplate = async (template: any) => {
    if (!api) return
    const todayYMD = new Date().toISOString().slice(0, 10)

    // 1. Create parent task
    const parentRes = await api.dbQuery(
      'tasks',
      `
      INSERT INTO tasks (title, description, priority, status, due_date, is_completed, progress)
      VALUES (?, ?, 'mid', '待处理', ?, 0, 0)
    `,
      [template.title, t('tasks.template_created_desc'), todayYMD],
    )

    if (parentRes?.success) {
      const parentId = parentRes.data.insertId

      // 2. Create child tasks
      for (const sub of template.subtasks) {
        await api.dbQuery(
          'tasks',
          `
          INSERT INTO tasks (title, description, parent_id, is_completed, progress, priority, status, due_date)
          VALUES (?, '', ?, 0, 0, 'mid', '待处理', ?)
        `,
          [sub, parentId, todayYMD],
        )
      }
      showToast(t('tasks.toast_template_imported'))
      setTaskTab('list')
      loadData()
    }
  }

  const activeTask = tasks.find((t) => t.id === selectedTaskId)

  return (
    <div
      style={{
        animation: 'enter 0.15s ease both',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('tasks.title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('tasks.subtitle')}</p>
        </div>
      </div>

      {/* View Tabs */}
      <div
        className="tabs"
        style={{
          display: 'flex',
          gap: '4px',
          borderBottom: '1px solid var(--color-border)',
          marginBottom: '16px',
        }}
      >
        <button
          className={`tab ${taskTab === 'kanban' ? 'active' : ''}`}
          onClick={() => setTaskTab('kanban')}
        >
          {t('tasks.tab_kanban')}
        </button>
        <button
          className={`tab ${taskTab === 'list' ? 'active' : ''}`}
          onClick={() => setTaskTab('list')}
        >
          {t('tasks.tab_list')}
        </button>
        <button
          className={`tab ${taskTab === 'calendar' ? 'active' : ''}`}
          onClick={() => setTaskTab('calendar')}
        >
          {t('tasks.tab_calendar')}
        </button>
        <button
          className={`tab ${taskTab === 'recurring' ? 'active' : ''}`}
          onClick={() => setTaskTab('recurring')}
        >
          {t('tasks.tab_recurring')}
        </button>
        <button
          className={`tab ${taskTab === 'templates' ? 'active' : ''}`}
          onClick={() => setTaskTab('templates')}
        >
          {t('tasks.tab_templates')}
        </button>
        <button
          className={`tab ${taskTab === 'scheduled' ? 'active' : ''}`}
          onClick={() => setTaskTab('scheduled')}
        >
          {t('tasks.tab_scheduled')}
        </button>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0 }}>
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
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '12px',
                height: '100%',
                overflowY: 'auto',
              }}
            >
              {[
                { key: 'lane_inbox', dbVal: '待收集' },
                { key: 'lane_todo', dbVal: '待处理' },
                { key: 'lane_inprogress', dbVal: '进行中' },
                { key: 'lane_review', dbVal: '待验收' },
                { key: 'lane_closed', dbVal: '已关闭' },
              ].map((lane) => {
                const laneTasks = tasks.filter(
                  (t) =>
                    t.status === lane.dbVal ||
                    (lane.dbVal === '待处理' && t.status === '已逾期'),
                )
                return (
                  <div
                    key={lane.key}
                    style={{
                      backgroundColor: 'var(--bg-sidebar)',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      minHeight: '400px',
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
                          style={{
                            padding: '12px',
                            cursor: 'pointer',
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
                            setSelectedTaskId(task.id)
                            setEditDesc(task.description || '')
                            setEditProgress(task.progress || 0)
                            setTaskTab('list')
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 340px',
              gap: '16px',
              height: '100%',
            }}
          >
            {/* Left list tree */}
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}
            >
              {/* Quick Add Bar */}
              <form
                onSubmit={handleQuickAdd}
                style={{ display: 'flex', gap: '8px', padding: '4px' }}
              >
                <input
                  id="quickTitle"
                  ref={quickTitleInputRef}
                  className="form-field"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  placeholder={t('tasks.quick_add_placeholder')}
                  style={{ flexGrow: 1 }}
                />
                <select
                  className="form-field"
                  value={quickPriority}
                  onChange={(e) => setQuickPriority(e.target.value)}
                  style={{ width: '80px' }}
                >
                  <option value="high">{t('tasks.priority_high')}</option>
                  <option value="mid">{t('tasks.priority_mid')}</option>
                  <option value="low">{t('tasks.priority_low')}</option>
                </select>
                <button type="submit" className="btn primary">
                  <Plus size={16} />
                </button>
              </form>

              {/* Task rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {tasks
                  .filter((t) => !t.parent_id)
                  .map((task) => {
                    const children = tasks.filter((c) => c.parent_id === task.id)
                    const isSelected = selectedTaskId === task.id
                    const isOverdue = task.status === '已逾期'

                    return (
                      <div key={task.id} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'auto auto 1fr auto auto',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '12px',
                            border: '1px solid var(--color-border)',
                            borderRadius: '8px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.04)'
                              : 'var(--bg-surface)',
                            borderColor: isOverdue
                              ? 'var(--color-danger)'
                              : isSelected
                                ? 'var(--color-accent)'
                                : 'var(--color-border)',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            setSelectedTaskId(task.id)
                            setEditDesc(task.description || '')
                            setEditProgress(task.progress || 0)
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTaskDone(task)
                            }}
                            style={{
                              border: 'none',
                              background: 'none',
                              display: 'flex',
                              alignItems: 'center',
                            }}
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
                          <span
                            style={{
                              fontSize: '11px',
                              color: isOverdue ? 'var(--color-danger)' : 'var(--text-muted)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {isOverdue ? t('common.overdue') : task.due_date}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <span
                              style={{
                                fontSize: '13px',
                                fontWeight: 600,
                                textDecoration: task.is_completed === 1 ? 'line-through' : 'none',
                                color:
                                  task.is_completed === 1
                                    ? 'var(--text-muted)'
                                    : 'var(--text-main)',
                              }}
                            >
                              {task.title}
                            </span>
                            {task.progress > 0 && task.progress < 100 && (
                              <div
                                style={{
                                  height: '3px',
                                  backgroundColor: 'var(--color-border)',
                                  borderRadius: '2px',
                                  marginTop: '4px',
                                  width: '80px',
                                }}
                              >
                                <div
                                  style={{
                                    height: '100%',
                                    width: `${task.progress}%`,
                                    backgroundColor: 'var(--color-accent)',
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          <span
                            className={`pill ${task.priority === 'high' ? 'red' : task.priority === 'mid' ? 'yellow' : 'green'}`}
                            style={{ fontSize: '10px' }}
                          >
                            {getPriorityLabel(task.priority)}
                          </span>
                          <button
                            className="btn sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAddSubtask(task.id)
                            }}
                            title={t('tasks.add_subtask_tooltip')}
                          >
                            ＋
                          </button>
                        </div>

                        {/* Render subtasks */}
                        {children.map((child) => (
                          <div
                            key={child.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'auto auto 1fr auto',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '10px 12px 10px 32px',
                              borderLeft: '2px solid var(--color-border)',
                              backgroundColor:
                                selectedTaskId === child.id
                                  ? 'rgba(59, 130, 246, 0.02)'
                                  : 'transparent',
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              setSelectedTaskId(child.id)
                              setEditDesc(child.description || '')
                              setEditProgress(child.progress || 0)
                            }}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleTaskDone(child)
                              }}
                              style={{
                                border: 'none',
                                background: 'none',
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            >
                              {child.is_completed === 1 ? (
                                <Check size={14} color="var(--color-success)" />
                              ) : (
                                <Circle size={14} color="var(--text-muted)" />
                              )}
                            </button>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              {child.due_date}
                            </span>
                            <span
                              style={{
                                fontSize: '12.5px',
                                textDecoration: child.is_completed === 1 ? 'line-through' : 'none',
                                color:
                                  child.is_completed === 1
                                    ? 'var(--text-muted)'
                                    : 'var(--text-main)',
                              }}
                            >
                              {child.title}
                            </span>
                            <span
                              className={`pill ${child.priority === 'high' ? 'red' : child.priority === 'mid' ? 'yellow' : 'green'}`}
                              style={{ fontSize: '9px', transform: 'scale(0.85)' }}
                            >
                              {getPriorityLabel(child.priority)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
              </div>
            </div>

            {/* Right details panel */}
            <aside
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                height: '100%',
                overflowY: 'auto',
              }}
            >
              {activeTask ? (
                <>
                  <h3 style={{ fontSize: '15px', fontWeight: 800 }}>{t('tasks.details_title')}</h3>
                  <div>
                    <label
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: '4px',
                      }}
                    >
                      {t('tasks.details_label_title')}
                    </label>
                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{activeTask.title}</div>
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: '4px',
                      }}
                    >
                      {t('tasks.details_label_desc')}
                    </label>
                    <textarea
                      className="form-field"
                      rows={3}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder={t('tasks.details_desc_placeholder')}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: '4px',
                      }}
                    >
                      {t('tasks.details_label_status')}: {getStatusLabel(activeTask.status)}
                    </label>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <span className="pill">
                        {getPriorityLabel(activeTask.priority)} {t('tasks.details_priority_suffix')}
                      </span>
                      <span className="pill">
                        {t('tasks.details_due_prefix')}{' '}
                        {activeTask.due_date || t('tasks.due_date_not_set')}
                      </span>
                    </div>
                  </div>

                  {/* Manual Progress Slider */}
                  {!activeTask.parent_id && tasks.some((c) => c.parent_id === activeTask.id) ? (
                    <div>
                      <label
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: '4px',
                        }}
                      >
                        {t('tasks.details_subtask_progress')}
                      </label>
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
                              width: `${activeTask.progress}%`,
                              backgroundColor: 'var(--color-accent)',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 'bold' }}>
                          {activeTask.progress}%
                        </span>
                      </div>
                      <p
                        style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '4px' }}
                      >
                        {t('tasks.details_subtask_progress_tip')}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: '4px',
                        }}
                      >
                        {t('tasks.details_label_progress')}: {editProgress}%
                      </label>
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
                    className="btn primary"
                    onClick={handleSaveDetails}
                    style={{ marginTop: 'auto' }}
                  >
                    {t('tasks.btn_save_changes')}
                  </button>
                </>
              ) : (
                <div
                  style={{
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    margin: 'auto',
                    fontStyle: 'italic',
                    fontSize: '12px',
                  }}
                >
                  {t('tasks.select_task_tip')}
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
                    className={`btn sm ${calendarMode === 'day' ? 'primary' : ''}`}
                    onClick={() => setCalendarMode('day')}
                  >
                    {t('tasks.calendar_mode_day')}
                  </button>
                  <button
                    className={`btn sm ${calendarMode === 'week' ? 'primary' : ''}`}
                    onClick={() => setCalendarMode('week')}
                  >
                    {t('tasks.calendar_mode_week')}
                  </button>
                  <button
                    className={`btn sm ${calendarMode === 'month' ? 'primary' : ''}`}
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '320px 1fr',
              gap: '16px',
              height: '100%',
            }}
          >
            {/* Left rules list */}
            <div
              className="card"
              style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <strong style={{ fontSize: '13px' }}>{t('tasks.recurring_rules_title')}</strong>
                <button className="btn sm primary" onClick={handleNewRule}>
                  ＋
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    style={{
                      padding: '10px',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      backgroundColor:
                        selectedRuleId === rule.id ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
                      borderColor:
                        selectedRuleId === rule.id ? 'var(--color-accent)' : 'var(--color-border)',
                      cursor: 'pointer',
                    }}
                    onClick={() => selectRule(rule)}
                  >
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{rule.title}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {rule.frequency === 'daily'
                        ? t('tasks.freq_daily')
                        : rule.frequency === 'weekday'
                          ? t('tasks.freq_weekday')
                          : rule.frequency === 'weekly'
                            ? t('tasks.freq_weekly')
                            : rule.frequency === 'monthly'
                              ? t('tasks.freq_monthly')
                              : rule.frequency}{' '}
                      · {rule.cron || t('tasks.no_cron')}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right rule editor */}
            <div
              className="card"
              style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <h3 style={{ fontSize: '15px', fontWeight: 800 }}>
                  {t('tasks.config_rule_title')}
                </h3>
                {selectedRuleId && (
                  <button className="btn sm" onClick={() => handleDeleteRule(selectedRuleId)}>
                    <Trash2 size={12} /> {t('common.delete')}
                  </button>
                )}
              </div>

              <div>
                <label
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    display: 'block',
                    marginBottom: '4px',
                  }}
                >
                  {t('tasks.rule_name_label')}
                </label>
                <input
                  className="form-field"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                />
              </div>

              <div>
                <label
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    display: 'block',
                    marginBottom: '4px',
                  }}
                >
                  {t('tasks.details_label_desc')}
                </label>
                <textarea
                  className="form-field"
                  rows={2}
                  value={ruleDesc}
                  onChange={(e) => setRuleDesc(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: '10px' }}>
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      display: 'block',
                      marginBottom: '4px',
                    }}
                  >
                    {t('tasks.freq_label')}
                  </label>
                  <select
                    className="form-field"
                    value={ruleFreq}
                    onChange={(e) => setRuleFreq(e.target.value)}
                  >
                    <option value="daily">{t('tasks.freq_daily')}</option>
                    <option value="weekday">{t('tasks.freq_weekday')}</option>
                    <option value="weekly">{t('tasks.freq_weekly')}</option>
                    <option value="monthly">{t('tasks.freq_monthly')}</option>
                    <option value="cron">{t('tasks.freq_cron')}</option>
                  </select>
                </div>
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      display: 'block',
                      marginBottom: '4px',
                    }}
                  >
                    {t('tasks.interval_label')}
                  </label>
                  <input
                    className="form-field"
                    type="number"
                    value={ruleInterval}
                    onChange={(e) => setRuleInterval(parseInt(e.target.value))}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      display: 'block',
                      marginBottom: '4px',
                    }}
                  >
                    {t('tasks.time_label')}
                  </label>
                  <input
                    className="form-field"
                    type="time"
                    value={ruleTime}
                    onChange={(e) => setRuleTime(e.target.value)}
                  />
                </div>
              </div>

              {ruleFreq === 'weekly' && (
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      display: 'block',
                      marginBottom: '6px',
                    }}
                  >
                    {t('tasks.days_of_week_label')}
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                      const isActive = ruleWeekDays.includes(d)
                      const names = t('tasks.weekdays_short').split(',')
                      return (
                        <button
                          key={d}
                          type="button"
                          className="btn sm"
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
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      display: 'block',
                      marginBottom: '4px',
                    }}
                  >
                    {t('tasks.freq_cron')}
                  </label>
                  <input
                    className="form-field"
                    value={ruleCron}
                    onChange={(e) => setRuleCron(e.target.value)}
                    placeholder="0 22 * * *"
                  />
                  <span
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--text-muted)',
                      marginTop: '4px',
                      display: 'block',
                    }}
                  >
                    {t('tasks.cron_hint')}
                  </span>
                </div>
              )}

              <div>
                <label
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    display: 'block',
                    marginBottom: '4px',
                  }}
                >
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

              {/* Next 8 triggers preview mockup */}
              <div>
                <label
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    display: 'block',
                    marginBottom: '6px',
                  }}
                >
                  {t('tasks.future_triggers_label')}
                </label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {t('tasks.future_triggers_list')
                    .split(',')
                    .map((t) => (
                      <span key={t} className="pill blue">
                        {t}
                      </span>
                    ))}
                </div>
              </div>

              <button
                className="btn primary"
                onClick={handleSaveRule}
                style={{ width: 'max-content', alignSelf: 'flex-end', marginTop: 'auto' }}
              >
                {t('tasks.btn_save_rule')}
              </button>
            </div>
          </div>
        )}

        {/* TAB: TEMPLATES */}
        {taskTab === 'templates' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '16px',
              overflowY: 'auto',
              height: '100%',
            }}
          >
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="card"
                style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>{tpl.icon}</span>
                  <h3 style={{ fontSize: '14px', fontWeight: 700 }}>{tpl.title}</h3>
                </div>
                <ul
                  style={{
                    paddingLeft: '18px',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    flexGrow: 1,
                  }}
                >
                  {tpl.subtasks.map((st: string) => (
                    <li key={st}>{st}</li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '8px 0' }}>
                  {tpl.tags.map((t: string) => (
                    <span key={t} className="pill">
                      {t}
                    </span>
                  ))}
                </div>
                <button
                  className="btn primary sm"
                  onClick={() => handleUseTemplate(tpl)}
                  style={{ width: 'max-content' }}
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
            <strong style={{ fontSize: '14px' }}>{t('tasks.scheduled_log_title')}</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
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
                {scheduledLogs.map((log) => (
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
                        className="btn sm"
                        onClick={() => showToast(t('tasks.toast_action_triggered'))}
                      >
                        {t('tasks.btn_run_now')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export const TASK_STATUS = {
  pending: '待处理',
  inProgress: '进行中',
  review: '待审核',
  closed: '已关闭',
  overdue: '已逾期',
} as const

export type TaskWorkflowRecord = {
  status?: string | null
  is_completed?: number | boolean | null
  requires_review?: number | boolean | null
  start_date?: string | null
  start_time?: string | null
  due_date?: string | null
  due_time?: string | null
}

const parseLocalDateTime = (date: string | null | undefined, time: string | null | undefined) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date?.trim() ?? '')
  if (!dateMatch) return null
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time?.trim() ?? '')
  const hour = timeMatch ? Number(timeMatch[1]) : 0
  const minute = timeMatch ? Number(timeMatch[2]) : 0
  const second = timeMatch?.[3] ? Number(timeMatch[3]) : 0
  const value = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hour,
    minute,
    second,
  )
  return Number.isNaN(value.getTime()) ? null : value
}

// Terminal states are intentional user decisions. All other states are derived from the task window.
export const getAutomaticTaskStatus = (task: TaskWorkflowRecord, now = new Date()) => {
  if (task.status === TASK_STATUS.closed || task.status === TASK_STATUS.review) return task.status
  if (task.is_completed === 1 || task.is_completed === true) {
    return task.requires_review ? TASK_STATUS.review : TASK_STATUS.closed
  }

  const startsAt = parseLocalDateTime(task.start_date, task.start_time)
  const dueAt = parseLocalDateTime(task.due_date, task.due_time)
  if (startsAt && now.getTime() < startsAt.getTime()) return TASK_STATUS.pending
  if (dueAt && now.getTime() > dueAt.getTime()) return TASK_STATUS.overdue
  return TASK_STATUS.inProgress
}

export const getReopenedTaskStatus = (task: TaskWorkflowRecord, now = new Date()) =>
  getAutomaticTaskStatus({ ...task, status: TASK_STATUS.inProgress, is_completed: 0 }, now)

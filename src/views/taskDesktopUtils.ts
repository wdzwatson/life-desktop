import { normalizeTaskDueDate } from './taskCalendarUtils'

export type DesktopTask = {
  status?: string | null
  due_date?: string | null
  start_date?: string | null
  end_date?: string | null
  is_completed?: number | boolean | null
}

export type DesktopTaskDateState = {
  todayKey: string
  startKey: string | null
  endKey: string | null
  isActiveToday: boolean
  isOverdue: boolean
  isVisible: boolean
}

const padDatePart = (value: number) => String(value).padStart(2, '0')

export const getUserDateKey = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export const getSystemDateKey = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`

const normalizeDate = (value: string | null | undefined) => normalizeTaskDueDate(value)

export const getDesktopTaskDateState = (
  task: DesktopTask,
  todayKey: string,
): DesktopTaskDateState => {
  const startKey = normalizeDate(task.start_date)
  // Existing tasks only have due_date. Treat it as the inclusive end of the task period.
  const endKey = normalizeDate(task.end_date) ?? normalizeDate(task.due_date)
  const isActiveToday = (!startKey || startKey <= todayKey) && (!endKey || endKey >= todayKey)
  const isOverdue = Boolean(endKey && endKey < todayKey)
  const isVisible = task.status !== '已关闭' && (isActiveToday || isOverdue)

  return { todayKey, startKey, endKey, isActiveToday, isOverdue, isVisible }
}

export const getDesktopTasksForDate = <Task extends DesktopTask>(tasks: Task[], todayKey: string) =>
  tasks.filter((task) => getDesktopTaskDateState(task, todayKey).isVisible)

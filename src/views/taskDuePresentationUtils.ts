import { normalizeTaskDueDate } from './taskCalendarUtils'

export type TaskDuePresentation = {
  dateKey: string | null
  time: string | null
  isEndOfDay: boolean
}

export const isEndOfDayDueTime = (value: string | null | undefined) => value === '23:59:59'

export const getTaskDuePresentation = (
  dueDate: string | null | undefined,
  dueTime: string | null | undefined,
): TaskDuePresentation => {
  const dateKey = normalizeTaskDueDate(dueDate)
  if (!dateKey) return { dateKey: null, time: null, isEndOfDay: false }

  if (isEndOfDayDueTime(dueTime)) {
    return { dateKey, time: null, isEndOfDay: true }
  }

  return { dateKey, time: dueTime ? dueTime.slice(0, 5) : null, isEndOfDay: false }
}

export type TaskCalendarMode = 'day' | 'week' | 'month'

export type TaskWithDueDate = {
  due_date?: string | null
}

const padDatePart = (value: number) => String(value).padStart(2, '0')

export const toCalendarDateKey = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`

export const normalizeTaskDueDate = (value: string | null | undefined) => {
  const candidate = value?.trim().slice(0, 10) ?? ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }
  return toCalendarDateKey(parsed)
}

export const getCalendarWeekDays = (date: Date) => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const weekday = start.getDay()
  const distanceFromMonday = weekday === 0 ? 6 : weekday - 1
  start.setDate(start.getDate() - distanceFromMonday)

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

export const getCalendarMonthDays = (date: Date) => {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1)
  const gridStart = getCalendarWeekDays(firstDay)[0]

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + index)
    return day
  })
}

export const shiftCalendarDate = (date: Date, mode: TaskCalendarMode, amount: number) => {
  if (mode === 'day') {
    const result = new Date(date)
    result.setDate(result.getDate() + amount)
    return result
  }

  if (mode === 'week') {
    const result = new Date(date)
    result.setDate(result.getDate() + amount * 7)
    return result
  }

  const targetMonth = new Date(date.getFullYear(), date.getMonth() + amount, 1)
  const lastTargetDay = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0,
  ).getDate()
  targetMonth.setDate(Math.min(date.getDate(), lastTargetDay))
  return targetMonth
}

export const groupTasksByDueDate = <Task extends TaskWithDueDate>(tasks: Task[]) => {
  const result = new Map<string, Task[]>()
  for (const task of tasks) {
    const dateKey = normalizeTaskDueDate(task.due_date)
    if (!dateKey) continue
    const current = result.get(dateKey) ?? []
    current.push(task)
    result.set(dateKey, current)
  }
  return result
}

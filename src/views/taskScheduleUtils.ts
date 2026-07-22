export type TaskTemplateRule = {
  id: number
  title: string
  description?: string | null
  frequency?: string | null
  interval?: number | null
  week_days?: string | null
  month_days?: string | null
  cron?: string | null
  start_date?: string | null
  start_time?: string | null
  time_slots?: string | null
  created_at?: string | null
  last_trigger_time?: string | null
}

export type TaskTemplateOccurrence = {
  dateKey: string
  time: string
  instanceKey: string
}

const padDatePart = (value: number) => String(value).padStart(2, '0')

export const toLocalDateKey = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`

const parseDateKey = (value: string | null | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? '')
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
  return toLocalDateKey(parsed)
}

const parseTime = (value: string | null | undefined) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '')
  if (!match) return '09:00'

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return '09:00'
  return `${padDatePart(hour)}:${padDatePart(minute)}`
}

const localDayNumber = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Math.floor(new Date(year, month - 1, day).getTime() / 86_400_000)
}

const getWeekStartDayNumber = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const jsDay = date.getDay()
  const distanceFromMonday = jsDay === 0 ? 6 : jsDay - 1
  return localDayNumber(dateKey) - distanceFromMonday
}

const monthDifference = (startDateKey: string, currentDate: Date) => {
  const [startYear, startMonth] = startDateKey.split('-').map(Number)
  return (currentDate.getFullYear() - startYear) * 12 + currentDate.getMonth() + 1 - startMonth
}

const numberList = (value: string | null | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item))

const getWorkingDaysSinceStart = (startDateKey: string, currentDateKey: string) => {
  const [startYear, startMonth, startDay] = startDateKey.split('-').map(Number)
  const [currentYear, currentMonth, currentDay] = currentDateKey.split('-').map(Number)
  const cursor = new Date(startYear, startMonth - 1, startDay)
  const end = new Date(currentYear, currentMonth - 1, currentDay)
  let workingDays = 0

  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) workingDays += 1
    cursor.setDate(cursor.getDate() + 1)
  }

  return workingDays
}

export const getTemplateStartDateKey = (rule: TaskTemplateRule, now = new Date()) =>
  parseDateKey(rule.start_date) ?? parseDateKey(rule.created_at) ?? toLocalDateKey(now)

export const getTemplateStartTime = (rule: TaskTemplateRule) => parseTime(rule.start_time)

export const getTemplateTimes = (rule: TaskTemplateRule) => {
  const configuredTimes = (rule.time_slots ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseTime)

  return configuredTimes.length > 0 ? configuredTimes : [getTemplateStartTime(rule)]
}

export const getDueTemplateOccurrences = (
  rule: TaskTemplateRule,
  now = new Date(),
  options: { ignoreStartTime?: boolean } = {},
): TaskTemplateOccurrence[] => {
  const dateKey = toLocalDateKey(now)
  const startDateKey = getTemplateStartDateKey(rule, now)
  if (localDayNumber(dateKey) < localDayNumber(startDateKey)) return []

  const times = getTemplateTimes(rule)
  const firstTime = times[0]
  const [hour, minute] = firstTime.split(':').map(Number)
  const scheduledAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
  if (!options.ignoreStartTime && now.getTime() < scheduledAt.getTime()) return []

  const frequency = rule.frequency || 'daily'
  const interval = Math.max(1, Number(rule.interval) || 1)
  const startDayNumber = localDayNumber(startDateKey)
  const currentDayNumber = localDayNumber(dateKey)
  const daysSinceStart = currentDayNumber - startDayNumber
  let matches = false

  if (frequency === 'custom') {
    matches = daysSinceStart === 0 && !rule.last_trigger_time
  } else if (frequency === 'daily') {
    matches = daysSinceStart % interval === 0
  } else if (frequency === 'weekday') {
    const jsDay = now.getDay()
    const workingDaysSinceStart = getWorkingDaysSinceStart(startDateKey, dateKey)
    matches =
      jsDay !== 0 &&
      jsDay !== 6 &&
      workingDaysSinceStart > 0 &&
      (workingDaysSinceStart - 1) % interval === 0
  } else if (frequency === 'weekly') {
    const selectedDays = numberList(rule.week_days)
    const visualWeekday = now.getDay() === 0 ? 7 : now.getDay()
    const weeksSinceStart = Math.floor(
      (getWeekStartDayNumber(dateKey) - getWeekStartDayNumber(startDateKey)) / 7,
    )
    matches =
      weeksSinceStart >= 0 &&
      weeksSinceStart % interval === 0 &&
      (selectedDays.length === 0 || selectedDays.includes(visualWeekday))
  } else if (frequency === 'monthly') {
    const monthDays = numberList(rule.month_days)
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const startDay = Number(startDateKey.slice(8, 10))
    const effectiveDays = monthDays.length > 0 ? monthDays : [Math.min(startDay, lastDayOfMonth)]
    const monthsSinceStart = monthDifference(startDateKey, now)
    matches =
      monthsSinceStart >= 0 &&
      monthsSinceStart % interval === 0 &&
      effectiveDays.some((day) => (day === -1 ? now.getDate() === lastDayOfMonth : day === now.getDate()))
  }

  if (!matches) return []
  return times.map((time) => ({
    dateKey,
    time,
    instanceKey: `${dateKey}T${time}`,
  }))
}

export const getDueTemplateOccurrence = (
  rule: TaskTemplateRule,
  now = new Date(),
  options: { ignoreStartTime?: boolean } = {},
): TaskTemplateOccurrence | null => getDueTemplateOccurrences(rule, now, options)[0] ?? null

export const getNextTemplateOccurrences = (
  rule: TaskTemplateRule,
  from = new Date(),
  limit = 5,
) => {
  const occurrences: TaskTemplateOccurrence[] = []
  const probe = new Date(from)

  for (let offset = 0; offset < 370 && occurrences.length < limit; offset += 1) {
    const startTime = getTemplateStartTime(rule)
    const [hour, minute] = startTime.split(':').map(Number)
    const candidate = new Date(
      probe.getFullYear(),
      probe.getMonth(),
      probe.getDate() + offset,
      hour,
      minute,
    )
    const dueOccurrences = getDueTemplateOccurrences(
      {
        ...rule,
        last_trigger_time: rule.frequency === 'custom' ? null : rule.last_trigger_time,
      },
      candidate,
    )
    for (const occurrence of dueOccurrences) {
      const occurrenceAt = new Date(`${occurrence.dateKey}T${occurrence.time}:00`)
      if (occurrenceAt.getTime() < from.getTime()) continue
      if (occurrences.some((item) => item.instanceKey === occurrence.instanceKey)) continue
      occurrences.push(occurrence)
    }
  }

  return occurrences
}

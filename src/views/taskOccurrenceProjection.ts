import {
  getNextTemplateOccurrences,
  toLocalDateKey,
  type TaskTemplateRule,
} from './taskScheduleUtils'

type PersistedTask = {
  id: number
  due_date?: string | null
  recur_rule_id?: number | null
  template_id?: number | null
  template_version?: number | null
  instance_key?: string | null
}

export type CalendarOccurrence = PersistedTask & {
  title: string
  description?: string | null
  priority: string
  status: string
  is_virtual?: boolean
  occurrence_time?: string
  due_time?: string | null
}

export const projectCalendarOccurrences = (
  tasks: CalendarOccurrence[],
  rules: TaskTemplateRule[],
  start: Date,
  end: Date,
  skippedKeys = new Set<string>(),
) => {
  const realKeys = new Set(tasks.map((task) => `${task.recur_rule_id ?? ''}:${task.instance_key ?? ''}`))
  const projected = [...tasks]
  const startKey = toLocalDateKey(start)
  const endKey = toLocalDateKey(end)

  for (const rule of rules) {
    for (const occurrence of getNextTemplateOccurrences(rule, start, 370)) {
      if (occurrence.dateKey < startKey || occurrence.dateKey > endKey) continue
      if (skippedKeys.has(`${rule.id}:${occurrence.instanceKey}`)) continue
      if (realKeys.has(`${rule.id}:${occurrence.instanceKey}`)) continue
      projected.push({
        id: -Number(`${rule.id}${occurrence.dateKey.replaceAll('-', '')}${occurrence.time.replaceAll(':', '')}`),
        title: rule.title,
        description: rule.description,
        priority: (rule as any).priority || 'mid',
        status: '待处理',
        due_date: occurrence.dateKey,
        due_time: occurrence.time,
        recur_rule_id: rule.id,
        template_id: (rule as any).template_id || null,
        template_version: (rule as any).template_version || null,
        instance_key: occurrence.instanceKey,
        occurrence_time: occurrence.time,
        is_virtual: true,
      })
    }
  }
  return projected
}

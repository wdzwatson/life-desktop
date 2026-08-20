import { getDueTemplateOccurrences } from '../src/views/taskScheduleUtils'
import { getAutomaticTaskStatus, TASK_STATUS } from '../src/taskWorkflow'

type Occurrence = { dateKey: string; time: string; instanceKey: string }

const groupOccurrencesByDate = (occurrences: Occurrence[]) => {
  const grouped = new Map<string, Occurrence[]>()
  for (const occurrence of occurrences) {
    const items = grouped.get(occurrence.dateKey) || []
    items.push(occurrence)
    grouped.set(occurrence.dateKey, items)
  }
  return grouped
}

export function runTaskSchedulerCore(db: any, now = new Date()) {
  const generatedTasks: { title: string }[] = []
  const overdueTasks: { id: number; title: string }[] = []

  for (const rule of db.prepare('SELECT * FROM recurring_rules').all() as any[]) {
    const occurrences = getDueTemplateOccurrences(rule, now, { ignoreStartTime: true }) as Occurrence[]
    const groups = groupOccurrencesByDate(occurrences)
    const runDate = db.transaction((dateKey: string, dateOccurrences: Occurrence[]) => {
      const available = dateOccurrences.filter(
        (occurrence) =>
          !db
            .prepare(
              'SELECT 1 FROM recurring_rule_occurrence_exceptions WHERE recur_rule_id = ? AND instance_key = ? LIMIT 1',
            )
            .get(rule.id, occurrence.instanceKey),
      )
      if (available.length === 0) return 0

      db.prepare(
        'INSERT OR IGNORE INTO recurring_instances (recur_rule_id, date_key) VALUES (?, ?)',
      ).run(rule.id, dateKey)
      const instance = db
        .prepare('SELECT id FROM recurring_instances WHERE recur_rule_id = ? AND date_key = ?')
        .get(rule.id, dateKey) as { id: number }
      if (!instance) return 0

      let parent = db
        .prepare(
          'SELECT * FROM tasks WHERE recurring_instance_id = ? AND recur_instance_root = 1 LIMIT 1',
        )
        .get(instance.id) as any
      if (!parent) {
        const inserted = db
          .prepare(
            `INSERT INTO tasks
              (title, description, priority, status, requires_review, start_date, start_time,
               due_date, due_time, recur_rule_id, template_id, template_version,
               recurring_instance_id, instance_key, recur_instance_root, parent_id, progress)
             VALUES (?, ?, ?, '待处理', ?, ?, '00:00:00', ?, '23:59:59', ?, ?, ?, ?, NULL, 1, ?, 0)`,
          )
          .run(
            rule.title,
            rule.description || '',
            rule.priority || 'mid',
            rule.requires_review ? 1 : 0,
            dateKey,
            dateKey,
            rule.id,
            rule.template_id || null,
            rule.template_version || null,
            instance.id,
            rule.parent_id || null,
          )
        parent = { id: Number(inserted.lastInsertRowid) }
        generatedTasks.push({ title: rule.title })
      }

      const insertChild = db.prepare(
        `INSERT INTO tasks
          (title, description, priority, status, requires_review, start_date, start_time,
           due_date, due_time, recur_rule_id, template_id, template_version,
           recurring_instance_id, instance_key, recur_instance_root, parent_id, progress)
         VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
      )
      const steps = db
        .prepare('SELECT * FROM recurring_rule_steps WHERE rule_id = ? ORDER BY sort_order ASC, id ASC')
        .all(rule.id) as any[]
      const insertStep = db.prepare(
        `INSERT INTO tasks
          (title, description, priority, status, requires_review, start_date, start_time,
           due_date, due_time, recur_rule_id, template_id, template_version,
           recurring_instance_id, instance_key, parent_id, progress)
         VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      let added = 0
      for (const occurrence of available) {
        const existing = db
          .prepare(
            'SELECT id FROM tasks WHERE recurring_instance_id = ? AND instance_key = ? AND parent_id = ? LIMIT 1',
          )
          .get(instance.id, occurrence.instanceKey, parent.id)
        const childId = existing?.id ?? Number(insertChild.run(
          rule.title,
          rule.description || '',
          rule.priority || 'mid',
          rule.requires_review ? 1 : 0,
          dateKey,
          occurrence.time,
          dateKey,
          `${occurrence.time}:00`,
          rule.id,
          rule.template_id || null,
          rule.template_version || null,
          instance.id,
          occurrence.instanceKey,
          parent.id,
        ).lastInsertRowid)
        for (const step of steps) {
          const stepExists = db
            .prepare('SELECT id FROM tasks WHERE parent_id = ? AND title = ? LIMIT 1')
            .get(childId, step.title)
          if (!stepExists) {
            insertStep.run(
              step.title,
              step.description || '',
              step.priority || rule.priority || 'mid',
              rule.requires_review ? 1 : 0,
              dateKey,
              occurrence.time,
              dateKey,
              `${occurrence.time}:00`,
              rule.id,
              rule.template_id || null,
              rule.template_version || null,
              instance.id,
              null,
              childId,
            )
          }
        }
        if (!existing) added += 1
      }
      return added
    })

    for (const [dateKey, dateOccurrences] of groups) runDate(dateKey, dateOccurrences)
    if (occurrences.length > 0)
      db.prepare('UPDATE recurring_rules SET last_trigger_time = ? WHERE id = ?').run(
        now.toISOString(),
        rule.id,
      )
  }

  for (const task of db
    .prepare("SELECT * FROM tasks WHERE is_completed = 0 AND status NOT IN ('已关闭', '待审核')")
    .all() as any[]) {
    const nextStatus = getAutomaticTaskStatus(task, now)
    if (nextStatus === task.status) continue
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(nextStatus, task.id)
    if (nextStatus === TASK_STATUS.overdue) overdueTasks.push({ id: task.id, title: task.title })
  }
  return { generatedTasks, overdueTasks }
}

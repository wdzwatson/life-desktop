import { getDueTemplateOccurrences, toLocalDateKey } from '../src/views/taskScheduleUtils'

export function runTaskSchedulerCore(db: any, now = new Date()) {
  const generatedTasks: { title: string }[] = []
  const overdueTasks: { id: number; title: string }[] = []
  const currentYMD = toLocalDateKey(now)

  for (const rule of db.prepare('SELECT * FROM recurring_rules').all() as any[]) {
    const occurrences = getDueTemplateOccurrences(rule, now, { ignoreStartTime: true })
    for (const occurrence of occurrences) {
      if (db.prepare('SELECT 1 FROM recurring_rule_occurrence_exceptions WHERE recur_rule_id = ? AND instance_key = ? LIMIT 1').get(rule.id, occurrence.instanceKey)) continue
      if (db.prepare('SELECT id FROM tasks WHERE recur_rule_id = ? AND instance_key = ? AND parent_id IS NULL LIMIT 1').get(rule.id, occurrence.instanceKey)) continue

      const inserted = db.prepare(`INSERT INTO tasks (title, description, priority, status, due_date, due_time, recur_rule_id, template_id, template_version, instance_key, progress) VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, 0)`).run(
        rule.title, rule.description || '', rule.priority || 'mid', occurrence.dateKey, occurrence.time, rule.id, rule.template_id || null, rule.template_version || null, occurrence.instanceKey,
      )
      const parentId = Number(inserted.lastInsertRowid)
      const insertStep = db.prepare(`INSERT INTO tasks (title, description, priority, status, due_date, due_time, recur_rule_id, template_id, template_version, instance_key, parent_id, progress) VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, ?, 0)`)
      for (const step of db.prepare('SELECT * FROM recurring_rule_steps WHERE rule_id = ? ORDER BY sort_order ASC, id ASC').all(rule.id) as any[]) {
        insertStep.run(step.title, step.description || '', step.priority || rule.priority || 'mid', occurrence.dateKey, occurrence.time, rule.id, rule.template_id || null, rule.template_version || null, occurrence.instanceKey, parentId)
      }
      generatedTasks.push({ title: rule.title })
    }
    if (occurrences.length > 0) db.prepare('UPDATE recurring_rules SET last_trigger_time = ? WHERE id = ?').run(now.toISOString(), rule.id)
  }

  for (const task of db.prepare("SELECT * FROM tasks WHERE due_date < ? AND is_completed = 0 AND status != '已关闭' AND status != '已逾期'").all(currentYMD) as any[]) {
    db.prepare("UPDATE tasks SET status = '已逾期' WHERE id = ?").run(task.id)
    overdueTasks.push({ id: task.id, title: task.title })
  }
  return { generatedTasks, overdueTasks }
}

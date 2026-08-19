import { TASK_STATUS } from './taskWorkflow'

export type TaskTreeMutation = {
  sql: string
  params: Array<number | string | null>
}

const taskTreeCte = `
  WITH RECURSIVE task_tree(id) AS (
    SELECT id FROM tasks WHERE id = ?
    UNION ALL
    SELECT tasks.id FROM tasks
    INNER JOIN task_tree ON tasks.parent_id = task_tree.id
  )
`

const getLocalDateTimeParts = (now: Date) => {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}:${second}` }
}

export const buildCompleteTaskTreeMutation = (taskId: number): TaskTreeMutation => ({
  sql: `${taskTreeCte}
    UPDATE tasks
    SET is_completed = 1,
        progress = 100,
        status = CASE
          WHEN (SELECT requires_review FROM tasks WHERE id = ?) = 1 THEN '${TASK_STATUS.review}'
          ELSE '${TASK_STATUS.closed}'
        END
    WHERE id IN (SELECT id FROM task_tree)
      AND is_completed = 0
  `,
  params: [taskId, taskId],
})

export const buildReopenTaskTreeMutation = (
  taskId: number,
  now = new Date(),
): TaskTreeMutation => {
  const localNow = getLocalDateTimeParts(now)
  return {
    sql: `${taskTreeCte}
      UPDATE tasks
      SET is_completed = 0,
          progress = 0,
          status = CASE
            WHEN start_date IS NOT NULL AND (
              start_date > ? OR
              (start_date = ? AND COALESCE(start_time, '00:00:00') > ?)
            ) THEN '${TASK_STATUS.pending}'
            WHEN due_date IS NOT NULL AND (
              due_date < ? OR
              (due_date = ? AND COALESCE(due_time, '23:59:59') < ?)
            ) THEN '${TASK_STATUS.overdue}'
            ELSE '${TASK_STATUS.inProgress}'
          END
      WHERE id IN (SELECT id FROM task_tree)
    `,
    params: [
      taskId,
      localNow.date,
      localNow.date,
      localNow.time,
      localNow.date,
      localNow.date,
      localNow.time,
    ],
  }
}

export const buildResolveTaskTreeMutation = (
  taskId: number,
  status: typeof TASK_STATUS.review | typeof TASK_STATUS.closed,
): TaskTreeMutation => ({
  sql: `${taskTreeCte}
    UPDATE tasks
    SET status = ?, is_completed = 1, progress = 100
    WHERE id IN (SELECT id FROM task_tree)
  `,
  params: [taskId, status],
})

export const buildCloseTaskTreeMutation = (taskId: number): TaskTreeMutation => ({
  sql: `${taskTreeCte}
    UPDATE tasks
    SET closed_from_status = status,
        status = '${TASK_STATUS.closed}',
        is_completed = 1,
        progress = 100
    WHERE id IN (SELECT id FROM task_tree)
  `,
  params: [taskId],
})

export const buildAggregateTaskMutation = (
  taskId: number,
  now = new Date(),
): TaskTreeMutation => {
  const localNow = getLocalDateTimeParts(now)
  return {
    sql: `
      UPDATE tasks AS parent
      SET is_completed = CASE
            WHEN EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id)
             AND NOT EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id AND child.is_completed = 0)
            THEN 1 ELSE 0 END,
          progress = CASE
            WHEN NOT EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id) THEN parent.progress
            ELSE COALESCE((SELECT ROUND(AVG(child.progress)) FROM tasks AS child WHERE child.parent_id = parent.id), 0)
          END,
          status = CASE
            WHEN EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id)
             AND NOT EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id AND child.is_completed = 0)
             AND EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id AND child.status = '${TASK_STATUS.review}')
            THEN '${TASK_STATUS.review}'
            WHEN EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id)
             AND NOT EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id AND child.is_completed = 0)
            THEN '${TASK_STATUS.closed}'
            WHEN start_date IS NOT NULL AND (
              start_date > ? OR (start_date = ? AND COALESCE(start_time, '00:00:00') > ?)
            ) THEN '${TASK_STATUS.pending}'
            WHEN due_date IS NOT NULL AND (
              due_date < ? OR (due_date = ? AND COALESCE(due_time, '23:59:59') < ?)
            ) THEN '${TASK_STATUS.overdue}'
            ELSE '${TASK_STATUS.inProgress}'
          END
      WHERE parent.id = ?
        AND EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_id = parent.id)
    `,
    params: [
      localNow.date,
      localNow.date,
      localNow.time,
      localNow.date,
      localNow.date,
      localNow.time,
      taskId,
    ],
  }
}

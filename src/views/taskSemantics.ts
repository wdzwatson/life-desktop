export type TaskKind = 'normal' | 'recurring_date_instance' | 'recurring_execution'
export type RelationKind = 'root' | 'manual_child' | 'recurring_occurrence'

export const isRecurringDateInstance = (task: any) =>
  task?.task_kind === 'recurring_date_instance' ||
  (task?.recur_rule_id != null && task?.recur_instance_root === 1 && !task?.instance_key)

export const isRecurringExecution = (task: any) =>
  task?.task_kind === 'recurring_execution' ||
  (task?.recur_rule_id != null && task?.instance_key != null && task?.recur_instance_root === 0)

export const isRecurringStep = (task: any) =>
  task?.relation_kind === 'manual_child' &&
  task?.task_kind === 'normal' &&
  task?.recurring_instance_id != null

export const isManualTask = (task: any) => task?.task_kind === 'normal' && !isRecurringStep(task)

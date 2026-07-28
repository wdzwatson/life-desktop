export type HierarchyTask = {
  id: number
  parent_id?: number | null
  title?: string
}

export const formatTaskCode = (taskId: number) => `#${taskId}`

export const parseTaskCode = (value: string) => {
  const match = /^\s*#?(\d+)\s*$/.exec(value)
  if (!match) return null

  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export const getTaskAncestorPath = <Task extends HierarchyTask>(tasks: Task[], taskId: number) => {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const path: Task[] = []
  const visited = new Set<number>()
  let current = byId.get(taskId)

  while (current && !visited.has(current.id)) {
    path.unshift(current)
    visited.add(current.id)
    current = current.parent_id == null ? undefined : byId.get(current.parent_id)
  }

  return path
}

export const getTaskDescendantIds = <Task extends HierarchyTask>(tasks: Task[], taskId: number) => {
  const childrenByParent = new Map<number, number[]>()
  for (const task of tasks) {
    if (task.parent_id == null) continue
    childrenByParent.set(task.parent_id, [...(childrenByParent.get(task.parent_id) ?? []), task.id])
  }

  const descendants = new Set<number>()
  const pending = [...(childrenByParent.get(taskId) ?? [])]
  while (pending.length > 0) {
    const childId = pending.shift()
    if (childId == null || descendants.has(childId)) continue
    descendants.add(childId)
    pending.push(...(childrenByParent.get(childId) ?? []))
  }
  return descendants
}

export const canBindTaskToParent = <Task extends HierarchyTask>(
  tasks: Task[],
  taskId: number | null,
  parentId: number | null,
) => {
  if (parentId == null) return true
  if (taskId === parentId) return false

  const parent = tasks.find((task) => task.id === parentId)
  if (!parent) return false
  if (taskId == null) return true

  return !getTaskDescendantIds(tasks, taskId).has(parentId)
}

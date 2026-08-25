export const TASK_CHANGE_CHANNEL = 'tasks:changed'

export interface TaskChangePayload {
  reason: string
  revision: number
}

export interface TaskChangeTarget {
  send: (channel: string, payload: TaskChangePayload) => void
}

export class TaskChangeBus {
  private revision = 0
  private subscribers = new Set<number>()
  private readonly resolveTarget: (webContentsId: number) => TaskChangeTarget | null

  constructor(resolveTarget: (webContentsId: number) => TaskChangeTarget | null) {
    this.resolveTarget = resolveTarget
  }

  subscribe(webContentsId: number) {
    if (this.subscribers.has(webContentsId)) return false
    this.subscribers.add(webContentsId)
    this.deliver(webContentsId, { reason: 'subscribe', revision: this.revision })
    return true
  }

  unsubscribe(webContentsId: number) {
    this.subscribers.delete(webContentsId)
  }

  publish(reason: string) {
    const payload = { reason, revision: ++this.revision }
    for (const webContentsId of this.subscribers) this.deliver(webContentsId, payload)
    return payload
  }

  private deliver(webContentsId: number, payload: TaskChangePayload) {
    const target = this.resolveTarget(webContentsId)
    if (!target) {
      this.subscribers.delete(webContentsId)
      return
    }
    try {
      target.send(TASK_CHANGE_CHANNEL, payload)
    } catch {
      this.subscribers.delete(webContentsId)
    }
  }
}

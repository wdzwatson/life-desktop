export type DouyinTimeoutKind = 'page_load' | 'page_action' | 'sync_inactivity'

export class DouyinTimeoutError extends Error {
  readonly kind: DouyinTimeoutKind

  constructor(kind: DouyinTimeoutKind, message: string) {
    super(message)
    this.name = 'DouyinTimeoutError'
    this.kind = kind
  }
}

export function withDouyinTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  kind: DouyinTimeoutKind = 'page_load',
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new DouyinTimeoutError(kind, message)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export function withDouyinSyncInactivityTimeout<T>(
  operation: (reportActivity: () => void) => Promise<T>,
  timeoutMs: number,
  message: string,
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (callback: (value: T | Error) => void, value: T | Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      callback(value)
    }
    const reportActivity = () => {
      if (settled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(
        () => finish(reject, new DouyinTimeoutError('sync_inactivity', message)),
        timeoutMs,
      )
    }
    reportActivity()
    Promise.resolve()
      .then(() => operation(reportActivity))
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error instanceof Error ? error : new Error(String(error))),
      )
  })
}

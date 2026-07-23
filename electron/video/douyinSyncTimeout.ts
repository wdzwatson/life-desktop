export function withDouyinTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
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
      timer = setTimeout(() => finish(reject, new Error(message)), timeoutMs)
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

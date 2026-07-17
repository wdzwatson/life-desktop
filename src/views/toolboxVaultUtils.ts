export type ClipboardWriter = (value: string) => void | Promise<void>
export type TimerScheduler = (callback: () => void, delayMs: number) => unknown

export async function copySecretWithAutoClear(
  writeText: ClipboardWriter,
  secret: string,
  clearDelayMs = 30000,
  schedule: TimerScheduler = setTimeout,
) {
  await writeText(secret)
  schedule(() => {
    void writeText('')
  }, clearDelayMs)
}

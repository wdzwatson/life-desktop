export function getGifCapturePlan(durationSeconds: number, requestedInterval: number) {
  const targetDuration = Math.max(2, Math.min(15, durationSeconds)) * 1_000
  const interval = Math.max(
    Math.ceil(targetDuration / 20),
    Math.min(Math.max(150, Math.min(3_000, requestedInterval)), Math.floor(targetDuration / 2)),
  )
  const frameCount = Math.max(2, Math.min(20, Math.round(targetDuration / interval)))
  return { frameCount, interval, playbackDuration: frameCount * interval }
}

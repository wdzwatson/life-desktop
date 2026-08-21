export type GlobalSearchMetricEvent =
  'query_started' | 'first_result' | 'result_clicked' | 'query_empty' | 'query_failed'

export type GlobalSearchMetricModule = 'command' | 'tasks' | 'notes' | 'books' | 'videos'

export type GlobalSearchMetric = {
  event: GlobalSearchMetricEvent
  module?: GlobalSearchMetricModule
  duration_ms?: number
  timestamp: string
}

export const GLOBAL_SEARCH_METRICS_STORAGE_KEY = 'lifeos.global-search.metrics.v1'
type MetricStorage = Pick<Storage, 'getItem' | 'setItem'>

export function createGlobalSearchMetric(
  event: GlobalSearchMetricEvent,
  fields: { module?: GlobalSearchMetricModule; duration_ms?: number } = {},
  now = new Date(),
): GlobalSearchMetric {
  const metric: GlobalSearchMetric = { event, timestamp: now.toISOString() }
  if (fields.module) metric.module = fields.module
  if (typeof fields.duration_ms === 'number' && Number.isFinite(fields.duration_ms)) {
    metric.duration_ms = Math.max(0, Math.round(fields.duration_ms))
  }
  return metric
}

export function appendGlobalSearchMetric(metric: GlobalSearchMetric, storage?: MetricStorage) {
  if (!storage) return false
  try {
    const parsed = JSON.parse(storage.getItem(GLOBAL_SEARCH_METRICS_STORAGE_KEY) || '[]')
    const metrics = Array.isArray(parsed) ? parsed : []
    metrics.push(metric)
    storage.setItem(GLOBAL_SEARCH_METRICS_STORAGE_KEY, JSON.stringify(metrics.slice(-100)))
    return true
  } catch {
    return false
  }
}

export function recordGlobalSearchMetric(
  event: GlobalSearchMetricEvent,
  fields: { module?: GlobalSearchMetricModule; duration_ms?: number } = {},
) {
  if (typeof window === 'undefined') return false
  return appendGlobalSearchMetric(createGlobalSearchMetric(event, fields), window.sessionStorage)
}

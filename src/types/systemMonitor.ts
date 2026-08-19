export type SystemMonitorMetric = 'cpu' | 'memory' | 'network'
export type SystemMonitorStatus = 'ready' | 'stale' | 'unavailable'

export interface SystemMonitorInterface {
  name: string
  online: boolean
  downloadBps: number
  uploadBps: number
  receivedBytes: number
  sentBytes: number
}

export interface SystemMonitorSnapshot {
  timestamp: number
  status: SystemMonitorStatus
  cpu: { percent: number }
  memory: { usedBytes: number; totalBytes: number; percent: number }
  network: {
    online: boolean
    downloadBps: number
    uploadBps: number
    interfaces: SystemMonitorInterface[]
  }
}

export interface SystemMonitorProcessRow {
  key: string
  name: string
  pidCount: number
  cpuPercent: number
  memoryBytes: number
  memoryPercent: number
}

export interface SystemMonitorNetworkRow {
  key: string
  name: string
  online: boolean
  downloadBps: number
  uploadBps: number
  percent: number
}

export interface SystemMonitorDetails {
  metric: SystemMonitorMetric
  timestamp: number
  rows: SystemMonitorProcessRow[] | SystemMonitorNetworkRow[]
  supported: boolean
  note?: string
}

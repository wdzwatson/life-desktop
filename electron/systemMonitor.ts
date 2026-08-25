import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const POWERSHELL_UTF8_PREFIX =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

export type MonitorMetric = 'cpu' | 'memory' | 'network'
export type MonitorStatus = 'ready' | 'stale' | 'unavailable'

export interface SystemMonitorSnapshot {
  timestamp: number
  status: MonitorStatus
  cpu: { percent: number }
  memory: { usedBytes: number; totalBytes: number; percent: number }
  network: {
    online: boolean
    downloadBps: number
    uploadBps: number
    interfaces: NetworkInterfaceSnapshot[]
  }
}

export interface NetworkInterfaceSnapshot {
  name: string
  online: boolean
  downloadBps: number
  uploadBps: number
  receivedBytes: number
  sentBytes: number
}

export interface ProcessResourceRow {
  key: string
  name: string
  pidCount: number
  cpuPercent: number
  memoryBytes: number
  memoryPercent: number
}

export interface NetworkResourceRow {
  key: string
  name: string
  online: boolean
  downloadBps: number
  uploadBps: number
  percent: number
}

export interface SystemMonitorDetails {
  metric: MonitorMetric
  timestamp: number
  rows: ProcessResourceRow[] | NetworkResourceRow[]
  supported: boolean
  note?: string
}

type RawProcess = {
  pid: number
  name: string
  cpuPercent: number
  memoryBytes: number
}

type CpuSample = { idle: number; total: number }
type NetworkCounter = { receivedBytes: number; sentBytes: number }

const MAX_ROWS = 8
const SAMPLE_INTERVAL_MS = 3_000
const DETAIL_INTERVAL_MS = 5_000
const BYTES_PER_MB = 1024 * 1024

const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
const round = (value: number, digits = 1) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const normalizeProcessName = (value: string) => {
  const trimmed = value.trim().replace(/^\[|\]$/g, '')
  return trimmed || 'Unknown process'
}

export const normalizeDarwinProcessName = (value: string) => {
  const normalized = normalizeProcessName(value)
  const bundleMatch = normalized.match(/(?:^|\/)([^/]+)\.app(?:\/|$)/i)
  if (bundleMatch?.[1]) return bundleMatch[1]
  if (normalized.startsWith('/')) return path.posix.basename(normalized) || normalized
  return normalized
}

const groupProcessRows = (processes: RawProcess[], totalMemory: number): ProcessResourceRow[] => {
  const grouped = new Map<string, ProcessResourceRow>()
  for (const process of processes) {
    if (process.pid <= 0 || process.name === 'System Idle Process' || process.name === 'Idle')
      continue
    const name = normalizeProcessName(process.name)
    const key = name.toLowerCase()
    const current = grouped.get(key) ?? {
      key,
      name,
      pidCount: 0,
      cpuPercent: 0,
      memoryBytes: 0,
      memoryPercent: 0,
    }
    current.pidCount += 1
    current.cpuPercent += Math.max(0, process.cpuPercent)
    current.memoryBytes += Math.max(0, process.memoryBytes)
    current.memoryPercent = totalMemory > 0 ? (current.memoryBytes / totalMemory) * 100 : 0
    grouped.set(key, current)
  }
  return [...grouped.values()]
}

const sortRows = (rows: ProcessResourceRow[], metric: 'cpu' | 'memory') =>
  rows
    .sort((left, right) =>
      metric === 'cpu'
        ? right.cpuPercent - left.cpuPercent || right.memoryBytes - left.memoryBytes
        : right.memoryBytes - left.memoryBytes || right.cpuPercent - left.cpuPercent,
    )
    .slice(0, MAX_ROWS)
    .map((row) => ({
      ...row,
      cpuPercent: round(row.cpuPercent),
      memoryPercent: round(row.memoryPercent),
    }))

const parseNumber = (value: string | undefined) => {
  const parsed = Number.parseFloat((value || '').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

const execPowerShell = (command: string, maxBuffer = 2 * 1024 * 1024) =>
  execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `${POWERSHELL_UTF8_PREFIX}${command}`],
    { windowsHide: true, maxBuffer },
  )

const parseCsvFields = (line: string) =>
  line
    .replace(/^"|"$/g, '')
    .split('","')
    .map((field) => field.replace(/""/g, '"'))

const getCpuSample = (): CpuSample => {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    idle += cpu.times.idle
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
  }
  return { idle, total }
}

const getDefaultInterfaceNames = () => {
  const interfaces = os.networkInterfaces()
  return new Set(
    Object.entries(interfaces)
      .filter(([, addresses]) => addresses?.some((address) => !address.internal))
      .map(([name]) => name),
  )
}

const parseLinuxNetwork = async (): Promise<Map<string, NetworkCounter>> => {
  const content = await fs.readFile('/proc/net/dev', 'utf8')
  const counters = new Map<string, NetworkCounter>()
  for (const line of content.split('\n').slice(2)) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const name = line.slice(0, separator).trim()
    const fields = line
      .slice(separator + 1)
      .trim()
      .split(/\s+/)
    if (fields.length < 9) continue
    counters.set(name, { receivedBytes: Number(fields[0]) || 0, sentBytes: Number(fields[8]) || 0 })
  }
  return counters
}

export const parseDarwinNetworkOutput = (stdout: string): Map<string, NetworkCounter> => {
  const counters = new Map<string, NetworkCounter>()
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const header = lines.find((line) => {
    const fields = line.split(/\s+/)
    return fields.includes('Name') && fields.includes('Ibytes') && fields.includes('Obytes')
  })
  if (!header) return counters
  const headerFields = header.split(/\s+/)
  const nameIndex = headerFields.indexOf('Name')
  const receivedIndex = headerFields.indexOf('Ibytes')
  const sentIndex = headerFields.indexOf('Obytes')
  if (nameIndex < 0 || receivedIndex < 0 || sentIndex < 0) return counters
  const headerPosition = lines.indexOf(header)
  for (const line of lines.slice(headerPosition + 1)) {
    const fields = line.split(/\s+/)
    if (fields[0] === 'Name' || fields.length <= Math.max(nameIndex, receivedIndex, sentIndex))
      continue
    const name = fields[nameIndex]
    if (!name) continue
    const receivedBytes = Number(fields[receivedIndex]) || 0
    const sentBytes = Number(fields[sentIndex]) || 0
    const previous = counters.get(name)
    counters.set(name, {
      receivedBytes: Math.max(previous?.receivedBytes || 0, receivedBytes),
      sentBytes: Math.max(previous?.sentBytes || 0, sentBytes),
    })
  }
  return counters
}

const parseDarwinNetwork = async (): Promise<Map<string, NetworkCounter>> => {
  const { stdout } = await execFileAsync('/usr/sbin/netstat', ['-ibdn'])
  return parseDarwinNetworkOutput(stdout)
}

export const parseWindowsNetworkOutput = (stdout: string): Map<string, NetworkCounter> => {
  const counters = new Map<string, NetworkCounter>()
  for (const line of stdout.split('\n')) {
    const numbers = line.match(/[\d][\d,]*/g)
    if (!numbers || numbers.length < 2) continue
    counters.set('system', {
      receivedBytes: parseNumber(numbers[0]),
      sentBytes: parseNumber(numbers[1]),
    })
    break
  }
  return counters
}

const parseWindowsNetwork = async (): Promise<Map<string, NetworkCounter>> => {
  const { stdout } = await execFileAsync('netstat.exe', ['-e'], {
    windowsHide: true,
    maxBuffer: 512 * 1024,
  })
  return parseWindowsNetworkOutput(stdout)
}

const getWindowsInterfaceCounters = async (): Promise<Map<string, NetworkCounter>> => {
  const command =
    'Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Csv -NoTypeInformation'
  const { stdout } = await execPowerShell(command)
  const counters = new Map<string, NetworkCounter>()
  for (const line of stdout
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(1)) {
    const fields = parseCsvFields(line)
    if (fields.length < 3) continue
    counters.set(fields[0], {
      receivedBytes: Number(fields[1]) || 0,
      sentBytes: Number(fields[2]) || 0,
    })
  }
  return counters
}

const readNetworkCounters = async () => {
  if (process.platform === 'linux') return parseLinuxNetwork()
  if (process.platform === 'darwin') return parseDarwinNetwork()
  if (process.platform === 'win32') return parseWindowsNetwork()
  return new Map<string, NetworkCounter>()
}

const getProcessRowsWithPs = async (
  normalizeName: (value: string) => string = normalizeProcessName,
): Promise<RawProcess[]> => {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,pcpu=,rss=,comm='], {
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+([\d.,]+)\s+(\d+)\s+(.+)$/)
      if (!match) return null
      return {
        pid: Number(match[1]),
        cpuPercent: parseNumber(match[2]) / Math.max(1, os.cpus().length),
        memoryBytes: Number(match[3]) * 1024,
        name: normalizeName(match[4]),
      }
    })
    .filter((process): process is RawProcess => process !== null)
}

const getLinuxProcessRows = async (): Promise<RawProcess[]> => {
  const rows = await getProcessRowsWithPs()
  return rows
}

const getDarwinProcessRows = async (): Promise<RawProcess[]> => {
  const rows = await getProcessRowsWithPs(normalizeDarwinProcessName)
  return rows
}

type WindowsProcessCounter = { pid: number; name: string; cpuSeconds: number; memoryBytes: number }
let windowsProcessPrevious = new Map<number, WindowsProcessCounter>()
let windowsProcessPreviousAt = 0

const queryWindowsProcessCounters = async (): Promise<WindowsProcessCounter[]> => {
  const command =
    'Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Csv -NoTypeInformation'
  const { stdout } = await execPowerShell(command, 8 * 1024 * 1024)
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const rows: WindowsProcessCounter[] = []
  for (const line of lines.slice(1)) {
    const fields = parseCsvFields(line)
    if (fields.length < 4) continue
    const [pid, name, cpu, memory] = fields
    rows.push({
      pid: Number(pid),
      name: normalizeProcessName(name),
      cpuSeconds: parseNumber(cpu),
      memoryBytes: Number(memory) || 0,
    })
  }
  return rows
}

const getWindowsProcessRows = async (): Promise<RawProcess[]> => {
  let current = await queryWindowsProcessCounters()
  let sampledAt = Date.now()
  if (windowsProcessPreviousAt === 0) {
    windowsProcessPrevious = new Map(current.map((process) => [process.pid, process]))
    windowsProcessPreviousAt = sampledAt
    await new Promise((resolve) => setTimeout(resolve, 650))
    current = await queryWindowsProcessCounters()
    sampledAt = Date.now()
  }
  const elapsedMs = Math.max(250, sampledAt - windowsProcessPreviousAt)
  const coreCount = Math.max(1, os.cpus().length)
  const rows = current.map((process) => {
    const previous = windowsProcessPrevious.get(process.pid)
    const cpuDeltaMs = previous ? Math.max(0, (process.cpuSeconds - previous.cpuSeconds) * 1000) : 0
    return {
      pid: process.pid,
      name: process.name,
      cpuPercent: clampPercent((cpuDeltaMs / elapsedMs / coreCount) * 100),
      memoryBytes: process.memoryBytes,
    }
  })
  windowsProcessPrevious = new Map(current.map((process) => [process.pid, process]))
  windowsProcessPreviousAt = sampledAt
  return rows
}

const readProcessRows = async () => {
  if (process.platform === 'win32') return getWindowsProcessRows()
  if (process.platform === 'linux') return getLinuxProcessRows()
  if (process.platform === 'darwin') return getDarwinProcessRows()
  return []
}

export class SystemMonitorService {
  private subscribers = new Set<(snapshot: SystemMonitorSnapshot) => void>()
  private detailSubscribers = new Map<MonitorMetric, Set<(details: SystemMonitorDetails) => void>>()
  private snapshot: SystemMonitorSnapshot = this.emptySnapshot()
  private cpuPrevious = getCpuSample()
  private networkPrevious: Map<string, NetworkCounter> | null = null
  private sampleTimer: NodeJS.Timeout | null = null
  private detailTimer: NodeJS.Timeout | null = null
  private overviewLoopActive = false
  private detailLoopActive = false
  private sampleInFlight = false
  private detailInFlight = false
  private networkDetailPrevious: Map<string, NetworkCounter> | null = null
  private networkDetailPreviousAt = 0

  subscribe(callback: (snapshot: SystemMonitorSnapshot) => void) {
    this.subscribers.add(callback)
    callback(this.snapshot)
    this.ensureTimers()
    return () => {
      this.subscribers.delete(callback)
      this.ensureTimers()
    }
  }

  subscribeDetails(metric: MonitorMetric, callback: (details: SystemMonitorDetails) => void) {
    const subscribers = this.detailSubscribers.get(metric) ?? new Set()
    subscribers.add(callback)
    this.detailSubscribers.set(metric, subscribers)
    this.ensureTimers()
    void this.collectDetails(metric)
    return () => {
      subscribers.delete(callback)
      if (subscribers.size === 0) this.detailSubscribers.delete(metric)
      this.ensureTimers()
    }
  }

  getSnapshot() {
    return this.snapshot
  }

  private ensureTimers() {
    const wantsOverview = this.subscribers.size > 0
    const wantsDetails = this.detailSubscribers.size > 0
    if (wantsOverview && !this.overviewLoopActive) {
      this.overviewLoopActive = true
      void this.scheduleOverview()
    }
    if (!wantsOverview) {
      if (this.sampleTimer) clearTimeout(this.sampleTimer)
      this.sampleTimer = null
      this.overviewLoopActive = false
    }
    if (wantsDetails && !this.detailLoopActive) {
      this.detailLoopActive = true
      void this.scheduleDetails()
    }
    if (!wantsDetails) {
      if (this.detailTimer) clearTimeout(this.detailTimer)
      this.detailTimer = null
      this.detailLoopActive = false
    }
  }

  private async scheduleOverview() {
    await this.collectOverview()
    if (this.subscribers.size === 0) {
      this.overviewLoopActive = false
      return
    }
    this.sampleTimer = setTimeout(() => {
      this.sampleTimer = null
      void this.scheduleOverview()
    }, SAMPLE_INTERVAL_MS)
  }

  private async scheduleDetails() {
    for (const metric of this.detailSubscribers.keys()) await this.collectDetails(metric)
    if (this.detailSubscribers.size === 0) {
      this.detailLoopActive = false
      return
    }
    this.detailTimer = setTimeout(() => {
      this.detailTimer = null
      void this.scheduleDetails()
    }, DETAIL_INTERVAL_MS)
  }

  private async collectOverview() {
    if (this.sampleInFlight) return
    this.sampleInFlight = true
    try {
      const cpuCurrent = getCpuSample()
      const cpuDelta = cpuCurrent.total - this.cpuPrevious.total
      const idleDelta = cpuCurrent.idle - this.cpuPrevious.idle
      this.cpuPrevious = cpuCurrent
      const cpuPercent = cpuDelta > 0 ? clampPercent((1 - idleDelta / cpuDelta) * 100) : 0
      const totalBytes = os.totalmem()
      const freeBytes = await this.getAvailableMemory()
      const network = await this.collectNetwork()
      this.snapshot = {
        timestamp: Date.now(),
        status: 'ready',
        cpu: { percent: round(cpuPercent) },
        memory: {
          usedBytes: Math.max(0, totalBytes - freeBytes),
          totalBytes,
          percent: totalBytes > 0 ? round(((totalBytes - freeBytes) / totalBytes) * 100) : 0,
        },
        network,
      }
      for (const subscriber of this.subscribers) subscriber(this.snapshot)
    } catch {
      this.snapshot = { ...this.snapshot, timestamp: Date.now(), status: 'stale' }
      for (const subscriber of this.subscribers) subscriber(this.snapshot)
    } finally {
      this.sampleInFlight = false
    }
  }

  private async collectNetwork() {
    const current = await readNetworkCounters()
    const defaults = getDefaultInterfaceNames()
    const elapsedMs =
      this.snapshot.timestamp > 0
        ? Math.max(250, Date.now() - this.snapshot.timestamp)
        : SAMPLE_INTERVAL_MS
    const interfaces = [...current.entries()]
      .filter(([name]) => name !== 'lo' && name !== 'Loopback Pseudo-Interface 1')
      .map(([name, counter]) => {
        const previous = this.networkPrevious?.get(name)
        const receivedDelta = previous
          ? Math.max(0, counter.receivedBytes - previous.receivedBytes)
          : 0
        const sentDelta = previous ? Math.max(0, counter.sentBytes - previous.sentBytes) : 0
        return {
          name,
          online: defaults.has(name) || name === 'system',
          downloadBps: (receivedDelta * 1000) / elapsedMs,
          uploadBps: (sentDelta * 1000) / elapsedMs,
          receivedBytes: counter.receivedBytes,
          sentBytes: counter.sentBytes,
        }
      })
    this.networkPrevious = current
    const downloadBps = interfaces.reduce((sum, item) => sum + item.downloadBps, 0)
    const uploadBps = interfaces.reduce((sum, item) => sum + item.uploadBps, 0)
    return { online: interfaces.some((item) => item.online), downloadBps, uploadBps, interfaces }
  }

  private async getAvailableMemory() {
    if (process.platform === 'linux') {
      const content = await fs.readFile('/proc/meminfo', 'utf8')
      const match = content.match(/^MemAvailable:\s+(\d+)\s+kB/im)
      if (match) return Number(match[1]) * 1024
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('/usr/bin/vm_stat')
      const pageSize = Number(stdout.match(/page size of (\d+) bytes/i)?.[1]) || 4096
      const pages = (label: string) =>
        Number(stdout.match(new RegExp(`${label}:\\s+(\\d+)`, 'i'))?.[1]) || 0
      const availablePages =
        pages('Pages free') +
        pages('Pages inactive') +
        pages('Pages speculative') +
        pages('Pages purgeable')
      if (availablePages > 0) return Math.min(os.totalmem(), availablePages * pageSize)
    }
    return os.freemem()
  }

  private async getNetworkDetailRows(): Promise<NetworkResourceRow[]> {
    let counters: Map<string, NetworkCounter>
    counters =
      process.platform === 'win32'
        ? await getWindowsInterfaceCounters()
        : await readNetworkCounters()
    let sampledAt = Date.now()
    if (!this.networkDetailPrevious) {
      this.networkDetailPrevious = counters
      this.networkDetailPreviousAt = sampledAt
      await new Promise((resolve) => setTimeout(resolve, 650))
      counters =
        process.platform === 'win32'
          ? await getWindowsInterfaceCounters()
          : await readNetworkCounters()
      sampledAt = Date.now()
    }
    const elapsedMs = Math.max(250, sampledAt - this.networkDetailPreviousAt)
    const onlineNames = getDefaultInterfaceNames()
    const rows = [...counters.entries()]
      .filter(([name]) => name !== 'lo' && !name.toLowerCase().includes('loopback'))
      .map(([name, counter]) => {
        const previous = this.networkDetailPrevious?.get(name)
        return {
          key: name,
          name,
          online: onlineNames.has(name),
          downloadBps: previous
            ? Math.max(0, ((counter.receivedBytes - previous.receivedBytes) * 1000) / elapsedMs)
            : 0,
          uploadBps: previous
            ? Math.max(0, ((counter.sentBytes - previous.sentBytes) * 1000) / elapsedMs)
            : 0,
          percent: 0,
        }
      })
    this.networkDetailPrevious = counters
    this.networkDetailPreviousAt = sampledAt
    const total = rows.reduce((sum, row) => sum + row.downloadBps + row.uploadBps, 0)
    return rows
      .map((row) => ({
        ...row,
        downloadBps: round(row.downloadBps),
        uploadBps: round(row.uploadBps),
        percent: total > 0 ? round(((row.downloadBps + row.uploadBps) / total) * 100) : 0,
      }))
      .sort(
        (left, right) => right.downloadBps + right.uploadBps - (left.downloadBps + left.uploadBps),
      )
      .slice(0, MAX_ROWS)
  }

  private async collectDetails(metric: MonitorMetric) {
    if (this.detailInFlight) return
    const subscribers = this.detailSubscribers.get(metric)
    if (!subscribers || subscribers.size === 0) return
    this.detailInFlight = true
    try {
      let details: SystemMonitorDetails
      if (metric === 'network') {
        details = {
          metric,
          timestamp: Date.now(),
          supported: true,
          rows: await this.getNetworkDetailRows(),
          note: 'Network detail is shown per interface. Per-application byte attribution requires optional OS privileges.',
        }
      } else {
        const processes = await readProcessRows()
        details = {
          metric,
          timestamp: Date.now(),
          supported: true,
          rows: sortRows(groupProcessRows(processes, this.snapshot.memory.totalBytes), metric),
        }
      }
      for (const subscriber of subscribers) subscriber(details)
    } catch {
      const details: SystemMonitorDetails = {
        metric,
        timestamp: Date.now(),
        rows: [],
        supported: false,
        note: 'Resource detail is unavailable on this platform right now.',
      }
      for (const subscriber of subscribers) subscriber(details)
    } finally {
      this.detailInFlight = false
    }
  }

  private emptySnapshot(): SystemMonitorSnapshot {
    return {
      timestamp: 0,
      status: 'unavailable',
      cpu: { percent: 0 },
      memory: { usedBytes: 0, totalBytes: os.totalmem(), percent: 0 },
      network: { online: false, downloadBps: 0, uploadBps: 0, interfaces: [] },
    }
  }
}

export const systemMonitorService = new SystemMonitorService()

export const formatBytesPerSecond = (bytes: number) => {
  if (bytes < 1024) return `${Math.round(bytes)} B/s`
  if (bytes < BYTES_PER_MB) return `${(bytes / 1024).toFixed(0)} KB/s`
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB/s`
}

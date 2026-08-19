import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDarwinNetworkOutput, parseWindowsNetworkOutput } from '../electron/systemMonitor'

const monitorSource = readFileSync(join(process.cwd(), 'electron', 'systemMonitor.ts'), 'utf8')
const preloadSource = readFileSync(join(process.cwd(), 'electron', 'preload.ts'), 'utf8')
const mainSource = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8')
const componentSource = readFileSync(join(process.cwd(), 'src', 'components', 'SystemMonitor.tsx'), 'utf8')
const monitorStyles = readFileSync(join(process.cwd(), 'src', 'components', 'SystemMonitor.css'), 'utf8')
const statusbarSource = readFileSync(join(process.cwd(), 'src', 'components', 'Statusbar.tsx'), 'utf8')
const noteSource = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')
const noteStyles = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.css'), 'utf8')

test('system monitor keeps overview sampling separate from on-demand details', () => {
  assert.match(monitorSource, /SAMPLE_INTERVAL_MS = 3_000/)
  assert.match(monitorSource, /DETAIL_INTERVAL_MS = 5_000/)
  assert.match(monitorSource, /subscribeDetails\(/)
  assert.match(monitorSource, /if \(this\.detailSubscribers\.size === 0\)/)
  assert.match(monitorSource, /Get-Process \| Select-Object Id,ProcessName,CPU,WorkingSet64/)
  assert.match(monitorSource, /\/proc\/meminfo/)
  assert.match(monitorSource, /vm_stat/)
  assert.match(monitorSource, /netstat\.exe', \['-e'\]/)
  assert.match(monitorSource, /Get-NetAdapterStatistics \| Select-Object Name,ReceivedBytes,SentBytes/)
  assert.match(monitorSource, /Text\.UTF8Encoding/)
})

test('system monitor exposes constrained IPC subscriptions and renderer cleanup', () => {
  assert.match(preloadSource, /getSystemMonitorSnapshot: \(\) => ipcRenderer\.invoke\('systemMonitor:getSnapshot'\)/)
  assert.match(preloadSource, /systemMonitor:details:subscribe/)
  assert.match(preloadSource, /systemMonitor:details:unsubscribe/)
  assert.match(mainSource, /systemMonitor:getSnapshot/)
  assert.match(mainSource, /registerSystemMonitorWindow\(event\.sender\.id, metric\)/)
  assert.match(mainSource, /const mainWindowWebContentsId = mainWindow\.webContents\.id/)
  assert.match(mainSource, /unregisterAllSystemMonitorWindow\(mainWindowWebContentsId\)/)
})

test('system monitor is mounted in both global surfaces and uses clickable metric buttons', () => {
  assert.match(componentSource, /aria-haspopup="dialog"/)
  assert.match(componentSource, /setActiveMetric\(\(current\) => \(current === metric \? null : metric\)\)/)
  assert.match(monitorSource, /Network detail is shown per interface/)
  assert.match(statusbarSource, /<SystemMonitor \/>/)
  assert.match(noteSource, /<SystemMonitor placement="note" \/>/)
})

test('darwin network parsing follows netstat column headers and aggregates interface rows', () => {
  const counters = parseDarwinNetworkOutput(`Name Mtu Network Address Ipkts Ierrs Opkts Oerrs Coll Drop Ibytes Obytes\nen0 1500 <Link> aa 10 0 20 0 0 0 1234 5678\nen0 1500 192.168.1 link 11 0 21 0 0 0 1200 5000\nen1 1500 <Link> bb 1 0 2 0 0 0 99 88`)
  assert.deepEqual(counters.get('en0'), { receivedBytes: 1234, sentBytes: 5678 })
  assert.deepEqual(counters.get('en1'), { receivedBytes: 99, sentBytes: 88 })
})

test('windows overview network parsing uses the first byte counter row without localized labels', () => {
  const counters = parseWindowsNetworkOutput(`Interface Statistics\n\n                           Received            Sent\n\nBytes                    1,482,035,899      1,929,248,931\nUnicast packets           161,717,335        137,098,883`)
  assert.deepEqual(counters.get('system'), { receivedBytes: 1482035899, sentBytes: 1929248931 })
})

test('desktop note reserves remaining height for tasks and bounds the resource popover', () => {
  assert.match(noteStyles, /\.desktop-task-note \{[\s\S]*display: flex;[\s\S]*height: 100vh;/)
  assert.match(noteStyles, /\.desktop-task-note__content \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;/)
  assert.match(monitorStyles, /\.system-monitor--note \.system-monitor__rows \{[\s\S]*calc\(100vh - 190px\)/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TaskChangeBus } from '../electron/taskChangeBus'

test('task change bus handshakes, versions changes, and removes stale subscribers', () => {
  const deliveries = new Map<number, Array<{ channel: string; reason: string; revision: number }>>()
  const available = new Set([11, 22])
  const bus = new TaskChangeBus((webContentsId) =>
    available.has(webContentsId)
      ? {
          send: (channel, payload) => {
            const events = deliveries.get(webContentsId) ?? []
            events.push({ channel, ...payload })
            deliveries.set(webContentsId, events)
          },
        }
      : null,
  )

  assert.equal(bus.subscribe(11), true)
  assert.equal(bus.subscribe(11), false)
  assert.deepEqual(deliveries.get(11), [
    { channel: 'tasks:changed', reason: 'subscribe', revision: 0 },
  ])

  bus.subscribe(22)
  assert.deepEqual(bus.publish('query'), { reason: 'query', revision: 1 })
  assert.equal(deliveries.get(11)?.at(-1)?.revision, 1)
  assert.equal(deliveries.get(22)?.at(-1)?.revision, 1)

  bus.unsubscribe(11)
  available.delete(22)
  bus.publish('transaction')
  assert.equal(deliveries.get(11)?.length, 2)
  assert.equal(deliveries.get(22)?.length, 2)
})

test('task mutations broadcast a shared change event to both task surfaces', () => {
  const mainProcess = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8')
  const preload = readFileSync(join(process.cwd(), 'electron', 'preload.ts'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')
  const dashboardView = readFileSync(join(process.cwd(), 'src', 'views', 'Dashboard.tsx'), 'utf8')
  const statusbar = readFileSync(join(process.cwd(), 'src', 'components', 'Statusbar.tsx'), 'utf8')

  assert.match(mainProcess, /emitTaskDataChanged\('query'\)/)
  assert.match(mainProcess, /emitTaskDataChanged\('transaction'\)/)
  assert.match(mainProcess, /ipcMain\.on\('tasks:subscribe'/)
  assert.match(mainProcess, /ipcMain\.on\('tasks:unsubscribe'/)
  assert.match(preload, /ipcRenderer\.send\('tasks:subscribe'\)/)
  assert.match(preload, /ipcRenderer\.send\('tasks:unsubscribe'\)/)
  assert.match(tasksView, /api\?\.onTasksChanged\?\.\(\(\) =>/)
  assert.match(noteView, /api\?\.onTasksChanged\?\.\(\(\) =>/)
  assert.match(dashboardView, /api\?\.onTasksChanged\?\.\(\(\) =>/)
  assert.match(statusbar, /api\?\.onTasksChanged\?\.\(\(\) =>/)
})

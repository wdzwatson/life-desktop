import type { MessageBoxOptions, WebContents } from 'electron'
import { SystemCleanerService } from './service'

export const SYSTEM_CLEANER_CHANNELS = [
  'systemCleaner:startScan',
  'systemCleaner:getScan',
  'systemCleaner:cancelScan',
  'systemCleaner:previewCleanup',
  'systemCleaner:executeCleanup',
] as const

type IpcRegistrar = { handle: (channel: string, listener: (event: { sender: WebContents }, payload?: unknown) => unknown) => void }
type Dependencies = {
  service: SystemCleanerService
  confirm: (options: MessageBoxOptions) => Promise<{ response: number }>
}

function response(action: () => unknown | Promise<unknown>) {
  return Promise.resolve().then(action).then((data) => ({ success: true, data })).catch((error) => ({
    success: false,
    error: error instanceof Error ? error.message : 'System cleanup failed.',
  }))
}

export function registerSystemCleanerIpc(ipc: IpcRegistrar, dependencies: Dependencies) {
  ipc.handle('systemCleaner:startScan', () => response(async () => {
    const result = await dependencies.confirm({
      type: 'info', buttons: ['Start scan', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Scan system storage',
      message: 'Review local storage usage and approved cache locations?',
      detail: 'The scan is read-only. System Cleaner does not inspect browser cookies, sessions, passwords, or application databases.',
    })
    if (result.response !== 0) throw new Error('Scan was cancelled.')
    return dependencies.service.startScan()
  }))
  ipc.handle('systemCleaner:getScan', (_event, payload) => response(() => dependencies.service.getScan((payload as { taskId?: unknown })?.taskId)))
  ipc.handle('systemCleaner:cancelScan', (_event, payload) => response(() => dependencies.service.cancelScan((payload as { taskId?: unknown })?.taskId)))
  ipc.handle('systemCleaner:previewCleanup', (_event, payload) => response(() => dependencies.service.previewCleanup(payload)))
  ipc.handle('systemCleaner:executeCleanup', (_event, payload) => response(async () => {
    const result = await dependencies.confirm({
      type: 'warning', buttons: ['Delete reviewed files', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Confirm cache cleanup',
      message: 'Delete the files in the reviewed cleanup plan?',
      detail: 'This permanently removes only the selected cache files. Browser cookies, sessions, passwords, installed dependencies, and application data are excluded.',
    })
    if (result.response !== 0) throw new Error('Cleanup was cancelled.')
    return dependencies.service.executeCleanup(payload)
  }))
}

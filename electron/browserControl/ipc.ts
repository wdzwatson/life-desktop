import type { BrowserControlService } from './service'
import { BrowserControlError } from './service'

export const BROWSER_CONTROL_CHANNELS = [
  'browserControl:getStatus',
  'browserControl:installIntegration',
  'browserControl:openExtensionFolder',
  'browserControl:executeWebLike',
] as const

type IpcRegistrar = {
  handle: (channel: string, listener: (_event: unknown, payload?: unknown) => unknown) => void
}

type Dependencies = {
  service: BrowserControlService
  getRegistrationStatus: () => Promise<unknown>
  installIntegration: () => Promise<unknown>
  openExtensionFolder: () => Promise<string>
}

function response(action: () => unknown | Promise<unknown>) {
  return Promise.resolve()
    .then(action)
    .then((data) => ({ success: true, data }))
    .catch((error) => ({
      success: false,
      error: {
        code: error instanceof BrowserControlError ? error.code : 'browser_control_failed',
        message: error instanceof Error ? error.message : 'Browser control failed.',
      },
    }))
}

export function registerBrowserControlIpc(ipc: IpcRegistrar, dependencies: Dependencies) {
  ipc.handle('browserControl:getStatus', () => response(async () => ({
    ...dependencies.service.getStatus(),
    registration: await dependencies.getRegistrationStatus(),
  })))
  ipc.handle('browserControl:installIntegration', () => response(dependencies.installIntegration))
  ipc.handle('browserControl:openExtensionFolder', () => response(dependencies.openExtensionFolder))
  ipc.handle('browserControl:executeWebLike', (_event, payload) => response(() => {
    const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    return dependencies.service.executeWebLike({
      url: input.url,
      preferredTabId: input.preferredTabId,
    })
  }))
}

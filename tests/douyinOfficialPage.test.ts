import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { WebContents } from 'electron'
import { DouyinOfficialPageObserver } from '../electron/video/douyinOfficialPage.ts'

class FakeDebugger extends EventEmitter {
  attached = false
  readonly commands: string[] = []

  attach() {
    this.attached = true
  }

  detach() {
    this.attached = false
  }

  isAttached() {
    return this.attached
  }

  async sendCommand(command: string) {
    this.commands.push(command)
    if (command === 'Network.getResponseBody') {
      return { body: JSON.stringify({ collects_list: [], has_more: false }) }
    }
    return {}
  }
}

test('official page observer waits for a completed official response before reading its body', async () => {
  const debuggerSession = new FakeDebugger()
  const page = {
    debugger: debuggerSession,
    executeJavaScript: async () => true,
  } as unknown as WebContents
  const observer = new DouyinOfficialPageObserver(page)
  await observer.start()

  const pending = observer.request('/aweme/v1/web/collects/list/', { count: '20' })
  debuggerSession.emit('message', {}, 'Network.responseReceived', {
    requestId: 'request-1',
    response: { url: 'https://www.douyin.com/aweme/v1/web/collects/list/?count=20', status: 200 },
  })
  assert.equal(debuggerSession.commands.includes('Network.getResponseBody'), false)

  debuggerSession.emit('message', {}, 'Network.loadingFinished', { requestId: 'request-1' })
  assert.deepEqual(await pending, { ok: true, status: 200, body: { collects_list: [], has_more: false } })
  assert.equal(debuggerSession.commands.includes('Network.getResponseBody'), true)
  observer.stop()
})

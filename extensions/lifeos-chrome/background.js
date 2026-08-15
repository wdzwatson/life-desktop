import { parseHttpUrl, selectMatchingTab } from './url-match.js'

const NATIVE_HOST_NAME = 'com.lifeos.browser'
const PROTOCOL_VERSION = 1
const SCRIPT_EXPRESSION = `(() => {
  console.log('741852963');
  return { success: true, url: location.href };
})()`
const instanceIdKey = 'lifeosBrowserInstanceId'

let nativePort = null
let reconnectTimer = null
let connectionState = 'disconnected'

async function getInstanceId() {
  const stored = await chrome.storage.local.get(instanceIdKey)
  if (typeof stored[instanceIdKey] === 'string') return stored[instanceIdKey]
  const value = crypto.randomUUID()
  await chrome.storage.local.set({ [instanceIdKey]: value })
  return value
}

function updateConnectionState(state, error = '') {
  connectionState = state
  void chrome.storage.local.set({ lifeosBrowserConnectionState: state, lifeosBrowserConnectionError: error })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectNativeHost()
  }, 3000)
}

async function connectNativeHost() {
  if (nativePort) return
  try {
    updateConnectionState('connecting')
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
    nativePort = port
    port.onMessage.addListener((message) => void handleNativeMessage(message))
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || ''
      nativePort = null
      updateConnectionState('disconnected', error)
      scheduleReconnect()
    })
    port.postMessage({
      type: 'extension.hello',
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: chrome.runtime.getManifest().version,
      instanceId: await getInstanceId(),
    })
    updateConnectionState('connected')
  } catch (error) {
    nativePort = null
    updateConnectionState('disconnected', error instanceof Error ? error.message : String(error))
    scheduleReconnect()
  }
}

function respond(id, payload) {
  nativePort?.postMessage({ type: 'response', id, ...payload })
}

function candidateSummary(tab) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || '',
    url: tab.url || '',
    active: Boolean(tab.active),
    matchScore: tab.matchScore,
  }
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (action, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      action(value)
    }
    const onUpdated = (updatedId, changeInfo, tab) => {
      if (updatedId === tabId && changeInfo.status === 'complete') finish(resolve, tab)
    }
    const timer = setTimeout(() => finish(reject, new Error('The page did not finish loading in time.')), timeoutMs)
    chrome.tabs.onUpdated.addListener(onUpdated)
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish(resolve, tab)
    }).catch((error) => finish(reject, error))
  })
}

async function executeFixedScript(tabId) {
  const target = { tabId }
  await chrome.debugger.attach(target, '1.3')
  try {
    const result = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: SCRIPT_EXPRESSION,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || 'The page script failed.')
    return result?.result?.value
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined)
  }
}

async function executeWebLike(params) {
  const requested = parseHttpUrl(params?.url)
  if (!requested) throw new Error('A complete HTTP or HTTPS URL is required.')

  const tabs = (await chrome.tabs.query({})).filter((tab) => Number.isInteger(tab.id) && parseHttpUrl(tab.url || ''))
  const selection = selectMatchingTab(requested.href, tabs, params?.preferredTabId)
  if (selection.kind === 'invalid_preference') throw new Error('The selected tab is no longer available or no longer matches the URL.')
  if (selection.kind === 'ambiguous') {
    return { status: 'ambiguous', candidates: selection.candidates.map(candidateSummary) }
  }

  const opened = selection.kind === 'none'
  let tab = opened
    ? await chrome.tabs.create({ url: requested.href, active: true })
    : selection.tab
  if (!Number.isInteger(tab.id)) throw new Error('Chrome did not return a usable tab.')
  tab = await waitForTabComplete(tab.id)

  const finalUrl = parseHttpUrl(tab.url || '')
  if (!finalUrl) throw new Error('The target tab is not an HTTP or HTTPS page.')
  if (finalUrl.hostname !== requested.hostname) {
    throw new Error(`The page redirected to a different host: ${finalUrl.hostname}`)
  }

  if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined)
  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined)
  const evaluation = await executeFixedScript(tab.id)
  return {
    status: opened ? 'opened' : 'matched',
    tabId: tab.id,
    title: tab.title || '',
    url: evaluation?.url || finalUrl.href,
    scriptExecuted: evaluation?.success === true,
  }
}

async function handleNativeMessage(message) {
  if (!message || message.type !== 'request' || typeof message.id !== 'string') return
  if (message.method !== 'webLike.execute') {
    respond(message.id, { ok: false, error: { code: 'unsupported_method', message: 'Unsupported browser command.' } })
    return
  }
  try {
    const data = await executeWebLike(message.params)
    respond(message.id, { ok: true, data })
  } catch (error) {
    respond(message.id, {
      ok: false,
      error: { code: 'execution_failed', message: error instanceof Error ? error.message : String(error) },
    })
  }
}

chrome.runtime.onInstalled.addListener(() => connectNativeHost())
chrome.runtime.onStartup.addListener(() => connectNativeHost())
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'lifeos.connectionStatus') return false
  sendResponse({ state: connectionState })
  return false
})

connectNativeHost()

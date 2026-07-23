import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  protocol,
  Menu,
  screen,
  Tray,
  nativeImage,
  session,
} from 'electron'
import path from 'path'
import fs from 'fs'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from './db/schema'
import { runDbTransaction } from './db/transaction'
import {
  createLifeOsBackupPackage,
  inspectLifeOsBackupPackage,
  restoreLifeOsBackupPackage,
} from './backup/service'
import AdmZip from 'adm-zip'
import { fileURLToPath } from 'url'
import { autoUpdater } from 'electron-updater'
import crypto from 'crypto'
import { PDFParse } from 'pdf-parse'
import {
  decodeHtmlText,
  getAnchorBlockOffset,
  resolveChapterTitleFromHtml,
  resolveTocTarget,
} from '../src/views/bookReaderUtils'
import {
  checkVideoTools,
  createInitialVideoEngineStatus,
  deriveVideoEngineStatus,
  formatDurationSeconds,
  installManagedVideoTool,
  isVideoEngineReady,
  getVideoCookieAccessStatus,
  parseVideoUrl,
  probeVideoDurationSeconds,
  resolveVideoToolPath,
  resolvePlaybackPath,
  resolveVideoDownloadDir,
  runProcess,
  startVideoDownload,
  verifyVideoCookieAccess,
  type VideoEngineStatus,
} from './video/service'
import { hasBilibiliLoginCookie, writeBilibiliCookieFile } from './video/bilibiliCookies'
import {
  DOUYIN_LOGIN_URL,
  getDouyinLoginPartition,
  hasDouyinLoginCookie,
  summarizeDouyinAuth,
} from './video/douyinSession'
import {
  DouyinFavoritesError,
  canDownloadDouyinFavorite,
  clearDouyinFavoriteItems,
  deleteDouyinFavoriteItems,
  getDouyinAccountSyncStatus,
  getDouyinFavoriteItem,
  listDouyinFavoriteFolders,
  listDouyinFavoriteItems,
  syncDouyinFavorites,
  updateDouyinFavoriteDownloadState,
} from './video/douyinFavorites'
import { createDouyinWebFavoritesClient } from './video/douyinWebClient'
import { DouyinOfficialPageObserver } from './video/douyinOfficialPage'
import {
  DouyinTimeoutError,
  withDouyinSyncInactivityTimeout,
  withDouyinTimeout,
} from './video/douyinSyncTimeout'
import { handleVideoProtocolRequest } from './video/protocol'
import { classifyVideoDownloadFailure } from './video/downloadState'
import { normalizeBulkVideoTagPayload } from '../src/views/videoStateUtils'
import { getDueTemplateOccurrence, toLocalDateKey } from '../src/views/taskScheduleUtils'
import { runTaskSchedulerCore } from './taskSchedulerCore'
import { VaultService, serializeVaultError } from './vault/service'
import { getDirectDbAccessError } from './db/accessPolicy'
import {
  registerAIConfigIpc,
  registerAIConversationIpc,
  registerAIMcpRuntimeIpc,
  registerAIRuntimeIpc,
  registerAIImageIpc,
  registerAIStorageIpc,
  registerAIVideoIpc,
} from './ai/ipc'
import { createSafeStorageCredentialAdapter } from './ai/safeStorageAdapter'
import { AIAgentRuntime } from './ai/agentRuntime'
import { AIAgentService } from './ai/agentService'
import { AIConversationService } from './ai/conversationService'
import { AICredentialService } from './ai/credentialService'
import { AIProviderService } from './ai/providerService'
import { AI_RUN_EVENT_CHANNEL } from './ai/runEvents'
import { AIMcpConfigService } from './ai/mcpConfigService'
import { AIMcpManager } from './ai/mcpManager'
import { handleAIMediaProtocolRequest } from './ai/mediaProtocol'
import { AIMediaService } from './ai/mediaService'
import { AIImageGenerationService } from './ai/imageGenerationService'
import { AIVideoAdapter } from './ai/providers/videoAdapter'
import { AIVideoGenerationService } from './ai/videoGenerationService'
import { AIVideoAssetService } from './ai/videoAssetService'
import { AIServiceError } from './ai/types'
import { AIRecoveryService } from './ai/recoveryService'
import { AI_SCHEMA_VERSION } from './ai/schema'
import { AIStorageService } from './ai/storageService'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Helper for hashing passwords securely using PBKDF2
function hashPassword(password: string, salt?: string) {
  const currentSalt = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, currentSalt, 1000, 64, 'sha512').toString('hex')
  return { salt: currentSalt, hash }
}

// Keep global references
let mainWindow: BrowserWindow | null = null
let desktopTaskNoteWindow: BrowserWindow | null = null
let douyinSyncWindow: BrowserWindow | null = null
let douyinSyncWindowReady = false
let douyinSyncPageLoadPromise: Promise<void> | null = null
let douyinSyncInFlight: Promise<Awaited<ReturnType<typeof synchronizeDouyinFavorites>>> | null =
  null
let desktopTaskNoteSaveTimer: NodeJS.Timeout | null = null
let appTray: Tray | null = null
let isQuitting = false
let activeUserId = 'guest'
const openDbs: Map<string, any> = new Map() // dbName -> Database instance
let schedulerInterval: NodeJS.Timeout | null = null
let videoEngineStatus: VideoEngineStatus = createInitialVideoEngineStatus()
let videoEngineLoadPromise: Promise<VideoEngineStatus> | null = null
let vaultService: VaultService | null = null
let aiAgentRuntime: AIAgentRuntime | null = null
let aiMcpManager: AIMcpManager | null = null
const aiImageControllers = new Set<AbortController>()
const aiVideoControllers = new Set<AbortController>()
let aiRecoveryController: AbortController | null = null

function logDouyinSyncWindow(event: string, details?: Record<string, unknown>) {
  console.info('[DouyinSyncWindow]', event, details || {})
}

function destroyDouyinSyncWindowForAppQuit() {
  if (!douyinSyncWindow || douyinSyncWindow.isDestroyed()) {
    douyinSyncWindow = null
    douyinSyncWindowReady = false
    douyinSyncPageLoadPromise = null
    return
  }
  logDouyinSyncWindow('destroy', { reason: 'app_quit' })
  douyinSyncWindow.destroy()
  douyinSyncWindow = null
  douyinSyncWindowReady = false
  douyinSyncPageLoadPromise = null
}

// Default Paths
const BASE_DIR = path.join(app.getPath('home'), 'LifeOS')
const CONFIG_DIR = path.join(BASE_DIR, 'config')
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'life-video',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
  {
    scheme: 'life-ai-asset',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
])

// Ensure configuration files exist
function initConfig() {
  if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR)
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR)

  if (!fs.existsSync(SETTINGS_FILE)) {
    const defaultSettings = {
      theme: 'Minimal',
      language: 'zh-CN',
      lastUserId: 'guest',
      maxDownloads: 3,
      autoCheckUpdates: true,
      baseFolder: BASE_DIR,
      userProfiles: {
        guest: { nickname: '访客模式', avatar: 'G' },
      },
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2))
  }
}

function getSettings() {
  initConfig()
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function getDesktopTaskNoteSettings() {
  const settings = getSettings()
  return {
    opacity:
      typeof settings.desktopTaskNote?.opacity === 'number'
        ? settings.desktopTaskNote.opacity
        : 0.96,
    alwaysOnTop: settings.desktopTaskNote?.alwaysOnTop !== false,
    bounds: settings.desktopTaskNote?.bounds,
    layoutVersion: Number(settings.desktopTaskNote?.layoutVersion) || 0,
  }
}

function saveDesktopTaskNoteSettings(patch: Record<string, unknown>) {
  const settings = getSettings()
  settings.desktopTaskNote = {
    ...getDesktopTaskNoteSettings(),
    ...settings.desktopTaskNote,
    ...patch,
  }
  saveSettings(settings)
}

function scheduleDesktopTaskNoteBoundsSave() {
  if (!desktopTaskNoteWindow || desktopTaskNoteWindow.isDestroyed()) return
  if (desktopTaskNoteSaveTimer) clearTimeout(desktopTaskNoteSaveTimer)
  desktopTaskNoteSaveTimer = setTimeout(() => {
    if (!desktopTaskNoteWindow || desktopTaskNoteWindow.isDestroyed()) return
    saveDesktopTaskNoteSettings({ bounds: desktopTaskNoteWindow.getBounds() })
    desktopTaskNoteSaveTimer = null
  }, 250)
}

function getVideoToolSettings() {
  return {
    ...getSettings(),
    videoToolsDir: path.join(BASE_DIR, 'tools', 'video'),
  }
}

function getBilibiliCookieFilePath() {
  return path.join(BASE_DIR, 'users', activeUserId, 'config', 'bilibili-cookies.txt')
}

function getBilibiliLoginPartition() {
  const safeUserId = activeUserId.replace(/[^a-zA-Z0-9_.-]/g, '_')
  return `persist:lifeos-bilibili-${safeUserId}`
}

async function collectBilibiliCookies(authWindow: BrowserWindow) {
  const cookieStore = authWindow.webContents.session.cookies
  const groups = await Promise.all([
    cookieStore.get({ url: 'https://www.bilibili.com' }),
    cookieStore.get({ url: 'https://passport.bilibili.com' }),
    cookieStore.get({ url: 'https://api.bilibili.com' }),
    cookieStore.get({ domain: '.bilibili.com' }),
  ])
  const seen = new Set<string>()
  return groups.flat().filter((cookie) => {
    const key = `${cookie.domain}\t${cookie.path}\t${cookie.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function persistBilibiliCookies(authWindow: BrowserWindow) {
  const cookies = await collectBilibiliCookies(authWindow)
  if (!hasBilibiliLoginCookie(cookies)) {
    return { success: false, error: 'Bilibili login cookies were not found.' }
  }
  const cookiePath = getBilibiliCookieFilePath()
  writeBilibiliCookieFile(cookiePath, cookies)
  const settings = getSettings()
  saveSettings({
    ...settings,
    cookieMode: 'bilibili',
    bilibiliCookiesPath: cookiePath,
  })
  return { success: true, path: cookiePath }
}

async function getBilibiliAuthStatus() {
  const settings = getVideoToolSettings()
  const cookiePath = settings.bilibiliCookiesPath || getBilibiliCookieFilePath()
  return {
    success: true,
    loggedIn: fs.existsSync(cookiePath),
    path: cookiePath,
  }
}

async function startBilibiliAccountLogin() {
  if (!mainWindow) return { success: false, error: 'Main window is not available.' }

  const loginWindow = new BrowserWindow({
    width: 980,
    height: 740,
    minWidth: 720,
    minHeight: 560,
    parent: mainWindow,
    title: 'Bilibili Login',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: getBilibiliLoginPartition(),
    },
  })

  const cookieStore = loginWindow.webContents.session.cookies
  return new Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>(
    (resolve) => {
      let settled = false
      let checking = false
      const finish = async (canceled: boolean) => {
        if (settled || checking || loginWindow.isDestroyed()) return
        checking = true
        try {
          const result = await persistBilibiliCookies(loginWindow)
          if (result.success) {
            settled = true
            cookieStore.removeListener('changed', onCookieChanged)
            if (!loginWindow.isDestroyed()) loginWindow.close()
            resolve(result)
            return
          }
          if (canceled) {
            settled = true
            cookieStore.removeListener('changed', onCookieChanged)
            if (!loginWindow.isDestroyed()) loginWindow.close()
            resolve({ success: false, canceled: true, error: result.error })
          }
        } catch (error: any) {
          settled = true
          cookieStore.removeListener('changed', onCookieChanged)
          if (!loginWindow.isDestroyed()) loginWindow.close()
          resolve({ success: false, error: error?.message || String(error) })
        } finally {
          checking = false
        }
      }
      const onCookieChanged = () => {
        void finish(false)
      }

      cookieStore.on('changed', onCookieChanged)
      loginWindow.webContents.on('did-finish-load', () => {
        void finish(false)
      })
      loginWindow.on('close', (event) => {
        if (settled) return
        event.preventDefault()
        const closeAfterCurrentCheck = () => {
          if (checking) {
            setTimeout(closeAfterCurrentCheck, 50)
            return
          }
          void finish(true)
        }
        closeAfterCurrentCheck()
      })
      loginWindow.loadURL('https://passport.bilibili.com/login')
    },
  )
}

async function collectDouyinCookies() {
  const cookieStore = session.fromPartition(getDouyinLoginPartition(activeUserId)).cookies
  const groups = await Promise.all([
    cookieStore.get({ url: 'https://www.douyin.com' }),
    cookieStore.get({ url: 'https://www.iesdouyin.com' }),
    cookieStore.get({ domain: '.douyin.com' }),
  ])
  const seen = new Set<string>()
  return groups.flat().filter((cookie) => {
    const key = `${cookie.domain}\t${cookie.path}\t${cookie.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function writeDouyinCookieFile() {
  const cookies = await collectDouyinCookies()
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'lifeos-douyin-download-'))
  const filePath = path.join(directory, 'cookies.txt')
  const lines = [
    '# Netscape HTTP Cookie File',
    '# This file is generated temporarily for a Douyin download.',
    ...cookies.map((cookie) =>
      [
        cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`,
        'TRUE',
        cookie.path || '/',
        cookie.secure ? 'TRUE' : 'FALSE',
        cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0,
        cookie.name.replace(/[\t\r\n]/g, ''),
        cookie.value.replace(/[\t\r\n]/g, ''),
      ].join('\t'),
    ),
  ]
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8')
  return {
    filePath,
    cleanup: () => {
      try {
        fs.rmSync(directory, { recursive: true, force: true })
      } catch (error) {
        console.warn('[DouyinDownload] failed to clean temporary cookies', error)
      }
    },
  }
}

async function getDouyinAuthStatus() {
  const cookies = await collectDouyinCookies()
  return { success: true, ...summarizeDouyinAuth(cookies) }
}

async function logoutDouyinAccount() {
  const douyinSession = session.fromPartition(getDouyinLoginPartition(activeUserId))
  await douyinSession.clearStorageData({ storages: ['cookies'] })
  await douyinSession.clearCache()
  return { success: true }
}

async function startDouyinAccountLogin() {
  if (!mainWindow) return { success: false, error: 'Main window is not available.' }

  const loginWindow = new BrowserWindow({
    width: 980,
    height: 740,
    minWidth: 720,
    minHeight: 560,
    parent: mainWindow,
    title: 'Douyin Login',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: getDouyinLoginPartition(activeUserId),
    },
  })

  const cookieStore = loginWindow.webContents.session.cookies
  return new Promise<{ success: boolean; canceled?: boolean; error?: string }>((resolve) => {
    let settled = false
    let checking = false
    const finish = async (canceled: boolean) => {
      if (settled || checking || loginWindow.isDestroyed()) return
      checking = true
      try {
        const cookies = await collectDouyinCookies()
        if (hasDouyinLoginCookie(cookies)) {
          settled = true
          cookieStore.removeListener('changed', onCookieChanged)
          if (!loginWindow.isDestroyed()) loginWindow.close()
          resolve({ success: true })
          return
        }
        if (canceled) {
          settled = true
          cookieStore.removeListener('changed', onCookieChanged)
          if (!loginWindow.isDestroyed()) loginWindow.close()
          resolve({ success: false, canceled: true })
        }
      } catch (error: any) {
        settled = true
        cookieStore.removeListener('changed', onCookieChanged)
        if (!loginWindow.isDestroyed()) loginWindow.close()
        resolve({ success: false, error: error?.message || String(error) })
      } finally {
        checking = false
      }
    }
    const onCookieChanged = () => {
      void finish(false)
    }

    cookieStore.on('changed', onCookieChanged)
    loginWindow.webContents.on('did-finish-load', () => {
      void finish(false)
    })
    loginWindow.on('close', (event) => {
      if (settled) return
      event.preventDefault()
      const closeAfterCurrentCheck = () => {
        if (checking) {
          setTimeout(closeAfterCurrentCheck, 50)
          return
        }
        void finish(true)
      }
      closeAfterCurrentCheck()
    })
    void loginWindow.loadURL(DOUYIN_LOGIN_URL)
  })
}

async function withDouyinFavoritesClient<T>(
  action: (client: ReturnType<typeof createDouyinWebFavoritesClient>) => Promise<T>,
) {
  const syncWindow =
    douyinSyncWindow && !douyinSyncWindow.isDestroyed()
      ? douyinSyncWindow
      : new BrowserWindow({
          // The official page is only used as an authenticated data source. Keep it out of the
          // foreground while retaining an active renderer for page automation.
          show: false,
          skipTaskbar: true,
          focusable: false,
          title: 'Douyin Favorites Sync',
          width: 1080,
          height: 760,
          backgroundColor: '#ffffff',
          webPreferences: {
            backgroundThrottling: false,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            partition: getDouyinLoginPartition(activeUserId),
          },
        })
  const reusedSyncWindow = douyinSyncWindow === syncWindow && douyinSyncWindowReady
  douyinSyncWindow = syncWindow
  logDouyinSyncWindow('opened_hidden')
  const navigationEvents = [
    'did-start-loading',
    'did-finish-load',
    'did-navigate',
    'did-navigate-in-page',
    'did-frame-navigate',
  ] as const
  const onNavigation = (...args: unknown[]) => {
    logDouyinSyncWindow('navigation', {
      event: navigationEvents.find((event) => args.includes(event)),
      url: syncWindow.webContents.getURL(),
      loading: syncWindow.webContents.isLoading(),
    })
  }
  const navigationListeners = navigationEvents.map((event) => {
    const listener = () => onNavigation(event)
    syncWindow.webContents.on(event, listener)
    return { event, listener }
  })
  const removeNavigationListeners = () => {
    for (const { event, listener } of navigationListeners) {
      syncWindow.webContents.removeListener(event, listener)
    }
  }
  syncWindow.once('close', () => {
    logDouyinSyncWindow('close_requested', { reason: isQuitting ? 'app_quit' : 'user' })
  })
  syncWindow.once('render-process-gone', (_event, details) => {
    logDouyinSyncWindow('renderer_gone', { reason: details.reason })
  })
  syncWindow.once('closed', () => {
    if (douyinSyncWindow === syncWindow) douyinSyncWindow = null
    douyinSyncWindowReady = false
    douyinSyncPageLoadPromise = null
    logDouyinSyncWindow('closed', { reason: isQuitting ? 'app_quit' : 'user' })
  })
  const officialPage = new DouyinOfficialPageObserver(syncWindow.webContents, (event) => {
    mainWindow?.webContents.send('video:douyin-sync-diagnostic', event)
  })
  let outcome: 'completed' | 'partial' | 'failed' = 'failed'
  try {
    await officialPage.start()
    mainWindow?.webContents.send('video:douyin-sync-diagnostic', { kind: 'page_loading' })
    if (reusedSyncWindow) logDouyinSyncWindow('reused_page')
    else await ensureDouyinFavoritesPageLoaded(syncWindow)
    officialPage.notifyPageReady()
    const result = await action(createDouyinWebFavoritesClient(officialPage))
    const syncResult = result as { success?: unknown; complete?: unknown }
    outcome =
      result && typeof result === 'object' && syncResult.success === false
        ? 'failed'
        : result && typeof result === 'object' && syncResult.complete === false
          ? 'partial'
          : 'completed'
    return result
  } catch (error) {
    logDouyinSyncWindow('sync_failed', {
      error: error instanceof Error ? error.message : String(error),
      timeoutKind: error instanceof DouyinTimeoutError ? error.kind : undefined,
    })
    mainWindow?.webContents.send('video:douyin-sync-diagnostic', { kind: 'page_failed' })
    throw error
  } finally {
    officialPage.stop()
    removeNavigationListeners()
    if (!syncWindow.isDestroyed()) {
      logDouyinSyncWindow('closed_after_sync', { reason: outcome })
      syncWindow.close()
    }
  }
}

function ensureDouyinFavoritesPageLoaded(syncWindow: BrowserWindow) {
  if (douyinSyncWindowReady && !syncWindow.webContents.isLoading()) return Promise.resolve()
  if (douyinSyncPageLoadPromise) return douyinSyncPageLoadPromise

  const loadPromise = withDouyinTimeout(
    loadDouyinFavoritesPage(syncWindow),
    20_000,
    'Douyin official page did not finish loading in time.',
    'page_load',
  )
  const trackedPromise = loadPromise
    .then(() => {
      douyinSyncWindowReady = true
    })
    .catch((error) => {
      douyinSyncWindowReady = false
      throw error
    })
    .finally(() => {
      if (douyinSyncPageLoadPromise === trackedPromise) douyinSyncPageLoadPromise = null
    })
  douyinSyncPageLoadPromise = trackedPromise
  return trackedPromise
}

function loadDouyinFavoritesPage(syncWindow: BrowserWindow) {
  const { webContents } = syncWindow
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      webContents.removeListener('did-fail-load', onFailed)
      webContents.removeListener('render-process-gone', onProcessGone)
    }
    const onFailed = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
    ) => {
      if (!validatedUrl.includes('douyin.com')) return
      cleanup()
      reject(new Error(`Douyin official page failed to load (${errorCode}): ${errorDescription}`))
    }
    const onProcessGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
      cleanup()
      reject(new Error(`Douyin official page renderer stopped: ${details.reason}`))
    }
    webContents.once('did-fail-load', onFailed)
    webContents.once('render-process-gone', onProcessGone)
    void webContents
      .loadURL('https://www.douyin.com/user/self?showSubTab=video&showTab=favorite_collection')
      .then(() => {
        cleanup()
        resolve()
      })
      .catch((error) => {
        cleanup()
        reject(error)
      })
  })
}

async function synchronizeDouyinFavorites() {
  const auth = await getDouyinAuthStatus()
  if (!auth.loggedIn) {
    return {
      success: false,
      foldersSynced: 0,
      itemsSynced: 0,
      error: {
        code: 'auth_required',
        message: 'Please sign in to Douyin before syncing favorites.',
      },
    }
  }
  try {
    return await withDouyinFavoritesClient((client) =>
      withDouyinSyncInactivityTimeout(
        (reportActivity) =>
          syncDouyinFavorites({
            db: getUserDb('videos'),
            sessionPartition: getDouyinLoginPartition(activeUserId),
            client,
            onProgress: (progress) => {
              reportActivity()
              mainWindow?.webContents.send('video:douyin-sync-progress', progress)
            },
          }),
        60_000,
        'Douyin favorites synchronization stopped after 60 seconds without progress.',
      ),
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to open the Douyin favorites page.'
    console.error('[DouyinSync] failed', {
      message,
      timeoutKind: error instanceof DouyinTimeoutError ? error.kind : undefined,
    })
    const syncError = new DouyinFavoritesError('network_error', message)
    return {
      success: false,
      foldersSynced: 0,
      itemsSynced: 0,
      error: { code: syncError.code, message: syncError.message },
    }
  }
}

function emitVideoEngineStatus() {
  mainWindow?.webContents.send('video:engine-status', videoEngineStatus)
}

async function loadVideoEngine(options: { force?: boolean } = {}) {
  if (videoEngineLoadPromise && !options.force) return videoEngineLoadPromise
  if (isVideoEngineReady(videoEngineStatus) && !options.force) return videoEngineStatus

  videoEngineStatus = {
    status: 'loading',
    message: 'Loading video download plugin...',
    tools: videoEngineStatus.tools,
    updatedAt: new Date().toISOString(),
  }
  emitVideoEngineStatus()

  videoEngineLoadPromise = checkVideoTools(getVideoToolSettings())
    .then((tools) => {
      videoEngineStatus = deriveVideoEngineStatus(tools)
      emitVideoEngineStatus()
      return videoEngineStatus
    })
    .catch((error: any) => {
      videoEngineStatus = {
        status: 'error',
        message: error?.message || String(error),
        tools: videoEngineStatus.tools,
        updatedAt: new Date().toISOString(),
      }
      emitVideoEngineStatus()
      return videoEngineStatus
    })
    .finally(() => {
      videoEngineLoadPromise = null
    })

  return videoEngineLoadPromise
}

function saveSettings(settings: any) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  return settings
}

// Close and clear all open databases
function closeUserDbs() {
  aiRecoveryController?.abort()
  aiRecoveryController = null
  for (const controller of aiImageControllers) controller.abort()
  aiImageControllers.clear()
  for (const controller of aiVideoControllers) controller.abort()
  aiVideoControllers.clear()
  aiAgentRuntime?.dispose()
  aiAgentRuntime = null
  void aiMcpManager?.dispose()
  aiMcpManager = null
  vaultService?.dispose()
  vaultService = null
  for (const db of openDbs.values()) {
    try {
      db.close()
    } catch {
      // Ignore close failures while switching users; stale handles are cleared below.
    }
  }
  openDbs.clear()
}

function getAIMcpManager() {
  if (aiMcpManager) return aiMcpManager
  const db = getUserDb('ai')
  const credentials = new AICredentialService(
    path.join(BASE_DIR, 'users', activeUserId, 'config', 'ai-credentials.json'),
    createSafeStorageCredentialAdapter(),
  )
  const config = new AIMcpConfigService(db, credentials)
  aiMcpManager = new AIMcpManager({ getConfigService: () => config })
  return aiMcpManager
}

function getAIAgentRuntime() {
  if (aiAgentRuntime) return aiAgentRuntime
  const db = getUserDb('ai')
  const credentialPath = path.join(BASE_DIR, 'users', activeUserId, 'config', 'ai-credentials.json')
  const credentials = new AICredentialService(credentialPath, createSafeStorageCredentialAdapter())
  const conversations = new AIConversationService(db)
  const services = {
    agents: new AIAgentService(db),
    providers: new AIProviderService(db, credentials),
    conversations,
    mcp: getAIMcpManager(),
    mcpConfig: new AIMcpConfigService(db, credentials),
    media: getAIMediaService(),
  }
  aiAgentRuntime = new AIAgentRuntime({
    getServices: () => services,
    emit: (event) => mainWindow?.webContents.send(AI_RUN_EVENT_CHANNEL, event),
  })
  return aiAgentRuntime
}

function getAIImageGenerationService() {
  const db = getUserDb('ai')
  const credentials = new AICredentialService(
    path.join(BASE_DIR, 'users', activeUserId, 'config', 'ai-credentials.json'),
    createSafeStorageCredentialAdapter(),
  )
  return new AIImageGenerationService({
    agents: new AIAgentService(db),
    providers: new AIProviderService(db, credentials),
    conversations: new AIConversationService(db),
    media: getAIMediaService(),
  })
}

function getAIVideoAssetService() {
  const db = getUserDb('ai')
  const credentials = new AICredentialService(
    path.join(BASE_DIR, 'users', activeUserId, 'config', 'ai-credentials.json'),
    createSafeStorageCredentialAdapter(),
  )
  const videoTasks = new AIVideoGenerationService({
    db,
    createAdapter: (config) => new AIVideoAdapter(config),
  })
  return new AIVideoAssetService({
    db,
    agents: new AIAgentService(db),
    providers: new AIProviderService(db, credentials),
    conversations: new AIConversationService(db),
    media: getAIMediaService(),
    videoTasks,
    probeDurationSeconds: (filePath) => probeVideoDurationSeconds(getVideoToolSettings(), filePath),
    createPlayableAsset: async ({ sourceAsset, filePath, providerId, providerTaskId, signal }) => {
      if (sourceAsset.mimeType === 'video/mp4' || sourceAsset.mimeType === 'video/webm')
        return undefined
      const outputPath = path.join(
        app.getPath('temp'),
        `life-ai-video-transcode-${crypto.randomUUID()}.mp4`,
      )
      try {
        const ffmpegPath = resolveVideoToolPath(getVideoToolSettings(), 'ffmpeg')
        const result = await runProcess(
          ffmpegPath,
          [
            '-y',
            '-i',
            filePath,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            outputPath,
          ],
          { timeoutMs: 30 * 60 * 1000, signal },
        )
        if (signal?.aborted) {
          throw new AIServiceError({
            code: 'cancelled',
            message: 'Video transcoding was cancelled.',
            retryable: false,
          })
        }
        if (result.code !== 0 || !fs.existsSync(outputPath)) {
          throw new AIServiceError({
            code: 'media_failed',
            message: result.stderr.includes('ENOENT')
              ? 'FFmpeg is required to convert this generated video.'
              : 'The generated video could not be converted to a playable format.',
            retryable: false,
          })
        }
        return await getAIMediaService().storeLocalFile({
          mediaType: 'video',
          filePath: outputPath,
          declaredMimeType: 'video/mp4',
          providerId,
          providerTaskId,
          originalName: 'generated-video.mp4',
        })
      } finally {
        await fs.promises.rm(outputPath, { force: true }).catch(() => undefined)
      }
    },
    createPoster: async ({ filePath, providerId, providerTaskId, signal }) => {
      const posterPath = path.join(
        app.getPath('temp'),
        `life-ai-video-poster-${crypto.randomUUID()}.jpg`,
      )
      try {
        const ffmpegPath = resolveVideoToolPath(getVideoToolSettings(), 'ffmpeg')
        const result = await runProcess(
          ffmpegPath,
          [
            '-y',
            '-ss',
            '00:00:01',
            '-i',
            filePath,
            '-frames:v',
            '1',
            '-vf',
            'scale=1280:-1',
            posterPath,
          ],
          { timeoutMs: 30000, signal },
        )
        if (signal?.aborted) {
          throw new AIServiceError({
            code: 'cancelled',
            message: 'Video poster generation was cancelled.',
            retryable: false,
          })
        }
        if (result.code !== 0 || !fs.existsSync(posterPath)) return undefined
        const base64 = await fs.promises.readFile(posterPath, 'base64')
        return await getAIMediaService().storeBase64({
          mediaType: 'image',
          base64,
          declaredMimeType: 'image/jpeg',
          providerId,
          providerTaskId,
          originalName: 'generated-video-poster.jpg',
        })
      } finally {
        await fs.promises.rm(posterPath, { force: true }).catch(() => undefined)
      }
    },
  })
}

// Get or open user database connection
function getUserDb(dbName: string): any {
  if (openDbs.has(dbName)) {
    return openDbs.get(dbName)
  }

  const userDbDir = path.join(BASE_DIR, 'users', activeUserId, 'database')
  const dbFile = path.join(userDbDir, `${dbName}.db`)

  // Create folder if missing
  if (!fs.existsSync(userDbDir)) {
    fs.mkdirSync(userDbDir, { recursive: true })
  }

  const db = new Database(dbFile)
  db.pragma('journal_mode = WAL')
  openDbs.set(dbName, db)
  return db
}

function getUserDbPath(dbName: string) {
  return path.join(BASE_DIR, 'users', activeUserId, 'database', `${dbName}.db`)
}

function getVaultService() {
  if (!vaultService)
    vaultService = new VaultService(getUserDb('vault'), { dbPath: getUserDbPath('vault') })
  return vaultService
}

async function runVaultAction(action: () => unknown | Promise<unknown>) {
  try {
    return { success: true, data: await action() }
  } catch (error) {
    return serializeVaultError(error)
  }
}

function getActiveUserVideoDir() {
  return resolveVideoDownloadDir(
    getSettings(),
    path.join(BASE_DIR, 'users', activeUserId, 'files', 'videos'),
  )
}

function removeDouyinFavoriteFiles(db: Database.Database, itemIds?: number[]) {
  const rows = itemIds
    ? (() => {
        const ids = [...new Set(itemIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
        if (ids.length === 0) return []
        const placeholders = ids.map(() => '?').join(', ')
        return db
          .prepare(
            `SELECT local_path, download_status FROM douyin_favorite_items WHERE id IN (${placeholders})`,
          )
          .all(...ids) as Array<{ local_path: string | null; download_status: string }>
      })()
    : (db.prepare('SELECT local_path, download_status FROM douyin_favorite_items').all() as Array<{
        local_path: string | null
        download_status: string
      }>)
  if (rows.some((row) => row.download_status === 'downloading')) {
    throw new Error('A Douyin video is still downloading. Wait for it to finish before deleting.')
  }

  const allowedRoot = path.resolve(getActiveUserVideoDir())
  for (const row of rows) {
    if (!row.local_path) continue
    const filePath = path.resolve(row.local_path)
    const relative = path.relative(allowedRoot, filePath)
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('The local Douyin video path is outside the video directory.')
    }
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
}

function setupVideoProtocol() {
  protocol.handle('life-video', (request) =>
    handleVideoProtocolRequest({ request, userVideoDir: getActiveUserVideoDir() }),
  )
}

function getAIMediaRoot() {
  return path.join(BASE_DIR, 'users', activeUserId, 'files', 'ai-media')
}

function getAIMediaService() {
  return new AIMediaService({ db: getUserDb('ai'), mediaRoot: getAIMediaRoot() })
}

function getAIStorageService() {
  const settings = getSettings()
  const configuredLimit = Number(settings.aiMediaMaxBytes)
  return new AIStorageService({
    db: getUserDb('ai'),
    mediaRoot: getAIMediaRoot(),
    credentialPath: path.join(BASE_DIR, 'users', activeUserId, 'config', 'ai-credentials.json'),
    media: getAIMediaService(),
    conversations: new AIConversationService(getUserDb('ai')),
    clearCredentials: () =>
      new AICredentialService(
        path.join(BASE_DIR, 'users', activeUserId, 'config', 'ai-credentials.json'),
        createSafeStorageCredentialAdapter(),
      ).clear(),
    capacityLimitBytes:
      Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : undefined,
  })
}

function startAIRecovery() {
  aiRecoveryController?.abort()
  const controller = new AbortController()
  aiRecoveryController = controller
  const service = new AIRecoveryService({
    db: getUserDb('ai'),
    conversations: new AIConversationService(getUserDb('ai')),
    resumeVideo: (assetId, signal) => getAIVideoAssetService().resume({ assetId, signal }),
  })
  void service
    .recover(controller.signal)
    .then(async () => {
      if (controller.signal.aborted) return
      const settings = getSettings()
      if (settings.aiMediaCleanupPolicy !== 'auto_unreferenced') return
      const maxMediaBytes = Number(settings.aiMediaMaxBytes)
      await getAIStorageService().enforceCapacity(
        Number.isInteger(maxMediaBytes) && maxMediaBytes > 0 ? maxMediaBytes : undefined,
      )
    })
    .catch(() => undefined)
    .finally(() => {
      if (aiRecoveryController === controller) aiRecoveryController = null
    })
}

function setupAIMediaProtocol() {
  protocol.handle('life-ai-asset', (request) =>
    handleAIMediaProtocolRequest({
      request,
      db: getUserDb('ai'),
      mediaRoot: getAIMediaRoot(),
    }),
  )
}

// Switch user and initialize
function switchUserSession(userId: string) {
  closeUserDbs()
  activeUserId = userId

  // Set up local folder paths for this user
  const userDir = path.join(BASE_DIR, 'users', userId)
  const dbDir = path.join(userDir, 'database')
  const filesDir = path.join(userDir, 'files')

  fs.mkdirSync(dbDir, { recursive: true })
  fs.mkdirSync(path.join(filesDir, 'notes'), { recursive: true })
  fs.mkdirSync(path.join(filesDir, 'books'), { recursive: true })
  fs.mkdirSync(path.join(filesDir, 'videos'), { recursive: true })

  // Initialize SQLite schemas
  initializeUserDatabase(dbDir)
  startAIRecovery()

  // Update settings.json lastUserId
  const settings = getSettings()
  settings.lastUserId = userId
  if (!settings.userProfiles[userId]) {
    settings.userProfiles[userId] = { nickname: `用户 ${userId}`, avatar: 'U' }
  }
  saveSettings(settings)
}

// Background scheduler loop
function startScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval)

  try {
    runSchedulerCycle()
  } catch (err) {
    console.error('Scheduler error:', err)
  }

  // Scan every minute
  schedulerInterval = setInterval(() => {
    try {
      runSchedulerCycle()
    } catch (err) {
      console.error('Scheduler error:', err)
    }
  }, 60000)
}

function emitTaskDataChanged(reason: string) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('tasks:changed', { reason })
  }
}

function runSchedulerCycle(options: { notify?: boolean } = {}) {
  const result = runTaskSchedulerCore(getUserDb('tasks'))
  if (options.notify !== false && mainWindow) {
    for (const task of result.generatedTasks) {
      mainWindow.webContents.send('scheduler:notif', { title: '任务实例已生成', body: task.title })
    }
    for (const task of result.overdueTasks) {
      mainWindow.webContents.send('scheduler:overdue', task)
    }
  }
  if (result.generatedTasks.length > 0 || result.overdueTasks.length > 0) {
    emitTaskDataChanged('scheduler')
  }
  return { generatedCount: result.generatedTasks.length, overdueCount: result.overdueTasks.length }

  /* legacy scheduler body retained temporarily below for migration reference */
  const notify = options.notify !== false
  const db = getUserDb('tasks')
  const now = new Date()
  const currentYMD = toLocalDateKey(now)
  let generatedCount = 0
  let overdueCount = 0

  // 1. Scan task templates and auto-generate due instances.
  const rules = db.prepare('SELECT * FROM recurring_rules').all() as any[]

  rules.forEach((rule) => {
    // Tasks become actionable at the beginning of their scheduled day. The stored time
    // remains available to the UI and reminders without delaying the day's task instance.
    const occurrence = getDueTemplateOccurrence(rule, now, { ignoreStartTime: true })
    if (!occurrence) return

    const skipped = db
      .prepare(
        'SELECT 1 FROM recurring_rule_occurrence_exceptions WHERE recur_rule_id = ? AND instance_key = ? LIMIT 1',
      )
      .get(rule.id, occurrence.instanceKey)
    if (skipped) return

    const existing = db
      .prepare(
        `
        SELECT id FROM tasks
        WHERE recur_rule_id = ? AND instance_key = ? AND parent_id IS NULL
        LIMIT 1
      `,
      )
      .get(rule.id, occurrence.instanceKey) as { id?: number } | undefined

    if (existing?.id) {
      if (rule.frequency === 'custom' && !rule.last_trigger_time) {
        db.prepare('UPDATE recurring_rules SET last_trigger_time = ? WHERE id = ?').run(
          now.toISOString(),
          rule.id,
        )
      }
      return
    }

    const title = rule.title
    const desc = rule.description || '由任务模板自动生成'
    const priority = rule.priority || 'mid'

    const inserted = db
      .prepare(
        `
      INSERT INTO tasks (
        title, description, priority, status, due_date, recur_rule_id, instance_key, progress
      )
      VALUES (?, ?, ?, '待处理', ?, ?, ?, 0)
    `,
      )
      .run(title, desc, priority, occurrence.dateKey, rule.id, occurrence.instanceKey)
    const parentId = Number(inserted.lastInsertRowid)

    const steps = db
      .prepare(
        'SELECT * FROM recurring_rule_steps WHERE rule_id = ? ORDER BY sort_order ASC, id ASC',
      )
      .all(rule.id) as any[]
    const insertStep = db.prepare(
      `
      INSERT INTO tasks (
        title, description, priority, status, due_date, recur_rule_id, instance_key, parent_id, progress
      )
      VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, 0)
    `,
    )
    for (const step of steps) {
      insertStep.run(
        step.title,
        step.description || '',
        step.priority || priority,
        occurrence.dateKey,
        rule.id,
        occurrence.instanceKey,
        parentId,
      )
    }

    db.prepare('UPDATE recurring_rules SET last_trigger_time = ? WHERE id = ?').run(
      now.toISOString(),
      rule.id,
    )
    generatedCount += 1

    if (notify && mainWindow) {
      mainWindow.webContents.send('scheduler:notif', {
        title: `任务实例已生成`,
        body: title,
      })
    }
  })

  // 2. Scan tasks for overdue states
  // We scan tasks where due_date is past currentYMD and is_completed = 0
  const overdueTasks = db
    .prepare(
      `
    SELECT * FROM tasks 
    WHERE due_date < ? AND is_completed = 0 AND status != '已关闭' AND status != '已逾期'
  `,
    )
    .all(currentYMD) as any[]

  overdueTasks.forEach((task) => {
    db.prepare("UPDATE tasks SET status = '已逾期' WHERE id = ?").run(task.id)
    overdueCount += 1
    if (notify && mainWindow) {
      mainWindow.webContents.send('scheduler:overdue', {
        taskId: task.id,
        title: task.title,
      })
    }
  })

  return { generatedCount, overdueCount }
}

// Electron window creation
function configureApplicationMenu() {
  if (process.platform !== 'win32') return

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'View',
        submenu: [{ role: 'reload', label: 'Reload' }],
      },
    ]),
  )
}

function createWindow() {
  initConfig()

  const settings = getSettings()
  activeUserId = settings.lastUserId || 'guest'
  switchUserSession(activeUserId)

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // Let each operating system provide its standard title bar and window controls.
    // This preserves the expected Windows, macOS, and Linux interactions instead of
    // recreating a macOS-style control strip in the renderer.
    title: 'LifeOS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // Open devtools in development
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    emitVideoEngineStatus()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  setupAutoUpdater()
  startScheduler()
  void loadVideoEngine()
}

function createDesktopTaskNoteWindow() {
  if (desktopTaskNoteWindow && !desktopTaskNoteWindow.isDestroyed()) {
    desktopTaskNoteWindow.show()
    desktopTaskNoteWindow.focus()
    return desktopTaskNoteWindow
  }

  const noteSettings = getDesktopTaskNoteSettings()
  const savedBounds =
    noteSettings.layoutVersion >= 1 &&
    noteSettings.bounds &&
    typeof noteSettings.bounds === 'object'
      ? noteSettings.bounds
      : null
  const noteWidth = Number(savedBounds?.width) || 320
  const noteHeight = Number(savedBounds?.height) || 420
  const workArea = screen.getPrimaryDisplay().workArea
  const defaultBounds = {
    x: workArea.x + workArea.width - noteWidth - 18,
    y: workArea.y + 18,
  }
  const bounds = savedBounds ?? defaultBounds
  if (noteSettings.layoutVersion < 1) {
    saveDesktopTaskNoteSettings({
      layoutVersion: 1,
      bounds: { ...defaultBounds, width: noteWidth, height: noteHeight },
    })
  }
  desktopTaskNoteWindow = new BrowserWindow({
    width: noteWidth,
    height: noteHeight,
    x: Number(bounds.x),
    y: Number(bounds.y),
    minWidth: 260,
    minHeight: 240,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    roundedCorners: true,
    skipTaskbar: true,
    title: 'LifeOS 今日任务',
    alwaysOnTop: noteSettings.alwaysOnTop,
    opacity: noteSettings.opacity,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    desktopTaskNoteWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#desktop-task-note`)
  } else {
    desktopTaskNoteWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'desktop-task-note',
    })
  }

  desktopTaskNoteWindow.on('closed', () => {
    if (desktopTaskNoteSaveTimer) clearTimeout(desktopTaskNoteSaveTimer)
    desktopTaskNoteWindow = null
  })
  desktopTaskNoteWindow.on('move', scheduleDesktopTaskNoteBoundsSave)
  desktopTaskNoteWindow.on('resize', scheduleDesktopTaskNoteBoundsSave)

  return desktopTaskNoteWindow
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

function createAppTray() {
  if (appTray) return
  const iconPath = path.join(__dirname, '../build/icon.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  appTray = new Tray(icon)
  appTray.setToolTip('LifeOS')
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 LifeOS', click: showMainWindow },
      { label: '打开今日任务便签', click: () => createDesktopTaskNoteWindow().show() },
      { type: 'separator' },
      { label: '退出 LifeOS', click: () => app.quit() },
    ]),
  )
  appTray.on('click', () => createDesktopTaskNoteWindow().show())
}

app.whenReady().then(() => {
  setupVideoProtocol()
  setupAIMediaProtocol()
  configureApplicationMenu()
  createWindow()
  createDesktopTaskNoteWindow()
  createAppTray()
})

app.on('window-all-closed', () => {
  closeUserDbs()
  if (schedulerInterval) clearInterval(schedulerInterval)
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  destroyDouyinSyncWindowForAppQuit()
  closeUserDbs()
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

ipcMain.handle('ai:media:saveAs', async (_event, payload: { assetId?: number }) => {
  try {
    const service = getAIMediaService()
    const asset = service.getAsset(payload?.assetId)
    const options = { defaultPath: asset.originalName || `ai-image-${asset.id}` }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { success: true, data: { saved: false } }
    return { success: true, data: await service.copyAssetTo(asset.id, result.filePath) }
  } catch {
    return {
      success: false,
      error: {
        code: 'storage_error',
        message: 'The AI media file could not be saved.',
        retryable: false,
      },
    }
  }
})

ipcMain.handle('ai:media:reveal', async (_event, payload: { assetId?: number }) => {
  try {
    const filePath = await getAIMediaService().getRegisteredFilePath(payload?.assetId)
    shell.showItemInFolder(filePath)
    return { success: true, data: { revealed: true } }
  } catch {
    return {
      success: false,
      error: {
        code: 'not_found',
        message: 'The AI media file could not be located.',
        retryable: false,
      },
    }
  }
})

ipcMain.handle('ai:attachments:select', async () => {
  try {
    const options = {
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return { success: true, data: [] }
    const mimeByExtension: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
    }
    const assets = await Promise.all(
      result.filePaths.map(async (filePath) => {
        const extension = path.extname(filePath).toLowerCase()
        const mediaType = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)
          ? 'image'
          : 'file'
        const asset = await getAIMediaService().storeLocalFile({
          mediaType,
          filePath,
          declaredMimeType: mimeByExtension[extension],
          originalName: path.basename(filePath),
        })
        return {
          id: asset.id,
          mediaType: asset.mediaType,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          originalName: asset.originalName,
          url: asset.url,
        }
      }),
    )
    return { success: true, data: assets }
  } catch (error) {
    const detail =
      error instanceof AIServiceError
        ? error.detail
        : { code: 'storage_error', message: 'The attachment could not be added.', retryable: false }
    return { success: false, error: detail }
  }
})

// IPC Handlers: User Authentication & Switching
ipcMain.handle('user:switch', async (_, userId: string) => {
  const settings = getSettings()
  const profile = settings.userProfiles[userId]
  if (profile && profile.passwordHash) {
    return null // Block unauthenticated switches for password-protected accounts
  }
  switchUserSession(userId)
  return {
    userId,
    profile,
  }
})

ipcMain.handle('user:login', async (_, { userId, password }) => {
  const settings = getSettings()
  const profile = settings.userProfiles[userId]
  if (!profile) {
    return { success: false, error: '用户不存在' }
  }
  if (!profile.passwordHash) {
    // Passwordless account
    switchUserSession(userId)
    return { success: true, userId, profile }
  }
  const { hash } = hashPassword(password, profile.salt)
  if (hash !== profile.passwordHash) {
    return { success: false, error: '密码错误' }
  }
  profile.sessionValid = true
  profile.lastActiveTime = Date.now()
  settings.userProfiles[userId] = profile
  saveSettings(settings)

  switchUserSession(userId)
  return { success: true, userId, profile }
})

ipcMain.handle(
  'user:register',
  async (
    _,
    { userId, nickname, avatar, password, passwordHint, securityQuestion, securityAnswer },
  ) => {
    const settings = getSettings()
    if (settings.userProfiles[userId]) {
      return { success: false, error: '该用户名已存在' }
    }

    const profile: any = {
      nickname,
      avatar,
    }

    if (password) {
      const { salt, hash } = hashPassword(password)
      profile.passwordHash = hash
      profile.salt = salt
      profile.passwordHint = passwordHint
      profile.sessionValid = true
      profile.lastActiveTime = Date.now()

      if (securityQuestion && securityAnswer) {
        const ansCrypto = hashPassword(securityAnswer)
        profile.securityQuestion = securityQuestion
        profile.recoveryAnswerHash = ansCrypto.hash
        profile.recoveryAnswerSalt = ansCrypto.salt
      }
    }

    settings.userProfiles[userId] = profile
    saveSettings(settings)
    switchUserSession(userId)

    return { success: true, userId, profile }
  },
)

ipcMain.handle('user:resetPassword', async (_, { userId, securityAnswer, newPassword }) => {
  const settings = getSettings()
  const profile = settings.userProfiles[userId]
  if (!profile) {
    return { success: false, error: '用户不存在' }
  }
  if (!profile.securityQuestion || !profile.recoveryAnswerHash) {
    return { success: false, error: '该账户未设置密保问题，无法重置密码' }
  }

  const { hash } = hashPassword(securityAnswer, profile.recoveryAnswerSalt)
  if (hash !== profile.recoveryAnswerHash) {
    return { success: false, error: '密保问题答案错误' }
  }

  if (newPassword) {
    const passCrypto = hashPassword(newPassword)
    profile.passwordHash = passCrypto.hash
    profile.salt = passCrypto.salt
    profile.sessionValid = true
    profile.lastActiveTime = Date.now()
  } else {
    delete profile.passwordHash
    delete profile.salt
    delete profile.passwordHint
    delete profile.securityQuestion
    delete profile.recoveryAnswerHash
    delete profile.recoveryAnswerSalt
    delete profile.sessionValid
    delete profile.lastActiveTime
  }

  settings.userProfiles[userId] = profile
  saveSettings(settings)
  return { success: true }
})

ipcMain.handle(
  'user:updateProfile',
  async (
    _,
    { userId, nickname, avatar, password, passwordHint, securityQuestion, securityAnswer },
  ) => {
    const settings = getSettings()
    const profile = settings.userProfiles[userId]
    if (!profile) return { success: false, error: '用户不存在' }

    profile.nickname = nickname
    profile.avatar = avatar

    if (password !== undefined) {
      if (password) {
        const { salt, hash } = hashPassword(password)
        profile.passwordHash = hash
        profile.salt = salt
        profile.passwordHint = passwordHint
        profile.sessionValid = true
        profile.lastActiveTime = Date.now()

        if (securityQuestion && securityAnswer) {
          const ansCrypto = hashPassword(securityAnswer)
          profile.securityQuestion = securityQuestion
          profile.recoveryAnswerHash = ansCrypto.hash
          profile.recoveryAnswerSalt = ansCrypto.salt
        }
      } else {
        delete profile.passwordHash
        delete profile.salt
        delete profile.passwordHint
        delete profile.securityQuestion
        delete profile.recoveryAnswerHash
        delete profile.recoveryAnswerSalt
        delete profile.sessionValid
        delete profile.lastActiveTime
      }
    }

    settings.userProfiles[userId] = profile
    saveSettings(settings)
    switchUserSession(userId)
    return { success: true, profile }
  },
)

ipcMain.handle('user:getProfileList', async () => {
  const settings = getSettings()
  return Object.keys(settings.userProfiles || {}).map((userId) => {
    const profile = settings.userProfiles[userId]
    return {
      userId,
      nickname: profile.nickname,
      avatar: profile.avatar,
      hasPassword: !!profile.passwordHash,
      passwordHint: profile.passwordHint,
      securityQuestion: profile.securityQuestion,
    }
  })
})

ipcMain.handle('user:getCurrent', async () => {
  const settings = getSettings()
  const profile = settings.userProfiles[activeUserId] || { nickname: 'Guest', avatar: 'G' }

  let isAuthenticated = false
  if (!profile.passwordHash) {
    isAuthenticated = true
  } else {
    const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000
    const now = Date.now()
    const lastActive = profile.lastActiveTime || 0
    if (profile.sessionValid && now - lastActive < FIFTEEN_DAYS) {
      isAuthenticated = true
      // Update last active time to slide the session window
      profile.lastActiveTime = now
      settings.userProfiles[activeUserId] = profile
      saveSettings(settings)
    }
  }

  return {
    userId: activeUserId,
    isAuthenticated,
    profile: {
      nickname: profile.nickname,
      avatar: profile.avatar,
      hasPassword: !!profile.passwordHash,
      passwordHint: profile.passwordHint,
      securityQuestion: profile.securityQuestion,
    },
  }
})

ipcMain.handle('user:logout', async () => {
  aiAgentRuntime?.dispose()
  aiAgentRuntime = null
  await aiMcpManager?.dispose()
  aiMcpManager = null
  vaultService?.lock()
  const settings = getSettings()
  const profile = settings.userProfiles[activeUserId]
  if (profile) {
    profile.sessionValid = false
    settings.userProfiles[activeUserId] = profile
    saveSettings(settings)
  }
  return { success: true }
})

// IPC Handlers: Settings Config
ipcMain.handle('settings:get', async () => {
  return getSettings()
})

ipcMain.handle('settings:save', async (_, newSettings: any) => {
  const previousSettings = getSettings()
  const savedSettings = saveSettings(newSettings)
  const videoSettingKeys = [
    'ytDlpPath',
    'ffmpegPath',
    'videoDownloadDir',
    'qualityPreference',
    'cookieMode',
    'cookieBrowser',
    'cookiesPath',
    'bilibiliCookiesPath',
  ]
  if (videoSettingKeys.some((key) => previousSettings[key] !== newSettings[key])) {
    void loadVideoEngine({ force: true })
  }
  return savedSettings
})

ipcMain.handle('settings:clearAppData', async () => {
  try {
    // 1. Close all active database connections
    closeUserDbs()

    // 2. Delete the user files directory completely
    const usersDir = path.join(BASE_DIR, 'users')
    if (fs.existsSync(usersDir)) {
      fs.rmSync(usersDir, { recursive: true, force: true })
    }

    // 3. Reset the user profiles inside settings.json
    const settings = getSettings()
    settings.userProfiles = {
      guest: { nickname: '访客模式', avatar: 'G' },
    }
    settings.lastUserId = 'guest'
    saveSettings(settings)

    // 4. Re-initialize the session for guest user
    switchUserSession('guest')

    return { success: true }
  } catch (err: any) {
    console.error('Failed to clear app data:', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('backup:selectDirectory', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select backup destination',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (canceled || filePaths.length === 0) return { success: false, canceled: true }
  return { success: true, path: filePaths[0] }
})

ipcMain.handle('backup:selectFile', async (_, eventOptions?: { title?: string }) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow!, {
    title: eventOptions?.title || 'Select LifeOS backup',
    filters: [{ name: 'LifeOS backup', extensions: ['zip'] }],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return { success: false, canceled: true }
  return { success: true, path: filePaths[0] }
})

ipcMain.handle('backup:inspect', async (_, { filePath }: { filePath: string }) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Backup file is required.' }
    }
    return { success: true, data: inspectLifeOsBackupPackage(filePath) }
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) }
  }
})

ipcMain.handle('backup:create', async (_, { outputDir }: { outputDir: string }) => {
  let databasesClosed = false
  try {
    if (!outputDir || typeof outputDir !== 'string') {
      return { success: false, error: 'Backup destination is required.' }
    }
    closeUserDbs()
    databasesClosed = true
    const settings = getSettings()
    const result = createLifeOsBackupPackage({
      appVersion: app.getVersion(),
      baseDir: BASE_DIR,
      outputDir,
      settingsFile: SETTINGS_FILE,
      userId: activeUserId,
      videoDownloadDir: settings.videoDownloadDir,
      aiSchemaVersion: AI_SCHEMA_VERSION,
    })
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) }
  } finally {
    if (databasesClosed) startAIRecovery()
  }
})

ipcMain.handle('backup:restore', async (_, { filePath }: { filePath: string }) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Backup file is required.' }
    }
    closeUserDbs()
    const result = restoreLifeOsBackupPackage({
      archivePath: filePath,
      baseDir: BASE_DIR,
      settingsFile: SETTINGS_FILE,
      targetUserId: activeUserId,
    })
    switchUserSession(activeUserId)
    return { success: true, data: result }
  } catch (error: any) {
    try {
      switchUserSession(activeUserId)
    } catch (recoveryError) {
      console.error('Failed to reopen the active user after restore failure:', recoveryError)
    }
    return { success: false, error: error?.message || String(error) }
  }
})

ipcMain.handle('app:restart', async () => {
  app.relaunch()
  app.exit(0)
  return { success: true }
})

ipcMain.on('fs:reveal', (_, filePath: string) => {
  // Safe reveal in finder
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath)
  }
})

// IPC Handlers: Book File Selector
ipcMain.handle('book:select-file', async (event) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(event.sender) || mainWindow!,
    {
      title: '选择电子书文件',
      filters: [{ name: 'eBooks', extensions: ['epub', 'pdf', 'mobi', 'txt', 'docx'] }],
      properties: ['openFile'],
    },
  )

  if (canceled || filePaths.length === 0) {
    return { success: false, error: 'Canceled' }
  }

  const sourcePath = filePaths[0]
  const fileName = path.basename(sourcePath)
  const ext = path.extname(sourcePath).toLowerCase()
  const title = path.basename(sourcePath, ext)

  const targetDir = path.join(BASE_DIR, 'users', activeUserId, 'files', 'books')
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const targetPath = path.join(targetDir, fileName)

  try {
    fs.copyFileSync(sourcePath, targetPath)
    return {
      success: true,
      title,
      fileName,
      filePath: targetPath,
      relativePath: `/books/${fileName}`,
    }
  } catch (error: any) {
    console.error('Failed to copy book file:', error)
    return { success: false, error: error.message }
  }
})

// IPC Handlers: File Deletion
ipcMain.handle('fs:delete-file', async (_, relativePath: string) => {
  try {
    const absolutePath = path.join(BASE_DIR, 'users', activeUserId, 'files', relativePath)
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath)
      return { success: true }
    }
    return { success: false, error: 'File does not exist' }
  } catch (error: any) {
    console.error('Failed to delete file:', error)
    return { success: false, error: error.message }
  }
})

// IPC Handlers: Open External File
ipcMain.handle('fs:open-external', async (_, relativePath: string) => {
  try {
    const absolutePath = path.join(BASE_DIR, 'users', activeUserId, 'files', relativePath)
    if (fs.existsSync(absolutePath)) {
      await shell.openPath(absolutePath)
      return { success: true }
    }
    return { success: false, error: 'File does not exist' }
  } catch (error: any) {
    console.error('Failed to open external file:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('shell:openExternal', async (_, url: string) => {
  try {
    if (!/^https?:\/\//i.test(url)) {
      return { success: false, error: 'Only HTTP(S) URLs can be opened externally.' }
    }
    await shell.openExternal(url)
    return { success: true }
  } catch (error: any) {
    console.error('Failed to open external URL:', error)
    return { success: false, error: error.message }
  }
})

// IPC Handlers: Get Book Chapters (EPUB & TXT Parser)
ipcMain.handle('book:get-chapters', async (_, relativePath: string) => {
  try {
    const absolutePath = path.join(BASE_DIR, 'users', activeUserId, 'files', relativePath)
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: 'Book file not found' }
    }

    const ext = path.extname(absolutePath).toLowerCase()

    if (ext === '.txt') {
      const text = fs.readFileSync(absolutePath, 'utf8')
      const lines = text.split(/\r?\n/)

      const chapters: { title: string; paragraphs: string[] }[] = []
      let currentChapter = { title: 'Chapter 1', paragraphs: [] as string[] }
      const chapterTitleRegex = /^(第[一二三四五六七八九十百千\d]+章|Chapter\s+\d+|#\s+)/i

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        if (chapterTitleRegex.test(line)) {
          if (currentChapter.paragraphs.length > 0) {
            chapters.push(currentChapter)
          }
          currentChapter = { title: line, paragraphs: [] }
        } else {
          currentChapter.paragraphs.push(line)
        }
      }

      if (currentChapter.paragraphs.length > 0) {
        chapters.push(currentChapter)
      }

      if (chapters.length === 0) {
        chapters.push({ title: 'Book Content', paragraphs: ['[Empty book content]'] })
      }

      return { success: true, chapters }
    } else if (ext === '.epub') {
      const zip = new AdmZip(absolutePath)

      // 1. Read META-INF/container.xml to find the OPF file path
      const containerEntry = zip.getEntry('META-INF/container.xml')
      if (!containerEntry) {
        return { success: false, error: 'Invalid EPUB: container.xml missing' }
      }
      const containerXml = containerEntry.getData().toString('utf8')
      const opfPathMatch = containerXml.match(/full-path="([^"]+)"/)
      if (!opfPathMatch) {
        return { success: false, error: 'Invalid EPUB: OPF path not found' }
      }
      const opfPath = opfPathMatch[1]
      const opfDir = path.dirname(opfPath)

      // 2. Read the OPF file
      const opfEntry = zip.getEntry(opfPath)
      if (!opfEntry) {
        return { success: false, error: `Invalid EPUB: OPF file not found at ${opfPath}` }
      }
      const opfXml = opfEntry.getData().toString('utf8')

      // 3. Parse manifest items
      const manifestItems: { [id: string]: string } = {}
      const itemRegex = /<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"/g
      let match
      while ((match = itemRegex.exec(opfXml)) !== null) {
        manifestItems[match[1]] = match[2]
      }
      const itemRegexAlt = /<item\s+[^>]*href="([^"]+)"[^>]*id="([^"]+)"/g
      while ((match = itemRegexAlt.exec(opfXml)) !== null) {
        manifestItems[match[2]] = match[1]
      }

      // 4. Parse spine items
      const spineIds: string[] = []
      const itemrefRegex = /<itemref\s+[^>]*idref="([^"]+)"/g
      while ((match = itemrefRegex.exec(opfXml)) !== null) {
        spineIds.push(match[1])
      }

      // 4b. Build the table of contents. We capture BOTH a flat href -> title map
      // (used to name each spine chapter) AND a hierarchical list with nesting
      // levels (used to render an indented sidebar). Most EPUBs repeat the same
      // <title> on every spine file, so the TOC is the only reliable name source.
      const tocTitleByHref: { [href: string]: string } = {}
      // Hierarchical entries in document order: level 0 = top-level chapter.
      // `frag` is the #anchor (if any) so sub-entries inside one file can resolve
      // to a specific paragraph rather than all collapsing onto the file start.
      const tocEntries: { title: string; level: number; hrefKey: string; frag: string }[] = []
      const normalizeHref = (h: string) =>
        decodeURIComponent(h.split('#')[0].split('/').pop() || '').trim()
      const fragOf = (h: string) => {
        const i = h.indexOf('#')
        return i >= 0 ? decodeURIComponent(h.slice(i + 1)).trim() : ''
      }

      // EPUB3: navigation document declared with properties="nav"
      const navIdMatch = opfXml.match(/<item\s+[^>]*properties="[^"]*\bnav\b[^"]*"[^>]*>/i)
      let tocHref: string | null = null
      if (navIdMatch) {
        const hrefM = navIdMatch[0].match(/href="([^"]+)"/i)
        if (hrefM) tocHref = hrefM[1]
      }
      // EPUB2: spine toc attribute points at an ncx manifest id
      if (!tocHref) {
        const spineTocMatch = opfXml.match(/<spine\s+[^>]*toc="([^"]+)"/i)
        if (spineTocMatch) {
          tocHref = manifestItems[spineTocMatch[1]] || null
        }
      }
      // Fallback: any .ncx item in the manifest
      if (!tocHref) {
        const ncxId = Object.keys(manifestItems).find((id) =>
          manifestItems[id].toLowerCase().endsWith('.ncx'),
        )
        if (ncxId) tocHref = manifestItems[ncxId]
      }

      if (tocHref) {
        const tocRelative = decodeURIComponent(tocHref)
        const tocZipPath =
          opfDir === '.' ? tocRelative : path.join(opfDir, tocRelative).replace(/\\/g, '/')
        const tocEntry = zip.getEntry(tocZipPath)
        if (tocEntry) {
          const tocXml = tocEntry.getData().toString('utf8')
          const stripTags = (s: string) =>
            s
              .replace(/<[^>]+>/g, '')
              .replace(/\s+/g, ' ')
              .trim()

          if (tocHref.toLowerCase().endsWith('.ncx')) {
            // EPUB2 .ncx: navPoints nest to express hierarchy. Walk tokens and
            // track depth via navPoint open/close so sub-chapters get level > 0.
            const tokenRe =
              /<navPoint\b|<\/navPoint>|<text>(.*?)<\/text>|<content\b[^>]*\bsrc="([^"]+)"/gis
            let depth = 0
            let pendingLabel = ''
            let tk
            while ((tk = tokenRe.exec(tocXml)) !== null) {
              if (tk[0].toLowerCase().startsWith('<navpoint')) {
                depth++
                pendingLabel = ''
              } else if (tk[0].toLowerCase().startsWith('</navpoint')) {
                depth = Math.max(0, depth - 1)
              } else if (tk[1] !== undefined) {
                pendingLabel = stripTags(tk[1])
              } else if (tk[2] !== undefined) {
                const key = normalizeHref(tk[2])
                if (pendingLabel && key) {
                  tocEntries.push({
                    title: pendingLabel,
                    level: Math.max(0, depth - 1),
                    hrefKey: key,
                    frag: fragOf(tk[2]),
                  })
                  if (!tocTitleByHref[key]) tocTitleByHref[key] = pendingLabel
                  pendingLabel = ''
                }
              }
            }
          } else {
            // EPUB3 nav.xhtml: hierarchy is expressed by nested <ol>. Isolate the
            // toc nav (ignore landmarks / page-list) and track <ol> depth.
            const navMatch =
              tocXml.match(/<nav[^>]*epub:type="[^"]*\btoc\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i) ||
              tocXml.match(/<nav[^>]*\brole="doc-toc"[^>]*>([\s\S]*?)<\/nav>/i) ||
              tocXml.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i)
            const navInner = navMatch ? navMatch[1] : tocXml
            const tokenRe = /<ol\b|<\/ol>|<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gis
            let depth = 0
            let tk
            while ((tk = tokenRe.exec(navInner)) !== null) {
              if (tk[0].toLowerCase().startsWith('<ol')) {
                depth++
              } else if (tk[0].toLowerCase().startsWith('</ol')) {
                depth = Math.max(0, depth - 1)
              } else if (tk[1] !== undefined) {
                const key = normalizeHref(tk[1])
                const label = stripTags(tk[2])
                if (label && key) {
                  tocEntries.push({
                    title: label,
                    level: Math.max(0, depth - 1),
                    hrefKey: key,
                    frag: fragOf(tk[1]),
                  })
                  if (!tocTitleByHref[key]) tocTitleByHref[key] = label
                }
              }
            }
          }
        }
      }

      // 5. Read chapters in spine order
      const chapters: {
        title: string
        paragraphs: ({ type: 'paragraph' | 'heading'; text: string; level?: number } | string)[]
        href: string
      }[] = []
      const usedTitles = new Set<string>()
      // Maps a spine file (normalized href) to its index in `chapters`, so TOC
      // entries (which reference files/anchors) can resolve to a chapter.
      const chapterIndexByHref: { [href: string]: number } = {}
      // Per-chapter map of #anchor id -> paragraph index, so a TOC sub-entry can
      // jump to the exact paragraph instead of the chapter start.
      const anchorParaByHref: { [href: string]: { [frag: string]: number } } = {}
      for (let i = 0; i < spineIds.length; i++) {
        const id = spineIds[i]
        const href = manifestItems[id]
        if (!href) continue

        const relativeHtmlPath = decodeURIComponent(href)
        const htmlZipPath =
          opfDir === '.'
            ? relativeHtmlPath
            : path.join(opfDir, relativeHtmlPath).replace(/\\/g, '/')

        const htmlEntry = zip.getEntry(htmlZipPath)
        if (!htmlEntry) continue

        const htmlContent = htmlEntry.getData().toString('utf8')

        // Resolve chapter title. Priority: TOC label > first heading > <title> > "Chapter N".
        // The TOC is preferred because most EPUBs reuse the same <title> on every
        // file, which is what caused duplicate sidebar entries.
        const tocTitle = tocTitleByHref[normalizeHref(href)]
        const title = resolveChapterTitleFromHtml(htmlContent, tocTitle, `Chapter ${i + 1}`)

        // Parse paragraphs and headings in document order. Headings are kept as
        // addressable blocks so TOC anchors can highlight and render correctly.
        const paragraphs: (
          { type: 'paragraph' | 'heading'; text: string; level?: number } | string
        )[] = []
        const paraOffsets: number[] = []
        const blockRegex = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gis
        let blockMatch
        while ((blockMatch = blockRegex.exec(htmlContent)) !== null) {
          const tag = blockMatch[1].toLowerCase()
          const text = decodeHtmlText(blockMatch[2])

          if (text) {
            paragraphs.push(
              tag === 'p'
                ? { type: 'paragraph', text }
                : { type: 'heading', text, level: parseInt(tag.slice(1), 10) },
            )
            paraOffsets.push(blockMatch.index)
          }
        }

        // Map every id="..." / name="..." anchor in this file to the paragraph
        // index at or after its position (a heading's id maps to the next para).
        const anchorMap: { [frag: string]: number } = {}
        const idRegex = /\b(?:id|name)=["']([^"']+)["']/gis
        let idM
        while ((idM = idRegex.exec(htmlContent)) !== null) {
          const frag = idM[1]
          if (anchorMap[frag] !== undefined) continue
          const pos = idM.index
          anchorMap[frag] = getAnchorBlockOffset(pos, paraOffsets)
        }

        // Fallback: extract text lines if no paragraphs found in p tags
        if (paragraphs.length === 0) {
          const bodyMatch = htmlContent.match(/<body[^>]*>(.*?)<\/body>/is)
          if (bodyMatch) {
            const bodyText = bodyMatch[1]
              .replace(/<[^>]+>/g, '\n')
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
            paragraphs.push(...bodyText.map((text) => ({ type: 'paragraph' as const, text })))
          }
        }

        if (paragraphs.length > 0) {
          let cleanTitle = title
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()

          // Guarantee a unique title so the reader sidebar never shows two
          // identical entries (titles drive nothing functionally now, but
          // duplicates are confusing to read).
          if (usedTitles.has(cleanTitle)) {
            let suffix = 2
            while (usedTitles.has(`${cleanTitle} (${suffix})`)) suffix++
            cleanTitle = `${cleanTitle} (${suffix})`
          }
          usedTitles.add(cleanTitle)

          chapters.push({
            title: cleanTitle,
            paragraphs,
            href: normalizeHref(href),
          })
          chapterIndexByHref[normalizeHref(href)] = chapters.length - 1
          anchorParaByHref[normalizeHref(href)] = anchorMap
        }
      }

      if (chapters.length === 0) {
        return { success: false, error: 'No readable text content found in EPUB' }
      }

      // Build the hierarchical TOC for the sidebar. Each entry carries its nesting
      // level, the chapter index it jumps to, and the paragraph offset within that
      // chapter (resolved from the #anchor) so sub-entries land in the right place.
      const toc = tocEntries
        .map((e) => {
          const { chapterIndex, paragraphOffset } = resolveTocTarget(
            e,
            chapters,
            chapterIndexByHref,
            anchorParaByHref,
          )
          return {
            title: e.title,
            level: e.level,
            chapterIndex,
            paragraphOffset,
          }
        })
        .filter((e) => typeof e.chapterIndex === 'number')

      return { success: true, chapters, toc }
    } else if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(absolutePath)
      const parser = new PDFParse({ data: dataBuffer })
      const result = await parser.getText()
      const rawText = result.text

      // Split pages by "-- Page of Total --"
      const pageSeparatorRegex = /--\s*\d+\s*of\s*\d+\s*--/g
      const rawPages = rawText.split(pageSeparatorRegex)

      const chapters: { title: string; paragraphs: string[] }[] = []
      let pageNum = 0
      for (let i = 0; i < rawPages.length; i++) {
        const pageText = rawPages[i].trim()
        if (!pageText && i === 0) continue
        pageNum++

        const paragraphs = pageText
          .split(/\r?\n/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0)

        if (paragraphs.length > 0) {
          chapters.push({
            title: `Page ${pageNum}`,
            paragraphs,
          })
        }
      }

      if (chapters.length === 0) {
        return { success: false, error: 'No readable text content found in PDF' }
      }

      return { success: true, chapters }
    } else if (ext === '.docx') {
      const zip = new AdmZip(absolutePath)
      const docEntry = zip.getEntry('word/document.xml')
      if (!docEntry) {
        return { success: false, error: 'Invalid DOCX: word/document.xml missing' }
      }
      const docXml = docEntry.getData().toString('utf8')

      const chapters: { title: string; paragraphs: string[] }[] = []
      let currentChapter = { title: 'Document Content', paragraphs: [] as string[] }

      // We can find all <w:p>...</w:p>
      const pRegex = /<w:p[^>]*>(.*?)<\/w:p>/gs
      let pMatch
      while ((pMatch = pRegex.exec(docXml)) !== null) {
        const pContent = pMatch[1]
        // Extract all <w:t>...</w:t> inside this paragraph
        const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g
        let tMatch
        let pText = ''
        while ((tMatch = tRegex.exec(pContent)) !== null) {
          pText += tMatch[1]
        }
        pText = pText.trim()
        if (pText) {
          const chapterTitleRegex = /^(第[一二三四五六七八九十百千\d]+章|Chapter\s+\d+|#\s+)/i
          if (chapterTitleRegex.test(pText) && pText.length < 100) {
            if (currentChapter.paragraphs.length > 0) {
              chapters.push(currentChapter)
            }
            currentChapter = { title: pText, paragraphs: [] }
          } else {
            currentChapter.paragraphs.push(pText)
          }
        }
      }

      if (currentChapter.paragraphs.length > 0) {
        chapters.push(currentChapter)
      }

      if (chapters.length === 0) {
        return { success: false, error: 'No readable text content found in DOCX' }
      }

      return { success: true, chapters }
    } else {
      return { success: false, error: 'Unsupported format for in-app reading' }
    }
  } catch (error: any) {
    console.error('Failed to parse book content:', error)
    return { success: false, error: error.message }
  }
})

// IPC Handlers: Get Book File Buffer (for in-app PDF viewer)
ipcMain.handle('book:get-buffer', async (_, relativePath: string) => {
  try {
    const absolutePath = path.join(BASE_DIR, 'users', activeUserId, 'files', relativePath)
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: 'Book file not found' }
    }
    const dataBuffer = fs.readFileSync(absolutePath)
    return { success: true, data: dataBuffer }
  } catch (error: any) {
    console.error('Failed to read book buffer:', error)
    return { success: false, error: error.message }
  }
})

// IPC Handlers: Note Exporter (Markdown, HTML, Word, PDF, Text)
ipcMain.handle('note:export', async (event, { title, content, htmlContent, format }) => {
  try {
    let defaultExtension = 'md'
    let filters = []

    switch (format) {
      case 'md':
        defaultExtension = 'md'
        filters = [{ name: 'Markdown File', extensions: ['md'] }]
        break
      case 'html':
        defaultExtension = 'html'
        filters = [{ name: 'HTML File', extensions: ['html'] }]
        break
      case 'doc':
        defaultExtension = 'doc'
        filters = [{ name: 'Word Document', extensions: ['doc'] }]
        break
      case 'pdf':
        defaultExtension = 'pdf'
        filters = [{ name: 'PDF Document', extensions: ['pdf'] }]
        break
      case 'txt':
        defaultExtension = 'txt'
        filters = [{ name: 'Text File', extensions: ['txt'] }]
        break
      default:
        defaultExtension = 'md'
        filters = [{ name: 'All Files', extensions: ['*'] }]
    }

    // Sanitize title for filename
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '') || 'note'
    const defaultPath = path.join(app.getPath('downloads'), `${safeTitle}.${defaultExtension}`)

    const { filePath, canceled } = await dialog.showSaveDialog(
      BrowserWindow.fromWebContents(event.sender) || mainWindow!,
      {
        title: '导出笔记',
        defaultPath,
        filters,
      },
    )

    if (canceled || !filePath) {
      return { success: false, error: 'Canceled' }
    }

    // Prepare full HTML wrapper with some styling for HTML/PDF/DOC formats
    const styledHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
          }
          h1, h2, h3, h4, h5, h6 {
            color: #111;
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
          }
          h1 { font-size: 2.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
          h2 { font-size: 1.8em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
          h3 { font-size: 1.4em; }
          h4 { font-size: 1.1em; }
          p, blockquote, ul, ol, dl, table, pre { margin-top: 0; margin-bottom: 16px; }
          code {
            padding: 0.2em 0.4em;
            margin: 0;
            font-size: 85%;
            background-color: rgba(27,31,35,0.05);
            border-radius: 3px;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
          }
          pre {
            padding: 16px;
            overflow: auto;
            font-size: 85%;
            line-height: 1.45;
            background-color: #f6f8fa;
            border-radius: 3px;
          }
          pre code {
            background-color: transparent;
            padding: 0;
          }
          blockquote {
            padding: 0 1em;
            color: #6a737d;
            border-left: 0.25em solid #dfe2e5;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin-bottom: 16px;
          }
          table th, table td {
            padding: 6px 13px;
            border: 1px solid #dfe2e5;
          }
          table tr:nth-child(even) {
            background-color: #f6f8fa;
          }
          img {
            max-width: 100%;
            box-sizing: content-box;
          }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <div>${htmlContent || ''}</div>
      </body>
      </html>
    `

    if (format === 'md') {
      await fs.promises.writeFile(filePath, content, 'utf-8')
    } else if (format === 'txt') {
      // Simple text export (we could also strip markdown formatting, but saving the raw string is standard)
      await fs.promises.writeFile(filePath, content, 'utf-8')
    } else if (format === 'html') {
      await fs.promises.writeFile(filePath, styledHtml, 'utf-8')
    } else if (format === 'doc') {
      // Microsoft Word can read HTML files containing images and tables directly if named with .doc
      // Add MS Word specific XML namespaces/metadata so it fits standard page settings
      const docHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <xml>
            <w:WordDocument>
              <w:View>Print</w:View>
              <w:Zoom>100</w:Zoom>
            </w:WordDocument>
          </xml>
          <style>
            @page Section1 {
              size: 8.5in 11.0in;
              margin: 1.0in 1.25in 1.0in 1.25in;
              mso-header-margin: .5in;
              mso-footer-margin: .5in;
              mso-paper-source: 0;
            }
            div.Section1 {
              page: Section1;
            }
            body {
              font-family: "Calibri", "Arial", sans-serif;
            }
          </style>
        </head>
        <body>
          <div class="Section1">
            <h1>${title}</h1>
            <div>${htmlContent || ''}</div>
          </div>
        </body>
        </html>
      `
      await fs.promises.writeFile(filePath, docHtml, 'utf-8')
    } else if (format === 'pdf') {
      const win = new BrowserWindow({ show: false })
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(styledHtml))
      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: {
          marginType: 'default',
        },
      })
      await fs.promises.writeFile(filePath, pdfBuffer)
      win.destroy()
    }

    return { success: true, filePath }
  } catch (err: any) {
    console.error('Export error:', err)
    return { success: false, error: err.message }
  }
})

// IPC Handlers: Dynamic SQL Queries
ipcMain.handle('db:query', async (_, { dbName, sql, params = [] }) => {
  try {
    const directAccessError = getDirectDbAccessError(dbName)
    if (directAccessError) {
      return {
        success: false,
        error: directAccessError,
      }
    }
    const db = getUserDb(dbName)
    const normalizedSql = sql.trim().toLowerCase()

    if (normalizedSql.startsWith('select')) {
      const stmt = db.prepare(sql)
      return { success: true, data: stmt.all(...params) }
    } else {
      const stmt = db.prepare(sql)
      const res = stmt.run(...params)
      if (dbName === 'tasks') emitTaskDataChanged('query')
      return { success: true, data: res }
    }
  } catch (err: any) {
    console.error(`DB Error (${dbName}):`, err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('db:transaction', async (_, { dbName, statements }) => {
  try {
    const directAccessError = getDirectDbAccessError(dbName)
    if (directAccessError) {
      return {
        success: false,
        error: directAccessError,
      }
    }
    const db = getUserDb(dbName)
    const data = runDbTransaction(db, statements)
    if (dbName === 'tasks') emitTaskDataChanged('transaction')
    return { success: true, data }
  } catch (err: any) {
    console.error(`DB Transaction Error (${dbName}):`, err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('tasks:runScheduler', async () => {
  try {
    return { success: true, data: runSchedulerCycle({ notify: false }) }
  } catch (err: any) {
    console.error('Task scheduler manual run error:', err)
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('desktopTaskNote:getSettings', async () => getDesktopTaskNoteSettings())

ipcMain.handle('desktopTaskNote:show', async () => {
  createDesktopTaskNoteWindow().show()
  return { success: true }
})

ipcMain.handle('desktopTaskNote:hide', async () => {
  if (desktopTaskNoteWindow && !desktopTaskNoteWindow.isDestroyed()) desktopTaskNoteWindow.hide()
  return { success: true }
})

ipcMain.handle('desktopTaskNote:openMainWindow', async () => {
  showMainWindow()
  return { success: true }
})

ipcMain.handle(
  'desktopTaskNote:setSettings',
  async (_, patch: { opacity?: number; alwaysOnTop?: boolean }) => {
    const noteSettings = getDesktopTaskNoteSettings()
    const opacity = Math.min(1, Math.max(0.35, Number(patch.opacity ?? noteSettings.opacity)))
    const alwaysOnTop = patch.alwaysOnTop ?? noteSettings.alwaysOnTop
    if (desktopTaskNoteWindow && !desktopTaskNoteWindow.isDestroyed()) {
      desktopTaskNoteWindow.setOpacity(opacity)
      desktopTaskNoteWindow.setAlwaysOnTop(alwaysOnTop)
    }
    saveDesktopTaskNoteSettings({ opacity, alwaysOnTop })
    return { success: true, data: { opacity, alwaysOnTop } }
  },
)

registerAIConfigIpc(
  { handle: (channel, handler) => ipcMain.handle(channel, handler) },
  {
    getDb: () => getUserDb('ai'),
    getCredentialFilePath: () =>
      path.join(BASE_DIR, 'users', activeUserId, 'config', 'ai-credentials.json'),
    getCredentialCryptoAdapter: createSafeStorageCredentialAdapter,
    onMcpChanged: async (id, change) => {
      if (!aiMcpManager) return
      await aiMcpManager.disconnect(id, { recordStatus: change !== 'deleted' })
    },
  },
)

registerAIRuntimeIpc(
  { handle: (channel, handler) => ipcMain.handle(channel, handler) },
  { getRuntime: getAIAgentRuntime },
)

registerAIImageIpc(
  { handle: (channel, handler) => ipcMain.handle(channel, handler) },
  {
    getService: getAIImageGenerationService,
    isConversationActive: (conversationId) =>
      getAIAgentRuntime().isConversationActive(conversationId),
    createAbortScope: () => {
      const controller = new AbortController()
      aiImageControllers.add(controller)
      return {
        signal: controller.signal,
        abort: () => controller.abort(),
        dispose: () => aiImageControllers.delete(controller),
      }
    },
  },
)

registerAIVideoIpc(
  { handle: (channel, handler) => ipcMain.handle(channel, handler) },
  {
    getService: getAIVideoAssetService,
    isConversationActive: (conversationId) =>
      getAIAgentRuntime().isConversationActive(conversationId),
    createAbortScope: () => {
      const controller = new AbortController()
      aiVideoControllers.add(controller)
      return {
        signal: controller.signal,
        abort: () => controller.abort(),
        dispose: () => aiVideoControllers.delete(controller),
      }
    },
  },
)

registerAIStorageIpc(
  { handle: (channel, handler) => ipcMain.handle(channel, handler) },
  { getService: getAIStorageService },
)

registerAIConversationIpc(
  { handle: (channel, handler) => ipcMain.handle(channel, handler) },
  {
    getDb: () => getUserDb('ai'),
    getRuntime: getAIAgentRuntime,
    deleteConversation: async (id, deleteUnreferencedMedia) => {
      if (!deleteUnreferencedMedia)
        return new AIConversationService(getUserDb('ai')).deleteConversation(id)
      const storage = getAIStorageService()
      const preview = await storage.previewCleanup({ scope: 'conversation', conversationId: id })
      return storage.cleanup({
        scope: 'conversation',
        conversationId: id,
        planHash: preview.planHash,
      })
    },
  },
)

registerAIMcpRuntimeIpc(
  { handle: (channel, handler) => ipcMain.handle(channel, handler) },
  { getManager: getAIMcpManager },
)

// IPC Handlers: Encrypted password vault
ipcMain.handle('vault:status', async () => runVaultAction(() => getVaultService().getStatus()))

ipcMain.handle('vault:setup', async (_, masterPassword: string) =>
  runVaultAction(() => getVaultService().setup(masterPassword)),
)

ipcMain.handle('vault:unlock', async (_, masterPassword: string) =>
  runVaultAction(() => getVaultService().unlock(masterPassword)),
)

ipcMain.handle('vault:migrateLegacy', async (_, masterPassword: string) =>
  runVaultAction(() => getVaultService().migrateLegacy(masterPassword)),
)

ipcMain.handle('vault:lock', async () => runVaultAction(() => getVaultService().lock()))

ipcMain.handle('vault:list', async () => runVaultAction(() => getVaultService().listCredentials()))

ipcMain.handle('vault:create', async (_, input) =>
  runVaultAction(() => getVaultService().createCredential(input)),
)

ipcMain.handle('vault:reveal', async (_, id: number) =>
  runVaultAction(() => getVaultService().revealCredential(id)),
)

ipcMain.handle('vault:delete', async (_, id: number) =>
  runVaultAction(() => getVaultService().deleteCredential(id)),
)

// IPC Handlers: Video downloader
ipcMain.handle('video:checkTools', async () => {
  return checkVideoTools(getVideoToolSettings())
})

ipcMain.handle('video:getEngineStatus', async () => {
  return videoEngineStatus
})

ipcMain.handle('video:loadEngine', async () => {
  return loadVideoEngine({ force: true })
})

ipcMain.handle('video:loginBilibili', async () => {
  return startBilibiliAccountLogin()
})

ipcMain.handle('video:getBilibiliAuthStatus', async () => {
  return getBilibiliAuthStatus()
})

ipcMain.handle('video:loginDouyin', async () => {
  return startDouyinAccountLogin()
})

ipcMain.handle('video:getDouyinAuthStatus', async () => {
  return getDouyinAuthStatus()
})

ipcMain.handle('video:logoutDouyin', async () => {
  return logoutDouyinAccount()
})

ipcMain.handle('video:syncDouyinFavorites', async () => {
  if (douyinSyncInFlight) return douyinSyncInFlight
  const syncPromise = synchronizeDouyinFavorites()
  douyinSyncInFlight = syncPromise
  try {
    return await syncPromise
  } finally {
    if (douyinSyncInFlight === syncPromise) douyinSyncInFlight = null
  }
})

ipcMain.handle('video:listDouyinFavoriteFolders', async () => {
  return { success: true, data: listDouyinFavoriteFolders(getUserDb('videos')) }
})

ipcMain.handle('video:getDouyinSyncStatus', async () => {
  return {
    success: true,
    data: getDouyinAccountSyncStatus(getUserDb('videos'), getDouyinLoginPartition(activeUserId)),
  }
})

ipcMain.handle('video:listDouyinFavoriteItems', async (_, folderId: unknown, options?: unknown) => {
  const showAll = folderId === null
  const normalizedFolderId = Number(folderId)
  if (!showAll && (!Number.isSafeInteger(normalizedFolderId) || normalizedFolderId <= 0)) {
    return { success: false, error: 'A valid Douyin favorite folder is required.' }
  }
  const input = options && typeof options === 'object' ? (options as Record<string, unknown>) : {}
  const normalizedOptions = {
    offset: Number.isFinite(Number(input.offset))
      ? Math.max(0, Math.floor(Number(input.offset)))
      : 0,
    limit: Number.isFinite(Number(input.limit))
      ? Math.min(200, Math.max(1, Math.floor(Number(input.limit))))
      : 100,
    query: typeof input.query === 'string' ? input.query.trim().slice(0, 200) : '',
    contentType:
      input.contentType === 'video' || input.contentType === 'note' || input.contentType === 'unknown'
        ? input.contentType
        : undefined,
  }
  return {
    success: true,
    data: listDouyinFavoriteItems(getUserDb('videos'), showAll ? null : normalizedFolderId, normalizedOptions),
  }
})

ipcMain.handle('video:deleteDouyinFavoriteItems', async (_, itemIds: unknown) => {
  if (!Array.isArray(itemIds)) return { success: false, error: 'Video IDs are required.' }
  try {
    const db = getUserDb('videos')
    const normalizedIds = itemIds.map(Number)
    removeDouyinFavoriteFiles(db, normalizedIds)
    return { success: true, data: deleteDouyinFavoriteItems(db, normalizedIds) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('video:clearDouyinFavoriteItems', async () => {
  try {
    const db = getUserDb('videos')
    removeDouyinFavoriteFiles(db)
    return { success: true, data: clearDouyinFavoriteItems(db) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('video:downloadDouyinFavorite', async (_, itemId: unknown) => {
  if (!isVideoEngineReady(videoEngineStatus)) {
    if (videoEngineStatus.status === 'idle') void loadVideoEngine()
    throw new Error(videoEngineStatus.message || 'Video download plugin is loading.')
  }
  const normalizedItemId = Number(itemId)
  if (!Number.isSafeInteger(normalizedItemId) || normalizedItemId <= 0) {
    return { success: false, error: 'A valid Douyin favorite video is required.' }
  }
  const db = getUserDb('videos')
  const item = getDouyinFavoriteItem(db, normalizedItemId)
  if (!item) return { success: false, error: 'The Douyin favorite video no longer exists.' }
  if (!canDownloadDouyinFavorite(item)) {
    return { success: false, error: 'Only Douyin video favorites can be downloaded.' }
  }
  if (item.download_status === 'downloading') {
    return { success: false, error: 'This Douyin video is already downloading.' }
  }

  const cookieFile = await writeDouyinCookieFile()
  const updateProgress = (progress: number, message?: string) => {
    updateDouyinFavoriteDownloadState(db, normalizedItemId, {
      status: 'downloading',
      progress,
    })
    mainWindow?.webContents.send('video:douyin-download-progress', {
      itemId: normalizedItemId,
      progress,
      message,
      phase: 'downloading',
    })
  }
  try {
    updateDouyinFavoriteDownloadState(db, normalizedItemId, {
      status: 'downloading',
      progress: 0,
      error: null,
    })
    const result = await startVideoDownload({
      settings: {
        ...getVideoToolSettings(),
        cookieMode: 'douyin',
        douyinCookiesPath: cookieFile.filePath,
      },
      mainWindow,
      url: item.source_url,
      title: item.title,
      videoId: normalizedItemId,
      source: 'douyin',
      durationSeconds: item.duration_seconds,
      outputDir: getActiveUserVideoDir(),
      onProgress: updateProgress,
      onFinished: async (filePath) => {
        try {
          let durationSeconds = item.duration_seconds
          if (filePath) {
            try {
              durationSeconds = await probeVideoDurationSeconds(getVideoToolSettings(), filePath)
            } catch (error) {
              console.warn('[DouyinDownload] failed to probe downloaded duration', error)
            }
          }
          updateDouyinFavoriteDownloadState(db, normalizedItemId, {
            status: 'downloaded',
            progress: 100,
            localPath: filePath || null,
            error: null,
          })
          mainWindow?.webContents.send('video:douyin-download-finished', {
            itemId: normalizedItemId,
            filePath,
            durationSeconds,
          })
        } finally {
          cookieFile.cleanup()
        }
      },
      onFailed: (message) => {
        updateDouyinFavoriteDownloadState(db, normalizedItemId, {
          status: 'failed',
          progress: 0,
          error: message,
        })
        cookieFile.cleanup()
        mainWindow?.webContents.send('video:douyin-download-failed', {
          itemId: normalizedItemId,
          message,
        })
      },
    })
    return result
  } catch (error) {
    cookieFile.cleanup()
    updateDouyinFavoriteDownloadState(db, normalizedItemId, {
      status: 'failed',
      progress: 0,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
})

ipcMain.handle('video:getCookieAccessStatus', async (_, url: string) => {
  return getVideoCookieAccessStatus(getVideoToolSettings(), url)
})

ipcMain.handle('video:parseUrl', async (_, url: string) => {
  return parseVideoUrl(getVideoToolSettings(), url)
})

ipcMain.handle('video:bulkUpdateTags', async (_, payload: any) => {
  const normalized = normalizeBulkVideoTagPayload(payload || {})
  if (!normalized.success) return { success: false, error: normalized.error }

  try {
    const db = getUserDb('videos')
    const insertTag = db.prepare('INSERT OR IGNORE INTO video_tags (name) VALUES (?)')
    const selectTag = db.prepare('SELECT id FROM video_tags WHERE name = ?')
    const linkTag = db.prepare(
      'INSERT OR IGNORE INTO video_tag_links (video_id, tag_id) VALUES (?, ?)',
    )
    const unlinkTag = db.prepare('DELETE FROM video_tag_links WHERE video_id = ? AND tag_id = ?')

    const updateTags = db.transaction(
      (videoIds: number[], tagNames: string[], mode: 'add' | 'remove') => {
        for (const tagName of tagNames) {
          if (mode === 'add') insertTag.run(tagName)
          const tag = selectTag.get(tagName) as { id?: number } | undefined
          const tagId = Number(tag?.id)
          if (!tagId) {
            if (mode === 'remove') continue
            throw new Error(`Unable to resolve tag: ${tagName}`)
          }
          for (const videoId of videoIds) {
            if (mode === 'add') linkTag.run(videoId, tagId)
            else unlinkTag.run(videoId, tagId)
          }
        }
      },
    )

    updateTags(normalized.videoIds, normalized.tagNames, normalized.mode)
    return { success: true }
  } catch (err: any) {
    console.error('Video bulk tag update error:', err)
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('video:download', async (_, videoData: any) => {
  if (!isVideoEngineReady(videoEngineStatus)) {
    if (videoEngineStatus.status === 'idle') void loadVideoEngine()
    throw new Error(videoEngineStatus.message || 'Video download plugin is loading.')
  }
  return startVideoDownload({
    settings: getVideoToolSettings(),
    mainWindow,
    url: videoData.sourceUrl || videoData.url,
    title: videoData.title,
    videoId: videoData.id,
    source: videoData.source,
    sourceCid: videoData.sourceCid || videoData.source_cid,
    durationSeconds: videoData.durationSeconds || videoData.duration_seconds,
    outputDir: getActiveUserVideoDir(),
    onProgress: async (progress) => {
      if (!videoData.id || typeof progress !== 'number') return
      const db = getUserDb('videos')
      db.prepare(
        `
        UPDATE videos
        SET status = 'downloading',
            download_progress = ?,
            download_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      ).run(progress, videoData.id)
    },
    onFinished: async (filePath) => {
      if (!videoData.id || !filePath) return
      const durationSeconds = await probeVideoDurationSeconds(getVideoToolSettings(), filePath)
      const durationLabel = durationSeconds ? formatDurationSeconds(durationSeconds) : null
      const db = getUserDb('videos')
      db.prepare(
        `
        UPDATE videos
        SET status = 'downloaded',
            local_path = ?,
            path = ?,
            duration = COALESCE(duration, ?),
            duration_seconds = COALESCE(duration_seconds, ?),
            download_progress = 100,
            downloaded_at = CURRENT_TIMESTAMP,
            download_error = NULL,
            invalid_reason = NULL,
            diagnostic_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      ).run(filePath, filePath, durationLabel, durationSeconds || null, videoData.id)
    },
    onFailed: (message) => {
      if (!videoData.id) return
      const failure = classifyVideoDownloadFailure(message)
      const db = getUserDb('videos')
      db.prepare(
        `
        UPDATE videos
        SET status = ?,
            download_error = ?,
            invalid_reason = ?,
            diagnostic_message = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      ).run(
        failure.status,
        failure.downloadError,
        failure.invalidReason,
        failure.downloadError,
        videoData.id,
      )
    },
  })
})

ipcMain.handle('video:installTool', async (_, tool: 'yt-dlp' | 'ffmpeg') => {
  try {
    const result = await installManagedVideoTool(getVideoToolSettings(), tool)
    const tools = await checkVideoTools(getVideoToolSettings())
    videoEngineStatus = deriveVideoEngineStatus(tools)
    emitVideoEngineStatus()
    return { success: true, data: result, tools }
  } catch (err: any) {
    return { success: false, error: err.message || String(err) }
  }
})

ipcMain.handle('video:verifyCookieAccess', async () => {
  return verifyVideoCookieAccess(getVideoToolSettings())
})

ipcMain.handle('video:selectDownloadDir', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getActiveUserVideoDir(),
  })
  if (canceled || !filePaths[0]) return { success: false }
  return { success: true, path: filePaths[0] }
})

ipcMain.handle('video:getPlaybackUrl', async (_, localPath: string) => {
  return resolvePlaybackPath(getActiveUserVideoDir(), localPath)
})

// Auto-Updater Config & IPC Bindings
function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update:not-available')
  })

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:error', err?.message || 'Unknown update error')
  })

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('update:download-progress', {
      percent: Math.round(progressObj.percent),
      bytesPerSecond: progressObj.bytesPerSecond,
      transferred: progressObj.transferred,
      total: progressObj.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:downloaded', {
      version: info.version,
    })
  })
}

ipcMain.handle('app:version', () => {
  return app.getVersion()
})

ipcMain.handle('app:check-for-updates', async (_, isAutoCheck?: boolean) => {
  const isDev = process.env.VITE_DEV_SERVER_URL !== undefined || !app.isPackaged
  if (isDev) {
    if (isAutoCheck) {
      console.log('Auto update check skipped in dev mode')
      return { success: true, skipped: true }
    }
    mainWindow?.webContents.send('update:checking')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    mainWindow?.webContents.send('update:available', {
      version: '1.1.0',
      releaseNotes:
        '### 🚀 新特性\n- 新增了应用自动更新功能，从此告别手动下载！\n- 优化的系统设置菜单，增加了“系统更新”模块。\n- 修复了一些已知的性能和样式微调问题。\n\n### 🛠 修复与改进\n- 改进了 SQLite 在多账户环境下的稳定性。\n- 修复了 macOS 无边框窗口控制按钮重叠问题。',
      releaseDate: new Date().toISOString(),
    })
    return { success: true, isMock: true }
  } else {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, result }
    } catch (err) {
      const error = err as Error
      console.error('Check for updates error:', error)
      mainWindow?.webContents.send('update:error', error.message || 'Failed to check updates')
      return { success: false, error: error.message }
    }
  }
})

ipcMain.handle('app:download-update', async () => {
  const isDev = process.env.VITE_DEV_SERVER_URL !== undefined || !app.isPackaged
  if (isDev) {
    let percent = 0
    const interval = setInterval(() => {
      percent += Math.floor(Math.random() * 20) + 5
      if (percent >= 100) {
        percent = 100
        clearInterval(interval)
        mainWindow?.webContents.send('update:download-progress', {
          percent: 100,
          bytesPerSecond: 1024 * 1024 * 2.5,
          transferred: 50 * 1024 * 1024,
          total: 50 * 1024 * 1024,
        })
        mainWindow?.webContents.send('update:downloaded', { version: '1.1.0' })
      } else {
        mainWindow?.webContents.send('update:download-progress', {
          percent,
          bytesPerSecond: 1024 * 1024 * 1.5,
          transferred: Math.round((percent / 100) * 50 * 1024 * 1024),
          total: 50 * 1024 * 1024,
        })
      }
    }, 600)
    return { success: true, isMock: true }
  } else {
    try {
      const result = await autoUpdater.downloadUpdate()
      return { success: true, result }
    } catch (err) {
      const error = err as Error
      console.error('Download update error:', error)
      mainWindow?.webContents.send('update:error', error.message || 'Failed to download update')
      return { success: false, error: error.message }
    }
  }
})

ipcMain.handle('app:install-update', () => {
  const isDev = process.env.VITE_DEV_SERVER_URL !== undefined || !app.isPackaged
  if (isDev) {
    console.log('App install update mock triggered. App would restart here in production.')
    return { success: true, isMock: true }
  } else {
    try {
      autoUpdater.quitAndInstall()
      return { success: true }
    } catch (err) {
      const error = err as Error
      console.error('Install update error:', error)
      return { success: false, error: error.message }
    }
  }
})

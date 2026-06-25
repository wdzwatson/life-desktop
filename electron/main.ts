import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from './db/schema'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { autoUpdater } from 'electron-updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Helper for hashing passwords securely using PBKDF2
function hashPassword(password: string, salt?: string) {
  const currentSalt = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, currentSalt, 1000, 64, 'sha512').toString('hex')
  return { salt: currentSalt, hash }
}

// Keep global references
let mainWindow: BrowserWindow | null = null
let activeUserId = 'guest'
let openDbs: Map<string, any> = new Map() // dbName -> Database instance
let schedulerInterval: NodeJS.Timeout | null = null

// Default Paths
const BASE_DIR = path.join(app.getPath('home'), 'LifeOS')
const CONFIG_DIR = path.join(BASE_DIR, 'config')
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json')

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
  } catch (err) {
    return {}
  }
}

function saveSettings(settings: any) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  return settings
}

// Close and clear all open databases
function closeUserDbs() {
  for (const [name, db] of openDbs.entries()) {
    try {
      db.close()
    } catch (e) {}
  }
  openDbs.clear()
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

  // Scan every minute
  schedulerInterval = setInterval(() => {
    try {
      runSchedulerCycle()
    } catch (err) {
      console.error('Scheduler error:', err)
    }
  }, 60000)
}

function runSchedulerCycle() {
  const db = getUserDb('tasks')
  const now = new Date()
  const currentYMD = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const currentHM = now.toTimeString().slice(0, 5) // HH:MM
  const dayOfWeek = now.getDay() // 0-6 (Sun-Sat)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

  // 1. Scan recurring rules and auto-generate tasks
  const rules = db.prepare('SELECT * FROM recurring_rules').all() as any[]

  rules.forEach((rule) => {
    let shouldTrigger = false

    // Check execution policies
    if (rule.frequency === 'daily') {
      shouldTrigger = true
    } else if (rule.frequency === 'weekday' && !isWeekend) {
      shouldTrigger = true
    } else if (rule.frequency === 'weekly') {
      const days = (rule.week_days || '').split(',').map((x: string) => parseInt(x))
      // JS: 0=Sun, 1=Mon... In our visual builder: 1=Mon, 7=Sun
      const adjustedJSWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek
      if (days.includes(adjustedJSWeekDay)) {
        shouldTrigger = true
      }
    } else if (rule.frequency === 'monthly') {
      const days = (rule.month_days || '').split(',').map((x: string) => parseInt(x))
      const dateNum = now.getDate()
      if (days.includes(dateNum)) {
        shouldTrigger = true
      }
    }

    // Evaluate if trigger matches local time hour/minute
    if (shouldTrigger) {
      // Find last trigger date to prevent double triggers on the same day
      const lastTriggerYMD = rule.last_trigger_time ? rule.last_trigger_time.slice(0, 10) : ''
      if (lastTriggerYMD !== currentYMD) {
        // Generate task
        const title = rule.title
        const desc = rule.description || '由周期规则自动生成'

        db.prepare(
          `
          INSERT INTO tasks (title, description, priority, status, due_date, recur_rule_id, progress)
          VALUES (?, ?, 'mid', '待处理', ?, ?, 0)
        `,
        ).run(title, desc, currentYMD, rule.id)

        db.prepare('UPDATE recurring_rules SET last_trigger_time = ? WHERE id = ?').run(
          now.toISOString(),
          rule.id,
        )

        // Push notification in active window
        if (mainWindow) {
          mainWindow.webContents.send('scheduler:notif', {
            title: `任务已自动生成`,
            body: title,
          })
        }
      }
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
    if (mainWindow) {
      mainWindow.webContents.send('scheduler:overdue', {
        taskId: task.id,
        title: task.title,
      })
    }
  })
}

// Electron window creation
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
    frame: false, // Custom frameless title bar
    titleBarStyle: 'hidden',
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

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  setupAutoUpdater()
  startScheduler()
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  closeUserDbs()
  if (schedulerInterval) clearInterval(schedulerInterval)
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// IPC Handlers: Custom Frameless Window Controls
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.on('window:close', () => {
  mainWindow?.close()
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
    if (profile.sessionValid && (now - lastActive < FIFTEEN_DAYS)) {
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
  return saveSettings(newSettings)
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

ipcMain.on('fs:reveal', (_, filePath: string) => {
  // Safe reveal in finder
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath)
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
    const db = getUserDb(dbName)
    const normalizedSql = sql.trim().toLowerCase()

    if (normalizedSql.startsWith('select')) {
      const stmt = db.prepare(sql)
      return { success: true, data: stmt.all(...params) }
    } else {
      const stmt = db.prepare(sql)
      const res = stmt.run(...params)
      return { success: true, data: res }
    }
  } catch (err: any) {
    console.error(`DB Error (${dbName}):`, err)
    return { success: false, error: err.message }
  }
})

// IPC Handlers: Video downloader (Mock/Yt-Dlp interface)
ipcMain.handle('video:parseUrl', async (_, url: string) => {
  // In a real application, we would call: yt-dlp -J <url>
  // Here we mock the playlist resolution forBilbili/Youtube lists to show the多选popup
  if (url.includes('list') || url.includes('series') || url.includes('p=')) {
    return {
      isPlaylist: true,
      title: '合集: Electron 进阶系列教程',
      videos: [
        { id: '1', title: '1. Electron 无边框窗口与自定义标题栏', duration: '12:40' },
        { id: '2', title: '2. SQLite WAL模式配置与数据结构', duration: '18:15' },
        { id: '3', title: '3. Preload 桥接安全最佳实践', duration: '14:22' },
        { id: '4', title: '4. electron-builder 跨平台打包优化', duration: '22:10' },
      ],
    }
  }
  return {
    isPlaylist: false,
    title: '单个视频: SQLite FTS 全文检索实战',
    duration: '15:30',
  }
})

// Concurrent download queue runner (Simulating yt-dlp triggers and progress bars)
ipcMain.handle('video:download', async (_, videoData: any) => {
  const { title } = videoData

  // Simulate download chunks progress
  let progress = 0
  const interval = setInterval(() => {
    progress += Math.floor(Math.random() * 15) + 5
    if (progress >= 100) {
      progress = 100
      clearInterval(interval)

      // Update SQLite videos.db status
      try {
        const db = getUserDb('videos')
        db.prepare(
          `
          INSERT INTO videos (title, url, status, priority)
          VALUES (?, ?, 'downloaded', 'low')
        `,
        ).run(title, 'http://mock-url')
      } catch (e) {}

      mainWindow?.webContents.send('video:download-finished', { title })
    } else {
      mainWindow?.webContents.send('video:download-progress', { title, progress })
    }
  }, 800)

  return { success: true, message: '下载已加入后台队列' }
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

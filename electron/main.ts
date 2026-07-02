import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from './db/schema'
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
  parseVideoUrl,
  resolvePlaybackPath,
  startVideoDownload,
} from './video/service'

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
const openDbs: Map<string, any> = new Map() // dbName -> Database instance
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
  } catch {
    return {}
  }
}

function saveSettings(settings: any) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  return settings
}

// Close and clear all open databases
function closeUserDbs() {
  for (const db of openDbs.values()) {
    try {
      db.close()
    } catch {
      // Ignore close failures while switching users; stale handles are cleared below.
    }
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

function getActiveUserVideoDir() {
  return path.join(BASE_DIR, 'users', activeUserId, 'files', 'videos')
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
          const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

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
          | { type: 'paragraph' | 'heading'; text: string; level?: number }
          | string
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

// IPC Handlers: Video downloader
ipcMain.handle('video:checkTools', async () => {
  return checkVideoTools(getSettings())
})

ipcMain.handle('video:parseUrl', async (_, url: string) => {
  return parseVideoUrl(getSettings(), url)
})

ipcMain.handle('video:download', async (_, videoData: any) => {
  return startVideoDownload({
    settings: getSettings(),
    mainWindow,
    url: videoData.sourceUrl || videoData.url,
    title: videoData.title,
    outputDir: getActiveUserVideoDir(),
  })
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

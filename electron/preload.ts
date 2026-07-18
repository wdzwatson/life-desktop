import { contextBridge, ipcRenderer } from 'electron'
import { getManagedVideoToolInstallSupport } from './video/toolSupport'

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMac: process.platform === 'darwin',
  platform: process.platform,
  managedVideoToolInstallSupport: getManagedVideoToolInstallSupport(),

  // User Authentication & Workspace Settings
  switchUser: (userId: string) => ipcRenderer.invoke('user:switch', userId),
  loginUser: (userId: string, password?: string) =>
    ipcRenderer.invoke('user:login', { userId, password }),
  registerUser: (userData: any) => ipcRenderer.invoke('user:register', userData),
  resetUserPassword: (data: any) => ipcRenderer.invoke('user:resetPassword', data),
  getUserProfileList: () => ipcRenderer.invoke('user:getProfileList'),
  updateUserProfile: (data: any) => ipcRenderer.invoke('user:updateProfile', data),
  getCurrentUser: () => ipcRenderer.invoke('user:getCurrent'),
  logoutUser: () => ipcRenderer.invoke('user:logout'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  clearAppData: () => ipcRenderer.invoke('settings:clearAppData'),
  selectBackupDirectory: () => ipcRenderer.invoke('backup:selectDirectory'),
  selectBackupFile: () => ipcRenderer.invoke('backup:selectFile'),
  inspectBackup: (filePath: string) => ipcRenderer.invoke('backup:inspect', { filePath }),
  createBackup: (outputDir: string) => ipcRenderer.invoke('backup:create', { outputDir }),
  restoreBackup: (filePath: string) => ipcRenderer.invoke('backup:restore', { filePath }),
  restartApp: () => ipcRenderer.invoke('app:restart'),
  revealInFinder: (filePath: string) => ipcRenderer.send('fs:reveal', filePath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Database IPC Bridge
  dbQuery: (dbName: string, sql: string, params?: any[]) =>
    ipcRenderer.invoke('db:query', { dbName, sql, params }),
  dbTransaction: (dbName: string, statements: Array<{ sql: string; params?: unknown[] }>) =>
    ipcRenderer.invoke('db:transaction', { dbName, statements }),

  // Encrypted password vault
  getVaultStatus: () => ipcRenderer.invoke('vault:status'),
  setupVault: (masterPassword: string) => ipcRenderer.invoke('vault:setup', masterPassword),
  unlockVault: (masterPassword: string) => ipcRenderer.invoke('vault:unlock', masterPassword),
  migrateLegacyVault: (masterPassword: string) =>
    ipcRenderer.invoke('vault:migrateLegacy', masterPassword),
  lockVault: () => ipcRenderer.invoke('vault:lock'),
  listVaultCredentials: () => ipcRenderer.invoke('vault:list'),
  createVaultCredential: (input: {
    websiteName: string
    url?: string
    username?: string
    password: string
    notes?: string
  }) => ipcRenderer.invoke('vault:create', input),
  revealVaultCredential: (id: number) => ipcRenderer.invoke('vault:reveal', id),
  deleteVaultCredential: (id: number) => ipcRenderer.invoke('vault:delete', id),

  // Note Export IPC Bridge
  exportNote: (data: { title: string; content: string; htmlContent: string; format: string }) =>
    ipcRenderer.invoke('note:export', data),

  selectBookFile: () => ipcRenderer.invoke('book:select-file'),
  deleteBookFile: (relativePath: string) => ipcRenderer.invoke('fs:delete-file', relativePath),
  openExternalFile: (relativePath: string) => ipcRenderer.invoke('fs:open-external', relativePath),
  getBookChapters: (relativePath: string) => ipcRenderer.invoke('book:get-chapters', relativePath),
  getBookBuffer: (relativePath: string) => ipcRenderer.invoke('book:get-buffer', relativePath),

  // Video parsing & downloading
  checkVideoTools: () => ipcRenderer.invoke('video:checkTools'),
  getVideoEngineStatus: () => ipcRenderer.invoke('video:getEngineStatus'),
  loadVideoEngine: () => ipcRenderer.invoke('video:loadEngine'),
  installVideoTool: (tool: 'yt-dlp' | 'ffmpeg') => ipcRenderer.invoke('video:installTool', tool),
  verifyVideoCookieAccess: () => ipcRenderer.invoke('video:verifyCookieAccess'),
  selectVideoDownloadDir: () => ipcRenderer.invoke('video:selectDownloadDir'),
  parseVideoUrl: (url: string) => ipcRenderer.invoke('video:parseUrl', url),
  bulkUpdateVideoTags: (payload: { videoIds: number[]; tagNames: string[]; mode: 'add' | 'remove' }) =>
    ipcRenderer.invoke('video:bulkUpdateTags', payload),
  startDownload: (videoData: any) => ipcRenderer.invoke('video:download', videoData),
  getVideoPlaybackUrl: (localPath: string) => ipcRenderer.invoke('video:getPlaybackUrl', localPath),
  onVideoEngineStatus: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on('video:engine-status', subscription)
    return () => {
      ipcRenderer.removeListener('video:engine-status', subscription)
    }
  },
  onDownloadProgress: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on('video:download-progress', subscription)
    return () => {
      ipcRenderer.removeListener('video:download-progress', subscription)
    }
  },
  onDownloadFinished: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on('video:download-finished', subscription)
    return () => {
      ipcRenderer.removeListener('video:download-finished', subscription)
    }
  },
  onDownloadFailed: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on('video:download-failed', subscription)
    return () => {
      ipcRenderer.removeListener('video:download-failed', subscription)
    }
  },

  // App version & updates
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: (isAutoCheck?: boolean) =>
    ipcRenderer.invoke('app:check-for-updates', isAutoCheck),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateChecking: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('update:checking', sub)
    return () => {
      ipcRenderer.removeListener('update:checking', sub)
    }
  },
  onUpdateAvailable: (callback: (info: unknown) => void) => {
    const sub = (_event: unknown, info: unknown) => callback(info)
    ipcRenderer.on('update:available', sub)
    return () => {
      ipcRenderer.removeListener('update:available', sub)
    }
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('update:not-available', sub)
    return () => {
      ipcRenderer.removeListener('update:not-available', sub)
    }
  },
  onUpdateProgress: (callback: (progress: unknown) => void) => {
    const sub = (_event: unknown, progress: unknown) => callback(progress)
    ipcRenderer.on('update:download-progress', sub)
    return () => {
      ipcRenderer.removeListener('update:download-progress', sub)
    }
  },
  onUpdateDownloaded: (callback: (info: unknown) => void) => {
    const sub = (_event: unknown, info: unknown) => callback(info)
    ipcRenderer.on('update:downloaded', sub)
    return () => {
      ipcRenderer.removeListener('update:downloaded', sub)
    }
  },
  onUpdateError: (callback: (err: unknown) => void) => {
    const sub = (_event: unknown, err: unknown) => callback(err)
    ipcRenderer.on('update:error', sub)
    return () => {
      ipcRenderer.removeListener('update:error', sub)
    }
  },
})

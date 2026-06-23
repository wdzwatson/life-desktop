import type { IpcRenderer } from 'electron'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMac: process.platform === 'darwin',

  // User Authentication & Workspace Settings
  switchUser: (userId: string) => ipcRenderer.invoke('user:switch', userId),
  loginUser: (userId: string, password?: string) =>
    ipcRenderer.invoke('user:login', { userId, password }),
  registerUser: (userData: any) => ipcRenderer.invoke('user:register', userData),
  resetUserPassword: (data: any) => ipcRenderer.invoke('user:resetPassword', data),
  getUserProfileList: () => ipcRenderer.invoke('user:getProfileList'),
  updateUserProfile: (data: any) => ipcRenderer.invoke('user:updateProfile', data),
  getCurrentUser: () => ipcRenderer.invoke('user:getCurrent'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  clearAppData: () => ipcRenderer.invoke('settings:clearAppData'),
  revealInFinder: (filePath: string) => ipcRenderer.send('fs:reveal', filePath),

  // Database IPC Bridge
  dbQuery: (dbName: string, sql: string, params?: any[]) =>
    ipcRenderer.invoke('db:query', { dbName, sql, params }),

  // Video parsing & downloading
  parseVideoUrl: (url: string) => ipcRenderer.invoke('video:parseUrl', url),
  startDownload: (videoData: any) => ipcRenderer.invoke('video:download', videoData),
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

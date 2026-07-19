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

  // AI configuration. Full credentials remain in the main process.
  listAIProviders: (filters?: unknown) => ipcRenderer.invoke('ai:providers:list', filters),
  getAIProvider: (id: number) => ipcRenderer.invoke('ai:providers:get', { id }),
  createAIProvider: (input: unknown) => ipcRenderer.invoke('ai:providers:create', input),
  updateAIProvider: (id: number, input: unknown, options?: { preserveHeaders?: boolean }) =>
    ipcRenderer.invoke('ai:providers:update', {
      id,
      input,
      preserveHeaders: options?.preserveHeaders,
    }),
  copyAIProvider: (id: number, name?: string) =>
    ipcRenderer.invoke('ai:providers:copy', { id, name }),
  setAIProviderEnabled: (id: number, enabled: boolean) =>
    ipcRenderer.invoke('ai:providers:setEnabled', { id, enabled }),
  setDefaultAIProvider: (id: number, capability: 'text' | 'image' | 'video') =>
    ipcRenderer.invoke('ai:providers:setDefault', { id, capability }),
  removeAIProviderCredential: (id: number) =>
    ipcRenderer.invoke('ai:providers:removeCredential', { id }),
  getAIProviderDependencies: (id: number) =>
    ipcRenderer.invoke('ai:providers:dependencies', { id }),
  deleteAIProvider: (id: number) => ipcRenderer.invoke('ai:providers:delete', { id }),
  listAIModels: () => ipcRenderer.invoke('ai:models:list'),
  createAIModel: (input: unknown) => ipcRenderer.invoke('ai:models:create', input),
  updateAIModel: (id: number, input: unknown) => ipcRenderer.invoke('ai:models:update', { id, input }),
  deleteAIModel: (id: number) => ipcRenderer.invoke('ai:models:delete', { id }),
  syncAIModels: () => ipcRenderer.invoke('ai:models:sync'),

  listAIAgents: () => ipcRenderer.invoke('ai:agents:list'),
  getAIAgent: (id: number) => ipcRenderer.invoke('ai:agents:get', { id }),
  createAIAgent: (input: unknown) => ipcRenderer.invoke('ai:agents:create', input),
  updateAIAgent: (id: number, input: unknown) =>
    ipcRenderer.invoke('ai:agents:update', { id, input }),
  copyAIAgent: (id: number, name?: string) => ipcRenderer.invoke('ai:agents:copy', { id, name }),
  setAIAgentEnabled: (id: number, enabled: boolean) =>
    ipcRenderer.invoke('ai:agents:setEnabled', { id, enabled }),
  setDefaultAIAgent: (id: number) => ipcRenderer.invoke('ai:agents:setDefault', { id }),
  getAIAgentSnapshot: (id: number) => ipcRenderer.invoke('ai:agents:snapshot', { id }),
  deleteAIAgent: (id: number) => ipcRenderer.invoke('ai:agents:delete', { id }),

  listAIMcpServers: () => ipcRenderer.invoke('ai:mcp:list'),
  getAIMcpServer: (id: number) => ipcRenderer.invoke('ai:mcp:get', { id }),
  createAIMcpServer: (input: unknown) => ipcRenderer.invoke('ai:mcp:create', input),
  updateAIMcpServer: (id: number, input: unknown, options?: { preserveCredentials?: boolean }) =>
    ipcRenderer.invoke('ai:mcp:update', {
      id,
      input,
      preserveCredentials: options?.preserveCredentials,
    }),
  copyAIMcpServer: (id: number, name?: string) => ipcRenderer.invoke('ai:mcp:copy', { id, name }),
  setAIMcpServerEnabled: (id: number, enabled: boolean) =>
    ipcRenderer.invoke('ai:mcp:setEnabled', { id, enabled }),
  setAIMcpToolRisk: (id: number, toolName: string, risk: string | null) =>
    ipcRenderer.invoke('ai:mcp:setRiskOverride', { id, toolName, risk }),
  getAIMcpDependencies: (id: number) => ipcRenderer.invoke('ai:mcp:dependencies', { id }),
  deleteAIMcpServer: (id: number) => ipcRenderer.invoke('ai:mcp:delete', { id }),
  connectAIMcpServer: (id: number, refresh = false) =>
    ipcRenderer.invoke('ai:mcpRuntime:connect', { id, refresh }),
  disconnectAIMcpServer: (id: number) => ipcRenderer.invoke('ai:mcpRuntime:disconnect', { id }),
  refreshAIMcpTools: (id: number) => ipcRenderer.invoke('ai:mcpRuntime:refreshTools', { id }),

  // AI conversation runtime. Events contain public run state only; credentials stay in main.
  startAIRun: (input: unknown) => ipcRenderer.invoke('ai:runs:start', input),
  cancelAIRun: (conversationId: number, runId?: number) =>
    ipcRenderer.invoke('ai:runs:cancel', { conversationId, runId }),
  approveAITool: (
    runId: number,
    toolCallId: string,
    decision: 'approve_once' | 'approve_session' | 'reject',
  ) => ipcRenderer.invoke('ai:runs:approveTool', { runId, toolCallId, decision }),
  generateAIImages: (input: unknown) => ipcRenderer.invoke('ai:images:generate', input),
  cancelAIImageGeneration: (conversationId: number) =>
    ipcRenderer.invoke('ai:images:cancel', { conversationId }),
  generateAIVideos: (input: unknown) => ipcRenderer.invoke('ai:videos:generate', input),
  cancelAIVideoGeneration: (conversationId: number) =>
    ipcRenderer.invoke('ai:videos:cancel', { conversationId }),
  getAIStorageUsage: () => ipcRenderer.invoke('ai:storage:usage'),
  previewAIStorageCleanup: (input: unknown) => ipcRenderer.invoke('ai:storage:previewCleanup', input),
  cleanAIStorage: (input: unknown) => ipcRenderer.invoke('ai:storage:cleanup', input),
  onAIRunEvent: (callback: (data: unknown) => void) => {
    const subscription = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('ai:runs:event', subscription)
    return () => {
      ipcRenderer.removeListener('ai:runs:event', subscription)
    }
  },
  listAIConversations: (filters?: unknown) => ipcRenderer.invoke('ai:conversations:list', filters),
  getAIConversation: (id: number) => ipcRenderer.invoke('ai:conversations:get', { id }),
  createAIConversation: (title: string, agentId: number, thinkingLevel?: string) =>
    ipcRenderer.invoke('ai:conversations:create', { title, agentId, ...(thinkingLevel ? { thinkingLevel } : {}) }),
  setAIConversationSelection: (conversationId: number, agentId: number, thinkingLevel: string) =>
    ipcRenderer.invoke('ai:conversations:setSelection', { conversationId, agentId, thinkingLevel }),
  renameAIConversation: (id: number, title: string) =>
    ipcRenderer.invoke('ai:conversations:rename', { id, title }),
  setAIConversationPinned: (id: number, pinned: boolean) =>
    ipcRenderer.invoke('ai:conversations:setPinned', { id, pinned }),
  setAIConversationArchived: (id: number, archived: boolean) =>
    ipcRenderer.invoke('ai:conversations:setArchived', { id, archived }),
  deleteAIConversation: (id: number, deleteUnreferencedMedia = false) =>
    ipcRenderer.invoke('ai:conversations:delete', { id, deleteUnreferencedMedia }),
  listAIConversationMessages: (conversationId: number, options?: { beforeId?: number; limit?: number }) =>
    ipcRenderer.invoke('ai:conversations:messages', { conversationId, ...options }),
  listAIConversationEvents: (conversationId: number) =>
    ipcRenderer.invoke('ai:conversations:events', { conversationId }),
  upsertAIModelSwitchEvent: (input: unknown) =>
    ipcRenderer.invoke('ai:conversations:upsertModelSwitchEvent', input),
  deleteAIModelSwitchEvent: (conversationId: number, afterMessageId: number | null) =>
    ipcRenderer.invoke('ai:conversations:deleteModelSwitchEvent', { conversationId, afterMessageId }),
  listAIConversationRuns: (conversationId: number, limit?: number) =>
    ipcRenderer.invoke('ai:conversations:runs', { conversationId, limit }),
  saveAIAsset: (assetId: number) => ipcRenderer.invoke('ai:media:saveAs', { assetId }),
  revealAIAsset: (assetId: number) => ipcRenderer.invoke('ai:media:reveal', { assetId }),

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

import { create } from 'zustand'
import i18n from '../i18n'
import {
  normalizeLaunchpadSettings,
  shouldShowLaunchpad,
  toLaunchpadDateKey,
  type LaunchpadSettings,
} from '../views/launchpadUtils'
import {
  APPEARANCE_PRESETS,
  appearanceFromPreset,
  applyAppearanceToDocument,
  legacyThemeFromAppearance,
  mergeAppearanceSettings,
  normalizeAppearanceSettings,
  type AppearancePresetId,
  type AppearanceSettings,
} from '../appearance'

export type SettingsMenu = 'appearance' | 'shortcuts' | 'profile' | 'security' | 'updates' | 'video'
export type SidebarDisplayMode = 'dynamic' | 'collapsed' | 'expanded'

interface AppState {
  activeScreen: string
  taskTab: string
  settingsMenu: SettingsMenu
  sidebarDisplayMode: SidebarDisplayMode
  appearance: AppearanceSettings
  theme: string
  language: string
  userId: string
  userNickname: string
  userAvatar: string
  toastMessage: string | null
  toastId: number
  isAuthenticated: boolean
  registeredUsers: any[]
  launchpadSettings: LaunchpadSettings
  isInitialConfigLoaded: boolean

  // Actions
  setActiveScreen: (screen: string) => void
  setTaskTab: (tab: string) => void
  setSettingsMenu: (menu: SettingsMenu) => void
  setSidebarDisplayMode: (mode: SidebarDisplayMode) => Promise<void>
  setAppearancePreset: (preset: AppearancePresetId) => Promise<void>
  setAppearanceSettings: (appearance: Partial<AppearanceSettings>) => Promise<void>
  setTheme: (theme: string) => Promise<void>
  setLanguage: (lang: string) => Promise<void>
  setLaunchpadSettings: (settings: Partial<LaunchpadSettings>) => Promise<void>
  showToast: (msg: string) => void
  switchUser: (userId: string) => Promise<void>
  login: (userId: string, password?: string) => Promise<{ success: boolean; error?: string }>
  register: (userData: any) => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<void>
  resetPassword: (data: any) => Promise<{ success: boolean; error?: string }>
  loadProfileList: () => Promise<void>
  loadInitialConfig: () => Promise<void>
}

const getElectronAPI = () => (window as any).electronAPI

const isSidebarDisplayMode = (value: unknown): value is SidebarDisplayMode =>
  value === 'dynamic' || value === 'collapsed' || value === 'expanded'

// Helper functions for localStorage-based user profile mockup in browser environment
const getMockProfiles = () => {
  const data = localStorage.getItem('mock_user_profiles')
  if (!data) {
    // Default guest profile
    const initial = {
      guest: {
        nickname: '访客模式',
        avatar: 'G',
      },
    }
    localStorage.setItem('mock_user_profiles', JSON.stringify(initial))
    return initial
  }
  try {
    return JSON.parse(data)
  } catch {
    return {}
  }
}

const saveMockProfiles = (profiles: any) => {
  localStorage.setItem('mock_user_profiles', JSON.stringify(profiles))
}

const getMockSettings = () => {
  const data = localStorage.getItem('mock_settings')
  if (!data) {
    const initial = {
      theme: 'Minimal',
      appearance: appearanceFromPreset('neo-minimal'),
      language: 'zh-CN',
      sidebarDisplayMode: 'dynamic',
      launchpad: { startupMode: 'daily' },
      lastUserId: 'guest',
    }
    localStorage.setItem('mock_settings', JSON.stringify(initial))
    return initial
  }
  try {
    return JSON.parse(data)
  } catch {
    return {}
  }
}

const saveMockSettings = (settings: any) => {
  localStorage.setItem('mock_settings', JSON.stringify(settings))
}

export const useAppStore = create<AppState>((set, get) => ({
  activeScreen: 'dashboard',
  taskTab: 'list',
  settingsMenu: 'appearance',
  sidebarDisplayMode: 'dynamic',
  appearance: appearanceFromPreset('neo-minimal'),
  theme: 'Minimal',
  language: 'zh-CN',
  userId: 'guest',
  userNickname: '访客模式',
  userAvatar: 'G',
  toastMessage: null,
  toastId: 0,
  isAuthenticated: true, // Defaults to true initially; loadInitialConfig will correct it if a password exists
  registeredUsers: [],
  launchpadSettings: normalizeLaunchpadSettings(undefined),
  isInitialConfigLoaded: false,

  setActiveScreen: (screen) => {
    if (screen === 'landing') {
      set({ activeScreen: screen })
      return
    }
    const launchpadSettings = {
      ...get().launchpadSettings,
      lastContext: { screen, updatedAt: Date.now() },
    }
    set({ activeScreen: screen, launchpadSettings })
    const api = getElectronAPI()
    if (api) {
      void api.getSettings().then((settings: Record<string, unknown>) =>
        api.saveSettings({ ...settings, launchpad: launchpadSettings }),
      )
    } else {
      const settings = getMockSettings()
      settings.launchpad = launchpadSettings
      saveMockSettings(settings)
    }
  },
  setTaskTab: (tab) => set({ taskTab: tab }),
  setSettingsMenu: (menu) => set({ settingsMenu: menu }),
  setSidebarDisplayMode: async (sidebarDisplayMode) => {
    const api = getElectronAPI()
    if (api) {
      const settings = await api.getSettings()
      settings.sidebarDisplayMode = sidebarDisplayMode
      await api.saveSettings(settings)
    } else {
      const settings = getMockSettings()
      settings.sidebarDisplayMode = sidebarDisplayMode
      saveMockSettings(settings)
    }
    set({ sidebarDisplayMode })
  },

  setAppearancePreset: async (preset) => {
    const appearance = appearanceFromPreset(preset)
    const theme = legacyThemeFromAppearance(appearance)
    applyAppearanceToDocument(appearance)
    const api = getElectronAPI()
    if (api) {
      const settings = await api.getSettings()
      settings.appearance = appearance
      settings.theme = theme
      await api.saveSettings(settings)
    } else {
      const settings = getMockSettings()
      settings.appearance = appearance
      settings.theme = theme
      saveMockSettings(settings)
    }
    set({ appearance, theme })
    get().showToast(
      get().language === 'zh-CN'
        ? `已切换外观: ${APPEARANCE_PRESETS[preset].name}`
        : `Appearance switched to: ${APPEARANCE_PRESETS[preset].name}`,
    )
  },

  setAppearanceSettings: async (update) => {
    const appearance = mergeAppearanceSettings(get().appearance, update)
    const theme = legacyThemeFromAppearance(appearance)
    applyAppearanceToDocument(appearance)
    const api = getElectronAPI()
    if (api) {
      const settings = await api.getSettings()
      settings.appearance = appearance
      settings.theme = theme
      await api.saveSettings(settings)
    } else {
      const settings = getMockSettings()
      settings.appearance = appearance
      settings.theme = theme
      saveMockSettings(settings)
    }
    set({ appearance, theme })
    get().showToast(get().language === 'zh-CN' ? '外观设置已更新' : 'Appearance updated')
  },

  setTheme: async (theme) => {
    const appearance = normalizeAppearanceSettings(undefined, theme)
    applyAppearanceToDocument(appearance)
    const api = getElectronAPI()
    if (api) {
      const settings = await api.getSettings()
      settings.theme = theme
      settings.appearance = appearance
      await api.saveSettings(settings)
    } else {
      const settings = getMockSettings()
      settings.theme = theme
      settings.appearance = appearance
      saveMockSettings(settings)
    }
    set({ appearance, theme })
    get().showToast(
      get().language === 'zh-CN' ? `已切换主题: ${theme}` : `Theme switched to: ${theme}`,
    )
  },

  setLanguage: async (language) => {
    await i18n.changeLanguage(language)
    const api = getElectronAPI()
    if (api) {
      const settings = await api.getSettings()
      settings.language = language
      await api.saveSettings(settings)
    } else {
      const settings = getMockSettings()
      settings.language = language
      saveMockSettings(settings)
    }
    set({ language })
    get().showToast(language === 'zh-CN' ? '语言已切换为中文' : 'Language switched to English')
  },

  setLaunchpadSettings: async (settings) => {
    const launchpadSettings = normalizeLaunchpadSettings({ ...get().launchpadSettings, ...settings })
    const api = getElectronAPI()
    if (api) {
      const current = await api.getSettings()
      await api.saveSettings({ ...current, launchpad: launchpadSettings })
    } else {
      const current = getMockSettings()
      current.launchpad = launchpadSettings
      saveMockSettings(current)
    }
    set({ launchpadSettings })
  },

  showToast: (msg) => {
    const toastId = get().toastId + 1
    set({ toastMessage: msg, toastId })
    setTimeout(() => {
      if (get().toastId === toastId) {
        set({ toastMessage: null })
      }
    }, 1800)
  },

  switchUser: async (userId) => {
    const api = getElectronAPI()
    if (api) {
      const res = await api.switchUser(userId)
      if (res) {
        set({
          userId: res.userId,
          userNickname: res.profile.nickname,
          userAvatar: res.profile.avatar,
          isAuthenticated: !res.profile.passwordHash,
        })
        get().showToast(
          get().language === 'zh-CN'
            ? `切换用户成功: ${res.profile.nickname}`
            : `User switched successfully: ${res.profile.nickname}`,
        )
      } else {
        // Password-protected, redirect to lock screen
        set({
          userId,
          isAuthenticated: false,
        })
      }
    } else {
      // Browser Mock Fallback
      const profiles = getMockProfiles()
      const profile = profiles[userId]
      if (profile) {
        if (!profile.password) {
          const settings = getMockSettings()
          settings.lastUserId = userId
          saveMockSettings(settings)

          set({
            userId,
            userNickname: profile.nickname,
            userAvatar: profile.avatar,
            isAuthenticated: true,
          })
          get().showToast(
            get().language === 'zh-CN'
              ? `切换用户成功: ${profile.nickname}`
              : `User switched successfully: ${profile.nickname}`,
          )
        } else {
          set({
            userId,
            isAuthenticated: false,
          })
        }
      }
    }
  },

  login: async (userId, password) => {
    const api = getElectronAPI()
    if (api) {
      const res = await api.loginUser(userId, password)
      if (res && res.success) {
        set({
          userId: res.userId,
          userNickname: res.profile.nickname,
          userAvatar: res.profile.avatar,
          isAuthenticated: true,
        })
        const profiles = await api.getUserProfileList()
        if (profiles) set({ registeredUsers: profiles })

        get().showToast(
          get().language === 'zh-CN'
            ? `欢迎回来, ${res.profile.nickname}!`
            : `Welcome back, ${res.profile.nickname}!`,
        )
        return { success: true }
      }
      return { success: false, error: res?.error || 'Authentication failed' }
    } else {
      // Browser Mock Fallback
      const profiles = getMockProfiles()
      const profile = profiles[userId]
      if (!profile) {
        return {
          success: false,
          error: get().language === 'zh-CN' ? '用户不存在' : 'User not found',
        }
      }
      if (profile.password && profile.password !== password) {
        return {
          success: false,
          error: get().language === 'zh-CN' ? '密码错误' : 'Incorrect password',
        }
      }

      const settings = getMockSettings()
      settings.lastUserId = userId
      saveMockSettings(settings)

      profile.sessionValid = true
      profile.lastActiveTime = Date.now()
      profiles[userId] = profile
      saveMockProfiles(profiles)

      set({
        userId,
        userNickname: profile.nickname,
        userAvatar: profile.avatar,
        isAuthenticated: true,
      })

      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion,
      }))
      set({ registeredUsers: list })

      get().showToast(
        get().language === 'zh-CN'
          ? `欢迎回来, ${profile.nickname}!`
          : `Welcome back, ${profile.nickname}!`,
      )
      return { success: true }
    }
  },

  register: async (userData) => {
    const api = getElectronAPI()
    if (api) {
      const res = await api.registerUser(userData)
      if (res && res.success) {
        set({
          userId: res.userId,
          userNickname: res.profile.nickname,
          userAvatar: res.profile.avatar,
          isAuthenticated: true,
        })
        const profiles = await api.getUserProfileList()
        if (profiles) set({ registeredUsers: profiles })

        get().showToast(
          get().language === 'zh-CN' ? '新账户注册成功!' : 'Account registered successfully!',
        )
        return { success: true }
      }
      return { success: false, error: res?.error || 'Registration failed' }
    } else {
      // Browser Mock Fallback
      const { userId, nickname, avatar, password, passwordHint, securityQuestion, securityAnswer } =
        userData
      const profiles = getMockProfiles()
      if (profiles[userId]) {
        return {
          success: false,
          error: get().language === 'zh-CN' ? '该用户名已存在' : 'Username already exists',
        }
      }

      const newProfile: any = {
        nickname,
        avatar,
      }
      if (password) {
        newProfile.password = password
        newProfile.passwordHint = passwordHint
        newProfile.securityQuestion = securityQuestion
        newProfile.securityAnswer = securityAnswer
        newProfile.sessionValid = true
        newProfile.lastActiveTime = Date.now()
      }

      profiles[userId] = newProfile
      saveMockProfiles(profiles)

      const settings = getMockSettings()
      settings.lastUserId = userId
      saveMockSettings(settings)

      set({
        userId,
        userNickname: nickname,
        userAvatar: avatar,
        isAuthenticated: true,
      })

      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion,
      }))
      set({ registeredUsers: list })

      get().showToast(
        get().language === 'zh-CN' ? '新账户注册成功!' : 'Account registered successfully!',
      )
      return { success: true }
    }
  },

  signOut: async () => {
    const api = getElectronAPI()
    if (api) {
      try {
        await api.logoutUser()
      } catch (e) {
        console.error('Failed to logout on backend:', e)
      }
    } else {
      // Browser Mock Fallback
      const settings = getMockSettings()
      const profiles = getMockProfiles()
      const currentUserId = settings.lastUserId || 'guest'
      if (profiles[currentUserId]) {
        profiles[currentUserId].sessionValid = false
        saveMockProfiles(profiles)
      }
    }
    set({
      isAuthenticated: false,
      activeScreen: 'dashboard',
    })
    get().showToast(get().language === 'zh-CN' ? '已退出登录' : 'Logged out')
  },

  resetPassword: async (data) => {
    const api = getElectronAPI()
    if (api) {
      const res = await api.resetUserPassword(data)
      if (res && res.success) {
        const profiles = await api.getUserProfileList()
        if (profiles) set({ registeredUsers: profiles })

        get().showToast(get().language === 'zh-CN' ? '密码重置成功' : 'Password reset successfully')
        return { success: true }
      }
      return { success: false, error: res?.error || 'Reset failed' }
    } else {
      // Browser Mock Fallback
      const { userId, securityAnswer, newPassword } = data
      const profiles = getMockProfiles()
      const profile = profiles[userId]
      if (!profile) {
        return {
          success: false,
          error: get().language === 'zh-CN' ? '用户不存在' : 'User not found',
        }
      }
      if (!profile.securityQuestion || !profile.securityAnswer) {
        return {
          success: false,
          error:
            get().language === 'zh-CN'
              ? '该账户未设置密保问题，无法重置密码'
              : 'Security question not set',
        }
      }
      if (profile.securityAnswer !== securityAnswer) {
        return {
          success: false,
          error: get().language === 'zh-CN' ? '密保问题答案错误' : 'Incorrect answer',
        }
      }

      if (newPassword) {
        profile.password = newPassword
        profile.sessionValid = true
        profile.lastActiveTime = Date.now()
      } else {
        delete profile.password
        delete profile.passwordHint
        delete profile.securityQuestion
        delete profile.securityAnswer
        delete profile.sessionValid
        delete profile.lastActiveTime
      }

      profiles[userId] = profile
      saveMockProfiles(profiles)

      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion,
      }))
      set({ registeredUsers: list })

      get().showToast(get().language === 'zh-CN' ? '密码重置成功' : 'Password reset successfully')
      return { success: true }
    }
  },

  loadProfileList: async () => {
    const api = getElectronAPI()
    if (api) {
      const profiles = await api.getUserProfileList()
      if (profiles) set({ registeredUsers: profiles })
    } else {
      // Browser Mock Fallback
      const profiles = getMockProfiles()
      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion,
      }))
      set({ registeredUsers: list })
    }
  },

  loadInitialConfig: async () => {
    const api = getElectronAPI()
    if (api) {
      const userRes = await api.getCurrentUser()
      if (userRes) {
        set({
          userId: userRes.userId,
          userNickname: userRes.profile.nickname,
          userAvatar: userRes.profile.avatar,
          isAuthenticated: userRes.isAuthenticated,
        })
      }

      const profiles = await api.getUserProfileList()
      if (profiles) set({ registeredUsers: profiles })

      const settings = await api.getSettings()
      if (settings) {
        const appearance = normalizeAppearanceSettings(settings.appearance, settings.theme)
        const theme = legacyThemeFromAppearance(appearance)
        const launchpadSettings = normalizeLaunchpadSettings(settings.launchpad)
        const shouldOpenLaunchpad = shouldShowLaunchpad(launchpadSettings)
        const nextLaunchpadSettings = shouldOpenLaunchpad
          ? { ...launchpadSettings, lastShownDate: toLaunchpadDateKey() }
          : launchpadSettings
        set({
          appearance,
          theme,
          language: settings.language || 'zh-CN',
          sidebarDisplayMode: isSidebarDisplayMode(settings.sidebarDisplayMode)
            ? settings.sidebarDisplayMode
            : 'dynamic',
          launchpadSettings: nextLaunchpadSettings,
          activeScreen: shouldOpenLaunchpad
            ? 'landing'
            : launchpadSettings.lastContext?.screen || 'dashboard',
          isInitialConfigLoaded: true,
        })
        if (shouldOpenLaunchpad || !settings.appearance) {
          await api.saveSettings({
            ...settings,
            appearance,
            theme,
            launchpad: nextLaunchpadSettings,
          })
        }
        applyAppearanceToDocument(appearance)
        await i18n.changeLanguage(settings.language || 'zh-CN')
      } else {
        const appearance = appearanceFromPreset('neo-minimal')
        applyAppearanceToDocument(appearance)
        set({ appearance, theme: legacyThemeFromAppearance(appearance), isInitialConfigLoaded: true })
      }
    } else {
      // Browser Mock Fallback
      const settings = getMockSettings()
      const profiles = getMockProfiles()
      const currentUserId = settings.lastUserId || 'guest'
      const profile = profiles[currentUserId] || { nickname: '访客模式', avatar: 'G' }
      const appearance = normalizeAppearanceSettings(settings.appearance, settings.theme)
      const theme = legacyThemeFromAppearance(appearance)
      const launchpadSettings = normalizeLaunchpadSettings(settings.launchpad)
      const shouldOpenLaunchpad = shouldShowLaunchpad(launchpadSettings)
      const nextLaunchpadSettings = shouldOpenLaunchpad
        ? { ...launchpadSettings, lastShownDate: toLaunchpadDateKey() }
        : launchpadSettings

      let isAuthenticated = false
      if (!profile.password) {
        isAuthenticated = true
      } else {
        const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000
        const now = Date.now()
        const lastActive = profile.lastActiveTime || 0
        if (profile.sessionValid && now - lastActive < FIFTEEN_DAYS) {
          isAuthenticated = true
          profile.lastActiveTime = now
          profiles[currentUserId] = profile
          saveMockProfiles(profiles)
        }
      }

      set({
        userId: currentUserId,
        userNickname: profile.nickname,
        userAvatar: profile.avatar,
        isAuthenticated: isAuthenticated,
        appearance,
        theme,
        language: settings.language || 'zh-CN',
        sidebarDisplayMode: isSidebarDisplayMode(settings.sidebarDisplayMode)
          ? settings.sidebarDisplayMode
          : 'dynamic',
        launchpadSettings: nextLaunchpadSettings,
        activeScreen: shouldOpenLaunchpad
          ? 'landing'
          : launchpadSettings.lastContext?.screen || 'dashboard',
        isInitialConfigLoaded: true,
      })

      if (shouldOpenLaunchpad || !settings.appearance) {
        settings.appearance = appearance
        settings.theme = theme
        settings.launchpad = nextLaunchpadSettings
        saveMockSettings(settings)
      }

      applyAppearanceToDocument(appearance)
      await i18n.changeLanguage(settings.language || 'zh-CN')

      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion,
      }))
      set({ registeredUsers: list })
    }
  },
}))

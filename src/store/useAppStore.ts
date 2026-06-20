import { create } from 'zustand'
import i18n from '../i18n'

// Centralized type definitions
interface UserProfile {
  nickname: string;
  avatar: string;
}

interface AppState {
  activeScreen: string;
  taskTab: string;
  theme: string;
  language: string;
  userId: string;
  userNickname: string;
  userAvatar: string;
  toastMessage: string | null;
  isAuthenticated: boolean;
  registeredUsers: any[];
  
  // Actions
  setActiveScreen: (screen: string) => void;
  setTaskTab: (tab: string) => void;
  setTheme: (theme: string) => Promise<void>;
  setLanguage: (lang: string) => Promise<void>;
  showToast: (msg: string) => void;
  switchUser: (userId: string) => Promise<void>;
  login: (userId: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  register: (userData: any) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (data: any) => Promise<{ success: boolean; error?: string }>;
  loadProfileList: () => Promise<void>;
  loadInitialConfig: () => Promise<void>;
}

const getElectronAPI = () => (window as any).electronAPI

// Helper functions for localStorage-based user profile mockup in browser environment
const getMockProfiles = () => {
  const data = localStorage.getItem('mock_user_profiles')
  if (!data) {
    // Default guest profile
    const initial = {
      guest: {
        nickname: '访客模式',
        avatar: 'G'
      }
    }
    localStorage.setItem('mock_user_profiles', JSON.stringify(initial))
    return initial
  }
  try {
    return JSON.parse(data)
  } catch (e) {
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
      language: 'zh-CN',
      lastUserId: 'guest'
    }
    localStorage.setItem('mock_settings', JSON.stringify(initial))
    return initial
  }
  try {
    return JSON.parse(data)
  } catch (e) {
    return {}
  }
}

const saveMockSettings = (settings: any) => {
  localStorage.setItem('mock_settings', JSON.stringify(settings))
}


export const useAppStore = create<AppState>((set, get) => ({
  activeScreen: 'dashboard',
  taskTab: 'kanban',
  theme: 'Minimal',
  language: 'zh-CN',
  userId: 'guest',
  userNickname: '访客模式',
  userAvatar: 'G',
  toastMessage: null,
  isAuthenticated: true, // Defaults to true initially; loadInitialConfig will correct it if a password exists
  registeredUsers: [],

  setActiveScreen: (screen) => set({ activeScreen: screen }),
  setTaskTab: (tab) => set({ taskTab: tab }),

  setTheme: async (theme) => {
    document.body.className = `theme-${theme.toLowerCase().replace(' ', '-')}`
    const api = getElectronAPI()
    if (api) {
      const settings = await api.getSettings()
      settings.theme = theme
      await api.saveSettings(settings)
    } else {
      const settings = getMockSettings()
      settings.theme = theme
      saveMockSettings(settings)
    }
    set({ theme })
    get().showToast(get().language === 'zh-CN' ? `已切换主题: ${theme}` : `Theme switched to: ${theme}`)
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

  showToast: (msg) => {
    set({ toastMessage: msg })
    setTimeout(() => {
      if (get().toastMessage === msg) {
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
          isAuthenticated: !res.profile.passwordHash
        })
        get().showToast(get().language === 'zh-CN' ? `切换用户成功: ${res.profile.nickname}` : `User switched successfully: ${res.profile.nickname}`)
      } else {
        // Password-protected, redirect to lock screen
        set({
          userId,
          isAuthenticated: false
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
            isAuthenticated: true
          })
          get().showToast(get().language === 'zh-CN' ? `切换用户成功: ${profile.nickname}` : `User switched successfully: ${profile.nickname}`)
        } else {
          set({
            userId,
            isAuthenticated: false
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
          isAuthenticated: true
        })
        const profiles = await api.getUserProfileList()
        if (profiles) set({ registeredUsers: profiles })
        
        get().showToast(get().language === 'zh-CN' ? `欢迎回来, ${res.profile.nickname}!` : `Welcome back, ${res.profile.nickname}!`)
        return { success: true }
      }
      return { success: false, error: res?.error || 'Authentication failed' }
    } else {
      // Browser Mock Fallback
      const profiles = getMockProfiles()
      const profile = profiles[userId]
      if (!profile) {
        return { success: false, error: get().language === 'zh-CN' ? '用户不存在' : 'User not found' }
      }
      if (profile.password && profile.password !== password) {
        return { success: false, error: get().language === 'zh-CN' ? '密码错误' : 'Incorrect password' }
      }
      
      const settings = getMockSettings()
      settings.lastUserId = userId
      saveMockSettings(settings)
      
      set({
        userId,
        userNickname: profile.nickname,
        userAvatar: profile.avatar,
        isAuthenticated: true
      })
      
      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion
      }))
      set({ registeredUsers: list })
      
      get().showToast(get().language === 'zh-CN' ? `欢迎回来, ${profile.nickname}!` : `Welcome back, ${profile.nickname}!`)
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
          isAuthenticated: true
        })
        const profiles = await api.getUserProfileList()
        if (profiles) set({ registeredUsers: profiles })
        
        get().showToast(get().language === 'zh-CN' ? '新账户注册成功!' : 'Account registered successfully!')
        return { success: true }
      }
      return { success: false, error: res?.error || 'Registration failed' }
    } else {
      // Browser Mock Fallback
      const { userId, nickname, avatar, password, passwordHint, securityQuestion, securityAnswer } = userData
      const profiles = getMockProfiles()
      if (profiles[userId]) {
        return { success: false, error: get().language === 'zh-CN' ? '该用户名已存在' : 'Username already exists' }
      }
      
      const newProfile: any = {
        nickname,
        avatar
      }
      if (password) {
        newProfile.password = password
        newProfile.passwordHint = passwordHint
        newProfile.securityQuestion = securityQuestion
        newProfile.securityAnswer = securityAnswer
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
        isAuthenticated: true
      })
      
      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion
      }))
      set({ registeredUsers: list })
      
      get().showToast(get().language === 'zh-CN' ? '新账户注册成功!' : 'Account registered successfully!')
      return { success: true }
    }
  },

  signOut: async () => {
    set({
      isAuthenticated: false,
      activeScreen: 'dashboard'
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
        return { success: false, error: get().language === 'zh-CN' ? '用户不存在' : 'User not found' }
      }
      if (!profile.securityQuestion || !profile.securityAnswer) {
        return { success: false, error: get().language === 'zh-CN' ? '该账户未设置密保问题，无法重置密码' : 'Security question not set' }
      }
      if (profile.securityAnswer !== securityAnswer) {
        return { success: false, error: get().language === 'zh-CN' ? '密保问题答案错误' : 'Incorrect answer' }
      }
      
      if (newPassword) {
        profile.password = newPassword
      } else {
        delete profile.password
        delete profile.passwordHint
        delete profile.securityQuestion
        delete profile.securityAnswer
      }
      
      profiles[userId] = profile
      saveMockProfiles(profiles)
      
      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion
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
        securityQuestion: p.securityQuestion
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
          isAuthenticated: !userRes.profile.hasPassword
        })
      }
      
      const profiles = await api.getUserProfileList()
      if (profiles) set({ registeredUsers: profiles })

      const settings = await api.getSettings()
      if (settings) {
        set({
          theme: settings.theme || 'Minimal',
          language: settings.language || 'zh-CN'
        })
        const themeClass = `theme-${(settings.theme || 'Minimal').toLowerCase().replace(' ', '-')}`
        document.body.className = themeClass
        await i18n.changeLanguage(settings.language || 'zh-CN')
      }
    } else {
      // Browser Mock Fallback
      const settings = getMockSettings()
      const profiles = getMockProfiles()
      const currentUserId = settings.lastUserId || 'guest'
      const profile = profiles[currentUserId] || { nickname: '访客模式', avatar: 'G' }
      
      set({
        userId: currentUserId,
        userNickname: profile.nickname,
        userAvatar: profile.avatar,
        isAuthenticated: !profile.password,
        theme: settings.theme || 'Minimal',
        language: settings.language || 'zh-CN'
      })
      
      const themeClass = `theme-${(settings.theme || 'Minimal').toLowerCase().replace(' ', '-')}`
      document.body.className = themeClass
      await i18n.changeLanguage(settings.language || 'zh-CN')
      
      const list = Object.entries(profiles).map(([id, p]: [string, any]) => ({
        userId: id,
        nickname: p.nickname,
        avatar: p.avatar,
        hasPassword: !!p.password,
        passwordHint: p.passwordHint,
        securityQuestion: p.securityQuestion
      }))
      set({ registeredUsers: list })
    }
  }
}))

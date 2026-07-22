import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { getConfiguredLocales } from '../localeRegistry'
import { clampVideoConcurrentDownloads } from './videoLibraryUtils'
import { useConfirmation } from '../components/ConfirmationProvider'
import {
  Palette,
  User,
  Shield,
  RefreshCw,
  Download,
  FolderOpen,
  KeyRound,
} from 'lucide-react'

interface UpdateInfo {
  version: string
  releaseNotes?: string
  releaseDate?: string
}

interface BackupResult {
  filePath: string
  fileCount: number
}

interface RestoreInspection {
  filePath: string
  userId: string
  formatVersion: number
  sourcePlatform?: string
  fileCount: number
}

export const Settings: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { confirm } = useConfirmation()
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const language = useAppStore((state) => state.language)
  const setLanguage = useAppStore((state) => state.setLanguage)
  const userId = useAppStore((state) => state.userId)
  const userNickname = useAppStore((state) => state.userNickname)
  const userAvatar = useAppStore((state) => state.userAvatar)
  const showToast = useAppStore((state) => state.showToast)
  const loadInitialConfig = useAppStore((state) => state.loadInitialConfig)
  const signOut = useAppStore((state) => state.signOut)
  const activeMenu = useAppStore((state) => state.settingsMenu)
  const setActiveMenu = useAppStore((state) => state.setSettingsMenu)
  const configuredLocales = useMemo(
    () => getConfiguredLocales(i18n.language),
    [i18n.language],
  )

  // Update states
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  >('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [updateErrorMsg, setUpdateErrorMsg] = useState('')
  const [updateIsMock, setUpdateIsMock] = useState(false)
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true)
  const [videoSettings, setVideoSettings] = useState({
    ytDlpPath: '',
    ffmpegPath: '',
    cookieMode: 'none',
    cookieBrowser: 'chrome',
    cookiesPath: '',
    bilibiliCookiesPath: '',
    qualityPreference: 'best',
    videoDownloadDir: '',
    maxDownloads: 3,
  })
  const [videoToolStatus, setVideoToolStatus] = useState<any>(null)
  const [installingVideoTool, setInstallingVideoTool] = useState<'yt-dlp' | 'ffmpeg' | null>(null)
  const [verifyingCookieAccess, setVerifyingCookieAccess] = useState(false)
  const [loggingInBilibili, setLoggingInBilibili] = useState(false)

  // User Profile Form States
  const [editNickname, setEditNickname] = useState(userNickname)
  const [editAvatar, setEditAvatar] = useState(userAvatar)
  const [mockBackupKey, setMockBackupKey] = useState('lifeos_backup_private_secret_key_2026')
  const [backupDir, setBackupDir] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null)
  const [backupError, setBackupError] = useState('')
  const [restoreInspection, setRestoreInspection] = useState<RestoreInspection | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [restoreSuccess, setRestoreSuccess] = useState(false)
  // Password management states
  const [hasPassword, setHasPassword] = useState(false)
  const [editPassword, setEditPassword] = useState('')
  const [editConfirmPassword, setEditConfirmPassword] = useState('')
  const [editHint, setEditHint] = useState('')
  const [editQuestion, setEditQuestion] = useState('What is your favorite book?')
  const [editAnswer, setEditAnswer] = useState('')

  const api = (window as any).electronAPI
  const isMacPlatform = api?.platform
    ? api.platform === 'darwin'
    : navigator.userAgent.includes('Mac')
  const canInstallManagedFfmpeg = api?.managedVideoToolInstallSupport?.ffmpeg ?? isMacPlatform
  const showManualFfmpegInstallNote = !canInstallManagedFfmpeg

  useEffect(() => {
    setEditNickname(userNickname)
    setEditAvatar(userAvatar)

    const loadProfileSecurity = async () => {
      if (api) {
        const userRes = await api.getCurrentUser()
        if (userRes && userRes.profile) {
          setHasPassword(userRes.profile.hasPassword)
          setEditHint(userRes.profile.passwordHint || '')
          setEditQuestion(userRes.profile.securityQuestion || 'What is your favorite book?')
        }
      }
    }
    loadProfileSecurity()
  }, [userId])

  // System updates listeners & triggers
  useEffect(() => {
    if (!api) return

    api.getAppVersion().then((v: string) => {
      if (v) setAppVersion(v)
    })

    api.getSettings().then((s: unknown) => {
      const settings = s as Record<string, any>
      if (settings) {
        setAutoCheckUpdates(settings.autoCheckUpdates !== false)
        setVideoSettings({
          ytDlpPath: settings.ytDlpPath || '',
          ffmpegPath: settings.ffmpegPath || '',
          cookieMode: settings.cookieMode || 'none',
          cookieBrowser: settings.cookieBrowser || 'chrome',
          cookiesPath: settings.cookiesPath || '',
          bilibiliCookiesPath: settings.bilibiliCookiesPath || '',
          qualityPreference: settings.qualityPreference || 'best',
          videoDownloadDir: settings.videoDownloadDir || '',
          maxDownloads: clampVideoConcurrentDownloads(settings.maxDownloads),
        })
      }
    })

    const unsubChecking = api.onUpdateChecking(() => {
      setUpdateStatus('checking')
      setUpdateErrorMsg('')
    })

    const unsubAvailable = api.onUpdateAvailable((info: unknown) => {
      setUpdateStatus('available')
      setUpdateInfo(info as UpdateInfo)
      setUpdateErrorMsg('')
    })

    const unsubNotAvailable = api.onUpdateNotAvailable(() => {
      setUpdateStatus('not-available')
      setUpdateErrorMsg('')
    })

    const unsubProgress = api.onUpdateProgress((progress: unknown) => {
      const prog = progress as { percent: number }
      setUpdateStatus('downloading')
      setDownloadPercent(prog.percent || 0)
      setUpdateErrorMsg('')
    })

    const unsubDownloaded = api.onUpdateDownloaded((info: unknown) => {
      setUpdateStatus('downloaded')
      setUpdateInfo(info as UpdateInfo)
      setUpdateErrorMsg('')
    })

    const unsubError = api.onUpdateError((err: unknown) => {
      setUpdateStatus('error')
      setUpdateErrorMsg(String(err))
    })

    return () => {
      unsubChecking()
      unsubAvailable()
      unsubNotAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    }
  }, [])

  const handleCheckForUpdates = async () => {
    if (!api) return
    setUpdateStatus('checking')
    setUpdateErrorMsg('')
    const result = await api.checkForUpdates()
    setUpdateIsMock(result?.isMock === true)
  }

  const handleDownloadUpdate = async () => {
    if (!api) return
    setUpdateStatus('downloading')
    setDownloadPercent(0)
    const result = await api.downloadUpdate()
    setUpdateIsMock(result?.isMock === true)
  }

  const handleInstallUpdate = () => {
    if (!api) return
    api.installUpdate()
  }

  const handleManualDownload = () => {
    window.open('https://github.com/wdzwatson/life-desktop/releases', '_blank')
  }

  const handleToggleAutoCheck = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked
    setAutoCheckUpdates(checked)
    if (api) {
      const current = await api.getSettings()
      const currentSettings = current as Record<string, any>
      await api.saveSettings({
        ...currentSettings,
        autoCheckUpdates: checked,
      })
    }
  }

  const handleSaveVideoSettings = async () => {
    if (!api) return
    const current = await api.getSettings()
    const nextSettings = {
      ...videoSettings,
      maxDownloads: clampVideoConcurrentDownloads(videoSettings.maxDownloads),
    }
    setVideoSettings(nextSettings)
    await api.saveSettings({ ...(current as Record<string, any>), ...nextSettings })
    showToast(t('settings.toast_video_settings_saved'))
  }

  const handleSelectVideoDownloadDir = async () => {
    if (!api) return
    const result = await api.selectVideoDownloadDir()
    if (result?.success && result.path) {
      setVideoSettings({ ...videoSettings, videoDownloadDir: result.path })
    }
  }

  const handleVerifyCookieAccess = async () => {
    if (!api) return
    setVerifyingCookieAccess(true)
    try {
      const current = await api.getSettings()
      await api.saveSettings({
        ...(current as Record<string, any>),
        ...videoSettings,
        maxDownloads: clampVideoConcurrentDownloads(videoSettings.maxDownloads),
      })
      const result = await api.verifyVideoCookieAccess()
      if (result?.success) {
        showToast(t('settings.video_cookie_verify_success'))
      } else {
        showToast(t('settings.video_cookie_verify_failed', { error: result?.error || '' }))
      }
    } finally {
      setVerifyingCookieAccess(false)
    }
  }

  const handleLoginBilibili = async () => {
    if (!api || loggingInBilibili) return
    setLoggingInBilibili(true)
    try {
      const result = await api.loginBilibili()
      if (result?.success) {
        const current = (await api.getSettings()) as Record<string, any>
        const nextSettings = {
          ...videoSettings,
          cookieMode: 'bilibili',
          bilibiliCookiesPath: result.path || current.bilibiliCookiesPath || '',
          maxDownloads: clampVideoConcurrentDownloads(videoSettings.maxDownloads),
        }
        setVideoSettings(nextSettings)
        await api.saveSettings({ ...current, ...nextSettings })
        showToast(t('settings.video_bilibili_login_success'))
      } else if (!result?.canceled) {
        showToast(t('settings.video_bilibili_login_failed', { error: result?.error || '' }))
      }
    } finally {
      setLoggingInBilibili(false)
    }
  }

  const handleCheckVideoTools = async () => {
    if (!api) return
    const status = await api.checkVideoTools()
    setVideoToolStatus(status)
  }

  const handleInstallVideoTool = async (tool: 'yt-dlp' | 'ffmpeg') => {
    if (!api) return
    setInstallingVideoTool(tool)
    const result = await api.installVideoTool(tool)
    setInstallingVideoTool(null)
    if (result?.success) {
      setVideoToolStatus(result.tools)
      showToast(t('settings.video_tool_install_success', { tool }))
    } else {
      showToast(t('settings.video_tool_install_failed', { tool, error: result?.error || '' }))
    }
  }

  // Save User Profile Changes
  const handleSaveProfile = async () => {
    if (!api) return

    if (editPassword) {
      if (editPassword !== editConfirmPassword) {
        showToast(t('auth.err_pass_mismatch'))
        return
      }
      if (!editQuestion || !editAnswer.trim()) {
        showToast(t('auth.err_security_needed'))
        return
      }
    }

    const payload: any = {
      userId,
      nickname: editNickname.trim(),
      avatar: editAvatar.trim().toUpperCase().slice(0, 1),
    }

    if (editPassword) {
      payload.password = editPassword
      payload.passwordHint = editHint.trim()
      payload.securityQuestion = editQuestion
      payload.securityAnswer = editAnswer.trim()
    } else if (hasPassword && editPassword === '' && editConfirmPassword === '') {
      if (!(await confirm({ description: t('settings.confirm_clear_password'), confirmLabel: t('common.confirm'), tone: 'danger' }))) return
      payload.password = '' // empty password string tells main process to clear credentials
    }

    const res = await api.updateUserProfile(payload)
    if (res && res.success) {
      await loadInitialConfig()
      setEditPassword('')
      setEditConfirmPassword('')
      setEditAnswer('')
      showToast(t('settings.toast_profile_saved'))
    } else {
      showToast(res?.error || 'Profile update failed')
    }
  }

  const handleClearAppData = async () => {
    if (!api) return

    if (
      !(await confirm({
        description: (
          <>
            {t('settings.security_clear_confirm_1')}
            <br />
            <br />
            {t('settings.security_clear_confirm_2')}
          </>
        ),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return

    try {
      const res = await api.clearAppData()
      if (res && res.success) {
        showToast(t('settings.security_clear_success'))
        setTimeout(() => {
          window.location.reload()
        }, 1000)
      } else {
        showToast(res?.error || 'Clear data failed')
      }
    } catch (e: any) {
      showToast(e.message || 'Error clearing data')
    }
  }

  const handleSelectBackupDirectory = async () => {
    if (!api) return
    const result = await api.selectBackupDirectory()
    if (result?.success && result.path) {
      setBackupDir(result.path)
      setBackupResult(null)
      setBackupError('')
    }
  }

  const handleCreateBackup = async () => {
    if (!api || !backupDir || backupBusy) return

    setBackupBusy(true)
    setBackupResult(null)
    setBackupError('')
    try {
      const result = await api.createBackup(backupDir)
      if (result?.success && result.data) {
        setBackupResult({
          filePath: result.data.filePath,
          fileCount: result.data.manifest?.files?.length || 0,
        })
      } else {
        setBackupError(result?.error || t('settings.backup_failed'))
      }
    } catch (error: any) {
      setBackupError(error?.message || t('settings.backup_failed'))
    } finally {
      setBackupBusy(false)
    }
  }

  const handleSelectRestoreFile = async () => {
    if (!api || restoreBusy) return
    const result = await api.selectBackupFile()
    if (!result?.success || !result.path) return

    setRestoreInspection(null)
    setRestoreSuccess(false)
    setRestoreError('')
    setRestoreBusy(true)
    try {
      const inspection = await api.inspectBackup(result.path)
      if (inspection?.success && inspection.data?.manifest) {
        setRestoreInspection({
          filePath: result.path,
          userId: inspection.data.manifest.userId,
          formatVersion: inspection.data.manifest.formatVersion,
          sourcePlatform: inspection.data.manifest.sourcePlatform,
          fileCount: inspection.data.fileCount || inspection.data.manifest.files?.length || 0,
        })
      } else {
        setRestoreError(inspection?.error || t('settings.restore_validation_failed'))
      }
    } catch (error: any) {
      setRestoreError(error?.message || t('settings.restore_validation_failed'))
    } finally {
      setRestoreBusy(false)
    }
  }

  const handleRestoreBackup = async () => {
    if (!api || !restoreInspection || restoreBusy) return
    if (
      !(await confirm({
        description: t('settings.restore_confirm', {
          userId: restoreInspection.userId,
          count: restoreInspection.fileCount,
        }),
        confirmLabel: t('common.confirm'),
        tone: 'danger',
      }))
    )
      return

    setRestoreBusy(true)
    setRestoreError('')
    setRestoreSuccess(false)
    try {
      const result = await api.restoreBackup(restoreInspection.filePath)
      if (result?.success) {
        setRestoreSuccess(true)
      } else {
        setRestoreError(result?.error || t('settings.restore_failed'))
      }
    } catch (error: any) {
      setRestoreError(error?.message || t('settings.restore_failed'))
    } finally {
      setRestoreBusy(false)
    }
  }

  const handleRestartAfterRestore = () => {
    api?.restartApp()
  }

  return (
    <div
      style={{
        animation: 'enter 0.15s ease both',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('settings.title')}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('settings.subtitle')}</p>
      </div>

      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '200px 1fr',
          gap: '16px',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        {/* Left Settings Sidebar */}
        <aside
          style={{
            borderRight: '1px solid var(--color-border)',
            padding: '12px',
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              className={`nav-item ${activeMenu === 'appearance' ? 'active' : ''}`}
              onClick={() => setActiveMenu('appearance')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <Palette size={15} />
              </span>
              <span className="settings-nav-label">{t('settings.menu_appearance')}</span>
            </button>
            <button
              className={`nav-item ${activeMenu === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveMenu('profile')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <User size={15} />
              </span>
              <span className="settings-nav-label">{t('settings.menu_profile')}</span>
            </button>
            <button
              className={`nav-item ${activeMenu === 'security' ? 'active' : ''}`}
              onClick={() => setActiveMenu('security')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <Shield size={15} />
              </span>
              <span className="settings-nav-label">{t('settings.menu_data')}</span>
            </button>
            <button
              className={`nav-item ${activeMenu === 'updates' ? 'active' : ''}`}
              onClick={() => setActiveMenu('updates')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <RefreshCw size={15} />
              </span>
              <span className="settings-nav-label">{t('settings.menu_updates')}</span>
            </button>
            <button
              className={`nav-item ${activeMenu === 'video' ? 'active' : ''}`}
              onClick={() => setActiveMenu('video')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <Download size={15} />
              </span>
              <span className="settings-nav-label">{t('settings.video_downloader_title')}</span>
            </button>
          </div>
        </aside>

        {/* Right Settings Content */}
        <section
          style={{
            padding: '20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {/* TAB: APPEARANCE */}
          {activeMenu === 'appearance' && (
            <>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>
                  {t('settings.theme_select')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.theme_desc')}
                </p>
                <div
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}
                >
                  {['Minimal', 'Dense', 'Card', 'Dark Tech'].map((tName) => {
                    const isSelected = theme === tName
                    return (
                      <div
                        key={tName}
                        onClick={() => setTheme(tName)}
                        style={{
                          padding: '16px',
                          border: '2px solid var(--color-border)',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          textAlign: 'center',
                          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
                          borderColor: isSelected ? 'var(--color-accent)' : 'var(--color-border)',
                        }}
                      >
                        <strong style={{ fontSize: '13px', display: 'block' }}>{tName}</strong>
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            marginTop: '4px',
                            display: 'block',
                          }}
                        >
                          {tName === 'Minimal'
                            ? t('settings.theme_minimal_label')
                            : tName === 'Dense'
                              ? t('settings.theme_dense_label')
                              : tName === 'Card'
                                ? t('settings.theme_card_label')
                                : t('settings.theme_dark_tech_label')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>
                  {t('settings.lang_select')}
                </h3>
                <div
                  style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}
                >
                  {configuredLocales.map((locale) => (
                    <button
                      key={locale.code}
                      className={`btn ${language === locale.code ? 'primary' : ''}`}
                      onClick={() => setLanguage(locale.code)}
                    >
                      {locale.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* TAB: PROFILE CENTER & PASSWORD SETUP */}
          {activeMenu === 'profile' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px' }}>
              {/* Left Form: Edit Profile & Password */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800 }}>{t('settings.profile_title')}</h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '10px' }}>
                  <div>
                    <label
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: '4px',
                      }}
                    >
                      {t('settings.profile_user_id')}
                    </label>
                    <input
                      className="form-field"
                      value={userId}
                      disabled
                      style={{ backgroundColor: 'var(--bg-app)' }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: '4px',
                      }}
                    >
                      {t('settings.profile_nickname')}
                    </label>
                    <input
                      className="form-field"
                      value={editNickname}
                      onChange={(e) => setEditNickname(e.target.value)}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: '4px',
                      }}
                    >
                      {t('settings.profile_avatar')}
                    </label>
                    <input
                      className="form-field"
                      maxLength={1}
                      value={editAvatar}
                      onChange={(e) => setEditAvatar(e.target.value)}
                      style={{ textAlign: 'center' }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    borderTop: '1px solid var(--color-border)',
                    paddingTop: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <h4 style={{ fontSize: '13px', fontWeight: 700 }}>
                    {t('settings.password_security_title')}
                  </h4>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: '4px',
                        }}
                      >
                        {t('settings.new_password_label')}
                      </label>
                      <input
                        className="form-field"
                        type="password"
                        placeholder="••••••••"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: '4px',
                        }}
                      >
                        {t('settings.confirm_password_label')}
                      </label>
                      <input
                        className="form-field"
                        type="password"
                        placeholder="••••••••"
                        value={editConfirmPassword}
                        onChange={(e) => setEditConfirmPassword(e.target.value)}
                      />
                    </div>
                  </div>

                  {editPassword && (
                    <>
                      <div>
                        <label
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            display: 'block',
                            marginBottom: '4px',
                          }}
                        >
                          {t('settings.password_hint_label')}
                        </label>
                        <input
                          className="form-field"
                          placeholder="My favorite book..."
                          value={editHint}
                          onChange={(e) => setEditHint(e.target.value)}
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                          <label
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-muted)',
                              display: 'block',
                              marginBottom: '4px',
                            }}
                          >
                            {t('settings.recovery_question_label')}
                          </label>
                          <select
                            className="form-field"
                            value={editQuestion}
                            onChange={(e) => setEditQuestion(e.target.value)}
                          >
                            <option value="What is your favorite book?">
                              What is your favorite book?
                            </option>
                            <option value="What is the name of your first pet?">
                              What is the name of your first pet?
                            </option>
                            <option value="What was the name of your first school?">
                              What was the name of your first school?
                            </option>
                            <option value="What is your favorite food?">
                              What is your favorite food?
                            </option>
                          </select>
                        </div>
                        <div>
                          <label
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-muted)',
                              display: 'block',
                              marginBottom: '4px',
                            }}
                          >
                            {t('settings.recovery_answer_label')}
                          </label>
                          <input
                            className="form-field"
                            placeholder="Answer"
                            value={editAnswer}
                            onChange={(e) => setEditAnswer(e.target.value)}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <button
                  className="btn primary"
                  onClick={handleSaveProfile}
                  style={{ width: 'max-content', marginTop: '6px' }}
                >
                  {t('settings.profile_save_btn')}
                </button>
              </div>

              {/* Right panel: Switch Account / Sign Out */}
              <div
                style={{
                  borderLeft: '1px solid var(--color-border)',
                  paddingLeft: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <h3 style={{ fontSize: '14px', fontWeight: 800 }}>
                  {t('settings.account_switch_title')}
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {t('settings.account_switch_desc_secure')}
                </p>
                <button
                  className="btn sm"
                  onClick={signOut}
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    color: 'var(--color-danger)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    fontWeight: 'bold',
                    marginTop: '8px',
                    height: '32px',
                  }}
                >
                  {t('settings.btn_sign_out')}
                </button>
              </div>
            </div>
          )}

          {/* TAB: DATA & SECURITY BACKUPS */}
          {activeMenu === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>
                  {t('settings.security_title')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.security_desc')}
                </p>
                <div style={{ display: 'flex', gap: '8px', maxWidth: '560px' }}>
                  <input
                    className="form-field"
                    type="password"
                    value={mockBackupKey}
                    onChange={(e) => setMockBackupKey(e.target.value)}
                    style={{ flexGrow: 1 }}
                  />
                  <button
                    className="btn"
                    onClick={() => showToast(t('settings.security_toast_key_configured'))}
                  >
                    {t('settings.security_config_btn')}
                  </button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>
                  {t('settings.security_migration_title')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.security_migration_desc')}
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    className="form-field"
                    value="~/LifeOS"
                    disabled
                    style={{ backgroundColor: 'var(--bg-app)', flexGrow: 1 }}
                  />
                  <button
                    className="btn"
                    onClick={() => showToast(t('settings.security_toast_migrated'))}
                  >
                    {t('settings.security_migrate_btn')}
                  </button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>
                  {t('settings.backup_title')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.backup_desc')}
                </p>
                <div style={{ display: 'flex', gap: '8px', maxWidth: '680px' }}>
                  <input
                    className="form-field"
                    value={backupDir}
                    placeholder={t('settings.backup_destination_placeholder')}
                    readOnly
                    style={{ flexGrow: 1, backgroundColor: 'var(--bg-app)' }}
                  />
                  <button className="btn" onClick={handleSelectBackupDirectory} type="button">
                    <FolderOpen size={14} />
                    {t('settings.backup_select_dir')}
                  </button>
                  <button
                    className="btn primary"
                    onClick={handleCreateBackup}
                    disabled={!backupDir || backupBusy}
                    type="button"
                  >
                    <Download size={14} />
                    {backupBusy ? t('settings.backup_running') : t('settings.backup_create_btn')}
                  </button>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '11.5px', marginTop: '8px' }}>
                  {t('settings.backup_external_video_note')}
                </p>
                {backupResult && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(34, 197, 94, 0.08)',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ color: 'var(--color-success, #16a34a)', fontWeight: 700 }}>
                      {t('settings.backup_success', { count: backupResult.fileCount })}
                    </div>
                    <div style={{ color: 'var(--text-muted)', marginTop: '4px', wordBreak: 'break-all' }}>
                      {backupResult.filePath}
                    </div>
                    <button
                      className="btn sm"
                      onClick={() => api?.revealInFinder(backupResult.filePath)}
                      type="button"
                      style={{ marginTop: '8px' }}
                    >
                      {t('settings.backup_reveal')}
                    </button>
                  </div>
                )}
                {backupError && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(239, 68, 68, 0.08)',
                      color: 'var(--color-danger)',
                      fontSize: '12px',
                    }}
                  >
                    {t('settings.backup_failed')}: {backupError}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>
                  {t('settings.restore_title')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.restore_desc')}
                </p>
                <div style={{ display: 'flex', gap: '8px', maxWidth: '680px' }}>
                  <input
                    className="form-field"
                    value={restoreInspection?.filePath || ''}
                    placeholder={t('settings.restore_file_placeholder')}
                    readOnly
                    style={{ flexGrow: 1, backgroundColor: 'var(--bg-app)' }}
                  />
                  <button className="btn" onClick={handleSelectRestoreFile} type="button">
                    <FolderOpen size={14} />
                    {t('settings.restore_select_file')}
                  </button>
                  <button
                    className="btn primary"
                    onClick={handleRestoreBackup}
                    disabled={!restoreInspection || restoreBusy}
                    type="button"
                  >
                    <RefreshCw size={14} />
                    {restoreBusy ? t('settings.restore_running') : t('settings.restore_btn')}
                  </button>
                </div>
                {restoreInspection && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      color: 'var(--text-muted)',
                      fontSize: '12px',
                    }}
                  >
                    {t('settings.restore_validated', {
                      userId: restoreInspection.userId,
                      version: restoreInspection.formatVersion,
                      count: restoreInspection.fileCount,
                      platform: restoreInspection.sourcePlatform || 'unknown',
                    })}
                  </div>
                )}
                {restoreSuccess && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(34, 197, 94, 0.08)',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ color: 'var(--color-success, #16a34a)', fontWeight: 700 }}>
                      {t('settings.restore_success')}
                    </div>
                    <button className="btn sm" onClick={handleRestartAfterRestore} type="button" style={{ marginTop: '8px' }}>
                      {t('settings.restore_restart')}
                    </button>
                  </div>
                )}
                {restoreError && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(239, 68, 68, 0.08)',
                      color: 'var(--color-danger)',
                      fontSize: '12px',
                    }}
                  >
                    {t('settings.restore_failed')}: {restoreError}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                <h3
                  style={{
                    fontSize: '15px',
                    fontWeight: 800,
                    marginBottom: '4px',
                    color: 'var(--color-danger)',
                  }}
                >
                  {t('settings.security_clear_data_title')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.security_clear_data_desc')}
                </p>
                <button
                  className="btn"
                  onClick={handleClearAppData}
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    color: 'var(--color-danger)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    fontWeight: 'bold',
                    height: '34px',
                    width: 'max-content',
                  }}
                >
                  {t('settings.security_clear_data_btn')}
                </button>
              </div>
            </div>
          )}

          {/* TAB: VIDEO DOWNLOADER */}
          {activeMenu === 'video' && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '680px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>
                  {t('settings.video_downloader_title')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px' }}>
                  {t('settings.video_downloader_desc')}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                  {t('settings.video_ytdlp_path')}
                  <input
                    className="form-field"
                    value={videoSettings.ytDlpPath}
                    onChange={(e) =>
                      setVideoSettings({ ...videoSettings, ytDlpPath: e.target.value })
                    }
                    placeholder="yt-dlp"
                  />
                </label>
                <label
                  style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}
                >
                  {t('settings.video_ffmpeg_path')}
                  <input
                    className="form-field"
                    value={videoSettings.ffmpegPath}
                    onChange={(e) =>
                      setVideoSettings({ ...videoSettings, ffmpegPath: e.target.value })
                    }
                    placeholder="ffmpeg"
                  />
                  {showManualFfmpegInstallNote && (
                    <span
                      role="note"
                      style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.45 }}
                    >
                      {t('settings.video_ffmpeg_manual_install_note')}
                    </span>
                  )}
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                {t('settings.video_download_dir')}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    className="form-field"
                    value={videoSettings.videoDownloadDir}
                    onChange={(e) =>
                      setVideoSettings({ ...videoSettings, videoDownloadDir: e.target.value })
                    }
                    placeholder={t('settings.video_download_dir_placeholder')}
                    style={{ flexGrow: 1 }}
                  />
                  <button className="btn" onClick={handleSelectVideoDownloadDir} type="button">
                    <FolderOpen size={14} />
                    {t('settings.video_select_download_dir')}
                  </button>
                </div>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                {t('settings.video_max_downloads')}
                <input
                  className="form-field"
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={videoSettings.maxDownloads}
                  onChange={(e) =>
                    setVideoSettings({
                      ...videoSettings,
                      maxDownloads: clampVideoConcurrentDownloads(e.target.value),
                    })
                  }
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                  {t('settings.video_cookie_mode')}
                  <select
                    className="form-field"
                    value={videoSettings.cookieMode}
                    onChange={(e) =>
                      setVideoSettings({ ...videoSettings, cookieMode: e.target.value })
                    }
                  >
                    <option value="none">{t('settings.video_cookie_none')}</option>
                    <option value="bilibili">{t('settings.video_cookie_bilibili')}</option>
                    <option value="browser">{t('settings.video_cookie_browser')}</option>
                    <option value="file">{t('settings.video_cookie_file')}</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                  {t('settings.video_quality_preference')}
                  <select
                    className="form-field"
                    value={videoSettings.qualityPreference}
                    onChange={(e) =>
                      setVideoSettings({ ...videoSettings, qualityPreference: e.target.value })
                    }
                  >
                    <option value="best">{t('settings.video_quality_best')}</option>
                    <option value="1080p">1080P</option>
                    <option value="720p">720P</option>
                    <option value="audio">{t('settings.video_quality_audio')}</option>
                  </select>
                </label>
              </div>

              {videoSettings.cookieMode === 'browser' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                  {t('settings.video_cookie_browser_label')}
                  <select
                    className="form-field"
                    value={videoSettings.cookieBrowser}
                    onChange={(e) =>
                      setVideoSettings({ ...videoSettings, cookieBrowser: e.target.value })
                    }
                  >
                    <option value="chrome">Chrome</option>
                    <option value="safari">Safari</option>
                    <option value="firefox">Firefox</option>
                    <option value="edge">Edge</option>
                    <option value="brave">Brave</option>
                    <option value="chromium">Chromium</option>
                  </select>
                </label>
              )}

              {videoSettings.cookieMode === 'file' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                  {t('settings.video_cookies_path')}
                  <input
                    className="form-field"
                    value={videoSettings.cookiesPath}
                    onChange={(e) =>
                      setVideoSettings({ ...videoSettings, cookiesPath: e.target.value })
                    }
                    placeholder="/path/to/cookies.txt"
                  />
                </label>
              )}

              {videoSettings.cookieMode === 'bilibili' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    padding: '10px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-muted)',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                    {videoSettings.bilibiliCookiesPath
                      ? t('settings.video_bilibili_logged_in')
                      : t('settings.video_bilibili_login_required')}
                  </span>
                  <button
                    className="btn"
                    onClick={handleLoginBilibili}
                    disabled={loggingInBilibili}
                    type="button"
                  >
                    <KeyRound size={14} />
                    {loggingInBilibili
                      ? t('settings.video_bilibili_logging_in')
                      : t('settings.video_bilibili_login')}
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button className="btn primary" onClick={handleSaveVideoSettings}>
                  {t('common.save')}
                </button>
                <button className="btn" onClick={handleCheckVideoTools}>
                  {t('settings.video_check_tools')}
                </button>
                <button
                  className="btn"
                  onClick={handleVerifyCookieAccess}
                  disabled={verifyingCookieAccess || videoSettings.cookieMode === 'none'}
                >
                  <Shield size={14} />
                  {verifyingCookieAccess
                    ? t('settings.video_cookie_verifying')
                    : t('settings.video_cookie_verify')}
                </button>
                {videoSettings.cookieMode !== 'bilibili' && (
                  <button
                    className="btn"
                    onClick={handleLoginBilibili}
                    disabled={loggingInBilibili}
                    type="button"
                  >
                    <KeyRound size={14} />
                    {loggingInBilibili
                      ? t('settings.video_bilibili_logging_in')
                      : t('settings.video_bilibili_login')}
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => handleInstallVideoTool('yt-dlp')}
                  disabled={installingVideoTool !== null}
                >
                  <Download size={14} />
                  {installingVideoTool === 'yt-dlp'
                    ? t('settings.video_tool_installing')
                    : t('settings.video_install_ytdlp')}
                </button>
                {canInstallManagedFfmpeg && (
                  <button
                    className="btn"
                    onClick={() => handleInstallVideoTool('ffmpeg')}
                    disabled={installingVideoTool !== null}
                  >
                    <Download size={14} />
                    {installingVideoTool === 'ffmpeg'
                      ? t('settings.video_tool_installing')
                      : t('settings.video_install_ffmpeg')}
                  </button>
                )}
              </div>

              <div
                style={{
                  padding: '12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-muted)',
                  display: 'grid',
                  gap: '6px',
                }}
              >
                <strong style={{ fontSize: '12px' }}>{t('settings.video_bilibili_notes_title')}</strong>
                {[
                  'settings.video_bilibili_note_login',
                  'settings.video_bilibili_note_verify',
                  'settings.video_bilibili_note_412',
                  'settings.video_bilibili_note_rights',
                ].map((key) => (
                  <p key={key} style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
                    {t(key)}
                  </p>
                ))}
              </div>

              {videoToolStatus && (
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: '11px',
                    padding: '12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-app)',
                  }}
                >
                  {JSON.stringify(videoToolStatus, null, 2)}
                </pre>
              )}
            </section>
          )}

          {/* TAB: SYSTEM UPDATES */}
          {activeMenu === 'updates' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>
                  {t('settings.updates_title')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '16px' }}>
                  {t('settings.updates_subtitle')}
                </p>
                {updateIsMock && (
                  <p
                    style={{
                      color: 'var(--color-warning, #b45309)',
                      fontSize: '12px',
                      marginBottom: '12px',
                    }}
                  >
                    {t('settings.updates_dev_mock_note')}
                  </p>
                )}

                <div
                  style={{
                    padding: '16px',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-app)',
                    maxWidth: '600px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>
                      {t('settings.updates_current_version')}:{' '}
                      <span style={{ color: 'var(--color-accent)' }}>v{appVersion}</span>
                    </span>
                    {updateStatus === 'idle' ||
                    updateStatus === 'not-available' ||
                    updateStatus === 'error' ? (
                      <button className="btn primary sm" onClick={handleCheckForUpdates}>
                        {t('settings.updates_check_btn')}
                      </button>
                    ) : updateStatus === 'checking' ? (
                      <button
                        className="btn sm"
                        disabled
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <RefreshCw size={12} className="animate-spin" />
                        {t('settings.updates_checking')}
                      </button>
                    ) : null}
                  </div>

                  <div
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      paddingTop: '10px',
                      marginTop: '4px',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '12.5px',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={autoCheckUpdates}
                        onChange={handleToggleAutoCheck}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>{t('settings.updates_auto_check')}</span>
                    </label>
                  </div>

                  {/* Update Status Details */}
                  {updateStatus === 'not-available' && (
                    <div
                      style={{
                        color: 'var(--color-success)',
                        fontSize: '12.5px',
                        marginTop: '4px',
                      }}
                    >
                      ✓ {t('settings.updates_not_available')}
                    </div>
                  )}

                  {updateStatus === 'error' && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        marginTop: '4px',
                      }}
                    >
                      <div style={{ color: 'var(--color-danger)', fontSize: '12.5px' }}>
                        ⚠️ {t('settings.updates_error', { error: updateErrorMsg })}
                      </div>
                      <button
                        className="btn sm"
                        onClick={handleManualDownload}
                        style={{ width: 'max-content' }}
                      >
                        {t('settings.updates_manual_download')}
                      </button>
                    </div>
                  )}

                  {updateStatus === 'available' && updateInfo && (
                    <div
                      style={{
                        marginTop: '8px',
                        borderTop: '1px solid var(--color-border)',
                        paddingTop: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 'bold',
                          color: 'var(--color-accent)',
                        }}
                      >
                        🎉 {t('settings.updates_available', { version: updateInfo.version })}
                      </div>
                      {updateInfo.releaseNotes && (
                        <div
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '6px',
                            padding: '12px',
                            fontSize: '12px',
                            maxHeight: '180px',
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            lineHeight: '1.6',
                          }}
                        >
                          {updateInfo.releaseNotes}
                        </div>
                      )}
                      <button
                        className="btn primary sm"
                        onClick={handleDownloadUpdate}
                        style={{ width: 'max-content' }}
                      >
                        {t('settings.updates_download_btn')}
                      </button>
                    </div>
                  )}

                  {updateStatus === 'downloading' && (
                    <div
                      style={{
                        marginTop: '8px',
                        borderTop: '1px solid var(--color-border)',
                        paddingTop: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '12.5px',
                        }}
                      >
                        <span>
                          {t('settings.updates_downloading', { percent: downloadPercent })}
                        </span>
                      </div>
                      <div
                        style={{
                          height: '6px',
                          backgroundColor: 'var(--color-border)',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${downloadPercent}%`,
                            backgroundColor: 'var(--color-accent)',
                            transition: 'width 0.2s ease',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {updateStatus === 'downloaded' && (
                    <div
                      style={{
                        marginTop: '8px',
                        borderTop: '1px solid var(--color-border)',
                        paddingTop: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div style={{ color: 'var(--color-success)', fontSize: '12.5px' }}>
                        ✓ {t('settings.updates_downloaded')}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn primary sm" onClick={handleInstallUpdate}>
                          {t('settings.updates_install_btn')}
                        </button>
                        <button className="btn sm" onClick={handleManualDownload}>
                          {t('settings.updates_manual_download')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

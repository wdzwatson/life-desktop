import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  Palette,
  Globe,
  User,
  BookOpen,
  Shield,
  Database,
  Plus,
  Trash2,
  RefreshCw,
} from 'lucide-react'

interface UpdateInfo {
  version: string
  releaseNotes?: string
  releaseDate?: string
}

export const Settings: React.FC = () => {
  const { t } = useTranslation()
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const language = useAppStore((state) => state.language)
  const setLanguage = useAppStore((state) => state.setLanguage)
  const userId = useAppStore((state) => state.userId)
  const userNickname = useAppStore((state) => state.userNickname)
  const userAvatar = useAppStore((state) => state.userAvatar)
  const switchUser = useAppStore((state) => state.switchUser)
  const showToast = useAppStore((state) => state.showToast)
  const loadInitialConfig = useAppStore((state) => state.loadInitialConfig)
  const signOut = useAppStore((state) => state.signOut)

  // Settings tab switching
  const [activeMenu, setActiveMenu] = useState<
    'appearance' | 'categories' | 'profile' | 'security' | 'updates'
  >('appearance')

  // Update states
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  >('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [updateErrorMsg, setUpdateErrorMsg] = useState('')
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true)

  // Categories list state
  const [categories, setCategories] = useState<any[]>([])

  // User Profile Form States
  const [editNickname, setEditNickname] = useState(userNickname)
  const [editAvatar, setEditAvatar] = useState(userAvatar)
  const [mockBackupKey, setMockBackupKey] = useState('lifeos_backup_private_secret_key_2026')
  const [newUserToCreate, setNewUserToCreate] = useState('')

  // Password management states
  const [hasPassword, setHasPassword] = useState(false)
  const [editPassword, setEditPassword] = useState('')
  const [editConfirmPassword, setEditConfirmPassword] = useState('')
  const [editHint, setEditHint] = useState('')
  const [editQuestion, setEditQuestion] = useState('What is your favorite book?')
  const [editAnswer, setEditAnswer] = useState('')

  const api = (window as any).electronAPI

  const loadCategories = async () => {
    if (api) {
      const res = await api.dbQuery('books', 'SELECT * FROM categories ORDER BY sort_order ASC')
      if (res?.success) setCategories(res.data)
    }
  }

  useEffect(() => {
    loadCategories()
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
      const settings = s as { autoCheckUpdates?: boolean }
      if (settings) {
        setAutoCheckUpdates(settings.autoCheckUpdates !== false)
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
    await api.checkForUpdates()
  }

  const handleDownloadUpdate = async () => {
    if (!api) return
    setUpdateStatus('downloading')
    setDownloadPercent(0)
    await api.downloadUpdate()
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

  // Category management
  const handleAddCategory = async () => {
    if (!api) return
    const name = window.prompt(t('settings.prompt_add_category'))
    if (!name?.trim()) return

    const res = await api.dbQuery(
      'books',
      'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
      [name.trim(), categories.length + 1],
    )
    if (res?.success) {
      showToast(t('settings.toast_category_added', { name }))
      loadCategories()
    }
  }

  const handleDeleteCategory = async (id: number, name: string) => {
    const confirmMsg = t('settings.prompt_delete_category', { name })
    if (!api || !window.confirm(confirmMsg)) return

    // 1. Update books
    await api.dbQuery('books', 'UPDATE books SET category = "未分类" WHERE category = ?', [name])
    // 2. Delete category
    await api.dbQuery('books', 'DELETE FROM categories WHERE id = ?', [id])

    showToast(t('settings.toast_category_deleted'))
    loadCategories()
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
      const confirmClear = window.confirm(
        t('settings.confirm_clear_password'),
      )
      if (confirmClear) {
        payload.password = '' // empty password string tells main process to clear credentials
      } else {
        return
      }
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

    const confirm1 = window.confirm(t('settings.security_clear_confirm_1'))
    if (!confirm1) return

    const confirm2 = window.confirm(t('settings.security_clear_confirm_2'))
    if (!confirm2) return

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
              <span className="nav-label">{t('settings.menu_appearance')}</span>
            </button>
            <button
              className={`nav-item ${activeMenu === 'categories' ? 'active' : ''}`}
              onClick={() => setActiveMenu('categories')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <BookOpen size={15} />
              </span>
              <span className="nav-label">{t('settings.menu_categories')}</span>
            </button>
            <button
              className={`nav-item ${activeMenu === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveMenu('profile')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <User size={15} />
              </span>
              <span className="nav-label">{t('settings.menu_profile')}</span>
            </button>
            <button
              className={`nav-item ${activeMenu === 'security' ? 'active' : ''}`}
              onClick={() => setActiveMenu('security')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <Shield size={15} />
              </span>
              <span className="nav-label">{t('settings.menu_data')}</span>
            </button>
            <button
              className={`nav-item ${activeMenu === 'updates' ? 'active' : ''}`}
              onClick={() => setActiveMenu('updates')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon">
                <RefreshCw size={15} />
              </span>
              <span className="nav-label">{t('settings.menu_updates')}</span>
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
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button
                    className={`btn ${language === 'zh-CN' ? 'primary' : ''}`}
                    onClick={() => setLanguage('zh-CN')}
                  >
                    简体中文 (Chinese)
                  </button>
                  <button
                    className={`btn ${language === 'en-US' ? 'primary' : ''}`}
                    onClick={() => setLanguage('en-US')}
                  >
                    English (US)
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB: BOOK CATEGORIES */}
          {activeMenu === 'categories' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 800 }}>
                    {t('settings.category_title')}
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                    {t('settings.category_subtitle')}
                  </p>
                </div>
                <button className="btn sm primary" onClick={handleAddCategory}>
                  {t('settings.category_add_btn')}
                </button>
              </div>

              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px' }}
              >
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-app)',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>
                      {cat.name === '未分类' ? t('settings.category_uncategorized') : cat.name}
                    </span>
                    <button
                      className="btn sm"
                      onClick={() => handleDeleteCategory(cat.id, cat.name)}
                      style={{ border: 'none', background: 'none' }}
                      disabled={cat.name === '未分类'}
                    >
                      <Trash2 size={13} color="var(--color-danger)" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
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
                        手动前往 GitHub 下载
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
                          手动下载包
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

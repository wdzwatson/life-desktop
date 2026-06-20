import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { Palette, Globe, User, BookOpen, Shield, Database, Plus, Trash2 } from 'lucide-react'

export const Settings: React.FC = () => {
  const { t } = useTranslation()
  const theme = useAppStore(state => state.theme)
  const setTheme = useAppStore(state => state.setTheme)
  const language = useAppStore(state => state.language)
  const setLanguage = useAppStore(state => state.setLanguage)
  const userId = useAppStore(state => state.userId)
  const userNickname = useAppStore(state => state.userNickname)
  const userAvatar = useAppStore(state => state.userAvatar)
  const switchUser = useAppStore(state => state.switchUser)
  const showToast = useAppStore(state => state.showToast)
  const loadInitialConfig = useAppStore(state => state.loadInitialConfig)
  const signOut = useAppStore(state => state.signOut)

  // Settings tab switching
  const [activeMenu, setActiveMenu] = useState<'appearance' | 'categories' | 'profile' | 'security'>('appearance')

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

  // Category management
  const handleAddCategory = async () => {
    if (!api) return
    const name = window.prompt(t('settings.prompt_add_category'))
    if (!name?.trim()) return

    const res = await api.dbQuery('books', 'INSERT INTO categories (name, sort_order) VALUES (?, ?)', [
      name.trim(),
      categories.length + 1
    ])
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
        showToast(t('auth.err_pass_mismatch') || '两次输入的密码不一致')
        return
      }
      if (!editQuestion || !editAnswer.trim()) {
        showToast(t('auth.err_security_needed') || '设置密码时必须填写密保问题以防遗忘')
        return
      }
    }
    
    const payload: any = {
      userId,
      nickname: editNickname.trim(),
      avatar: editAvatar.trim().toUpperCase().slice(0, 1)
    }
    
    if (editPassword) {
      payload.password = editPassword
      payload.passwordHint = editHint.trim()
      payload.securityQuestion = editQuestion
      payload.securityAnswer = editAnswer.trim()
    } else if (hasPassword && editPassword === '' && editConfirmPassword === '') {
      const confirmClear = window.confirm(t('settings.confirm_clear_password') || '确定要清除当前账户的密码保护吗？')
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

  return (
    <div style={{ animation: 'enter 0.15s ease both', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('settings.title')}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('settings.subtitle')}</p>
      </div>

      <div style={{
        flexGrow: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        gap: '16px',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        backgroundColor: 'var(--bg-surface)'
      }}>
        {/* Left Settings Sidebar */}
        <aside style={{ borderRight: '1px solid var(--color-border)', padding: '12px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button 
              className={`nav-item ${activeMenu === 'appearance' ? 'active' : ''}`}
              onClick={() => setActiveMenu('appearance')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon"><Palette size={15} /></span>
              <span className="nav-label">{t('settings.menu_appearance')}</span>
            </button>
            <button 
              className={`nav-item ${activeMenu === 'categories' ? 'active' : ''}`}
              onClick={() => setActiveMenu('categories')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon"><BookOpen size={15} /></span>
              <span className="nav-label">{t('settings.menu_categories')}</span>
            </button>
            <button 
              className={`nav-item ${activeMenu === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveMenu('profile')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon"><User size={15} /></span>
              <span className="nav-label">{t('settings.menu_profile')}</span>
            </button>
            <button 
              className={`nav-item ${activeMenu === 'security' ? 'active' : ''}`}
              onClick={() => setActiveMenu('security')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon"><Shield size={15} /></span>
              <span className="nav-label">{t('settings.menu_data')}</span>
            </button>
          </div>
        </aside>

        {/* Right Settings Content */}
        <section style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* TAB: APPEARANCE */}
          {activeMenu === 'appearance' && (
            <>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>{t('settings.theme_select')}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.theme_desc')}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  {['Minimal', 'Dense', 'Card', 'Dark Tech'].map(tName => {
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
                          borderColor: isSelected ? 'var(--color-accent)' : 'var(--color-border)'
                        }}
                      >
                        <strong style={{ fontSize: '13px', display: 'block' }}>{tName}</strong>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                          {tName === 'Minimal' ? t('settings.theme_minimal_label') : 
                           tName === 'Dense' ? t('settings.theme_dense_label') : 
                           tName === 'Card' ? t('settings.theme_card_label') : t('settings.theme_dark_tech_label')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>{t('settings.lang_select')}</h3>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button className={`btn ${language === 'zh-CN' ? 'primary' : ''}`} onClick={() => setLanguage('zh-CN')}>简体中文 (Chinese)</button>
                  <button className={`btn ${language === 'en-US' ? 'primary' : ''}`} onClick={() => setLanguage('en-US')}>English (US)</button>
                </div>
              </div>
            </>
          )}

          {/* TAB: BOOK CATEGORIES */}
          {activeMenu === 'categories' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 800 }}>{t('settings.category_title')}</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('settings.category_subtitle')}</p>
                </div>
                <button className="btn sm primary" onClick={handleAddCategory}>{t('settings.category_add_btn')}</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px' }}>
                {categories.map(cat => (
                  <div 
                    key={cat.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-app)'
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
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('settings.profile_user_id')}</label>
                    <input className="form-field" value={userId} disabled style={{ backgroundColor: 'var(--bg-app)' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('settings.profile_nickname')}</label>
                    <input className="form-field" value={editNickname} onChange={e => setEditNickname(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('settings.profile_avatar')}</label>
                    <input className="form-field" maxLength={1} value={editAvatar} onChange={e => setEditAvatar(e.target.value)} style={{ textAlign: 'center' }} />
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 700 }}>{t('settings.password_security_title') || '账户密保与安全'}</h4>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('settings.new_password_label') || '修改新密码'}</label>
                      <input className="form-field" type="password" placeholder="••••••••" value={editPassword} onChange={e => setEditPassword(e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('settings.confirm_password_label') || '确认新密码'}</label>
                      <input className="form-field" type="password" placeholder="••••••••" value={editConfirmPassword} onChange={e => setEditConfirmPassword(e.target.value)} />
                    </div>
                  </div>

                  {editPassword && (
                    <>
                      <div>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('settings.password_hint_label') || '密码提示信息'}</label>
                        <input className="form-field" placeholder="My favorite book..." value={editHint} onChange={e => setEditHint(e.target.value)} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('settings.recovery_question_label') || '密保恢复问题'}</label>
                          <select className="form-field" value={editQuestion} onChange={e => setEditQuestion(e.target.value)}>
                            <option value="What is your favorite book?">What is your favorite book?</option>
                            <option value="What is the name of your first pet?">What is the name of your first pet?</option>
                            <option value="What was the name of your first school?">What was the name of your first school?</option>
                            <option value="What is your favorite food?">What is your favorite food?</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('settings.recovery_answer_label') || '密保问题答案'}</label>
                          <input className="form-field" placeholder="Answer" value={editAnswer} onChange={e => setEditAnswer(e.target.value)} />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <button className="btn primary" onClick={handleSaveProfile} style={{ width: 'max-content', marginTop: '6px' }}>
                  {t('settings.profile_save_btn')}
                </button>
              </div>

              {/* Right panel: Switch Account / Sign Out */}
              <div style={{ borderLeft: '1px solid var(--color-border)', paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800 }}>{t('settings.account_switch_title')}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {t('settings.account_switch_desc_secure') || '您将安全登出当前的工作空间会话，所有本地数据库将完全切断连接，回到系统锁定屏。'}
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
                    height: '32px'
                  }}
                >
                  {t('settings.btn_sign_out') || '安全退出当前账户'}
                </button>
              </div>
            </div>
          )}

          {/* TAB: DATA & SECURITY BACKUPS */}
          {activeMenu === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>{t('settings.security_title')}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.security_desc')}
                </p>
                <div style={{ display: 'flex', gap: '8px', maxWidth: '560px' }}>
                  <input className="form-field" type="password" value={mockBackupKey} onChange={e => setMockBackupKey(e.target.value)} style={{ flexGrow: 1 }} />
                  <button className="btn" onClick={() => showToast(t('settings.security_toast_key_configured'))}>{t('settings.security_config_btn')}</button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>{t('settings.security_migration_title')}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginBottom: '12px' }}>
                  {t('settings.security_migration_desc')}
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input className="form-field" value="~/LifeOS" disabled style={{ backgroundColor: 'var(--bg-app)', flexGrow: 1 }} />
                  <button className="btn" onClick={() => showToast(t('settings.security_toast_migrated'))}>{t('settings.security_migrate_btn')}</button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

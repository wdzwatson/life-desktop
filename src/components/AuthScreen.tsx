import React, { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { KeyRound, ShieldAlert, ArrowLeft, UserPlus, Eye, EyeOff } from 'lucide-react'

export const AuthScreen: React.FC = () => {
  const { t } = useTranslation()

  // App states
  const registeredUsers = useAppStore((state) => state.registeredUsers)
  const login = useAppStore((state) => state.login)
  const register = useAppStore((state) => state.register)
  const resetPassword = useAppStore((state) => state.resetPassword)
  const language = useAppStore((state) => state.language)
  const setLanguage = useAppStore((state) => state.setLanguage)

  // Navigation states
  const [view, setView] = useState<'login' | 'register' | 'recovery'>('login')

  // Selection / Login states
  const [selectedUserId, setSelectedUserId] = useState<string>(
    registeredUsers[0]?.userId || 'guest',
  )
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  // Registration form states
  const [regUserId, setRegUserId] = useState('')
  const [regNickname, setRegNickname] = useState('')
  const [regAvatar, setRegAvatar] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirmPassword, setRegConfirmPassword] = useState('')
  const [regHint, setRegHint] = useState('')
  const [regQuestion, setRegQuestion] = useState('What is your favorite book?')
  const [regAnswer, setRegAnswer] = useState('')
  const [regError, setRegError] = useState<string | null>(null)

  // Recovery form states
  const [recAnswer, setRecAnswer] = useState('')
  const [recNewPassword, setRecNewPassword] = useState('')
  const [recConfirmPassword, setRecConfirmPassword] = useState('')
  const [recError, setRecError] = useState<string | null>(null)

  const activeUser = registeredUsers.find((u) => u.userId === selectedUserId)

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    try {
      const res = await login(selectedUserId, password)
      if (!res.success) {
        setLoginError(res.error || 'Login failed')
      } else {
        setPassword('')
      }
    } catch (err: any) {
      setLoginError(
        t('auth.err_api_missing') || 'API Connection missing. Please run in Electron client.',
      )
    }
  }

  // Handle Register
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setRegError(null)

    // Validations
    if (!regUserId.trim() || !regNickname.trim() || !regAvatar.trim()) {
      setRegError(t('auth.err_fill_all') || '请填齐基本信息')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(regUserId)) {
      setRegError(t('auth.err_username_format') || '用户名只允许英文字母、数字和下划线')
      return
    }
    if (regPassword !== regConfirmPassword) {
      setRegError(t('auth.err_pass_mismatch') || '两次输入的密码不一致')
      return
    }
    if (regPassword && (!regQuestion || !regAnswer.trim())) {
      setRegError(t('auth.err_security_needed') || '设置密码时必须填写密保问题以防遗忘')
      return
    }

    try {
      const res = await register({
        userId: regUserId.trim().toLowerCase(),
        nickname: regNickname.trim(),
        avatar: regAvatar.trim().toUpperCase().slice(0, 1),
        password: regPassword || undefined,
        passwordHint: regHint.trim() || undefined,
        securityQuestion: regPassword ? regQuestion : undefined,
        securityAnswer: regPassword ? regAnswer.trim() : undefined,
      })

      if (!res.success) {
        setRegError(res.error || 'Registration failed')
      } else {
        // Clear registration form
        setRegUserId('')
        setRegNickname('')
        setRegAvatar('')
        setRegPassword('')
        setRegConfirmPassword('')
        setRegHint('')
        setRegAnswer('')
        setView('login')
      }
    } catch (err: any) {
      setRegError(
        t('auth.err_api_missing') || 'API Connection missing. Please run in Electron client.',
      )
    }
  }

  // Handle Recovery & Reset
  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault()
    setRecError(null)

    if (!recAnswer.trim()) {
      setRecError(t('auth.err_answer_empty') || '请填写密保问题的答案')
      return
    }
    if (recNewPassword !== recConfirmPassword) {
      setRecError(t('auth.err_pass_mismatch') || '两次输入的密码不一致')
      return
    }

    try {
      const res = await resetPassword({
        userId: selectedUserId,
        securityAnswer: recAnswer.trim(),
        newPassword: recNewPassword || undefined,
      })

      if (!res.success) {
        setRecError(res.error || 'Reset failed')
      } else {
        // Direct login after recovery reset
        await login(selectedUserId, recNewPassword)
        setRecAnswer('')
        setRecNewPassword('')
        setRecConfirmPassword('')
        setView('login')
      }
    } catch (err: any) {
      setRecError(
        t('auth.err_api_missing') || 'API Connection missing. Please run in Electron client.',
      )
    }
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-app)',
        color: 'var(--text-main)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        userSelect: 'none',
      }}
    >
      <div
        className="card"
        style={{
          width: '420px',
          padding: '30px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.02)',
          borderRadius: '16px',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all 0.3s ease',
          position: 'relative',
        }}
      >
        {/* Language Switcher */}
        <button
          type="button"
          onClick={() => setLanguage(language === 'zh-CN' ? 'en-US' : 'zh-CN')}
          style={{
            position: 'absolute',
            top: '15px',
            right: '15px',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-muted)',
            borderRadius: '4px',
            padding: '2px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 'bold',
            zIndex: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: '1',
          }}
        >
          {language === 'zh-CN' ? 'EN' : '中文'}
        </button>

        {/* VIEW: LOGIN LOCK SCREEN */}
        {view === 'login' && (
          <>
            <div
              style={{
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                  color: 'var(--color-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '4px',
                }}
              >
                <KeyRound size={24} />
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>
                {t('auth.title_welcome') || '欢迎使用 LifeOS'}
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {t('auth.subtitle_select') || '请选择账号并输入密码解锁'}
              </p>
            </div>

            {/* Profile avatar switcher */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center',
                padding: '10px 0',
                overflowX: 'auto',
              }}
            >
              {registeredUsers.map((u) => {
                const isSelected = u.userId === selectedUserId
                return (
                  <div
                    key={u.userId}
                    onClick={() => {
                      setSelectedUserId(u.userId)
                      setPassword('')
                      setLoginError(null)
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                      minWidth: '64px',
                    }}
                  >
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        backgroundColor: isSelected ? 'var(--color-accent)' : 'var(--color-border)',
                        color: isSelected ? '#fff' : 'var(--text-main)',
                        fontWeight: 800,
                        fontSize: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: isSelected
                          ? '2px solid var(--color-accent)'
                          : '2px solid transparent',
                        boxShadow: isSelected ? '0 0 0 2px var(--bg-surface)' : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {u.avatar || 'U'}
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: isSelected ? 'bold' : 'normal',
                        color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
                        maxWidth: '80px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {u.nickname}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Password Verification Form */}
            <form
              onSubmit={handleLogin}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              {activeUser?.hasPassword ? (
                <div>
                  <label
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      display: 'block',
                      marginBottom: '6px',
                    }}
                  >
                    {t('auth.label_password') || '输入密码'}
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      className="form-field"
                      style={{ paddingRight: '40px' }}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        border: 'none',
                        background: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--bg-app)',
                    borderRadius: '8px',
                    fontSize: '11.5px',
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                    border: '1px dashed var(--color-border)',
                  }}
                >
                  {t('auth.guest_no_password') || '当前选择的账户未设置密码，可直接解锁。'}
                </div>
              )}

              {loginError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    color: 'var(--color-danger)',
                  }}
                >
                  <ShieldAlert size={14} />
                  <span>{loginError}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn primary"
                style={{ height: '36px', fontSize: '13px', fontWeight: 600 }}
              >
                {activeUser?.hasPassword
                  ? t('auth.btn_unlock') || '解锁空间'
                  : t('auth.btn_enter') || '进入空间'}
              </button>
            </form>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--color-border)',
                paddingTop: '14px',
                marginTop: '4px',
              }}
            >
              {activeUser?.hasPassword ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setView('recovery')
                    setRecError(null)
                  }}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--color-accent)',
                    padding: 0,
                  }}
                >
                  {t('auth.link_forgot') || '忘记密码？'}
                </button>
              ) : (
                <div />
              )}

              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setView('register')
                  setRegError(null)
                }}
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--color-accent)',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <UserPlus size={13} /> {t('auth.btn_create_account') || '创建新账户'}
              </button>
            </div>
          </>
        )}

        {/* VIEW: REGISTER NEW ACCOUNT */}
        {view === 'register' && (
          <form
            onSubmit={handleRegister}
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '12px',
              }}
            >
              <button
                type="button"
                onClick={() => setView('login')}
                className="btn sm"
                style={{ padding: '4px' }}
              >
                <ArrowLeft size={14} />
              </button>
              <h2 style={{ fontSize: '15px', fontWeight: 800 }}>
                {t('auth.title_register') || '创建本地新账户'}
              </h2>
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
                {t('auth.label_username') || '本地账户 ID (限英文数字)'}
              </label>
              <input
                className="form-field"
                placeholder={t('auth.placeholder_username') || '如 user_admin'}
                value={regUserId}
                onChange={(e) => setRegUserId(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: '8px' }}>
              <div>
                <label
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    display: 'block',
                    marginBottom: '4px',
                  }}
                >
                  {t('auth.label_nickname') || '账户昵称'}
                </label>
                <input
                  className="form-field"
                  placeholder="Admin"
                  value={regNickname}
                  onChange={(e) => setRegNickname(e.target.value)}
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
                  {t('auth.label_avatar') || '头像首字母'}
                </label>
                <input
                  className="form-field"
                  maxLength={1}
                  value={regAvatar}
                  onChange={(e) => setRegAvatar(e.target.value)}
                  style={{ textAlign: 'center' }}
                  placeholder="A"
                />
              </div>
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
                {t('auth.label_new_password') || '密码 (留空则不设密码)'}
              </label>
              <input
                className="form-field"
                type="password"
                placeholder="••••••••"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
              />
            </div>

            {regPassword && (
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
                    {t('auth.label_confirm_password') || '确认密码'}
                  </label>
                  <input
                    className="form-field"
                    type="password"
                    placeholder="••••••••"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
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
                    {t('auth.label_hint') || '密码提示语'}
                  </label>
                  <input
                    className="form-field"
                    placeholder="My favorite book..."
                    value={regHint}
                    onChange={(e) => setRegHint(e.target.value)}
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
                    {t('auth.label_question') || '密保恢复问题'}
                  </label>
                  <select
                    className="form-field"
                    value={regQuestion}
                    onChange={(e) => setRegQuestion(e.target.value)}
                  >
                    <option value="What is your favorite book?">What is your favorite book?</option>
                    <option value="What is the name of your first pet?">
                      What is the name of your first pet?
                    </option>
                    <option value="What was the name of your first school?">
                      What was the name of your first school?
                    </option>
                    <option value="What is your favorite food?">What is your favorite food?</option>
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
                    {t('auth.label_answer') || '密保答案'}
                  </label>
                  <input
                    className="form-field"
                    placeholder="Answer"
                    value={regAnswer}
                    onChange={(e) => setRegAnswer(e.target.value)}
                  />
                </div>
              </>
            )}

            {regError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  color: 'var(--color-danger)',
                }}
              >
                <ShieldAlert size={14} />
                <span>{regError}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn primary"
              style={{ height: '36px', fontSize: '13px', fontWeight: 600, marginTop: '6px' }}
            >
              {t('auth.btn_register') || '创建并登入账户'}
            </button>
          </form>
        )}

        {/* VIEW: PASSWORD RECOVERY & RESET */}
        {view === 'recovery' && (
          <form
            onSubmit={handleRecovery}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '12px',
              }}
            >
              <button
                type="button"
                onClick={() => setView('login')}
                className="btn sm"
                style={{ padding: '4px' }}
              >
                <ArrowLeft size={14} />
              </button>
              <h2 style={{ fontSize: '15px', fontWeight: 800 }}>
                {t('auth.title_recovery') || '密保验证与重置密码'}
              </h2>
            </div>

            {activeUser?.passwordHint && (
              <div
                style={{
                  padding: '10px',
                  backgroundColor: 'var(--bg-app)',
                  borderLeft: '3px solid var(--color-accent)',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                <strong
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    marginBottom: '2px',
                  }}
                >
                  {t('auth.label_password_hint') || '密码提示'}:
                </strong>
                {activeUser.passwordHint}
              </div>
            )}

            <div>
              <label
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                {t('auth.label_question') || '安全密保问题'}
              </label>
              <div style={{ fontSize: '13px', fontWeight: 'bold', padding: '6px 0' }}>
                {activeUser?.securityQuestion || 'No question set'}
              </div>
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
                {t('auth.label_answer') || '密保问题答案'}
              </label>
              <input
                className="form-field"
                placeholder="Answer"
                value={recAnswer}
                onChange={(e) => setRecAnswer(e.target.value)}
              />
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
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                {t('auth.label_new_password') || '重置新密码 (留空则清除密码)'}
              </label>
              <input
                className="form-field"
                type="password"
                placeholder="••••••••"
                value={recNewPassword}
                onChange={(e) => setRecNewPassword(e.target.value)}
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
                {t('auth.label_confirm_password') || '确认新密码'}
              </label>
              <input
                className="form-field"
                type="password"
                placeholder="••••••••"
                value={recConfirmPassword}
                onChange={(e) => setRecConfirmPassword(e.target.value)}
              />
            </div>

            {recError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  color: 'var(--color-danger)',
                }}
              >
                <ShieldAlert size={14} />
                <span>{recError}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn primary"
              style={{ height: '36px', fontSize: '13px', fontWeight: 600 }}
            >
              {t('auth.btn_verify_reset') || '校验并登入空间'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

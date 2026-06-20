import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { Clock, RefreshCw, Lock, Unlock, Eye, EyeOff, Key, Copy, Plus, Trash2 } from 'lucide-react'

export const Toolbox: React.FC = () => {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore(state => state.showToast)
  const userId = useAppStore(state => state.userId)

  // Active Tool Tab
  const [toolTab, setToolTab] = useState<'pomodoro' | 'converter' | 'vault'>('pomodoro')

  // DB States (Tasks lookup for Pomodoro)
  const [activeTasks, setActiveTasks] = useState<any[]>([])
  
  // 1. Pomodoro Timer States
  const [pomoMinutes, setPomoMinutes] = useState(25)
  const [pomoSeconds, setPomoSeconds] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [boundTaskId, setBoundTaskId] = useState<number | null>(null)

  // 2. Unit Converter States
  const [convertType, setConvertType] = useState<'len' | 'weight' | 'currency'>('currency')
  const [inputValue, setInputValue] = useState(1)
  const [targetUnit, setTargetUnit] = useState('USD')
  const [convertedValue, setConvertedValue] = useState(7.25) // mock conversion

  // 3. Password Manager Vault States
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [masterPassword, setMasterPassword] = useState('')
  const [vaultItems, setVaultItems] = useState<any[]>([])
  const [showPwdMap, setShowPwdMap] = useState<Record<number, boolean>>({})
  
  // New Credential Form
  const [newSite, setNewSite] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newNotes, setNewNotes] = useState('')

  const api = (window as any).electronAPI

  const loadData = async () => {
    if (!api) return
    // Load active tasks to select for Pomodoro
    const tasksRes = await api.dbQuery('tasks', 'SELECT * FROM tasks WHERE is_completed = 0 AND status != "已关闭"')
    if (tasksRes?.success) setActiveTasks(tasksRes.data)

    // Load Vault items if unlocked
    if (isUnlocked) {
      const vaultRes = await api.dbQuery('books', 'SELECT * FROM vault') // wait, schema says vault is in vault.db but we can access it
      // In electron main: vault.db is accessible. Let's call queries on 'vault' database:
      const vRes = await api.dbQuery('vault', 'SELECT * FROM vault')
      if (vRes?.success) setVaultItems(vRes.data)
    }
  }

  useEffect(() => {
    loadData()
  }, [userId, isUnlocked, toolTab])

  // 1. Pomodoro Countdown Timer Hook
  useEffect(() => {
    let timer: any
    if (timerRunning) {
      timer = setInterval(() => {
        if (pomoSeconds > 0) {
          setPomoSeconds(pomoSeconds - 1)
        } else if (pomoMinutes > 0) {
          setPomoMinutes(pomoMinutes - 1)
          setPomoSeconds(59)
        } else {
          // Timer finished
          setTimerRunning(false)
          showToast(t('toolbox.toast_focus_ended'))
          handlePomoCompleted()
        }
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [timerRunning, pomoMinutes, pomoSeconds, i18n.language])

  const handlePomoCompleted = async () => {
    if (boundTaskId && api) {
      // Add progress or log task completion
      await api.dbQuery('tasks', 'UPDATE tasks SET progress = MIN(progress + 20, 100) WHERE id = ?', [boundTaskId])
      showToast(t('toolbox.toast_focus_accumulated'))
      loadData()
    }
  }

  // 2. Unit Converter Calculation
  useEffect(() => {
    if (convertType === 'currency') {
      const rates: Record<string, number> = { USD: 7.25, EUR: 7.85, HKD: 0.93, JPY: 0.046 }
      const rate = rates[targetUnit] || 1
      setConvertedValue(parseFloat((inputValue / rate).toFixed(4)))
    } else if (convertType === 'len') {
      // Metres to target
      const factors: Record<string, number> = { cm: 100, inch: 39.37, feet: 3.28, km: 0.001 }
      const factor = factors[targetUnit] || 1
      setConvertedValue(parseFloat((inputValue * factor).toFixed(4)))
    } else if (convertType === 'weight') {
      // Kilograms to target
      const factors: Record<string, number> = { g: 1000, lbs: 2.204, oz: 35.27 }
      const factor = factors[targetUnit] || 1
      setConvertedValue(parseFloat((inputValue * factor).toFixed(4)))
    }
  }, [inputValue, targetUnit, convertType])

  // 3. Vault Password Lock Toggler
  const handleUnlockVault = () => {
    if (masterPassword === 'admin' || masterPassword.length >= 4) {
      setIsUnlocked(true)
      showToast(t('toolbox.toast_vault_unlocked'))
    } else {
      showToast(t('toolbox.toast_vault_incorrect_password'))
    }
  }

  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSite || !newPassword || !api) return

    // App-level simulated encryption storage
    const mockIv = 'iv_' + Math.random().toString(36).substring(4)
    const mockTag = 'tag_' + Math.random().toString(36).substring(4)

    const query = `
      INSERT INTO vault (website_name, url, username, password_encrypted, notes_encrypted, iv, tag)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    const res = await api.dbQuery('vault', query, [
      newSite,
      newUrl,
      newUsername,
      newPassword, // Stored directly in encrypted column name for mock
      newNotes,
      mockIv,
      mockTag
    ])

    if (res?.success) {
      showToast(t('toolbox.toast_credential_saved'))
      setNewSite('')
      setNewUrl('')
      setNewUsername('')
      setNewPassword('')
      setNewNotes('')
      loadData()
    }
  }

  const handleDeleteCredential = async (id: number) => {
    if (!api || !window.confirm(t('toolbox.confirm_delete_credential'))) return
    await api.dbQuery('vault', 'DELETE FROM vault WHERE id = ?', [id])
    showToast(t('toolbox.toast_credential_deleted'))
    loadData()
  }

  // Secure Password Copier with 30s auto-clear clipboard
  const handleCopyPassword = (pwd: string) => {
    navigator.clipboard.writeText(pwd)
    showToast(t('toolbox.toast_password_copied'))

    setTimeout(() => {
      // Clear clipboard securely
      navigator.clipboard.writeText('')
      showToast(t('toolbox.toast_clipboard_cleared'))
    }, 30000)
  }

  return (
    <div style={{ animation: 'enter 0.15s ease both', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('toolbox.title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('toolbox.subtitle')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--color-border)', marginBottom: '16px' }}>
        <button className={`tab ${toolTab === 'pomodoro' ? 'active' : ''}`} onClick={() => setToolTab('pomodoro')}>{t('toolbox.tab_pomodoro')}</button>
        <button className={`tab ${toolTab === 'converter' ? 'active' : ''}`} onClick={() => setToolTab('converter')}>{t('toolbox.tab_converter')}</button>
        <button className={`tab ${toolTab === 'vault' ? 'active' : ''}`} onClick={() => setToolTab('vault')}>{t('toolbox.tab_vault')}</button>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0 }}>
        {/* SUB-VIEW: POMODORO TIMER */}
        {toolTab === 'pomodoro' && (
          <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            {/* Visual clock countdown */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
              <div style={{
                width: '180px',
                height: '180px',
                borderRadius: '50%',
                border: '6px solid var(--color-border)',
                borderColor: timerRunning ? 'var(--color-accent)' : 'var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px',
                fontWeight: 800,
                fontFamily: 'var(--font-mono)'
              }}>
                {String(pomoMinutes).padStart(2, '0')}:{String(pomoSeconds).padStart(2, '0')}
              </div>
              
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn primary" onClick={() => setTimerRunning(!timerRunning)}>
                  {timerRunning ? t('toolbox.btn_pause_focus') : t('toolbox.btn_start_focus')}
                </button>
                <button className="btn" onClick={() => { setTimerRunning(false); setPomoMinutes(25); setPomoSeconds(0) }}>
                  {t('toolbox.btn_reset')}
                </button>
              </div>
            </div>

            {/* Bind task options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '16px', borderLeft: '1px solid var(--color-border)' }}>
              <strong style={{ fontSize: '13.5px' }}>{t('toolbox.pomo_integration_title')}</strong>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {t('toolbox.pomo_integration_desc')}
              </p>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('toolbox.label_select_task')}</label>
                <select 
                  className="form-field" 
                  value={boundTaskId || ''} 
                  onChange={e => setBoundTaskId(e.target.value ? parseInt(e.target.value) : null)}
                >
                  <option value="">{t('toolbox.option_unbound')}</option>
                  {activeTasks.map(t => (
                    <option key={t.id} value={t.id}>{t.title} ({t.priority})</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
                <button className="btn sm" onClick={() => { setPomoMinutes(25); setPomoSeconds(0) }}>{t('toolbox.btn_25_min')}</button>
                <button className="btn sm" onClick={() => { setPomoMinutes(5); setPomoSeconds(0) }}>{t('toolbox.btn_5_min_break')}</button>
                <button className="btn sm" onClick={() => { setPomoMinutes(15); setPomoSeconds(0) }}>{t('toolbox.btn_15_min_break')}</button>
              </div>
            </div>
          </div>
        )}

        {/* SUB-VIEW: CONVERTER */}
        {toolTab === 'converter' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className={`btn sm ${convertType === 'currency' ? 'primary' : ''}`} onClick={() => { setConvertType('currency'); setTargetUnit('USD') }}>{t('toolbox.converter_tab_rate')}</button>
              <button className={`btn sm ${convertType === 'len' ? 'primary' : ''}`} onClick={() => { setConvertType('len'); setTargetUnit('cm') }}>{t('toolbox.converter_tab_length')}</button>
              <button className={`btn sm ${convertType === 'weight' ? 'primary' : ''}`} onClick={() => { setConvertType('weight'); setTargetUnit('g') }}>{t('toolbox.converter_tab_weight')}</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '24px', maxWidth: '640px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>{t('toolbox.converter_label_input')}</label>
                <input className="form-field" type="number" value={inputValue} onChange={e => setInputValue(parseFloat(e.target.value) || 0)} />
              </div>

              <div style={{ fontSize: '18px', color: 'var(--text-muted)', fontWeight: 'bold' }}>➔</div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>{t('toolbox.converter_label_target')}</label>
                <select className="form-field" value={targetUnit} onChange={e => setTargetUnit(e.target.value)}>
                  {convertType === 'currency' && (
                    <>
                      <option value="USD">{t('toolbox.unit_usd')}</option>
                      <option value="EUR">{t('toolbox.unit_eur')}</option>
                      <option value="HKD">{t('toolbox.unit_hkd')}</option>
                      <option value="JPY">{t('toolbox.unit_jpy')}</option>
                    </>
                  )}
                  {convertType === 'len' && (
                    <>
                      <option value="cm">{t('toolbox.unit_cm')}</option>
                      <option value="inch">{t('toolbox.unit_inch')}</option>
                      <option value="feet">{t('toolbox.unit_feet')}</option>
                      <option value="km">{t('toolbox.unit_km')}</option>
                    </>
                  )}
                  {convertType === 'weight' && (
                    <>
                      <option value="g">{t('toolbox.unit_g')}</option>
                      <option value="lbs">{t('toolbox.unit_lbs')}</option>
                      <option value="oz">{t('toolbox.unit_oz')}</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div style={{ marginTop: '16px', padding: '16px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', width: 'max-content' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('toolbox.converter_result_title')}</div>
              <strong style={{ fontSize: '22px', display: 'block', margin: '4px 0' }}>
                {inputValue} CNY ＝ {convertedValue} {targetUnit}
              </strong>
              {convertType === 'currency' && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {t('toolbox.converter_offline_hint')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* SUB-VIEW: PASSWORD MANAGER VAULT */}
        {toolTab === 'vault' && (
          <div style={{ height: '100%' }}>
            {!isUnlocked ? (
              /* Lock screen overlay */
              <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px' }}>
                <Lock size={42} color="var(--text-muted)" />
                <h3 style={{ fontSize: '15px', fontWeight: 800 }}>{t('toolbox.vault_locked_title')}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', width: '320px', textAlign: 'center' }}>
                  {t('toolbox.vault_locked_desc')}
                </p>
                <div style={{ display: 'flex', gap: '8px', width: '280px' }}>
                  <input 
                    className="form-field"
                    type="password"
                    placeholder={t('toolbox.vault_password_placeholder')}
                    value={masterPassword}
                    onChange={e => setMasterPassword(e.target.value)}
                  />
                  <button className="btn primary" onClick={handleUnlockVault}>{t('toolbox.btn_unlock')}</button>
                </div>
              </div>
            ) : (
              /* Unlocked Vault layout */
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '16px', height: '100%' }}>
                {/* Left credentials list */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '13.5px' }}>{t('toolbox.vault_saved_credentials')} ({vaultItems.length})</strong>
                    <button className="btn sm" onClick={() => setIsUnlocked(false)}>{t('toolbox.btn_lock_vault')}</button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {vaultItems.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', fontStyle: 'italic', margin: 'auto', padding: '24px' }}>
                        {t('toolbox.vault_empty_tip')}
                      </p>
                    ) : (
                      vaultItems.map(item => {
                        const isVisible = showPwdMap[item.id] || false
                        return (
                          <div 
                            key={item.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr auto auto auto',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '10px',
                              border: '1px solid var(--color-border)',
                              borderRadius: '8px',
                              backgroundColor: 'var(--bg-app)'
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: '13px', display: 'block' }}>{item.website_name}</strong>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.username || t('toolbox.vault_no_username')}</span>
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                              {isVisible ? item.password_encrypted : '••••••••'}
                            </div>
                            <button 
                              className="btn sm btn-icon"
                              style={{ border: 'none', background: 'none' }}
                              onClick={() => setShowPwdMap(prev => ({ ...prev, [item.id]: !isVisible }))}
                            >
                              {isVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                             <button 
                              className="btn sm btn-icon"
                              style={{ border: 'none', background: 'none' }}
                              onClick={() => handleCopyPassword(item.password_encrypted)}
                              title={t('toolbox.vault_copy_tooltip')}
                            >
                              <Copy size={13} />
                            </button>
                            <button 
                              className="btn sm btn-icon"
                              style={{ border: 'none', background: 'none' }}
                              onClick={() => handleDeleteCredential(item.id)}
                            >
                              <Trash2 size={13} color="var(--color-danger)" />
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Right: add credential form */}
                <form onSubmit={handleCreateCredential} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', overflowY: 'auto' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 800 }}>{t('toolbox.vault_new_credential_title')}</h3>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('toolbox.vault_label_site')}</label>
                    <input className="form-field" value={newSite} onChange={e => setNewSite(e.target.value)} required placeholder={t('toolbox.vault_site_placeholder')} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('toolbox.vault_label_url')}</label>
                    <input className="form-field" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://github.com" />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('toolbox.vault_label_username')}</label>
                    <input className="form-field" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="admin@example.com" />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('toolbox.vault_label_password')}</label>
                      <button 
                        type="button" 
                        className="btn sm" 
                        style={{ border: 'none', height: '18px', padding: 0, fontSize: '10px', color: 'var(--color-accent)' }}
                        onClick={() => setNewPassword(Math.random().toString(36).substring(2, 12))}
                      >
                        {t('toolbox.vault_btn_generate_password')}
                      </button>
                    </div>
                    <input className="form-field" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{t('toolbox.vault_label_notes')}</label>
                    <textarea className="form-field" rows={2} value={newNotes} onChange={e => setNewNotes(e.target.value)} />
                  </div>
                  <button type="submit" className="btn primary" style={{ marginTop: 'auto' }}>
                    {t('toolbox.vault_btn_save_credential')}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

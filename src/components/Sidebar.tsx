import React from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { 
  LayoutDashboard, 
  CheckSquare, 
  FileText, 
  BookOpen, 
  Video, 
  Grid, 
  Settings, 
  Search,
  Calendar,
  RotateCcw,
  LogOut
} from 'lucide-react'

export const Sidebar: React.FC = () => {
  const { t } = useTranslation()
  const activeScreen = useAppStore(state => state.activeScreen)
  const setActiveScreen = useAppStore(state => state.setActiveScreen)
  const setTaskTab = useAppStore(state => state.setTaskTab)
  const userAvatar = useAppStore(state => state.userAvatar)
  const userNickname = useAppStore(state => state.userNickname)
  const signOut = useAppStore(state => state.signOut)

  const handleNavClick = (screen: string, tab?: string) => {
    setActiveScreen(screen)
    if (tab) setTaskTab(tab)
  }

  return (
    <aside className="sidebar-nav">
      <div className="nav-group">
        {/* User Profile Summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 10px', marginBottom: '16px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: 'var(--color-accent)',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 'bold',
            fontSize: '14px',
            flexShrink: 0
          }}>
            {userAvatar}
          </div>
          <span className="nav-label" style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userNickname}
          </span>
        </div>

        {/* Navigation Items */}
        <button 
          className={`nav-item ${activeScreen === 'dashboard' ? 'active' : ''}`}
          onClick={() => handleNavClick('dashboard')}
        >
          <span className="nav-icon"><LayoutDashboard size={18} /></span>
          <span className="nav-label">{t('sidebar.dashboard')}</span>
        </button>

        <button 
          className={`nav-item ${activeScreen === 'tasks' ? 'active' : ''}`}
          onClick={() => handleNavClick('tasks')}
        >
          <span className="nav-icon"><CheckSquare size={18} /></span>
          <span className="nav-label">{t('sidebar.tasks')}</span>
        </button>

        <button 
          className={`nav-item ${activeScreen === 'notes' ? 'active' : ''}`}
          onClick={() => handleNavClick('notes')}
        >
          <span className="nav-icon"><FileText size={18} /></span>
          <span className="nav-label">{t('sidebar.notes')}</span>
        </button>

        <button 
          className={`nav-item ${activeScreen === 'books' ? 'active' : ''}`}
          onClick={() => handleNavClick('books')}
        >
          <span className="nav-icon"><BookOpen size={18} /></span>
          <span className="nav-label">{t('sidebar.books')}</span>
        </button>

        <button 
          className={`nav-item ${activeScreen === 'videos' ? 'active' : ''}`}
          onClick={() => handleNavClick('videos')}
        >
          <span className="nav-icon"><Video size={18} /></span>
          <span className="nav-label">{t('sidebar.videos')}</span>
        </button>

        <button 
          className={`nav-item ${activeScreen === 'toolbox' ? 'active' : ''}`}
          onClick={() => handleNavClick('toolbox')}
        >
          <span className="nav-icon"><Grid size={18} /></span>
          <span className="nav-label">{t('sidebar.toolbox')}</span>
        </button>

        {/* Pinned Links */}
        <div style={{ marginTop: '20px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
          <p className="nav-label" style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingLeft: '14px', marginBottom: '8px' }}>
            {t('sidebar.pinned')}
          </p>
          <button 
            className="nav-item"
            onClick={() => handleNavClick('tasks', 'calendar')}
          >
            <span className="nav-icon"><Calendar size={18} /></span>
            <span className="nav-label">{t('tasks.tab_calendar')}</span>
          </button>
          <button 
            className="nav-item"
            onClick={() => handleNavClick('tasks', 'recurring')}
          >
            <span className="nav-icon"><RotateCcw size={18} /></span>
            <span className="nav-label">{t('tasks.tab_recurring')}</span>
          </button>
        </div>
      </div>

      <div className="nav-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <button 
          className={`nav-item ${activeScreen === 'settings' ? 'active' : ''}`}
          onClick={() => handleNavClick('settings')}
        >
          <span className="nav-icon"><Settings size={18} /></span>
          <span className="nav-label">{t('sidebar.settings')}</span>
        </button>
        <button 
          className="nav-item"
          onClick={signOut}
          style={{ color: 'var(--color-danger)' }}
        >
          <span className="nav-icon"><LogOut size={18} /></span>
          <span className="nav-label">{t('sidebar.sign_out') || '退出登录'}</span>
        </button>
      </div>
    </aside>
  )
}

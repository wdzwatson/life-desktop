import React from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { Search, Plus, Upload, Globe, Palette } from 'lucide-react'
import { shouldHighlightTopbarNewTask } from './topbarUtils'

export const Topbar: React.FC<{ onOpenSearch: () => void }> = ({ onOpenSearch }) => {
  const { t } = useTranslation()
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const language = useAppStore((state) => state.language)
  const setLanguage = useAppStore((state) => state.setLanguage)
  const activeScreen = useAppStore((state) => state.activeScreen)
  const setActiveScreen = useAppStore((state) => state.setActiveScreen)
  const setTaskTab = useAppStore((state) => state.setTaskTab)

  const themes = ['Minimal', 'Dense', 'Card', 'Dark Tech']

  const cycleTheme = () => {
    const currentIndex = themes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex])
  }

  const toggleLanguage = () => {
    setLanguage(language === 'zh-CN' ? 'en-US' : 'zh-CN')
  }

  const handleNewTask = () => {
    setActiveScreen('tasks')
    setTaskTab('list')
    setTimeout(() => {
      const input = document.getElementById('quickTitle')
      if (input) input.focus()
    }, 100)
  }

  const handleImportFile = () => {
    const api = (window as any).electronAPI
    if (api) {
      // Trigger a mock file load or open workspace settings
      setActiveScreen('settings')
      setTaskTab('appearance') // Default settings page
      useAppStore.getState().showToast(t('topbar.manage_dir_hint'))
    }
  }

  const isMac = navigator.userAgent.includes('Mac')

  return (
    <header className="top-bar">
      {/* Global search trigger */}
      <button className="global-search-btn" onClick={onOpenSearch}>
        <Search size={16} />
        <span style={{ fontSize: '13px' }}>{t('topbar.search_placeholder')}</span>
        <span className="kbd-shortcut">{isMac ? '⌘ K' : 'Ctrl+K'}</span>
      </button>

      {/* Control buttons */}
      <div className="topbar-actions">
        {/* Module shortcuts */}
        <button
          className={`btn ${shouldHighlightTopbarNewTask(activeScreen) ? 'primary' : ''}`.trim()}
          onClick={handleNewTask}
        >
          <Plus size={15} />
          {t('common.new_task')}
        </button>

        <button className="btn" onClick={handleImportFile}>
          <Upload size={14} />
          {t('common.imported')}
        </button>

        {/* Theme and Language Cyclers */}
        <button className="btn btn-icon" onClick={cycleTheme} title={t('topbar.switch_theme')}>
          <Palette size={16} />
        </button>

        <button className="btn btn-icon" onClick={toggleLanguage} title="Switch Language">
          <Globe size={16} />
        </button>
      </div>
    </header>
  )
}

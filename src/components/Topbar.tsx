import React, { useEffect, useRef, useState } from 'react'
import { type SidebarDisplayMode, useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Globe,
  Palette,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  StickyNote,
  Upload,
} from 'lucide-react'
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
  const sidebarDisplayMode = useAppStore((state) => state.sidebarDisplayMode)
  const setSidebarDisplayMode = useAppStore((state) => state.setSidebarDisplayMode)
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false)
  const sidebarMenuRef = useRef<HTMLDivElement>(null)

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
    setTimeout(() => window.dispatchEvent(new Event('task:create')), 0)
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

  const handleShowDesktopTaskNote = () => {
    void (window as any).electronAPI?.showDesktopTaskNote?.()
  }

  const isMac = navigator.userAgent.includes('Mac')

  useEffect(() => {
    if (!sidebarMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!sidebarMenuRef.current?.contains(event.target as Node)) {
        setSidebarMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [sidebarMenuOpen])

  const sidebarDisplayOptions: Array<{
    mode: SidebarDisplayMode
    label: string
    Icon: typeof PanelLeft
  }> = [
    { mode: 'dynamic', label: t('topbar.sidebar_mode_dynamic'), Icon: PanelLeft },
    { mode: 'collapsed', label: t('topbar.sidebar_mode_collapsed'), Icon: PanelLeftClose },
    { mode: 'expanded', label: t('topbar.sidebar_mode_expanded'), Icon: PanelLeftOpen },
  ]

  const handleSidebarDisplayMode = (mode: SidebarDisplayMode) => {
    void setSidebarDisplayMode(mode)
    setSidebarMenuOpen(false)
  }

  return (
    <header className="top-bar">
      <div className="topbar-search-controls">
        <div className="sidebar-display-menu" ref={sidebarMenuRef}>
          <button
            className="btn btn-icon sidebar-display-menu__trigger"
            type="button"
            onClick={() => setSidebarMenuOpen((open) => !open)}
            title={t('topbar.sidebar_display')}
            aria-label={t('topbar.sidebar_display')}
            aria-haspopup="menu"
            aria-expanded={sidebarMenuOpen}
            aria-controls="sidebar-display-options"
          >
            <PanelLeft size={17} />
          </button>
          {sidebarMenuOpen && (
            <div id="sidebar-display-options" className="sidebar-display-menu__panel" role="menu">
              {sidebarDisplayOptions.map(({ mode, label, Icon }) => (
                <button
                  key={mode}
                  className="sidebar-display-menu__option"
                  type="button"
                  role="menuitemradio"
                  aria-checked={sidebarDisplayMode === mode}
                  onClick={() => handleSidebarDisplayMode(mode)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                  {sidebarDisplayMode === mode && <Check size={15} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Global search trigger */}
        <button className="global-search-btn" onClick={onOpenSearch}>
          <Search size={16} />
          <span style={{ fontSize: '13px' }}>{t('topbar.search_placeholder')}</span>
          <span className="kbd-shortcut">{isMac ? '⌘ K' : 'Ctrl+K'}</span>
        </button>
      </div>

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

        <button
          className="btn btn-icon"
          onClick={handleShowDesktopTaskNote}
          title={t('topbar.show_desktop_task_note')}
          aria-label={t('topbar.show_desktop_task_note')}
        >
          <StickyNote size={16} />
        </button>

        {/* Theme and Language Cyclers */}
        <button
          className="btn btn-icon"
          onClick={cycleTheme}
          title={t('topbar.switch_theme')}
          aria-label={t('topbar.switch_theme')}
        >
          <Palette size={16} />
        </button>

        <button
          className="btn btn-icon"
          onClick={toggleLanguage}
          title={t('topbar.switch_language')}
          aria-label={t('topbar.switch_language')}
        >
          <Globe size={16} />
        </button>
      </div>
    </header>
  )
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Minus, Square, X } from 'lucide-react'

type WindowApi = {
  platform?: string
  getWindowState?: () => Promise<{ isMaximized?: boolean }>
  minimizeWindow?: () => Promise<unknown>
  toggleMaximizeWindow?: () => Promise<{ isMaximized?: boolean } | undefined>
  closeWindow?: () => Promise<unknown>
  onWindowMaximizedChange?: (callback: (isMaximized: boolean) => void) => (() => void) | undefined
}

const CUSTOM_TITLEBAR_PLATFORMS = ['win32', 'linux']

type DesktopTitlebarProps = {
  title?: string
}

export function DesktopTitlebar({ title = 'LifeOS' }: DesktopTitlebarProps) {
  const { t } = useTranslation()
  const api = (window as any).electronAPI as WindowApi | undefined
  const platform = api?.platform
  const hasCustomTitlebar = CUSTOM_TITLEBAR_PLATFORMS.includes(platform || '')
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)

  useEffect(() => {
    if (!hasCustomTitlebar) return

    let mounted = true
    void api?.getWindowState?.().then((state) => {
      if (mounted) setIsWindowMaximized(Boolean(state?.isMaximized))
    })
    const unsubscribe = api?.onWindowMaximizedChange?.((nextMaximized) => {
      setIsWindowMaximized(nextMaximized)
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [api, hasCustomTitlebar])

  if (!hasCustomTitlebar) return null

  const toggleMaximize = async () => {
    const result = await api?.toggleMaximizeWindow?.()
    if (typeof result?.isMaximized === 'boolean') setIsWindowMaximized(result.isMaximized)
  }

  return (
    <header className={`desktop-titlebar desktop-titlebar--${platform}`}>
      <div className="desktop-titlebar__caption">
        <span>{title}</span>
      </div>
      <div className="desktop-titlebar__controls" aria-label={t('topbar.window_controls')}>
        <button
          className="desktop-titlebar__control"
          type="button"
          onClick={() => void api?.minimizeWindow?.()}
          title={t('topbar.window_minimize')}
          aria-label={t('topbar.window_minimize')}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <button
          className="desktop-titlebar__control"
          type="button"
          onClick={() => void toggleMaximize()}
          title={isWindowMaximized ? t('topbar.window_restore') : t('topbar.window_maximize')}
          aria-label={isWindowMaximized ? t('topbar.window_restore') : t('topbar.window_maximize')}
        >
          {isWindowMaximized ? (
            <Copy size={13} aria-hidden="true" />
          ) : (
            <Square size={13} aria-hidden="true" />
          )}
        </button>
        <button
          className="desktop-titlebar__control desktop-titlebar__control--close"
          type="button"
          onClick={() => void api?.closeWindow?.()}
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}

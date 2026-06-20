import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'

export const Statusbar: React.FC = () => {
  const { t } = useTranslation()
  const activeScreen = useAppStore((state) => state.activeScreen)
  const toastMessage = useAppStore((state) => state.toastMessage)

  // Local counts fetched from SQLite
  const [taskCount, setTaskCount] = useState(0)
  const [recurCount, setRecurCount] = useState(0)
  const userId = useAppStore((state) => state.userId)

  // Fetch counts when user database changes or screen switches
  useEffect(() => {
    const api = (window as any).electronAPI
    if (api) {
      // Fetch total active tasks
      api
        .dbQuery('tasks', 'SELECT COUNT(*) as count FROM tasks WHERE is_completed = 0')
        .then((res: any) => {
          if (res?.success) setTaskCount(res.data[0].count)
        })
      // Fetch recurring rules count
      api.dbQuery('tasks', 'SELECT COUNT(*) as count FROM recurring_rules').then((res: any) => {
        if (res?.success) setRecurCount(res.data[0].count)
      })
    }
  }, [activeScreen, userId, toastMessage])

  return (
    <footer className="status-bar">
      {/* Connection state */}
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: 'var(--color-success)',
            display: 'inline-block',
          }}
        />
        Ready · {activeScreen.toUpperCase()} · {t('common.offline')} ({userId})
      </span>

      {/* Dynamic database statistics */}
      <div style={{ display: 'flex', gap: '16px' }}>
        <span>
          Tasks: <strong>{taskCount}</strong>
        </span>
        <span>
          Rules: <strong>{recurCount}</strong>
        </span>
      </div>

      {/* Global overlay Toast notifications */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '48px',
            right: '24px',
            padding: '10px 18px',
            borderRadius: '8px',
            backgroundColor: 'var(--text-main)',
            color: 'var(--bg-app)',
            fontSize: '13px',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 9999,
            animation: 'toastEnter 0.2s ease both',
          }}
        >
          <style
            dangerouslySetInnerHTML={{
              __html: `
            @keyframes toastEnter {
              from { opacity: 0; transform: translateY(8px); }
              to { opacity: 1; transform: none; }
            }
          `,
            }}
          />
          {toastMessage}
        </div>
      )}
    </footer>
  )
}

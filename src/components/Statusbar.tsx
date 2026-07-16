import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Info, Trash2 } from 'lucide-react'

export const Statusbar: React.FC = () => {
  const { t } = useTranslation()
  const activeScreen = useAppStore((state) => state.activeScreen)
  const toastMessage = useAppStore((state) => state.toastMessage)

  // Local counts fetched from SQLite
  const [taskCount, setTaskCount] = useState(0)
  const [recurCount, setRecurCount] = useState(0)
  const userId = useAppStore((state) => state.userId)

  const toastTone = toastMessage
    ? /失败|错误|无法|失败|failed|error|unable|could not|cannot|not ready/i.test(toastMessage)
      ? 'error'
      : /删除|清除|delete|removed|cleared/i.test(toastMessage)
        ? 'warning'
        : /成功|已保存|保存|完成|解锁|已复制|created|saved|completed|success|unlocked|copied/i.test(
            toastMessage,
          )
          ? 'success'
          : 'info'
    : 'info'

  const ToastIcon =
    toastTone === 'error'
      ? AlertCircle
      : toastTone === 'warning'
        ? Trash2
        : toastTone === 'success'
          ? CheckCircle2
          : Info

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
          className={`toast-notification toast-notification--${toastTone}`}
          role="status"
          aria-live="polite"
        >
          <ToastIcon size={16} strokeWidth={2.2} aria-hidden="true" />
          {toastMessage}
        </div>
      )}
    </footer>
  )
}

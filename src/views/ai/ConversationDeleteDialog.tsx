import { Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import type { AIChatConversation } from './chatUtils'

type ConversationDeleteDialogProps = {
  conversation: AIChatConversation
  submitting: boolean
  onCancel: () => void
  onConfirm: (deleteUnreferencedMedia: boolean) => void
  returnFocus: () => void
}

export function ConversationDeleteDialog({
  conversation,
  submitting,
  onCancel,
  onConfirm,
  returnFocus,
}: ConversationDeleteDialogProps) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [deleteMedia, setDeleteMedia] = useState(false)

  return (
    <AccessibleDialog
      title={t('aiChat.chat.delete_dialog_title')}
      onClose={() => {
        if (!submitting) onCancel()
      }}
      returnFocus={returnFocus}
      initialFocusRef={cancelRef}
      role="alertdialog"
      overlayClassName="ai-conversation-dialog-overlay"
      contentClassName="ai-conversation-dialog ai-conversation-delete__panel"
      closeOnOverlay
    >
      <div className="ai-conversation-delete__heading">
        <span aria-hidden="true"><Trash2 size={18} /></span>
        <p>{t('aiChat.chat.delete_dialog_desc', { name: conversation.title })}</p>
      </div>

      <label className="ai-conversation-delete__media-option">
        <input
          type="checkbox"
          checked={deleteMedia}
          disabled={submitting}
          onChange={(event) => setDeleteMedia(event.target.checked)}
        />
        <span>
          <strong>{t('aiChat.chat.delete_media_option')}</strong>
          <small>{t('aiChat.chat.delete_media_option_desc')}</small>
        </span>
      </label>

      <div className="ai-conversation-dialog__actions">
        <button ref={cancelRef} className="btn" disabled={submitting} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          className="btn danger"
          disabled={submitting}
          onClick={() => onConfirm(deleteMedia)}
        >
          {t('common.delete')}
        </button>
      </div>
    </AccessibleDialog>
  )
}

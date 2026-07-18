import { Pencil } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import type { AIChatConversation } from './chatUtils'

type ConversationRenameDialogProps = {
  conversation: AIChatConversation
  submitting: boolean
  onCancel: () => void
  onConfirm: (title: string) => void
  returnFocus: () => void
}

export function ConversationRenameDialog({
  conversation,
  submitting,
  onCancel,
  onConfirm,
  returnFocus,
}: ConversationRenameDialogProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(conversation.title)
  const normalizedTitle = title.trim()
  const canSave = Boolean(normalizedTitle && normalizedTitle !== conversation.title && !submitting)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSave) onConfirm(normalizedTitle)
  }

  return (
    <AccessibleDialog
      title={t('aiChat.chat.rename_dialog_title')}
      onClose={() => {
        if (!submitting) onCancel()
      }}
      returnFocus={returnFocus}
      initialFocusRef={inputRef}
      overlayClassName="ai-conversation-dialog-overlay"
      contentClassName="ai-conversation-dialog ai-conversation-rename-dialog"
      closeOnOverlay
    >
      <form onSubmit={submit}>
        <label className="ai-conversation-rename__field">
          <span><Pencil size={14} aria-hidden="true" />{t('aiChat.chat.rename_label')}</span>
          <input
            ref={inputRef}
            className="form-field"
            value={title}
            maxLength={160}
            disabled={submitting}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="ai-conversation-dialog__actions">
          <button type="button" className="btn" disabled={submitting} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!canSave}>
            {t('aiChat.chat.rename_save')}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

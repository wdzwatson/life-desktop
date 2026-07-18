import { Archive, ArchiveRestore, MessageSquare, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sortAIConversations, type AIChatConversation } from './chatUtils'

type ConversationListProps = {
  conversations: AIChatConversation[]
  activeId: number | null
  search: string
  showArchived: boolean
  loading: boolean
  canCreate: boolean
  onSearchChange: (value: string) => void
  onShowArchivedChange: (value: boolean) => void
  onSelect: (conversation: AIChatConversation) => void
  onCreate: () => void
  onRename: (conversation: AIChatConversation, trigger: HTMLButtonElement) => void
  onTogglePinned: (conversation: AIChatConversation) => void
  onToggleArchived: (conversation: AIChatConversation) => void
  onDelete: (conversation: AIChatConversation, trigger: HTMLButtonElement) => void
}

function formatActivity(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ConversationList({
  conversations,
  activeId,
  search,
  showArchived,
  loading,
  canCreate,
  onSearchChange,
  onShowArchivedChange,
  onSelect,
  onCreate,
  onRename,
  onTogglePinned,
  onToggleArchived,
  onDelete,
}: ConversationListProps) {
  const { t } = useTranslation()
  const ordered = sortAIConversations(conversations)

  return (
    <aside className="ai-conversation-sidebar" aria-label={t('aiChat.chat.history')}>
      <div className="ai-conversation-sidebar__top">
        <div>
          <h2>{t('aiChat.chat.history')}</h2>
          <p>{t('aiChat.chat.history_count', { count: conversations.length })}</p>
        </div>
        <button
          className="btn primary ai-conversation-new"
          onClick={onCreate}
          disabled={!canCreate}
          title={!canCreate ? t('aiChat.chat.agent_required') : undefined}
        >
          <Plus size={15} aria-hidden="true" />
          {t('aiChat.chat.new_conversation')}
        </button>
      </div>

      <label className="ai-conversation-search">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">{t('aiChat.chat.search_label')}</span>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('aiChat.chat.search_placeholder')}
        />
      </label>

      <label className="ai-conversation-archive-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => onShowArchivedChange(event.target.checked)}
        />
        <span>{t('aiChat.chat.show_archived')}</span>
      </label>

      <div className="ai-conversation-list" aria-busy={loading}>
        {!loading && ordered.length === 0 && (
          <div className="ai-conversation-list__empty">
            <MessageSquare size={20} aria-hidden="true" />
            <p>{search ? t('aiChat.chat.no_search_results') : t('aiChat.chat.no_conversations')}</p>
          </div>
        )}
        {ordered.map((conversation) => (
          <article
            key={conversation.id}
            className={`ai-conversation-item ${conversation.id === activeId ? 'is-active' : ''}`}
          >
            <button
              className="ai-conversation-item__main"
              onClick={() => onSelect(conversation)}
              aria-current={conversation.id === activeId ? 'true' : undefined}
            >
              <span className="ai-conversation-item__title">
                {conversation.isPinned && <Pin size={11} aria-hidden="true" />}
                <strong>{conversation.title}</strong>
              </span>
              <span className="ai-conversation-item__meta">
                <span>{t('aiChat.chat.message_count', { count: conversation.messageCount })}</span>
                <time>{formatActivity(conversation.lastMessageAt ?? conversation.updatedAt)}</time>
              </span>
            </button>
            <div className="ai-conversation-item__actions">
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  onRename(conversation, event.currentTarget)
                }}
                aria-label={t('aiChat.chat.rename_name', { name: conversation.title })}
                title={t('aiChat.chat.rename')}
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => onTogglePinned(conversation)}
                aria-label={t(conversation.isPinned ? 'aiChat.chat.unpin_name' : 'aiChat.chat.pin_name', { name: conversation.title })}
                title={t(conversation.isPinned ? 'aiChat.chat.unpin' : 'aiChat.chat.pin')}
              >
                {conversation.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
              </button>
              <button
                onClick={() => onToggleArchived(conversation)}
                aria-label={t(conversation.isArchived ? 'aiChat.chat.restore_name' : 'aiChat.chat.archive_name', { name: conversation.title })}
                title={t(conversation.isArchived ? 'aiChat.chat.restore' : 'aiChat.chat.archive')}
              >
                {conversation.isArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
              </button>
              <button
                className="is-danger"
                onClick={(event) => {
                  event.stopPropagation()
                  onDelete(conversation, event.currentTarget)
                }}
                aria-label={t('aiChat.chat.delete_name', { name: conversation.title })}
                title={t('common.delete')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  )
}

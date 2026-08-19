import React, { useEffect, useMemo, useState } from 'react'
import {
  Edit3,
  Highlighter,
  Languages,
  ListFilter,
  LocateFixed,
  MessageSquareText,
  PanelRightClose,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ReaderAnnotationPanelKind = 'translation' | 'highlight' | 'note'
export type ReaderAnnotationPanelFilter = 'all' | ReaderAnnotationPanelKind

export type ReaderAnnotationPanelItem = {
  id: string
  kind: ReaderAnnotationPanelKind
  text: string
  content?: string
  locationLabel: string
  createdAt?: string | null
}

export const READER_ANNOTATION_PAGE_SIZE = 80

const READER_ANNOTATION_FILTERS: Array<{
  id: ReaderAnnotationPanelFilter
  icon: typeof ListFilter
}> = [
  { id: 'all', icon: ListFilter },
  { id: 'translation', icon: Languages },
  { id: 'highlight', icon: Highlighter },
  { id: 'note', icon: MessageSquareText },
]

export const getReaderAnnotationCounts = (items: ReaderAnnotationPanelItem[]) => {
  const counts = { all: items.length, translation: 0, highlight: 0, note: 0 }
  items.forEach((item) => {
    counts[item.kind] += 1
  })
  return counts
}

export const filterReaderAnnotationItems = (
  items: ReaderAnnotationPanelItem[],
  filter: ReaderAnnotationPanelFilter,
) => (filter === 'all' ? items : items.filter((item) => item.kind === filter))

export const getReaderAnnotationPage = (
  items: ReaderAnnotationPanelItem[],
  visibleCount: number,
) => items.slice(0, Math.max(0, visibleCount))

const AnnotationCard = React.memo(function AnnotationCard({
  item,
  isActive,
  locale,
  onActivate,
  onEdit,
  onDelete,
}: {
  item: ReaderAnnotationPanelItem
  isActive: boolean
  locale: string
  onActivate: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const KindIcon =
    item.kind === 'translation'
      ? Languages
      : item.kind === 'highlight'
        ? Highlighter
        : MessageSquareText
  const createdAt = item.createdAt ? new Date(item.createdAt) : null
  const createdAtLabel =
    createdAt && Number.isFinite(createdAt.getTime())
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(createdAt)
      : null

  return (
    <article
      data-reader-annotation-id={item.id}
      className={`book-reader__annotation-card is-${item.kind} ${isActive ? 'is-active' : ''}`}
    >
      <header className="book-reader__annotation-card-header">
        <span className="book-reader__annotation-kind">
          <KindIcon size={12} aria-hidden="true" />
          {t(`books.reader_annotation_kind_${item.kind}`)}
        </span>
        <div className="book-reader__annotation-actions">
          <button
            type="button"
            className="book-reader__annotation-action"
            onClick={() => onEdit(item.id)}
            aria-label={t('common.edit')}
            title={t('common.edit')}
          >
            <Edit3 size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="book-reader__annotation-action"
            onClick={() => onActivate(item.id)}
            aria-label={t('books.locate_reader_annotation', { text: item.text })}
            title={t('books.locate_reader_annotation', { text: item.text })}
          >
            <LocateFixed size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="book-reader__annotation-action is-danger"
            onClick={() => onDelete(item.id)}
            aria-label={t('books.delete_reader_annotation', { text: item.text })}
            title={t('books.delete_reader_annotation', { text: item.text })}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div
        className="book-reader__annotation-card-target"
        role="button"
        tabIndex={0}
        aria-label={t('books.locate_reader_annotation', { text: item.text })}
        onClick={() => onActivate(item.id)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onActivate(item.id)
        }}
      >
        <span className="book-reader__annotation-location">{item.locationLabel}</span>
        <blockquote className="book-reader__annotation-source">{item.text}</blockquote>
        {item.kind === 'translation' && item.content ? (
          <p className="book-reader__annotation-content is-translation">{item.content}</p>
        ) : null}
        {item.kind === 'note' && item.content ? (
          <p className="book-reader__annotation-content is-note">{item.content}</p>
        ) : null}
        {createdAtLabel ? (
          <time className="book-reader__annotation-time" dateTime={createdAt?.toISOString()}>
            {t('books.reader_annotation_created_at', { time: createdAtLabel })}
          </time>
        ) : null}
      </div>
    </article>
  )
}, (previous, next) =>
  previous.item.id === next.item.id &&
  previous.item.kind === next.item.kind &&
  previous.item.text === next.item.text &&
  previous.item.content === next.item.content &&
  previous.item.locationLabel === next.item.locationLabel &&
  previous.item.createdAt === next.item.createdAt &&
  previous.isActive === next.isActive &&
  previous.locale === next.locale &&
  previous.onActivate === next.onActivate &&
  previous.onEdit === next.onEdit &&
  previous.onDelete === next.onDelete)

export const ReaderAnnotationsPanel = React.memo(function ReaderAnnotationsPanel({
  items,
  activeItemId,
  onActivate,
  onEdit,
  onDelete,
  onClose,
}: {
  items: ReaderAnnotationPanelItem[]
  activeItemId?: string | null
  onActivate: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const [filter, setFilter] = useState<ReaderAnnotationPanelFilter>('all')
  const [visibleCount, setVisibleCount] = useState(READER_ANNOTATION_PAGE_SIZE)
  const counts = useMemo(() => getReaderAnnotationCounts(items), [items])
  const filteredItems = useMemo(() => filterReaderAnnotationItems(items, filter), [filter, items])
  const visibleItems = useMemo(
    () => getReaderAnnotationPage(filteredItems, visibleCount),
    [filteredItems, visibleCount],
  )

  useEffect(() => {
    setVisibleCount(READER_ANNOTATION_PAGE_SIZE)
  }, [filter])

  useEffect(() => {
    if (!activeItemId) return
    const activeItem = items.find((item) => item.id === activeItemId)
    if (!activeItem) return
    if (filter !== 'all' && filter !== activeItem.kind) {
      setFilter('all')
      return
    }
    const activeIndex = filteredItems.findIndex((item) => item.id === activeItemId)
    if (activeIndex < 0) return
    const requiredCount =
      Math.ceil((activeIndex + 1) / READER_ANNOTATION_PAGE_SIZE) *
      READER_ANNOTATION_PAGE_SIZE
    setVisibleCount((current) => Math.max(current, requiredCount))
  }, [activeItemId, filter, filteredItems, items])

  return (
    <section className="reader-annotations-panel" aria-label={t('books.highlights_annotations_title')}>
      <header className="reader-annotations-panel__header">
        <h4>
          {t('books.highlights_annotations_title')} ({counts.all})
        </h4>
        <button
          type="button"
          className="reader-annotations-panel__close"
          onClick={onClose}
          aria-label={t('books.hide_annotations')}
          title={t('books.hide_annotations')}
        >
          <PanelRightClose size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="reader-annotations-panel__filters" role="group" aria-label={t('books.annotation_filter_label')}>
        {READER_ANNOTATION_FILTERS.map(({ id, icon: FilterIcon }) => (
          <button
            key={id}
            type="button"
            className={`reader-annotations-panel__filter is-${id}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            <FilterIcon size={12} aria-hidden="true" />
            <span>{t(`books.annotation_filter_${id}`)}</span>
            <strong>{counts[id]}</strong>
          </button>
        ))}
      </div>

      {visibleItems.length > 0 ? (
        <div className="book-reader__annotation-list">
          {visibleItems.map((item) => (
            <AnnotationCard
              key={item.id}
              item={item}
              isActive={activeItemId === item.id}
              locale={i18n.language}
              onActivate={onActivate}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <p className="reader-annotations-panel__empty">{t('books.annotation_filter_empty')}</p>
      )}

      {visibleItems.length < filteredItems.length ? (
        <button
          type="button"
          className="reader-annotations-panel__more"
          onClick={() => setVisibleCount((current) => current + READER_ANNOTATION_PAGE_SIZE)}
        >
          {t('books.annotation_load_more', {
            shown: visibleItems.length,
            total: filteredItems.length,
          })}
        </button>
      ) : null}
    </section>
  )
})

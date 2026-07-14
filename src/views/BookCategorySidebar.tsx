import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { BookOpen, Inbox, Languages, Library, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getContextMenuPosition } from './bookCategorySidebarUtils'
import './BookCategorySidebar.css'

export type BookShelf = {
  id: string | number
  name: string
}

export type MutationResult = { ok: true } | { ok: false; error: string }

export type BookCategorySidebarProps = {
  categories: BookShelf[]
  activeCategory: string
  allBooksCount: number
  toOrganizeCount: number
  getCategoryDisplayName: (category: BookShelf) => string
  getCategoryBookCount: (category: BookShelf) => number
  onSelectCategory: (category: string) => void
  onCreateCategory: (name: string) => Promise<MutationResult>
  onRenameCategory: (category: BookShelf, name: string) => Promise<MutationResult>
  onEditTranslations: (category: BookShelf) => void
  onRequestDelete: (category: BookShelf) => void
}

type ContextMenuState = {
  category: BookShelf
  left: number
  top: number
}

const CONTEXT_MENU_WIDTH = 176
const CONTEXT_MENU_HEIGHT = 132

export function BookCategorySidebar({
  categories,
  activeCategory,
  allBooksCount,
  toOrganizeCount,
  getCategoryDisplayName,
  getCategoryBookCount,
  onSelectCategory,
  onCreateCategory,
  onRenameCategory,
  onEditTranslations,
  onRequestDelete,
}: BookCategorySidebarProps) {
  const { t } = useTranslation()
  const [addName, setAddName] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<BookShelf['id'] | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [inlineError, setInlineError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const originatingRowRef = useRef<HTMLButtonElement | null>(null)
  const isSubmittingRef = useRef(false)
  const isMountedRef = useRef(true)

  const isAdding = addName !== null

  const closeContextMenu = useCallback((restoreFocus = true) => {
    setContextMenu(null)
    if (restoreFocus) originatingRowRef.current?.focus()
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      isSubmittingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    const handleDocumentPointerDown = () => closeContextMenu(false)
    document.addEventListener('pointerdown', handleDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown)
  }, [closeContextMenu, contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [contextMenu])

  const cancelAdd = () => {
    setAddName(null)
    setInlineError('')
  }

  const startAdd = () => {
    if (isSubmittingRef.current) return
    setAddName('')
    setRenamingId(null)
    setRenameValue('')
    setInlineError('')
  }

  const submitAdd = async () => {
    if (isSubmittingRef.current) return

    const name = addName?.trim() ?? ''
    if (!name) {
      setInlineError(t('books.shelf_name_required'))
      return
    }

    isSubmittingRef.current = true
    setIsSubmitting(true)
    try {
      const result = await onCreateCategory(name)
      if (!isMountedRef.current) return
      if (!result.ok) {
        setInlineError(result.error)
        return
      }
      setAddName(null)
      setInlineError('')
    } catch (error) {
      if (isMountedRef.current) {
        setInlineError(
          error instanceof Error ? error.message : t('books.toast_category_create_failed'),
        )
      }
    } finally {
      isSubmittingRef.current = false
      if (isMountedRef.current) setIsSubmitting(false)
    }
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
    setInlineError('')
  }

  const startRename = (category: BookShelf) => {
    if (isSubmittingRef.current) {
      closeContextMenu(false)
      return
    }
    setAddName(null)
    setRenamingId(category.id)
    setRenameValue(getCategoryDisplayName(category))
    setInlineError('')
    closeContextMenu(false)
  }

  const submitRename = async (category: BookShelf) => {
    if (isSubmittingRef.current) return

    const name = renameValue.trim()
    if (!name) {
      setInlineError(t('books.shelf_name_required'))
      return
    }

    isSubmittingRef.current = true
    setIsSubmitting(true)
    try {
      const result = await onRenameCategory(category, name)
      if (!isMountedRef.current) return
      if (!result.ok) {
        setInlineError(result.error)
        return
      }
      setRenamingId(null)
      setRenameValue('')
      setInlineError('')
    } catch (error) {
      if (isMountedRef.current) {
        setInlineError(
          error instanceof Error ? error.message : t('books.toast_category_update_failed'),
        )
      }
    } finally {
      isSubmittingRef.current = false
      if (isMountedRef.current) setIsSubmitting(false)
    }
  }

  const openContextMenu = (event: MouseEvent<HTMLButtonElement>, category: BookShelf) => {
    event.preventDefault()
    event.stopPropagation()
    originatingRowRef.current = event.currentTarget
    const position = getContextMenuPosition({
      clientX: event.clientX,
      clientY: event.clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      menuWidth: CONTEXT_MENU_WIDTH,
      menuHeight: CONTEXT_MENU_HEIGHT,
    })
    setContextMenu({ category, ...position })
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeContextMenu()
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    )
    if (items.length === 0) return

    const activeIndex = items.findIndex((item) => item === document.activeElement)
    const nextIndex =
      event.key === 'ArrowDown'
        ? (activeIndex + 1) % items.length
        : (activeIndex - 1 + items.length) % items.length
    items[nextIndex].focus()
  }

  const handleAddSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitAdd()
  }

  const handleRenameSubmit = (event: FormEvent<HTMLFormElement>, category: BookShelf) => {
    event.preventDefault()
    void submitRename(category)
  }

  return (
    <aside className="book-category-sidebar card" aria-label={t('books.sidebar_title')}>
      <h2 className="book-category-sidebar__title">{t('books.sidebar_title')}</h2>

      <div className="book-category-sidebar__content">
        <div className="book-category-sidebar__fixed-list">
          <button
            type="button"
            className={`book-category-sidebar__row ${activeCategory === 'all' ? 'active' : ''}`}
            onClick={() => onSelectCategory('all')}
            onContextMenu={(event) => event.preventDefault()}
          >
            <Library aria-hidden="true" />
            <span className="book-category-sidebar__label" title={t('books.all_books')}>
              {t('books.all_books')}
            </span>
            <span className="book-category-sidebar__count">{allBooksCount}</span>
          </button>

          <button
            type="button"
            className={`book-category-sidebar__row book-category-sidebar__to-organize ${
              toOrganizeCount > 0 ? 'has-items' : ''
            } ${activeCategory === 'uncategorized' ? 'active' : ''}`}
            onClick={() => onSelectCategory('uncategorized')}
            onContextMenu={(event) => event.preventDefault()}
          >
            <Inbox aria-hidden="true" />
            <span className="book-category-sidebar__label" title={t('books.to_organize')}>
              {t('books.to_organize')}
            </span>
            <span className="book-category-sidebar__count">{toOrganizeCount}</span>
          </button>
        </div>

        <div className="book-category-sidebar__group-title">
          <span>{t('books.my_shelves')}</span>
          <button
            type="button"
            className="book-category-sidebar__add-button"
            aria-label={t('books.add_shelf')}
            title={t('books.add_shelf')}
            onClick={startAdd}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        <div className="book-category-sidebar__custom-list">
          {isAdding && (
            <form className="book-category-sidebar__editor" onSubmit={handleAddSubmit}>
              <div className="book-category-sidebar__editor-row">
                <BookOpen aria-hidden="true" />
                <input
                  autoFocus
                  value={addName ?? ''}
                  disabled={isSubmitting}
                  aria-invalid={inlineError ? 'true' : undefined}
                  aria-label={t('books.add_shelf')}
                  onChange={(event) => setAddName(event.target.value)}
                  onBlur={() => {
                    if (!isSubmittingRef.current) cancelAdd()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelAdd()
                    }
                  }}
                />
              </div>
              {inlineError && <p className="book-category-sidebar__error">{inlineError}</p>}
            </form>
          )}

          {categories.map((category) => {
            const displayName = getCategoryDisplayName(category)
            if (renamingId === category.id) {
              return (
                <form
                  key={category.id}
                  className="book-category-sidebar__editor"
                  onSubmit={(event) => handleRenameSubmit(event, category)}
                >
                  <div className="book-category-sidebar__editor-row">
                    <BookOpen aria-hidden="true" />
                    <input
                      autoFocus
                      value={renameValue}
                      disabled={isSubmitting}
                      aria-invalid={inlineError ? 'true' : undefined}
                      aria-label={t('books.rename_shelf')}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => {
                        if (!isSubmittingRef.current) void submitRename(category)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelRename()
                        }
                      }}
                    />
                  </div>
                  {inlineError && <p className="book-category-sidebar__error">{inlineError}</p>}
                </form>
              )
            }

            const isContextOpen = contextMenu?.category.id === category.id
            return (
              <button
                key={category.id}
                type="button"
                className={`book-category-sidebar__row ${
                  activeCategory === category.name ? 'active' : ''
                } ${isContextOpen ? 'context-open' : ''}`}
                onClick={() => onSelectCategory(category.name)}
                onContextMenu={(event) => openContextMenu(event, category)}
              >
                <BookOpen aria-hidden="true" />
                <span className="book-category-sidebar__label" title={displayName}>
                  {displayName}
                </span>
                <span className="book-category-sidebar__count">
                  {getCategoryBookCount(category)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="book-category-sidebar__context-menu"
          role="menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
        >
          <button type="button" role="menuitem" onClick={() => startRename(contextMenu.category)}>
            <Pencil aria-hidden="true" />
            <span>{t('books.rename_shelf')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEditTranslations(contextMenu.category)
              closeContextMenu(false)
            }}
          >
            <Languages aria-hidden="true" />
            <span>{t('books.edit_shelf_translations')}</span>
          </button>
          <div className="book-category-sidebar__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onRequestDelete(contextMenu.category)
              closeContextMenu(false)
            }}
          >
            <Trash2 aria-hidden="true" />
            <span>{t('books.delete_shelf')}</span>
          </button>
        </div>
      )}
    </aside>
  )
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  Languages,
  Library,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ViewportPortal } from '../components/ViewportPortal'
import { getContextMenuPosition } from './bookCategorySidebarUtils'
import {
  ALL_NOTES_SCOPE,
  UNCATEGORIZED_NOTEBOOK,
  canExpandNotebookScope,
} from './notebookSidebarUtils'
import './NotebookSidebar.css'

export type NotebookSidebarNotebook = {
  id: number
  name: string
  category: string
}

export type NotebookSidebarNote = {
  id: number
  title: string
  notebook: string
  created_at: string
}

export type NotebookSidebarProps = {
  notebooks: NotebookSidebarNotebook[]
  notes: NotebookSidebarNote[]
  activeNotebook: string
  activeNoteId: number | null
  getNotebookDisplayName: (notebook: NotebookSidebarNotebook) => string
  getCategoryDisplayName: (category: string) => string
  formatTime: (time: string) => string
  onSelectNotebook: (notebook: string) => void
  onSelectNote: (note: NotebookSidebarNote, scope: string) => void
  onCreateNotebook: () => void
  onRenameNotebook: (notebook: NotebookSidebarNotebook) => void
  onEditTranslations: (notebook: NotebookSidebarNotebook) => void
  onDeleteNotebook: (notebook: NotebookSidebarNotebook) => void
}

type ContextMenuState = {
  notebook: NotebookSidebarNotebook
  left: number
  top: number
}

const CONTEXT_MENU_WIDTH = 208
const CONTEXT_MENU_HEIGHT = 132

export function NotebookSidebar({
  notebooks,
  notes,
  activeNotebook,
  activeNoteId,
  getNotebookDisplayName,
  getCategoryDisplayName,
  formatTime,
  onSelectNotebook,
  onSelectNote,
  onCreateNotebook,
  onRenameNotebook,
  onEditTranslations,
  onDeleteNotebook,
}: NotebookSidebarProps) {
  const { t } = useTranslation()
  const customNotebooks = useMemo(
    () => notebooks.filter((notebook) => notebook.name !== UNCATEGORIZED_NOTEBOOK),
    [notebooks],
  )
  const validNotebookNames = useMemo(
    () => new Set(customNotebooks.map((notebook) => notebook.name)),
    [customNotebooks],
  )
  const uncategorizedNotes = useMemo(
    () =>
      notes.filter(
        (note) =>
          !note.notebook ||
          note.notebook === UNCATEGORIZED_NOTEBOOK ||
          !validNotebookNames.has(note.notebook),
      ),
    [notes, validNotebookNames],
  )
  const notesByNotebook = useMemo(() => {
    const result = new Map<string, NotebookSidebarNote[]>()
    for (const note of notes) {
      if (!validNotebookNames.has(note.notebook)) continue
      const current = result.get(note.notebook) ?? []
      current.push(note)
      result.set(note.notebook, current)
    }
    return result
  }, [notes, validNotebookNames])
  const groupedNotebooks = useMemo(() => {
    const result = new Map<string, NotebookSidebarNotebook[]>()
    for (const notebook of customNotebooks) {
      const category = notebook.category?.trim() || '默认'
      const current = result.get(category) ?? []
      current.push(notebook)
      result.set(category, current)
    }
    return Array.from(result.entries())
  }, [customNotebooks])

  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(() => new Set())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(groupedNotebooks.map(([category]) => category)),
  )
  const seenCategoriesRef = useRef(new Set(groupedNotebooks.map(([category]) => category)))
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [menuFocusIndex, setMenuFocusIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const originatingRowRef = useRef<HTMLButtonElement | null>(null)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)

  const closeContextMenu = useCallback((restoreFocus = true) => {
    setContextMenu(null)
    if (restoreFocus) {
      if (originatingRowRef.current?.isConnected) originatingRowRef.current.focus()
      else addButtonRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    if (!activeNotebook) return
    setExpandedScopes((current) => new Set([...current, activeNotebook]))
  }, [activeNotebook])

  useEffect(() => {
    const newlySeen = groupedNotebooks
      .map(([category]) => category)
      .filter((category) => !seenCategoriesRef.current.has(category))
    if (newlySeen.length > 0) {
      setExpandedCategories((current) => new Set([...current, ...newlySeen]))
    }
    seenCategoriesRef.current = new Set(groupedNotebooks.map(([category]) => category))
  }, [groupedNotebooks])

  useEffect(() => {
    if (!contextMenu) return
    const handlePointerDown = () => closeContextMenu(false)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [closeContextMenu, contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"][tabindex="0"]')?.focus()
  }, [contextMenu])

  const toggleScope = (scope: string, canExpand: boolean) => {
    if (canExpand) {
      setExpandedScopes((current) => {
        const next = new Set(current)
        if (next.has(scope)) next.delete(scope)
        else next.add(scope)
        return next
      })
    }
    onSelectNotebook(scope)
  }

  const openContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    notebook: NotebookSidebarNotebook,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    originatingRowRef.current = event.currentTarget
    setMenuFocusIndex(0)
    setContextMenu({
      notebook,
      ...getContextMenuPosition({
        clientX: event.clientX,
        clientY: event.clientY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        menuWidth: CONTEXT_MENU_WIDTH,
        menuHeight: CONTEXT_MENU_HEIGHT,
      }),
    })
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeContextMenu()
      return
    }
    if (event.key === 'Tab') {
      closeContextMenu(false)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    )
    if (items.length === 0) return
    const activeIndex = items.findIndex((item) => item === document.activeElement)
    const currentIndex = activeIndex >= 0 ? activeIndex : menuFocusIndex
    const nextIndex =
      event.key === 'ArrowDown'
        ? (currentIndex + 1) % items.length
        : (currentIndex - 1 + items.length) % items.length
    setMenuFocusIndex(nextIndex)
    items[nextIndex].focus()
  }

  const renderNotes = (scope: string, scopedNotes: NotebookSidebarNote[]) => (
    <div className="notebook-sidebar__notes" role="group">
      {scopedNotes.length === 0 ? (
        <p className="notebook-sidebar__empty">{t('notes.empty_note_placeholder')}</p>
      ) : (
        scopedNotes.map((note) => (
          <button
            key={`${scope}-${note.id}`}
            type="button"
            className={`notebook-sidebar__note ${
              activeNoteId === note.id && activeNotebook === scope ? 'active' : ''
            }`}
            aria-current={activeNoteId === note.id && activeNotebook === scope ? 'page' : undefined}
            onClick={() => onSelectNote(note, scope)}
          >
            <FileText aria-hidden="true" />
            <span className="notebook-sidebar__note-copy">
              <span className="notebook-sidebar__note-title">
                {note.title || t('notes.title_placeholder')}
              </span>
              <span className="notebook-sidebar__note-time">{formatTime(note.created_at)}</span>
            </span>
          </button>
        ))
      )}
    </div>
  )

  const renderFixedScope = (
    scope: string,
    label: string,
    scopedNotes: NotebookSidebarNote[],
    icon: 'library' | 'inbox',
  ) => {
    const canExpand = canExpandNotebookScope(scopedNotes.length)
    const isExpanded = canExpand && expandedScopes.has(scope)
    const isActive = activeNotebook === scope
    const Icon = icon === 'library' ? Library : Inbox
    return (
      <div className="notebook-sidebar__branch">
        <button
          type="button"
          className={`notebook-sidebar__row notebook-sidebar__fixed-row ${
            isActive ? 'active' : ''
          }`}
          aria-expanded={canExpand ? isExpanded : undefined}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => toggleScope(scope, canExpand)}
          onContextMenu={(event) => event.preventDefault()}
        >
          {canExpand ? (
            isExpanded ? (
              <ChevronDown aria-hidden="true" />
            ) : (
              <ChevronRight aria-hidden="true" />
            )
          ) : (
            <span className="notebook-sidebar__chevron-spacer" aria-hidden="true" />
          )}
          <Icon aria-hidden="true" />
          <span className="notebook-sidebar__label" title={label}>
            {label}
          </span>
          <span className="notebook-sidebar__count">{scopedNotes.length}</span>
        </button>
        {isExpanded && renderNotes(scope, scopedNotes)}
      </div>
    )
  }

  return (
    <aside className="notebook-sidebar" aria-label={t('notes.notebooks_title')}>
      <h2 className="notebook-sidebar__title">{t('notes.notebooks_title')}</h2>

      <div className="notebook-sidebar__content">
        <div className="notebook-sidebar__fixed-list">
          {renderFixedScope(ALL_NOTES_SCOPE, t('notes.all_notes'), notes, 'library')}
          {renderFixedScope(
            UNCATEGORIZED_NOTEBOOK,
            t('notes.default_title'),
            uncategorizedNotes,
            'inbox',
          )}
        </div>

        <div className="notebook-sidebar__section-title">
          <span>{t('notes.my_notebooks')}</span>
          <button
            ref={addButtonRef}
            type="button"
            className="notebook-sidebar__add-button"
            aria-label={t('notes.create_notebook')}
            title={t('notes.create_notebook')}
            onClick={onCreateNotebook}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        <div className="notebook-sidebar__tree">
          {groupedNotebooks.length === 0 ? (
            <div className="notebook-sidebar__empty-state">
              <div className="notebook-sidebar__empty-state-icon" aria-hidden="true">
                <FolderPlus />
              </div>
              <p>{t('notes.empty_notebooks')}</p>
              <button type="button" onClick={onCreateNotebook}>
                {t('notes.create_first_notebook')}
              </button>
            </div>
          ) : (
            groupedNotebooks.map(([category, categoryNotebooks]) => {
              const isCategoryExpanded = expandedCategories.has(category)
              return (
                <div key={category} className="notebook-sidebar__category">
                  <button
                    type="button"
                    className="notebook-sidebar__category-row"
                    aria-expanded={isCategoryExpanded}
                    onClick={() =>
                      setExpandedCategories((current) => {
                        const next = new Set(current)
                        if (next.has(category)) next.delete(category)
                        else next.add(category)
                        return next
                      })
                    }
                  >
                    {isCategoryExpanded ? (
                      <ChevronDown aria-hidden="true" />
                    ) : (
                      <ChevronRight aria-hidden="true" />
                    )}
                    <span
                      className="notebook-sidebar__category-label"
                      title={getCategoryDisplayName(category)}
                    >
                      {getCategoryDisplayName(category)}
                    </span>
                    <span className="notebook-sidebar__category-count">
                      {categoryNotebooks.length}
                    </span>
                  </button>

                  {isCategoryExpanded && (
                    <div className="notebook-sidebar__category-children">
                      {categoryNotebooks.map((notebook) => {
                        const isActive = activeNotebook === notebook.name
                        const notebookNotes = notesByNotebook.get(notebook.name) ?? []
                        const canExpand = canExpandNotebookScope(notebookNotes.length)
                        const isExpanded = canExpand && expandedScopes.has(notebook.name)
                        const isContextOpen = contextMenu?.notebook.id === notebook.id
                        const containsActiveNote =
                          isActive &&
                          activeNoteId !== null &&
                          notebookNotes.some((note) => note.id === activeNoteId)
                        return (
                          <div key={notebook.id} className="notebook-sidebar__branch">
                            <div
                              className={`notebook-sidebar__row notebook-sidebar__notebook-row ${
                                isActive ? 'active' : ''
                              } ${containsActiveNote ? 'contains-active-note' : ''} ${
                                isContextOpen ? 'context-open' : ''
                              }`}
                            >
                              <button
                                type="button"
                                className="notebook-sidebar__row-select"
                                aria-expanded={canExpand ? isExpanded : undefined}
                                aria-current={isActive ? 'page' : undefined}
                                onClick={() => toggleScope(notebook.name, canExpand)}
                                onContextMenu={(event) => openContextMenu(event, notebook)}
                              >
                                {canExpand ? (
                                  isExpanded ? (
                                    <ChevronDown aria-hidden="true" />
                                  ) : (
                                    <ChevronRight aria-hidden="true" />
                                  )
                                ) : (
                                  <span
                                    className="notebook-sidebar__chevron-spacer"
                                    aria-hidden="true"
                                  />
                                )}
                                <Folder
                                  className="notebook-sidebar__notebook-icon"
                                  aria-hidden="true"
                                />
                                <span
                                  className="notebook-sidebar__label"
                                  title={getNotebookDisplayName(notebook)}
                                >
                                  {getNotebookDisplayName(notebook)}
                                </span>
                                <span className="notebook-sidebar__count">
                                  {notebookNotes.length}
                                </span>
                              </button>
                              <button
                                type="button"
                                className="notebook-sidebar__menu-button"
                                aria-label={t('notes.notebook_more_actions', {
                                  name: getNotebookDisplayName(notebook),
                                })}
                                title={t('notes.notebook_more_actions', {
                                  name: getNotebookDisplayName(notebook),
                                })}
                                onClick={(event) => openContextMenu(event, notebook)}
                              >
                                <MoreHorizontal aria-hidden="true" />
                              </button>
                            </div>
                            {isExpanded && renderNotes(notebook.name, notebookNotes)}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {contextMenu && (
        <ViewportPortal>
          <div
            ref={menuRef}
            className="notebook-sidebar__context-menu"
            role="menu"
            style={{ left: contextMenu.left, top: contextMenu.top }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={handleMenuKeyDown}
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={menuFocusIndex === 0 ? 0 : -1}
              onFocus={() => setMenuFocusIndex(0)}
              onClick={() => {
                onRenameNotebook(contextMenu.notebook)
                closeContextMenu(false)
              }}
            >
              <Pencil aria-hidden="true" />
              <span>{t('notes.rename_notebook')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={menuFocusIndex === 1 ? 0 : -1}
              onFocus={() => setMenuFocusIndex(1)}
              onClick={() => {
                onEditTranslations(contextMenu.notebook)
                closeContextMenu(false)
              }}
            >
              <Languages aria-hidden="true" />
              <span>{t('notes.edit_notebook_translations')}</span>
            </button>
            <div className="notebook-sidebar__menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="danger"
              tabIndex={menuFocusIndex === 2 ? 0 : -1}
              onFocus={() => setMenuFocusIndex(2)}
              onClick={() => {
                onDeleteNotebook(contextMenu.notebook)
                closeContextMenu(false)
              }}
            >
              <Trash2 aria-hidden="true" />
              <span>{t('notes.delete_notebook')}</span>
            </button>
          </div>
        </ViewportPortal>
      )}
    </aside>
  )
}

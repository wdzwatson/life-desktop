import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Inbox,
  Languages,
  Library,
  Pencil,
  Plus,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../components/AccessibleDialog'
import { getConfiguredLocales } from '../localeRegistry'
import {
  buildVideoGroupTree,
  expandVideoGroupWithAncestors,
  flattenVisibleVideoGroupTree,
  getContextMenuPosition,
  getDirectVideoGroupCounts,
  getNextMenuFocusIndex,
  getVideoGroupDeleteImpact,
  getVideoGroupDisplayName,
  toggleExpandedVideoGroup,
} from './videoGroupSidebarUtils'
import { getChipStyle } from './videoLibraryUtils'
import type {
  VideoGroupRecord,
  VideoGroupTranslation,
  VideoRecord,
  VideoTagRecord,
} from './videoTypes'
import './VideoGroupSidebar.css'

export type VideoGroupMutationResult = { ok: true; groupId?: number } | { ok: false; error: string }

export type VideoGroupSidebarProps = {
  groups: VideoGroupRecord[]
  translations: VideoGroupTranslation[]
  videos: Pick<VideoRecord, 'id' | 'group_id'>[]
  tags: VideoTagRecord[]
  activeGroupId: number | null | 'all'
  activeTag: string | null
  locale: string
  onSelectGroup: (groupId: number | null | 'all') => void
  onSelectTag: (tag: string | null) => void
  onCreateGroup: (parentId: number | null, name: string) => Promise<VideoGroupMutationResult>
  onRenameGroup: (group: VideoGroupRecord, name: string) => Promise<VideoGroupMutationResult>
  onSaveTranslations: (
    group: VideoGroupRecord,
    values: Record<string, string>,
  ) => Promise<VideoGroupMutationResult>
  onDeleteGroup: (group: VideoGroupRecord) => Promise<VideoGroupMutationResult>
}

type InlineEditorState =
  | { mode: 'create'; parentId: number | null; value: string; error: string }
  | { mode: 'rename'; groupId: number; value: string; initialValue: string; error: string }

type ContextMenuState = {
  groupId: number
  left: number
  top: number
}

type TranslationDialogState = {
  groupId: number
  values: Record<string, string>
  showMore: boolean
  error: string
  returnFocus: () => void
}

type DeleteDialogState = {
  groupId: number
  error: string
  returnFocus: () => void
}

const CONTEXT_MENU_WIDTH = 208
const CONTEXT_MENU_HEIGHT = 164
const MAX_VISUAL_DEPTH = 7

const dialogOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  backgroundColor: 'color-mix(in srgb, var(--text-main) 38%, transparent)',
  backdropFilter: 'blur(3px)',
}

const dialogContentStyle: CSSProperties = {
  width: 'min(440px, 100%)',
  maxHeight: 'min(640px, calc(100vh - 48px))',
  overflowY: 'auto',
  padding: '18px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-card)',
  outline: 'none',
  backgroundColor: 'var(--bg-surface)',
  boxShadow: '0 20px 56px color-mix(in srgb, var(--text-main) 24%, transparent)',
  color: 'var(--text-main)',
}

const dialogTitleStyle: CSSProperties = {
  margin: '0 0 14px',
  fontSize: '16px',
  lineHeight: 1.3,
}

function getAsyncError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function getDepthStyle(depth: number) {
  return {
    '--video-group-depth': Math.min(depth, MAX_VISUAL_DEPTH),
  } as CSSProperties
}

function isSameInlineEditor(current: InlineEditorState | null, expected: InlineEditorState) {
  if (!current || current.mode !== expected.mode) return false
  return current.mode === 'create'
    ? expected.mode === 'create' && current.parentId === expected.parentId
    : expected.mode === 'rename' && current.groupId === expected.groupId
}

export function VideoGroupSidebar({
  groups,
  translations,
  videos,
  tags,
  activeGroupId,
  activeTag,
  locale,
  onSelectGroup,
  onSelectTag,
  onCreateGroup,
  onRenameGroup,
  onSaveTranslations,
  onDeleteGroup,
}: VideoGroupSidebarProps) {
  const { t } = useTranslation()
  const tree = useMemo(
    () => buildVideoGroupTree(groups, translations, locale),
    [groups, locale, translations],
  )
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])
  const validGroupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups])
  const directCounts = useMemo(() => getDirectVideoGroupCounts(videos), [videos])
  const allVideosCount = videos.length
  const toOrganizeCount = useMemo(
    () =>
      videos.filter((video) => video.group_id == null || !validGroupIds.has(video.group_id)).length,
    [validGroupIds, videos],
  )
  const configuredLocales = useMemo(() => {
    const options = getConfiguredLocales(locale)
    return options.sort((left, right) => {
      if (left.code === locale) return -1
      if (right.code === locale) return 1
      return 0
    })
  }, [locale])

  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(
    () => new Set(tree.map((group) => group.id)),
  )
  const [inlineEditor, setInlineEditor] = useState<InlineEditorState | null>(null)
  const [inlinePending, setInlinePending] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [menuFocusIndex, setMenuFocusIndex] = useState(0)
  const [translationDialog, setTranslationDialog] = useState<TranslationDialogState | null>(null)
  const [translationPending, setTranslationPending] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const initializedTopLevelIdsRef = useRef(new Set(tree.map((group) => group.id)))
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())
  const originatingRowRef = useRef<HTMLButtonElement | null>(null)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const translationInputRef = useRef<HTMLInputElement | null>(null)
  const deleteCancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const inlinePendingRef = useRef(false)
  const translationPendingRef = useRef(false)
  const deletePendingRef = useRef(false)
  const isMountedRef = useRef(true)
  const groupsByIdRef = useRef(groupsById)
  const inlineEditorRef = useRef(inlineEditor)
  const translationDialogRef = useRef(translationDialog)
  const deleteDialogRef = useRef(deleteDialog)
  const inlineErrorId = useId()
  const translationErrorId = useId()
  const deleteErrorId = useId()
  groupsByIdRef.current = groupsById
  inlineEditorRef.current = inlineEditor
  translationDialogRef.current = translationDialog
  deleteDialogRef.current = deleteDialog

  const visibleRows = useMemo(
    () => flattenVisibleVideoGroupTree(tree, expandedGroupIds),
    [expandedGroupIds, tree],
  )

  const restoreOriginFocus = useCallback(() => {
    if (originatingRowRef.current?.isConnected) originatingRowRef.current.focus()
    else addButtonRef.current?.focus()
  }, [])

  const closeContextMenu = useCallback(
    (restoreFocus = true) => {
      setContextMenu(null)
      if (restoreFocus) restoreOriginFocus()
    },
    [restoreOriginFocus],
  )

  const createDialogReturnFocus = useCallback(() => {
    const sourceRow = originatingRowRef.current
    return () => {
      if (sourceRow?.isConnected) sourceRow.focus()
      else addButtonRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      inlinePendingRef.current = false
      translationPendingRef.current = false
      deletePendingRef.current = false
    }
  }, [])

  useEffect(() => {
    const newlySeenTopLevelIds = tree
      .map((group) => group.id)
      .filter((id) => !initializedTopLevelIdsRef.current.has(id))
    if (newlySeenTopLevelIds.length > 0) {
      setExpandedGroupIds((current) => new Set([...current, ...newlySeenTopLevelIds]))
    }
    initializedTopLevelIdsRef.current = new Set(tree.map((group) => group.id))
  }, [tree])

  useEffect(() => {
    if (typeof activeGroupId !== 'number') return
    setExpandedGroupIds((current) => expandVideoGroupWithAncestors(current, groups, activeGroupId))
  }, [activeGroupId, groups])

  useEffect(() => {
    if (!contextMenu) return
    const handleDocumentPointerDown = () => closeContextMenu(false)
    document.addEventListener('pointerdown', handleDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown)
  }, [closeContextMenu, contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"][tabindex="0"]')?.focus()
  }, [contextMenu])

  useEffect(() => {
    if (contextMenu && !groupsById.has(contextMenu.groupId)) closeContextMenu()
    if (inlineEditor?.mode === 'rename' && !groupsById.has(inlineEditor.groupId)) {
      setInlineEditor(null)
    }
    if (
      inlineEditor?.mode === 'create' &&
      inlineEditor.parentId != null &&
      !groupsById.has(inlineEditor.parentId)
    ) {
      setInlineEditor(null)
    }
    if (translationDialog && !groupsById.has(translationDialog.groupId)) {
      setTranslationDialog(null)
    }
    if (deleteDialog && !groupsById.has(deleteDialog.groupId)) setDeleteDialog(null)
  }, [closeContextMenu, contextMenu, deleteDialog, groupsById, inlineEditor, translationDialog])

  const startCreate = (parentId: number | null) => {
    if (inlinePendingRef.current) return
    if (parentId != null) {
      setExpandedGroupIds((current) => new Set([...current, parentId]))
    }
    setInlineEditor({ mode: 'create', parentId, value: '', error: '' })
  }

  const startRename = (groupId: number) => {
    if (inlinePendingRef.current) {
      closeContextMenu(false)
      return
    }
    const group = groupsById.get(groupId)
    if (!group) {
      closeContextMenu(false)
      return
    }
    const value = getVideoGroupDisplayName(group, translations, locale)
    setInlineEditor({
      mode: 'rename',
      groupId,
      value,
      initialValue: value.trim(),
      error: '',
    })
    closeContextMenu(false)
  }

  const cancelInlineEditor = () => {
    if (inlinePendingRef.current) return
    setInlineEditor(null)
  }

  const submitInlineEditor = async () => {
    if (!inlineEditor || inlinePendingRef.current) return
    const name = inlineEditor.value.trim()
    if (!name) {
      setInlineEditor({ ...inlineEditor, error: t('videos.group_name_required') })
      return
    }

    if (inlineEditor.mode === 'rename' && name === inlineEditor.initialValue) {
      setInlineEditor(null)
      return
    }

    const renameGroup =
      inlineEditor.mode === 'rename' ? groupsById.get(inlineEditor.groupId) : undefined
    if (inlineEditor.mode === 'rename' && !renameGroup) {
      setInlineEditor(null)
      return
    }

    inlinePendingRef.current = true
    setInlinePending(true)
    try {
      let result: VideoGroupMutationResult
      if (inlineEditor.mode === 'create') {
        result = await onCreateGroup(inlineEditor.parentId, name)
      } else if (renameGroup) {
        result = await onRenameGroup(renameGroup, name)
      } else {
        return
      }
      const targetStillExists =
        inlineEditor.mode === 'create'
          ? inlineEditor.parentId == null || groupsByIdRef.current.has(inlineEditor.parentId)
          : groupsByIdRef.current.has(inlineEditor.groupId)
      if (
        !isMountedRef.current ||
        !targetStillExists ||
        !isSameInlineEditor(inlineEditorRef.current, inlineEditor)
      ) {
        return
      }
      if (!result.ok) {
        setInlineEditor({ ...inlineEditor, error: result.error })
        return
      }
      setInlineEditor(null)
      if (inlineEditor.mode === 'create' && typeof result.groupId === 'number') {
        onSelectGroup(result.groupId)
      }
    } catch (error) {
      const targetStillExists =
        inlineEditor.mode === 'create'
          ? inlineEditor.parentId == null || groupsByIdRef.current.has(inlineEditor.parentId)
          : groupsByIdRef.current.has(inlineEditor.groupId)
      if (
        !isMountedRef.current ||
        !targetStillExists ||
        !isSameInlineEditor(inlineEditorRef.current, inlineEditor)
      ) {
        return
      }
      setInlineEditor({
        ...inlineEditor,
        error: getAsyncError(
          error,
          t(
            inlineEditor.mode === 'create'
              ? 'videos.group_create_failed'
              : 'videos.group_update_failed',
          ),
        ),
      })
    } finally {
      inlinePendingRef.current = false
      if (isMountedRef.current) setInlinePending(false)
    }
  }

  const openContextMenu = (
    event: MouseEvent<HTMLElement>,
    groupId: number,
    sourceRow: HTMLButtonElement | null,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    originatingRowRef.current = sourceRow
    setMenuFocusIndex(0)
    const position = getContextMenuPosition({
      clientX: event.clientX,
      clientY: event.clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      menuWidth: CONTEXT_MENU_WIDTH,
      menuHeight: CONTEXT_MENU_HEIGHT,
    })
    setContextMenu({ groupId, ...position })
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
    const activeIndex = items.findIndex((item) => item === document.activeElement)
    const nextIndex = getNextMenuFocusIndex(
      activeIndex >= 0 ? activeIndex : menuFocusIndex,
      items.length,
      event.key,
    )
    if (nextIndex < 0) return
    setMenuFocusIndex(nextIndex)
    items[nextIndex].focus()
  }

  const openTranslationDialog = (groupId: number) => {
    const group = groupsById.get(groupId)
    if (!group) {
      closeContextMenu(false)
      return
    }
    const values = Object.fromEntries(
      configuredLocales.map(({ code }) => {
        const exactValue = translations.find(
          (translation) => translation.group_id === groupId && translation.locale === code,
        )?.translation
        const fallbackValue =
          code === locale ? getVideoGroupDisplayName(group, translations, locale) : ''
        return [code, exactValue ?? fallbackValue]
      }),
    )
    setTranslationDialog({
      groupId,
      values,
      showMore: false,
      error: '',
      returnFocus: createDialogReturnFocus(),
    })
    closeContextMenu(false)
  }

  const closeTranslationDialog = () => {
    if (translationPendingRef.current) return
    setTranslationDialog(null)
  }

  const submitTranslations = async () => {
    if (!translationDialog || translationPendingRef.current) return
    const group = groupsById.get(translationDialog.groupId)
    if (!group) {
      setTranslationDialog(null)
      return
    }
    if (!(translationDialog.values[locale] ?? '').trim()) {
      setTranslationDialog({
        ...translationDialog,
        error: t('videos.group_name_required'),
      })
      return
    }

    translationPendingRef.current = true
    setTranslationPending(true)
    try {
      const result = await onSaveTranslations(group, translationDialog.values)
      if (
        !isMountedRef.current ||
        translationDialogRef.current?.groupId !== translationDialog.groupId ||
        !groupsByIdRef.current.has(translationDialog.groupId)
      ) {
        return
      }
      if (!result.ok) {
        setTranslationDialog({ ...translationDialog, error: result.error })
        return
      }
      setTranslationDialog(null)
    } catch (error) {
      if (
        isMountedRef.current &&
        translationDialogRef.current?.groupId === translationDialog.groupId &&
        groupsByIdRef.current.has(translationDialog.groupId)
      ) {
        setTranslationDialog({
          ...translationDialog,
          error: getAsyncError(error, t('videos.group_update_failed')),
        })
      }
    } finally {
      translationPendingRef.current = false
      if (isMountedRef.current) setTranslationPending(false)
    }
  }

  const openDeleteDialog = (groupId: number) => {
    if (!groupsById.has(groupId)) {
      closeContextMenu(false)
      return
    }
    setDeleteDialog({
      groupId,
      error: '',
      returnFocus: createDialogReturnFocus(),
    })
    closeContextMenu(false)
  }

  const closeDeleteDialog = () => {
    if (deletePendingRef.current) return
    setDeleteDialog(null)
  }

  const submitDelete = async () => {
    if (!deleteDialog || deletePendingRef.current) return
    const group = groupsById.get(deleteDialog.groupId)
    if (!group) {
      setDeleteDialog(null)
      return
    }

    deletePendingRef.current = true
    setDeletePending(true)
    try {
      const result = await onDeleteGroup(group)
      if (
        !isMountedRef.current ||
        deleteDialogRef.current?.groupId !== deleteDialog.groupId ||
        !groupsByIdRef.current.has(deleteDialog.groupId)
      ) {
        return
      }
      if (!result.ok) {
        setDeleteDialog({ ...deleteDialog, error: result.error })
        return
      }
      setDeleteDialog(null)
    } catch (error) {
      if (
        isMountedRef.current &&
        deleteDialogRef.current?.groupId === deleteDialog.groupId &&
        groupsByIdRef.current.has(deleteDialog.groupId)
      ) {
        setDeleteDialog({
          ...deleteDialog,
          error: getAsyncError(error, t('videos.group_delete_failed')),
        })
      }
    } finally {
      deletePendingRef.current = false
      if (isMountedRef.current) setDeletePending(false)
    }
  }

  const handleInlineSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitInlineEditor()
  }

  const renderInlineEditor = (depth: number) => {
    if (!inlineEditor) return null
    const labelKey =
      inlineEditor.mode === 'rename'
        ? 'videos.rename_group'
        : inlineEditor.parentId == null
          ? 'videos.add_top_level_group'
          : 'videos.add_child_group'

    return (
      <form
        className="video-group-sidebar__editor"
        style={getDepthStyle(depth)}
        onSubmit={handleInlineSubmit}
      >
        <div className="video-group-sidebar__editor-row">
          <span className="video-group-sidebar__chevron-spacer" aria-hidden="true" />
          <FolderPlus aria-hidden="true" />
          <input
            autoFocus
            value={inlineEditor.value}
            disabled={inlinePending}
            aria-label={t(labelKey)}
            aria-invalid={inlineEditor.error ? 'true' : undefined}
            aria-describedby={inlineEditor.error ? inlineErrorId : undefined}
            onChange={(event) =>
              setInlineEditor({ ...inlineEditor, value: event.target.value, error: '' })
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelInlineEditor()
              }
            }}
          />
          <div className="video-group-sidebar__editor-actions">
            <button
              type="submit"
              disabled={inlinePending}
              aria-label={t('common.save')}
              title={t('common.save')}
            >
              <Check aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={inlinePending}
              aria-label={t('common.cancel')}
              title={t('common.cancel')}
              onClick={cancelInlineEditor}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
        {inlineEditor.error && (
          <p id={inlineErrorId} className="video-group-sidebar__error" role="alert">
            {inlineEditor.error}
          </p>
        )}
      </form>
    )
  }

  const menuGroup = contextMenu ? groupsById.get(contextMenu.groupId) : undefined
  const translationGroup = translationDialog ? groupsById.get(translationDialog.groupId) : undefined
  const deletingGroup = deleteDialog ? groupsById.get(deleteDialog.groupId) : undefined
  const deleteImpact = deletingGroup
    ? getVideoGroupDeleteImpact(groups, videos, deletingGroup.id)
    : null

  return (
    <aside className="video-group-sidebar card" aria-label={t('videos.sidebar_title')}>
      <h2 className="video-group-sidebar__title">{t('videos.sidebar_title')}</h2>

      <div className="video-group-sidebar__content">
        <div className="video-group-sidebar__fixed-list">
          <button
            type="button"
            className={`video-group-sidebar__row video-group-sidebar__fixed-row ${
              activeGroupId === 'all' ? 'active' : ''
            }`}
            aria-current={activeGroupId === 'all' ? 'page' : undefined}
            onClick={() => onSelectGroup('all')}
            onContextMenu={(event) => event.preventDefault()}
          >
            <Library aria-hidden="true" />
            <span className="video-group-sidebar__label" title={t('videos.all_videos_sidebar')}>
              {t('videos.all_videos_sidebar')}
            </span>
            <span className="video-group-sidebar__count">{allVideosCount}</span>
          </button>

          <button
            type="button"
            className={`video-group-sidebar__row video-group-sidebar__fixed-row video-group-sidebar__to-organize ${
              toOrganizeCount > 0 ? 'has-items' : ''
            } ${activeGroupId === null ? 'active' : ''}`}
            aria-current={activeGroupId === null ? 'page' : undefined}
            onClick={() => onSelectGroup(null)}
            onContextMenu={(event) => event.preventDefault()}
          >
            <Inbox aria-hidden="true" />
            <span className="video-group-sidebar__label" title={t('videos.to_organize')}>
              {t('videos.to_organize')}
            </span>
            <span className="video-group-sidebar__count">{toOrganizeCount}</span>
          </button>
        </div>

        <div className="video-group-sidebar__section-title">
          <span>{t('videos.my_groups')}</span>
          <button
            ref={addButtonRef}
            type="button"
            className="video-group-sidebar__add-button"
            aria-label={t('videos.add_top_level_group')}
            title={t('videos.add_top_level_group')}
            onClick={() => startCreate(null)}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        <div className="video-group-sidebar__tree" role="tree">
          {inlineEditor?.mode === 'create' && inlineEditor.parentId == null
            ? renderInlineEditor(0)
            : null}

          {visibleRows.map((node) => {
            const hasChildren = node.children.length > 0
            const isExpanded = expandedGroupIds.has(node.id)
            const isActive = activeGroupId === node.id
            const isContextOpen = contextMenu?.groupId === node.id
            const isRenaming = inlineEditor?.mode === 'rename' && inlineEditor.groupId === node.id
            const isAddingChild =
              inlineEditor?.mode === 'create' && inlineEditor.parentId === node.id

            return (
              <Fragment key={node.id}>
                {isRenaming ? (
                  renderInlineEditor(node.depth)
                ) : (
                  <div
                    className={`video-group-sidebar__row video-group-sidebar__tree-row ${
                      isActive ? 'active' : ''
                    } ${isContextOpen ? 'context-open' : ''}`}
                    style={getDepthStyle(node.depth)}
                    onContextMenu={(event) =>
                      openContextMenu(event, node.id, rowRefs.current.get(node.id) ?? null)
                    }
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        className="video-group-sidebar__chevron"
                        aria-expanded={isExpanded}
                        aria-label={t(
                          isExpanded ? 'videos.collapse_group' : 'videos.expand_group',
                          { name: node.displayName },
                        )}
                        title={t(isExpanded ? 'videos.collapse_group' : 'videos.expand_group', {
                          name: node.displayName,
                        })}
                        onClick={(event) => {
                          event.stopPropagation()
                          setExpandedGroupIds((current) =>
                            toggleExpandedVideoGroup(current, node.id),
                          )
                        }}
                      >
                        <ChevronRight aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="video-group-sidebar__chevron-spacer" aria-hidden="true" />
                    )}
                    <button
                      ref={(element) => {
                        if (element) rowRefs.current.set(node.id, element)
                        else rowRefs.current.delete(node.id)
                      }}
                      type="button"
                      role="treeitem"
                      className="video-group-sidebar__row-select"
                      aria-level={node.depth + 1}
                      aria-selected={isActive}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => onSelectGroup(node.id)}
                    >
                      <Folder aria-hidden="true" />
                      <span className="video-group-sidebar__label" title={node.path}>
                        {node.displayName}
                      </span>
                      <span className="video-group-sidebar__count">
                        {directCounts.get(node.id) ?? 0}
                      </span>
                    </button>
                  </div>
                )}
                {isAddingChild ? renderInlineEditor(node.depth + 1) : null}
              </Fragment>
            )
          })}
        </div>

        <div className="video-group-sidebar__section-title video-group-sidebar__tags-title">
          <span>{t('videos.tags_title')}</span>
        </div>
        <div className="video-group-sidebar__tags">
          {tags.length === 0 ? (
            <p className="video-group-sidebar__tags-empty">{t('videos.empty_tags_tip')}</p>
          ) : (
            tags.map((tagItem) => {
              const active = activeTag === tagItem.name
              const chipStyle = getChipStyle(tagItem.name)
              return (
                <button
                  key={tagItem.id}
                  type="button"
                  className={`video-group-sidebar__tag ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  style={
                    active
                      ? undefined
                      : {
                          backgroundColor: chipStyle.backgroundColor,
                          borderColor: chipStyle.borderColor,
                          color: chipStyle.color,
                        }
                  }
                  onClick={() => onSelectTag(active ? null : tagItem.name)}
                >
                  <Tag aria-hidden="true" />
                  <span>{tagItem.name}</span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {contextMenu && menuGroup && (
        <div
          ref={menuRef}
          className="video-group-sidebar__context-menu"
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
              startCreate(menuGroup.id)
              closeContextMenu(false)
            }}
          >
            <FolderPlus aria-hidden="true" />
            <span>{t('videos.add_child_group')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={menuFocusIndex === 1 ? 0 : -1}
            onFocus={() => setMenuFocusIndex(1)}
            onClick={() => startRename(menuGroup.id)}
          >
            <Pencil aria-hidden="true" />
            <span>{t('videos.rename_group')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={menuFocusIndex === 2 ? 0 : -1}
            onFocus={() => setMenuFocusIndex(2)}
            onClick={() => openTranslationDialog(menuGroup.id)}
          >
            <Languages aria-hidden="true" />
            <span>{t('videos.edit_group_translations')}</span>
          </button>
          <div className="video-group-sidebar__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            tabIndex={menuFocusIndex === 3 ? 0 : -1}
            onFocus={() => setMenuFocusIndex(3)}
            onClick={() => openDeleteDialog(menuGroup.id)}
          >
            <Trash2 aria-hidden="true" />
            <span>{t('videos.delete_group')}</span>
          </button>
        </div>
      )}

      {translationDialog && translationGroup && (
        <AccessibleDialog
          title={t('videos.edit_group_translations')}
          onClose={closeTranslationDialog}
          returnFocus={translationDialog.returnFocus}
          initialFocusRef={translationInputRef}
          overlayStyle={dialogOverlayStyle}
          contentStyle={dialogContentStyle}
          titleStyle={dialogTitleStyle}
        >
          <form
            className="video-group-sidebar__dialog-form"
            onSubmit={(event) => {
              event.preventDefault()
              void submitTranslations()
            }}
          >
            {configuredLocales.slice(0, 1).map((option) => (
              <label key={option.code}>
                <span>{option.label}</span>
                <input
                  ref={translationInputRef}
                  value={translationDialog.values[option.code] ?? ''}
                  disabled={translationPending}
                  aria-invalid={translationDialog.error ? 'true' : undefined}
                  aria-describedby={translationDialog.error ? translationErrorId : undefined}
                  placeholder={t('videos.translation_name_placeholder', {
                    language: option.label,
                  })}
                  onChange={(event) =>
                    setTranslationDialog({
                      ...translationDialog,
                      values: {
                        ...translationDialog.values,
                        [option.code]: event.target.value,
                      },
                      error: '',
                    })
                  }
                />
              </label>
            ))}

            {configuredLocales.length > 1 && (
              <button
                type="button"
                className="video-group-sidebar__more-translations"
                aria-expanded={translationDialog.showMore}
                onClick={() =>
                  setTranslationDialog({
                    ...translationDialog,
                    showMore: !translationDialog.showMore,
                  })
                }
              >
                <ChevronDown aria-hidden="true" />
                <span>{t('common.more_translations')}</span>
              </button>
            )}

            {translationDialog.showMore && configuredLocales.length > 1 && (
              <div className="video-group-sidebar__translation-list">
                {configuredLocales.slice(1).map((option) => (
                  <label key={option.code}>
                    <span>{option.label}</span>
                    <input
                      value={translationDialog.values[option.code] ?? ''}
                      disabled={translationPending}
                      placeholder={t('videos.translation_name_placeholder', {
                        language: option.label,
                      })}
                      onChange={(event) =>
                        setTranslationDialog({
                          ...translationDialog,
                          values: {
                            ...translationDialog.values,
                            [option.code]: event.target.value,
                          },
                          error: '',
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            )}

            {translationDialog.error && (
              <p id={translationErrorId} className="video-group-sidebar__dialog-error" role="alert">
                {translationDialog.error}
              </p>
            )}

            <div className="video-group-sidebar__dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={translationPending}
                onClick={closeTranslationDialog}
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={translationPending}>
                {t('common.save')}
              </button>
            </div>
          </form>
        </AccessibleDialog>
      )}

      {deleteDialog && deletingGroup && deleteImpact && (
        <AccessibleDialog
          title={t('videos.confirm_delete_group_title')}
          onClose={closeDeleteDialog}
          returnFocus={deleteDialog.returnFocus}
          initialFocusRef={deleteCancelButtonRef}
          overlayStyle={dialogOverlayStyle}
          contentStyle={dialogContentStyle}
          titleStyle={{ ...dialogTitleStyle, color: 'var(--color-danger)' }}
        >
          <div className="video-group-sidebar__dialog-form">
            <p className="video-group-sidebar__delete-body">
              {t('videos.confirm_delete_group_body', {
                name: getVideoGroupDisplayName(deletingGroup, translations, locale),
                videoCount: deleteImpact.directVideoCount,
                childCount: deleteImpact.directChildCount,
              })}
            </p>
            {deleteDialog.error && (
              <p id={deleteErrorId} className="video-group-sidebar__dialog-error" role="alert">
                {deleteDialog.error}
              </p>
            )}
            <div className="video-group-sidebar__dialog-actions">
              <button
                ref={deleteCancelButtonRef}
                type="button"
                className="btn"
                disabled={deletePending}
                onClick={closeDeleteDialog}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn video-group-sidebar__delete-button"
                disabled={deletePending}
                aria-describedby={deleteDialog.error ? deleteErrorId : undefined}
                onClick={() => void submitDelete()}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </AccessibleDialog>
      )}
    </aside>
  )
}

import React, {
  useEffect,
  useState,
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
} from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  Bold,
  ChevronDown,
  Code,
  Plus,
  NotebookPen,
  Eye,
  Edit2,
  Columns,
  Trash2,
  Download,
  Languages,
  Paperclip,
  Heading1,
  Italic,
  KeyRound,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  Lock,
  Maximize2,
  Quote,
  Save,
  X,
} from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { getConfiguredLocales } from '../localeRegistry'
import { parseReaderBookDeepLink } from '../services/readerDeepLink'
import { decorateReaderAnnotationExportHtml } from '../services/readerAnnotationSerializer'
import { ViewportPortal } from '../components/ViewportPortal'
import { NotebookSidebar } from './NotebookSidebar'
import {
  clampNoteImageDimension,
  getNoteImageResizeDragDimensions,
  renderSizedNoteImages,
  updateNoteImageDimensions as updateNoteImageDimensionsInContent,
  type NoteImageDimensions,
} from './noteImageSizing'
import {
  ALL_NOTES_SCOPE,
  UNCATEGORIZED_NOTEBOOK,
  buildCreateNotebookStatements,
  buildDeleteNotebookStatements,
  buildRenameNotebookStatements,
  getNotebookTransactionError,
  resolveNotebookCategoryStorageName,
} from './notebookSidebarUtils'
import './Notes.css'

interface Notebook {
  id: number
  name: string
  category: string
  created_at?: string
}

interface Note {
  id: number
  title: string
  content: string
  note_type: string
  notebook: string
  is_private?: number
  created_at: string
  updated_at: string
}

interface DBResponse {
  success: boolean
  data: unknown
  error?: string
}

interface NoteAttachment {
  name: string
  url: string
  kind: 'image' | 'file'
}

interface NoteAttachmentResponse<T> {
  success: boolean
  data?: T
  error?: string
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read the pasted image.'))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Unable to read the pasted image.'))
    }
    reader.readAsDataURL(file)
  })

const escapeMarkdownLabel = (value: string) => value.replace(/([\\[\\]])/g, '\\$1')
const escapeHtmlAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

interface ElectronAPI {
  dbQuery: (dbName: string, sql: string, params?: unknown[]) => Promise<DBResponse>
  dbTransaction?: (
    dbName: string,
    statements: Array<{ sql: string; params?: unknown[] }>,
  ) => Promise<DBResponse>
  exportNote?: (data: {
    title: string
    content: string
    htmlContent: string
    format: string
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  selectNoteAttachments?: () => Promise<NoteAttachmentResponse<NoteAttachment[]>>
  saveNotePastedImage?: (data: {
    dataUrl: string
    fileName?: string
  }) => Promise<NoteAttachmentResponse<NoteAttachment>>
  openNoteAttachment?: (url: string) => Promise<{ success: boolean; error?: string }>
  copyNoteImage?: (url: string) => Promise<{ success: boolean; error?: string }>
  saveNoteImage?: (url: string) => Promise<{ success: boolean; saved?: boolean; error?: string }>
  createPrivateNote?: (data: {
    title: string
    content: string
    notebook: string
    password: string
  }) => Promise<{ success: boolean; data?: { id: number; title: string; content: string }; error?: string }>
  unlockPrivateNote?: (
    noteId: number,
    password: string,
  ) => Promise<{ success: boolean; data?: { id: number; content: string }; error?: string }>
  savePrivateNote?: (
    noteId: number,
    title: string,
    content: string,
  ) => Promise<{ success: boolean; error?: string }>
  lockPrivateNote?: (noteId: number) => Promise<{ success: boolean; error?: string }>
  openNoteEditorWindow?: (data: unknown) => Promise<{ success: boolean; error?: string }>
  closeNoteEditorWindow?: () => Promise<{ success: boolean; error?: string }>
  confirmNoteEditorClose?: () => Promise<{ success: boolean; error?: string }>
  sendNoteEditorDraft?: (data: unknown) => void
  notifyNoteEditorReady?: () => void
  onNoteEditorDraft?: (callback: (data: unknown) => void) => () => void
  onNoteEditorClosed?: (callback: () => void) => () => void
  onNoteEditorCloseRequest?: (callback: () => void) => () => void
  onNotesChanged?: (callback: (data: unknown) => void) => () => void
}

type NoteImageMenuState = {
  url: string
  left: number
  top: number
} | null

interface NoteEditorDraft {
  source?: string
  noteId?: number
  title?: string
  content?: string
  isPrivate?: boolean
  privateUnlocked?: boolean
}

export const Notes: React.FC<{ popup?: boolean }> = ({ popup = false }) => {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
  const userId = useAppStore((state) => state.userId)
  const setActiveScreen = useAppStore((state) => state.setActiveScreen)

  // DB States
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [activeNotebook, setActiveNotebook] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null)

  // Editor States
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [viewMode, setViewMode] = useState<'edit' | 'typora' | 'split' | 'preview'>('split')
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isAttaching, setIsAttaching] = useState(false)
  const [selectedNoteImage, setSelectedNoteImage] = useState<NoteImageDimensions | null>(null)
  const [noteImageMenu, setNoteImageMenu] = useState<NoteImageMenuState>(null)
  const [unlockPromptNote, setUnlockPromptNote] = useState<Note | null>(null)
  const [privatePassword, setPrivatePassword] = useState('')
  const [privateDialogMode, setPrivateDialogMode] = useState<'unlock' | 'create' | null>(null)
  const [activeDraftIsPrivate, setActiveDraftIsPrivate] = useState(false)
  const [isPrivateNoteUnlocked, setIsPrivateNoteUnlocked] = useState(false)
  const [isSavingPrivate, setIsSavingPrivate] = useState(false)
  const [isEditorWindowOpen, setIsEditorWindowOpen] = useState(false)
  const [isEditorWindowRestoring, setIsEditorWindowRestoring] = useState(false)
  const [renderedMarkdownHtml, setRenderedMarkdownHtml] = useState('')
  const [isMarkdownRendering, setIsMarkdownRendering] = useState(false)
  const [markdownRenderProgress, setMarkdownRenderProgress] = useState(0)
  const exportDropdownRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const typoraEditorRef = useRef<HTMLDivElement | null>(null)
  const suppressEditorBroadcastRef = useRef(false)
  const lastEditorBroadcastRef = useRef('')
  const pendingExternalEditorDraftRef = useRef<NoteEditorDraft | null>(null)

  // Notebook Modal States
  const [isNbModalOpen, setIsNbModalOpen] = useState(false)
  const [nbModalAction, setNbModalAction] = useState<'create' | 'rename' | null>(null)
  const [nbModalName, setNbModalName] = useState('')
  const [nbModalCategory, setNbModalCategory] = useState('')
  const [targetNotebook, setTargetNotebook] = useState<Notebook | null>(null)
  const [translations, setTranslations] = useState<any[]>([])
  const [nbNameTrans, setNbNameTrans] = useState<{ [key: string]: string }>({})
  const [nbCatTrans, setNbCatTrans] = useState<{ [key: string]: string }>({})
  const [isNbTransOpen, setIsNbTransOpen] = useState(false)
  const [isNbTranslationIntent, setIsNbTranslationIntent] = useState(false)

  // Deletion Modal States
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    type: 'note' | 'notebook'
    id: number
    name?: string
    nb?: Notebook
  } | null>(null)

  const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI
  const configuredLocales = useMemo(() => getConfiguredLocales(i18n.language), [i18n.language])
  const notebookCategoryListId = useId()
  const notebookCategoryHelpId = useId()
  const notebookTranslationsPanelId = useId()
  const currentLocaleLabel =
    configuredLocales.find((locale) => locale.code === i18n.language)?.label || i18n.language
  const deferredNoteContent = useDeferredValue(noteContent)
  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) || null,
    [activeNoteId, notes],
  )
  const activeNoteIsPrivate = Number(activeNote?.is_private || 0) === 1 || activeDraftIsPrivate
  const isMainNoteRenderSuspended = !popup && isEditorWindowOpen

  const selectNote = useCallback((note: Note, scope = note.notebook) => {
    setActiveNoteId(note.id)
    setNoteTitle(note.title)
    setActiveNotebook(scope)
    setSelectedNoteImage(null)
    setNoteImageMenu(null)
    if (Number(note.is_private || 0) === 1) {
      setNoteContent('')
      setActiveDraftIsPrivate(true)
      setIsPrivateNoteUnlocked(false)
      setUnlockPromptNote(note)
      setPrivateDialogMode('unlock')
      setPrivatePassword('')
      return
    }
    setNoteContent(note.content || '')
    setActiveDraftIsPrivate(false)
    setIsPrivateNoteUnlocked(false)
    setUnlockPromptNote(null)
    setPrivateDialogMode(null)
  }, [])

  const getNotebookDisplayName = (name: string, id: number) => {
    const currentLocale = i18n.language
    const trans = translations.find(
      (t) =>
        t.entity_type === 'notebook' && t.entity_id === String(id) && t.locale === currentLocale,
    )
    return trans ? trans.translation : name
  }

  const getNotebookCategoryDisplayName = (categoryName: string) => {
    const currentLocale = i18n.language
    const trans = translations.find(
      (t) =>
        t.entity_type === 'notebook_category' &&
        t.entity_id === categoryName &&
        t.locale === currentLocale,
    )
    return trans
      ? trans.translation
      : categoryName === '默认'
        ? t('common.default_category')
        : categoryName
  }

  const notebookCategoryOptions = useMemo(() => {
    const storageNames = [
      '默认',
      ...new Set(
        notebooks
          .map((notebook) => notebook.category?.trim())
          .filter((category): category is string => Boolean(category) && category !== '默认'),
      ),
    ]

    return storageNames.map((storageName) => {
      const translation = translations.find(
        (item) =>
          item.entity_type === 'notebook_category' &&
          item.entity_id === storageName &&
          item.locale === i18n.language,
      )
      return {
        storageName,
        displayName:
          typeof translation?.translation === 'string' && translation.translation.trim()
            ? translation.translation.trim()
            : storageName === '默认'
              ? t('common.default_category')
              : storageName,
      }
    })
  }, [i18n.language, notebooks, t, translations])

  const formatTime = (timeStr: string) => {
    if (!timeStr) return ''
    try {
      const isoStr = timeStr.includes('T') ? timeStr : timeStr.replace(' ', 'T') + 'Z'
      const date = new Date(isoStr)
      if (isNaN(date.getTime())) {
        return timeStr
      }
      return date.toLocaleString()
    } catch {
      return timeStr
    }
  }

  const loadNotes = useCallback(async () => {
    if (!api) {
      // Don't spam toast on load, just return empty state
      return
    }

    // Load notebooks
    const nbRes = await api.dbQuery(
      'notes',
      'SELECT * FROM notebooks ORDER BY category ASC, name ASC',
    )
    let list: Notebook[] = []
    if (nbRes?.success && Array.isArray(nbRes.data)) {
      list = nbRes.data as Notebook[]
    }
    setNotebooks(list)

    // Load translations
    const transRes = await api.dbQuery('notes', 'SELECT * FROM translations')
    if (transRes?.success) {
      setTranslations(transRes.data as any[])
    }

    const customNotebookNames = new Set(
      list
        .filter((notebook) => notebook.name !== UNCATEGORIZED_NOTEBOOK)
        .map((notebook) => notebook.name),
    )

    // Select active notebook or fallback
    let currentActive = activeNotebook
    const isFixedScope =
      currentActive === ALL_NOTES_SCOPE || currentActive === UNCATEGORIZED_NOTEBOOK
    if (!isFixedScope && !customNotebookNames.has(currentActive)) {
      currentActive = ALL_NOTES_SCOPE
      setActiveNotebook(currentActive)
    }

    // Load ALL notes
    const notesRes = await api.dbQuery('notes', 'SELECT * FROM notes ORDER BY updated_at DESC')
    if (notesRes?.success && Array.isArray(notesRes.data)) {
      const notesList = (notesRes.data as Note[]).map((note) =>
        Number(note.is_private || 0) === 1 ? { ...note, content: '' } : note,
      )
      setNotes(notesList)
      // Auto select first note if none selected or if active note is not in database
      if (notesList.length > 0) {
        const hasActive = notesList.some((n: Note) => n.id === activeNoteId)
        if (!hasActive || activeNoteId === null) {
          let defaultNote =
            currentActive === ALL_NOTES_SCOPE
              ? notesList[0]
              : currentActive === UNCATEGORIZED_NOTEBOOK
                ? notesList.find(
                    (note) =>
                      !note.notebook ||
                      note.notebook === UNCATEGORIZED_NOTEBOOK ||
                      !customNotebookNames.has(note.notebook),
                  )
                : notesList.find((note) => note.notebook === currentActive)
          if (!defaultNote) {
            defaultNote = notesList[0]
          }
          selectNote(defaultNote, currentActive)
        }
      } else {
        setActiveNoteId(null)
        setNoteTitle('')
        setNoteContent('')
      }
    } else {
      setNotes([])
      setActiveNoteId(null)
      setNoteTitle('')
      setNoteContent('')
    }
  }, [api, activeNotebook, activeNoteId, selectNote])

  useEffect(() => {
    if (popup) {
      return
    }
    loadNotes()
  }, [loadNotes, popup, userId])

  const handleSaveNote = useCallback(async () => {
    if (!api) {
      showToast(`⚠️ ${t('notes.error_save_failed')}: ${t('common.error_electron_required')}`)
      return false
    }
    if (!activeNoteId) return true
    if (activeNoteIsPrivate) {
      if (!isPrivateNoteUnlocked || !api.savePrivateNote) return false
      setIsSavingPrivate(true)
      const res = await api.savePrivateNote(activeNoteId, noteTitle, noteContent)
      setIsSavingPrivate(false)
      if (res?.success) {
        showToast(t('notes.toast_saved'))
        api.sendNoteEditorDraft?.({
          source: popup ? 'popup' : 'main',
          noteId: activeNoteId,
          title: noteTitle,
          content: noteContent,
          isPrivate: true,
          privateUnlocked: true,
        })
        loadNotes()
        return true
      } else {
        showToast(res?.error || t('notes.error_save_failed'))
        return false
      }
    }
    const query =
      'UPDATE notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    const res = await api.dbQuery('notes', query, [noteTitle, noteContent, activeNoteId])
    if (res?.success) {
      showToast(t('notes.toast_saved'))
      api.sendNoteEditorDraft?.({
        source: popup ? 'popup' : 'main',
        noteId: activeNoteId,
        title: noteTitle,
        content: noteContent,
        isPrivate: false,
        privateUnlocked: false,
      })
      loadNotes()
      return true
    }
    showToast(res?.error || t('notes.error_save_failed'))
    return false
  }, [
    activeNoteId,
    activeNoteIsPrivate,
    api,
    isPrivateNoteUnlocked,
    loadNotes,
    noteContent,
    noteTitle,
    popup,
    showToast,
    t,
  ])

  const insertAttachments = useCallback(
    async (attachments: NoteAttachment[]) => {
      if (!api || !activeNoteId || attachments.length === 0) return

      const textarea = editorRef.current
      const selectionStart = textarea?.selectionStart ?? noteContent.length
      const selectionEnd = textarea?.selectionEnd ?? noteContent.length
      const before = noteContent.slice(0, selectionStart)
      const after = noteContent.slice(selectionEnd)
      const markdown = attachments
        .map((attachment) => {
          const label = escapeMarkdownLabel(attachment.name)
          return attachment.kind === 'image'
            ? `![${label}](${attachment.url})`
            : `[📎 ${label}](${attachment.url})`
        })
        .join('\n')
      const prefix = before && !before.endsWith('\n') ? '\n\n' : ''
      const suffix = after && !after.startsWith('\n') ? '\n\n' : ''
      const nextContent = `${before}${prefix}${markdown}${suffix}${after}`

      setNoteContent(nextContent)
      const res =
        activeNoteIsPrivate && isPrivateNoteUnlocked && api.savePrivateNote
          ? await api.savePrivateNote(activeNoteId, noteTitle, nextContent)
          : await api.dbQuery(
              'notes',
              'UPDATE notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              [noteTitle, nextContent, activeNoteId],
            )
      if (!res?.success) {
        showToast(res?.error || t('notes.error_attachment_failed'))
        return
      }

      showToast(t('notes.toast_attachment_added'))
      void loadNotes()
      const cursorPosition = before.length + prefix.length + markdown.length
      requestAnimationFrame(() => {
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(cursorPosition, cursorPosition)
      })
    },
    [
      activeNoteId,
      activeNoteIsPrivate,
      api,
      isPrivateNoteUnlocked,
      loadNotes,
      noteContent,
      noteTitle,
      showToast,
      t,
    ],
  )

  const handleSelectAttachments = async () => {
    if (!api?.selectNoteAttachments || !activeNoteId) {
      showToast(t('common.error_electron_required'))
      return
    }
    setIsAttaching(true)
    try {
      const res = await api.selectNoteAttachments()
      if (!res.success) {
        showToast(res.error || t('notes.error_attachment_failed'))
        return
      }
      await insertAttachments(res.data || [])
    } catch (error) {
      showToast(`${t('notes.error_attachment_failed')}: ${(error as Error).message}`)
    } finally {
      setIsAttaching(false)
    }
  }

  const handleEditorPaste = async (event: React.ClipboardEvent<HTMLElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith('image/'),
    )
    if (!imageItem) return

    const imageFile = imageItem.getAsFile()
    if (!imageFile) return
    event.preventDefault()
    if (!api?.saveNotePastedImage || !activeNoteId) {
      showToast(t('common.error_electron_required'))
      return
    }

    setIsAttaching(true)
    try {
      const dataUrl = await readFileAsDataUrl(imageFile)
      const res = await api.saveNotePastedImage({ dataUrl, fileName: imageFile.name || undefined })
      if (!res.success || !res.data) {
        showToast(res.error || t('notes.error_attachment_failed'))
        return
      }
      await insertAttachments([res.data])
    } catch (error) {
      showToast(`${t('notes.error_attachment_failed')}: ${(error as Error).message}`)
    } finally {
      setIsAttaching(false)
    }
  }

  const handleCreateNote = async () => {
    if (!api) {
      showToast(`⚠️ ${t('notes.error_create_failed')}: ${t('common.error_electron_required')}`)
      return
    }
    const query = 'INSERT INTO notes (title, content, note_type, notebook) VALUES (?, ?, ?, ?)'
    const defaultTitle = t('notes.new_note')
    const defaultContent = t('notes.default_content')
    const targetNotebookName =
      !activeNotebook ||
      activeNotebook === ALL_NOTES_SCOPE ||
      activeNotebook === UNCATEGORIZED_NOTEBOOK
        ? UNCATEGORIZED_NOTEBOOK
        : activeNotebook
    // Ensure the notebook exists in the notebooks table
    const checkNb = await api.dbQuery(
      'notes',
      'SELECT count(*) as count FROM notebooks WHERE name = ?',
      [targetNotebookName],
    )
    if (
      checkNb?.success &&
      Array.isArray(checkNb.data) &&
      checkNb.data.length > 0 &&
      (checkNb.data[0] as { count: number }).count === 0
    ) {
      await api.dbQuery('notes', 'INSERT INTO notebooks (name, category) VALUES (?, ?)', [
        targetNotebookName,
        '默认',
      ])
    }

    const res = await api.dbQuery('notes', query, [
      defaultTitle,
      defaultContent,
      'markdown',
      targetNotebookName,
    ])
    if (res?.success && res.data) {
      const newId = (res.data as { lastInsertRowid: number }).lastInsertRowid
      showToast(t('notes.toast_created'))
      setActiveNoteId(newId)
      setNoteTitle(defaultTitle)
      setNoteContent(defaultContent)
      loadNotes()
    }
  }

  const openCreatePrivateNoteDialog = () => {
    setPrivateDialogMode('create')
    setUnlockPromptNote(null)
    setPrivatePassword('')
  }

  const getTargetNotebookName = () =>
    !activeNotebook ||
    activeNotebook === ALL_NOTES_SCOPE ||
    activeNotebook === UNCATEGORIZED_NOTEBOOK
      ? UNCATEGORIZED_NOTEBOOK
      : activeNotebook

  const handleCreatePrivateNote = async () => {
    if (!api?.createPrivateNote) {
      showToast(t('common.error_electron_required'))
      return
    }
    if (!privatePassword) {
      showToast(t('notes.private_password_required'))
      return
    }
    const defaultTitle = t('notes.private_note_title')
    const defaultContent = t('notes.private_note_default_content')
    const res = await api.createPrivateNote({
      title: defaultTitle,
      content: defaultContent,
      notebook: getTargetNotebookName(),
      password: privatePassword,
    })
    if (!res.success || !res.data) {
      showToast(res.error || t('notes.error_create_failed'))
      return
    }
    setPrivateDialogMode(null)
    setPrivatePassword('')
    setActiveNoteId(res.data.id)
    setNoteTitle(res.data.title)
    setNoteContent(res.data.content)
    setActiveDraftIsPrivate(true)
    setIsPrivateNoteUnlocked(true)
    showToast(t('notes.toast_private_created'))
    await loadNotes()
  }

  const handleUnlockPrivateNote = async () => {
    if (!api?.unlockPrivateNote || !unlockPromptNote) {
      showToast(t('common.error_electron_required'))
      return
    }
    if (!privatePassword) {
      showToast(t('notes.private_password_required'))
      return
    }
    const res = await api.unlockPrivateNote(unlockPromptNote.id, privatePassword)
    if (!res.success || !res.data) {
      showToast(res.error || t('notes.error_private_unlock_failed'))
      return
    }
    setActiveNoteId(unlockPromptNote.id)
    setNoteTitle(unlockPromptNote.title)
    setNoteContent(res.data.content)
    setActiveDraftIsPrivate(true)
    setIsPrivateNoteUnlocked(true)
    setUnlockPromptNote(null)
    setPrivateDialogMode(null)
    setPrivatePassword('')
    api.sendNoteEditorDraft?.({
      source: popup ? 'popup' : 'main',
      noteId: unlockPromptNote.id,
      title: unlockPromptNote.title,
      content: res.data.content,
      isPrivate: true,
      privateUnlocked: true,
    })
  }

  const handleLockPrivateNote = async () => {
    if (!api?.lockPrivateNote || !activeNoteId) return
    await handleSaveNote()
    await api.lockPrivateNote(activeNoteId)
    setNoteContent('')
    setActiveDraftIsPrivate(true)
    setIsPrivateNoteUnlocked(false)
    if (activeNote) {
      setUnlockPromptNote(activeNote)
      setPrivateDialogMode('unlock')
    }
  }

  const handleDeleteNote = (id: number) => {
    setDeleteConfirmTarget({ type: 'note', id })
  }

  const executeDeleteNote = async (id: number) => {
    if (!api) return
    const res = await api.dbQuery('notes', 'DELETE FROM notes WHERE id = ?', [id])
    if (res?.success) {
      showToast(t('notes.toast_deleted'))
      setActiveNoteId(null)
      loadNotes()
    } else {
      showToast(res?.error || t('notes.error_delete_failed'))
    }
    setDeleteConfirmTarget(null)
  }

  const executeDeleteNotebook = async (nb: Notebook) => {
    if (!api?.dbTransaction) return
    const res = await api.dbTransaction('notes', buildDeleteNotebookStatements(nb.id, nb.name))
    const transactionResults = Array.isArray(res?.data)
      ? (res.data as Array<{ changes?: number }>)
      : []
    const deleteChanges = Number(transactionResults.at(-1)?.changes)
    if (res?.success && Number.isFinite(deleteChanges) && deleteChanges > 0) {
      showToast(t('notes.toast_notebook_deleted'))
      if (activeNotebook === nb.name) {
        setActiveNotebook(UNCATEGORIZED_NOTEBOOK)
      }
      await loadNotes()
    } else {
      showToast(
        res?.success
          ? t('notes.error_notebook_unavailable')
          : getNotebookTransactionError(res?.error, t('notes.error_delete_notebook_failed')),
      )
    }
    setDeleteConfirmTarget(null)
  }

  const handleExportNote = async (format: 'md' | 'html' | 'docx' | 'pdf' | 'txt') => {
    if (!api || !activeNoteId) return
    setIsExporting(true)

    // Convert markdown to HTML for formats like HTML/Doc/PDF
    const parsedHtml = parseMarkdown(noteContent)

    try {
      const res = await api.exportNote?.({
        title: noteTitle,
        content: noteContent,
        htmlContent: parsedHtml,
        format,
      })

      if (res?.success) {
        showToast(t('notes.toast_export_success', { path: res.filePath }))
      } else if (res?.error !== 'Canceled') {
        showToast(t('notes.toast_export_failed', { error: res?.error }))
      }
    } catch (err) {
      showToast(`${t('notes.error_export_failed')}: ${(err as Error).message}`)
    } finally {
      setIsExporting(false)
      setIsExportDropdownOpen(false)
    }
  }

  // Notebook CRUD handlers
  const handleCreateNotebook = () => {
    setNbModalAction('create')
    setNbModalName('')
    setNbModalCategory(t('common.default_category'))
    setNbNameTrans({})
    setNbCatTrans({})
    setIsNbTransOpen(false)
    setIsNbTranslationIntent(false)
    setTargetNotebook(null)
    setIsNbModalOpen(true)
  }

  const handleRenameNotebook = (nb: Notebook, openTranslations = false) => {
    setNbModalAction('rename')
    const currentLocale = i18n.language

    // Load name
    const mainNameTrans = translations.find(
      (t) =>
        t.entity_type === 'notebook' && t.entity_id === String(nb.id) && t.locale === currentLocale,
    )
    setNbModalName(mainNameTrans ? mainNameTrans.translation : nb.name)

    // Load category
    const mainCatTrans = translations.find(
      (t) =>
        t.entity_type === 'notebook_category' &&
        t.entity_id === nb.category &&
        t.locale === currentLocale,
    )
    setNbModalCategory(
      mainCatTrans
        ? mainCatTrans.translation
        : nb.category === '默认'
          ? t('common.default_category')
          : nb.category,
    )

    // Load other translations
    const nameTransObj: { [key: string]: string } = {}
    const catTransObj: { [key: string]: string } = {}
    configuredLocales.forEach((locale) => {
      if (locale.code !== currentLocale) {
        // Name
        const nt = translations.find(
          (t) =>
            t.entity_type === 'notebook' &&
            t.entity_id === String(nb.id) &&
            t.locale === locale.code,
        )
        nameTransObj[locale.code] = nt ? nt.translation : ''

        // Category
        const ct = translations.find(
          (t) =>
            t.entity_type === 'notebook_category' &&
            t.entity_id === nb.category &&
            t.locale === locale.code,
        )
        catTransObj[locale.code] = ct ? ct.translation : ''
      }
    })

    setNbNameTrans(nameTransObj)
    setNbCatTrans(catTransObj)
    setIsNbTransOpen(openTranslations)
    setIsNbTranslationIntent(openTranslations)
    setTargetNotebook(nb)
    setIsNbModalOpen(true)
  }

  const handleNbModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!api?.dbTransaction) {
      showToast(`⚠️ ${t('common.error_db_connect')}`)
      return
    }
    if (!nbModalName.trim()) return

    const mainName = nbModalName.trim()
    const normalizedMainName = mainName.toLocaleLowerCase().replace(/\s+/g, ' ')
    const reservedNotebookNames = new Set(
      [
        UNCATEGORIZED_NOTEBOOK,
        ...configuredLocales.flatMap((locale) => [
          i18n.getResource(locale.code, 'translation', 'notes.all_notes'),
          i18n.getResource(locale.code, 'translation', 'notes.default_title'),
        ]),
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')),
    )
    if (reservedNotebookNames.has(normalizedMainName)) {
      showToast(t('notes.error_reserved_notebook_name'))
      return
    }
    let categoryToSave = resolveNotebookCategoryStorageName(
      nbModalCategory,
      notebookCategoryOptions,
    )
    if (
      categoryToSave === t('common.default_category') ||
      categoryToSave.toLowerCase() === 'default' ||
      categoryToSave === '默认'
    ) {
      categoryToSave = '默认'
    }

    const nameTranslations = configuredLocales.map((locale) => ({
      locale: locale.code,
      translation:
        locale.code === i18n.language
          ? mainName
          : (nbNameTrans[locale.code] || '').trim() || mainName,
    }))
    const currentCategoryName = nbModalCategory.trim() || categoryToSave
    const categoryTranslations = configuredLocales.map((locale) => ({
      locale: locale.code,
      translation:
        locale.code === i18n.language
          ? currentCategoryName
          : (nbCatTrans[locale.code] || '').trim() || currentCategoryName,
    }))

    const statements =
      nbModalAction === 'create'
        ? buildCreateNotebookStatements({
            name: mainName,
            category: categoryToSave,
            nameTranslations,
            categoryTranslations,
          })
        : targetNotebook
          ? buildRenameNotebookStatements({
              id: targetNotebook.id,
              previousName: targetNotebook.name,
              name: mainName,
              category: categoryToSave,
              nameTranslations,
              categoryTranslations,
            })
          : null
    if (!statements) return

    const res = await api.dbTransaction('notes', statements)
    if (!res?.success) {
      showToast(getNotebookTransactionError(res?.error, t('notes.toast_notebook_exists')))
      return
    }
    const transactionResults = Array.isArray(res.data)
      ? (res.data as Array<{ changes?: number }>)
      : []
    const primaryChanges = Number(transactionResults[0]?.changes)
    if (!Number.isFinite(primaryChanges) || primaryChanges === 0) {
      showToast(t('notes.error_notebook_unavailable'))
      return
    }

    setIsNbModalOpen(false)
    if (nbModalAction === 'create') {
      showToast(t('notes.toast_notebook_created'))
      setActiveNotebook(mainName)
    } else if (targetNotebook) {
      showToast(t('notes.toast_notebook_renamed'))
      if (activeNotebook === targetNotebook.name) setActiveNotebook(mainName)
    }
    await loadNotes()
  }

  const handleDeleteNotebook = (nb: Notebook) => {
    if (!api?.dbTransaction) {
      showToast(`⚠️ ${t('common.error_electron_required')}`)
      return
    }
    setDeleteConfirmTarget({ type: 'notebook', id: nb.id, name: nb.name, nb })
  }

  const handleNotebookScopeSelect = (scope: string) => {
    const customNotebookNames = new Set(
      notebooks
        .filter((notebook) => notebook.name !== UNCATEGORIZED_NOTEBOOK)
        .map((notebook) => notebook.name),
    )
    const candidate =
      scope === ALL_NOTES_SCOPE
        ? notes[0]
        : scope === UNCATEGORIZED_NOTEBOOK
          ? notes.find(
              (note) =>
                !note.notebook ||
                note.notebook === UNCATEGORIZED_NOTEBOOK ||
                !customNotebookNames.has(note.notebook),
            )
          : notes.find((note) => note.notebook === scope)

    setActiveNotebook(scope)
    if (candidate) selectNote(candidate, scope)
  }

  // Handle Double Link Click or E-book Deep Link Click
  const handleDeepLinkClick = useCallback(
    (link: string) => {
      // 1. E-book Link format: book:BookID#ChapterTitle
      const readerTarget = parseReaderBookDeepLink(link)
      if (readerTarget) {
        if (readerTarget.target === 'annotation') {
          showToast(t('notes.toast_navigating_annotation', { bookId: readerTarget.bookId }))
        } else {
          showToast(
            t('notes.toast_navigating_shelf', {
              bookId: readerTarget.bookId,
              chapter: readerTarget.target === 'chapter' ? readerTarget.chapter : 'Default',
            }),
          )
        }
        setActiveScreen('books')

        setTimeout(() => {
          const event = new CustomEvent('lifeos:open-book', {
            detail: {
              bookId: readerTarget.bookId,
              chapter: readerTarget.target === 'chapter' ? readerTarget.chapter : undefined,
              annotationId:
                readerTarget.target === 'annotation' ? readerTarget.annotationId : undefined,
            },
          })
          window.dispatchEvent(event)
        }, 200)
        return
      }

      // 2. Obsidian Double Link format: [[Note Title]]
      const foundNote = notes.find((n) => n.title.toLowerCase() === link.toLowerCase())
      if (foundNote) {
        selectNote(foundNote)
        showToast(t('notes.toast_navigated_linked', { title: foundNote.title }))
      } else {
        showToast(t('notes.toast_linked_not_found', { link }))
      }
    },
    [notes, selectNote, showToast, t, setActiveScreen],
  )

  const updateNoteImageDimensions = useCallback(
    (url: string, width: number, height: number, reset = false) => {
      if (!activeNoteId) return
      const nextContent = updateNoteImageDimensionsInContent(noteContent, { url, width, height }, reset)
      if (nextContent === noteContent) return

      setNoteContent(nextContent)
      if (!api) return
      const savePromise =
        activeNoteIsPrivate && isPrivateNoteUnlocked && api.savePrivateNote
          ? api.savePrivateNote(activeNoteId, noteTitle, nextContent)
          : api.dbQuery(
              'notes',
              'UPDATE notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              [noteTitle, nextContent, activeNoteId],
            )
      void savePromise
        .then((res) => {
          if (!res?.success) showToast(res?.error || t('notes.error_save_failed'))
        })
    },
    [activeNoteId, activeNoteIsPrivate, api, isPrivateNoteUnlocked, noteContent, noteTitle, showToast, t],
  )

  const replaceEditorSelection = useCallback((format: (selection: string) => string) => {
    const textarea = editorRef.current
    const start = textarea?.selectionStart ?? noteContent.length
    const end = textarea?.selectionEnd ?? noteContent.length
    const selected = noteContent.slice(start, end)
    const replacement = format(selected)
    const nextContent = `${noteContent.slice(0, start)}${replacement}${noteContent.slice(end)}`
    setNoteContent(nextContent)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start, start + replacement.length)
      typoraEditorRef.current?.focus()
    })
  }, [noteContent])

  const applyMarkdownCommand = useCallback(
    (command: 'bold' | 'italic' | 'heading' | 'quote' | 'code' | 'bullet' | 'ordered' | 'link') => {
      const wrapLine = (selection: string, prefix: string) =>
        (selection || t('notes.typora_placeholder_text'))
          .split('\n')
          .map((line) => `${prefix}${line}`)
          .join('\n')

      replaceEditorSelection((selection) => {
        switch (command) {
          case 'bold':
            return `**${selection || t('notes.typora_placeholder_text')}**`
          case 'italic':
            return `*${selection || t('notes.typora_placeholder_text')}*`
          case 'heading':
            return wrapLine(selection, '## ')
          case 'quote':
            return wrapLine(selection, '> ')
          case 'code':
            return selection.includes('\n') ? `\`\`\`\n${selection}\n\`\`\`` : `\`${selection || 'code'}\``
          case 'bullet':
            return wrapLine(selection, '- ')
          case 'ordered':
            return (selection || t('notes.typora_placeholder_text'))
              .split('\n')
              .map((line, index) => `${index + 1}. ${line}`)
              .join('\n')
          case 'link':
            return `[${selection || t('notes.typora_placeholder_text')}](https://)`
          default:
            return selection
        }
      })
    },
    [replaceEditorSelection, t],
  )

  const handleTyporaInput = (event: React.FormEvent<HTMLDivElement>) => {
    setNoteContent(event.currentTarget.innerText)
  }

  const addNoteImageResizeFrames = (html: string) => {
    const template = document.createElement('template')
    template.innerHTML = html
    template.content
      .querySelectorAll<HTMLImageElement>('img[src^="life-note-asset://attachment/"]')
      .forEach((image) => {
        if (image.parentElement?.classList.contains('note-image-frame')) return
        image.dataset.noteImage = 'true'
        image.setAttribute('draggable', 'false')
        const frame = document.createElement('span')
        frame.className = 'note-image-frame'
        const handle = document.createElement('span')
        handle.className = 'note-image-resize-handle'
        handle.setAttribute('aria-hidden', 'true')
        image.replaceWith(frame)
        frame.append(image, handle)
      })
    return template.innerHTML
  }

  // Mature Markdown parser using 'marked' and sanitized with 'DOMPurify'
  const parseMarkdown = (md: string) => {
    // 1. Process double links before parsing, so they are not treated as plain text or wrapped incorrectly.
    const doubleLinkRegex = /\[\[(.*?)\]\]/g
    const mdWithLinks = md.replace(doubleLinkRegex, (_, inner) => {
      const isBook = inner.startsWith('book:')
      const bookLabel = t('notes.book_ref_label', { id: inner.replace('book:', '') })
      const safeLink = escapeHtmlAttribute(inner)
      const content = `<span style="font-size: 11px;">🔗</span>${isBook ? bookLabel : inner}`
      const style = 'color: var(--color-accent); font-weight: bold; background: none; border: none; cursor: pointer; text-decoration: underline; display: inline-flex; align-items: center; gap: 4px;'
      return isBook
        ? `<a class="deep-link-btn" data-link="${safeLink}" href="${safeLink}" style="${style}">${content}</a>`
        : `<button class="deep-link-btn" data-link="${safeLink}" style="${style}">${content}</button>`
    })

    // 2. Parse Markdown to HTML using marked
    const rawHtml = decorateReaderAnnotationExportHtml(marked.parse(renderSizedNoteImages(mdWithLinks), {
      gfm: true,
      breaks: true,
    }) as string)

    // 3. Sanitize HTML using DOMPurify to prevent XSS but allow our custom buttons and style/class attributes.
    const cleanHtml = DOMPurify.sanitize(addNoteImageResizeFrames(rawHtml), {
      ADD_TAGS: ['button', 'span'],
      ADD_ATTR: [
        'aria-hidden',
        'data-link',
        'data-note-image',
        'data-note-width',
        'data-note-height',
        'style',
        'class',
      ],
      ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto|tel|life-note-asset|book):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    })

    return cleanHtml
  }

  useEffect(() => {
    const shouldRenderMarkdown =
      activeNoteId &&
      (!activeNoteIsPrivate || isPrivateNoteUnlocked) &&
      !isMainNoteRenderSuspended &&
      (viewMode === 'typora' || viewMode === 'split' || viewMode === 'preview')

    if (!shouldRenderMarkdown) {
      setIsMarkdownRendering(false)
      setMarkdownRenderProgress(0)
      if (!activeNoteId || isMainNoteRenderSuspended) setRenderedMarkdownHtml('')
      return
    }

    const content = deferredNoteContent || ''
    const imageCount = content.match(/!\[[^\]]*]\(/g)?.length ?? 0
    const isLargeRender = content.length > 8000 || imageCount > 12
    let cancelled = false
    let idleHandle: number | undefined
    let progressTimer: number | undefined
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    setIsMarkdownRendering(isLargeRender)
    setMarkdownRenderProgress(isLargeRender ? 18 : 0)

    const renderTimer = window.setTimeout(
      () => {
        if (cancelled) return
        if (isLargeRender) setMarkdownRenderProgress(55)

        const render = () => {
          if (cancelled) return
          const html = parseMarkdown(content)
          if (cancelled) return
          setRenderedMarkdownHtml(html)
          setMarkdownRenderProgress(100)
          progressTimer = window.setTimeout(() => {
            if (!cancelled) {
              setIsMarkdownRendering(false)
              setMarkdownRenderProgress(0)
            }
          }, 120)
        }

        if (idleWindow.requestIdleCallback) {
          idleHandle = idleWindow.requestIdleCallback(render, { timeout: 900 })
        } else {
          window.requestAnimationFrame(render)
        }
      },
      isLargeRender ? 420 : 180,
    )

    return () => {
      cancelled = true
      if (renderTimer) window.clearTimeout(renderTimer)
      if (progressTimer) window.clearTimeout(progressTimer)
      if (idleHandle && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleHandle)
    }
  }, [
    activeNoteId,
    activeNoteIsPrivate,
    deferredNoteContent,
    i18n.language,
    isMainNoteRenderSuspended,
    isPrivateNoteUnlocked,
    t,
    viewMode,
  ])

  // Attach event handlers to dynamic preview content.
  useEffect(() => {
    const previewContainer = document.getElementById('markdown-preview')
    if (!previewContainer) return

    const getImageDimensions = (image: HTMLImageElement): NoteImageDimensions => {
      const bounds = image.getBoundingClientRect()
      const width = Number(image.dataset.noteWidth) || bounds.width || image.naturalWidth
      const height = bounds.height || Number(image.dataset.noteHeight) || image.naturalHeight
      return {
        url: image.src,
        width: clampNoteImageDimension(width),
        height: clampNoteImageDimension(height),
      }
    }

    const applyImageDimensions = (image: HTMLImageElement, width: number, height: number) => {
      const safeWidth = clampNoteImageDimension(width)
      const safeHeight = clampNoteImageDimension(height)
      image.style.width = `${safeWidth}px`
      image.style.height = 'auto'
      image.style.maxWidth = '100%'
      image.dataset.noteWidth = String(safeWidth)
      image.dataset.noteHeight = String(safeHeight)
      const frame = image.closest<HTMLElement>('.note-image-frame')
      if (frame) {
        frame.style.width = `${safeWidth}px`
        frame.style.maxWidth = '100%'
      }
    }

    const createImageResizeGuide = (bounds: DOMRect, width: number, height: number) => {
      const guide = document.createElement('div')
      guide.className = 'note-image-resize-guide'
      guide.setAttribute('aria-hidden', 'true')
      document.body.append(guide)
      updateImageResizeGuide(guide, bounds, width, height)
      return guide
    }

    const updateImageResizeGuide = (
      guide: HTMLElement,
      bounds: DOMRect,
      width: number,
      height: number,
    ) => {
      const safeWidth = clampNoteImageDimension(width)
      const safeHeight = clampNoteImageDimension(height)
      guide.style.left = `${bounds.left}px`
      guide.style.top = `${bounds.top}px`
      guide.style.width = `${safeWidth}px`
      guide.style.height = `${safeHeight}px`
      guide.textContent = `${safeWidth} x ${safeHeight}`
    }

    const removeImageResizeGuide = (guide?: HTMLElement) => {
      guide?.remove()
    }

    const selectImage = (image: HTMLImageElement) => {
      const selected = getImageDimensions(image)
      setSelectedNoteImage(selected)
      previewContainer.querySelectorAll<HTMLImageElement>('img[data-note-image]').forEach((candidate) => {
        candidate.classList.toggle('note-image-selected', candidate.src === selected.url)
        candidate.closest('.note-image-frame')?.classList.toggle('note-image-frame-selected', candidate.src === selected.url)
      })
    }

    const getEventImage = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null
      const handle = target.closest<HTMLElement>('.note-image-resize-handle')
      if (handle) {
        return handle
          .closest<HTMLElement>('.note-image-frame')
          ?.querySelector<HTMLImageElement>('img[src^="life-note-asset://attachment/"]') ?? null
      }
      return target.closest<HTMLImageElement>('img[src^="life-note-asset://attachment/"]')
    }

    const handlePreviewClick = (event: MouseEvent) => {
      setNoteImageMenu(null)
      const image = getEventImage(event.target)
      if (image) {
        selectImage(image)
        return
      }
      const target = event.target
      if (!(target instanceof Element)) return
      const deepLinkButton = target.closest<HTMLElement>('.deep-link-btn')
      if (deepLinkButton) {
        event.preventDefault()
        const link = deepLinkButton.getAttribute('data-link')
        if (link) handleDeepLinkClick(link)
        return
      }

      const attachmentLink = target.closest<HTMLAnchorElement>(
        'a[href^="life-note-asset://attachment/"]',
      )
      const attachmentUrl = attachmentLink?.getAttribute('href')
      if (!attachmentUrl) return
      event.preventDefault()
      void api?.openNoteAttachment?.(attachmentUrl).then((res) => {
        if (!res?.success) showToast(res?.error || t('notes.error_attachment_open_failed'))
      })
    }

    const handlePreviewContextMenu = (event: MouseEvent) => {
      const image = getEventImage(event.target)
      if (!image) return
      event.preventDefault()
      selectImage(image)
      setNoteImageMenu({
        url: image.src,
        left: Math.min(event.clientX, window.innerWidth - 180),
        top: Math.min(event.clientY, window.innerHeight - 140),
      })
    }

    let resizeState:
      | {
          image: HTMLImageElement
          handle: Element
          startX: number
          startY: number
          startWidth: number
          startHeight: number
          currentWidth: number
          currentHeight: number
          maxWidth: number
          pointerId: number
          guide: HTMLElement
          guideBounds: DOMRect
        }
      | undefined
    let resizeAnimationFrame = 0

    const scheduleImageResizeGuidePaint = (width: number, height: number) => {
      if (!resizeState) return
      if (resizeAnimationFrame) window.cancelAnimationFrame(resizeAnimationFrame)
      resizeAnimationFrame = window.requestAnimationFrame(() => {
        if (resizeState) {
          updateImageResizeGuide(resizeState.guide, resizeState.guideBounds, width, height)
        }
        resizeAnimationFrame = 0
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      const image = getEventImage(target)
      if (!image) return
      const handle = target instanceof Element ? target.closest('.note-image-resize-handle') : null
      if (!handle) return

      event.preventDefault()
      event.stopPropagation()
      const bounds = image.getBoundingClientRect()
      const dimensions = getImageDimensions(image)
      const width = Math.max(48, bounds.width || dimensions.width)
      const height = Math.max(48, bounds.height || dimensions.height)
      resizeState = {
        image,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: width,
        startHeight: height,
        currentWidth: width,
        currentHeight: height,
        maxWidth: Math.max(48, previewContainer.clientWidth - 32),
        pointerId: event.pointerId,
        guide: createImageResizeGuide(bounds, width, height),
        guideBounds: bounds,
      }
      handle.setPointerCapture?.(event.pointerId)
      selectImage(image)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (resizeState) {
        event.preventDefault()
        const { width, height } = getNoteImageResizeDragDimensions({
          startWidth: resizeState.startWidth,
          startHeight: resizeState.startHeight,
          deltaX: event.clientX - resizeState.startX,
          deltaY: event.clientY - resizeState.startY,
          maxWidth: resizeState.maxWidth,
        })
        resizeState.currentWidth = width
        resizeState.currentHeight = height
        scheduleImageResizeGuidePaint(width, height)
        return
      }

      const frame = event.target instanceof Element ? event.target.closest<HTMLElement>('.note-image-frame') : null
      if (frame) frame.style.cursor = 'pointer'
    }

    const handlePointerUp = () => {
      if (!resizeState) return
      try {
        resizeState.handle.releasePointerCapture?.(resizeState.pointerId)
      } catch {
        // Pointer capture can already be released by the browser if the drag leaves the window.
      }
      if (resizeAnimationFrame) {
        window.cancelAnimationFrame(resizeAnimationFrame)
        resizeAnimationFrame = 0
      }
      removeImageResizeGuide(resizeState.guide)
      const dimensions = {
        url: resizeState.image.src,
        width: clampNoteImageDimension(resizeState.currentWidth),
        height: clampNoteImageDimension(resizeState.currentHeight),
      }
      applyImageDimensions(resizeState.image, dimensions.width, dimensions.height)
      setSelectedNoteImage(dimensions)
      updateNoteImageDimensions(dimensions.url, dimensions.width, dimensions.height)
      resizeState = undefined
    }

    const preventNativeImageDrag = (event: DragEvent) => {
      if (getEventImage(event.target)) event.preventDefault()
    }

    previewContainer.addEventListener('click', handlePreviewClick)
    previewContainer.addEventListener('contextmenu', handlePreviewContextMenu)
    previewContainer.addEventListener('pointerdown', handlePointerDown)
    previewContainer.addEventListener('dragstart', preventNativeImageDrag)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      previewContainer.removeEventListener('click', handlePreviewClick)
      previewContainer.removeEventListener('contextmenu', handlePreviewContextMenu)
      previewContainer.removeEventListener('pointerdown', handlePointerDown)
      previewContainer.removeEventListener('dragstart', preventNativeImageDrag)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      if (resizeAnimationFrame) window.cancelAnimationFrame(resizeAnimationFrame)
      removeImageResizeGuide(resizeState?.guide)
    }
  }, [api, handleDeepLinkClick, noteContent, showToast, t, updateNoteImageDimensions, viewMode])

  useEffect(() => {
    if (!selectedNoteImage) return
    document
      .querySelectorAll<HTMLImageElement>('img[src^="life-note-asset://attachment/"]')
      .forEach((image) => {
        if (image.src !== selectedNoteImage.url) return
        const width = clampNoteImageDimension(selectedNoteImage.width)
        const height = clampNoteImageDimension(selectedNoteImage.height)
        image.style.width = `${width}px`
        image.style.height = 'auto'
        image.style.maxWidth = '100%'
        image.dataset.noteWidth = String(width)
        image.dataset.noteHeight = String(height)
        const frame = image.closest<HTMLElement>('.note-image-frame')
        if (frame) {
          frame.style.width = `${width}px`
          frame.style.maxWidth = '100%'
        }
      })
  }, [selectedNoteImage])

  useEffect(() => {
    if (!isExportDropdownOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && exportDropdownRef.current?.contains(target)) return
      setIsExportDropdownOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExportDropdownOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isExportDropdownOpen])

  useEffect(() => {
    if (!noteImageMenu) return
    const close = () => setNoteImageMenu(null)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [noteImageMenu])

  useEffect(() => {
    if (!api?.onNoteEditorDraft) return
    return api.onNoteEditorDraft((raw) => {
      const data = raw as NoteEditorDraft
      if (!data?.noteId || data.source === (popup ? 'popup' : 'main')) return
      if (!popup && isEditorWindowOpen) {
        pendingExternalEditorDraftRef.current = data
        return
      }
      suppressEditorBroadcastRef.current = true
      setActiveNoteId(data.noteId)
      if (typeof data.title === 'string') setNoteTitle(data.title)
      if (typeof data.content === 'string') setNoteContent(data.content)
      setActiveDraftIsPrivate(Boolean(data.isPrivate))
      setIsPrivateNoteUnlocked(Boolean(data.isPrivate && data.privateUnlocked))
      if (data.isPrivate && !data.privateUnlocked) {
        setNoteContent('')
        setUnlockPromptNote({
          id: data.noteId,
          title: typeof data.title === 'string' ? data.title : '',
          content: '',
          note_type: 'markdown',
          notebook: activeNotebook || UNCATEGORIZED_NOTEBOOK,
          is_private: 1,
          created_at: '',
          updated_at: '',
        })
        setPrivateDialogMode('unlock')
      } else {
        setUnlockPromptNote(null)
        setPrivateDialogMode(null)
      }
      requestAnimationFrame(() => {
        suppressEditorBroadcastRef.current = false
      })
    })
  }, [activeNotebook, api, isEditorWindowOpen, popup])

  useEffect(() => {
    if (!popup || !api?.notifyNoteEditorReady) return
    api.notifyNoteEditorReady()
  }, [api, popup])

  useEffect(() => {
    if (!api?.onNotesChanged) return
    return api.onNotesChanged((raw) => {
      const data = raw as { noteId?: number; title?: string; content?: string; reason?: string }
      if (!popup && isEditorWindowOpen) {
        if (data?.noteId === activeNoteId && typeof data.content === 'string') {
          pendingExternalEditorDraftRef.current = {
            source: 'popup',
            noteId: data.noteId,
            title: data.title,
            content: data.content,
            isPrivate: data.reason === 'private-save',
            privateUnlocked: data.reason === 'private-save',
          }
        }
        return
      }
      if (
        data?.noteId === activeNoteId &&
        typeof data.content === 'string' &&
        data.reason === 'private-save'
      ) {
        setNoteContent(data.content)
        if (typeof data.title === 'string') setNoteTitle(data.title)
      }
      if (!popup) void loadNotes()
    })
  }, [activeNoteId, api, isEditorWindowOpen, loadNotes, popup])

  useEffect(() => {
    if (!api?.onNoteEditorClosed || popup) return
    return api.onNoteEditorClosed(() => {
      void (async () => {
        setIsEditorWindowRestoring(true)
        const draft = pendingExternalEditorDraftRef.current
        const noteId = Number(draft?.noteId || activeNoteId)
        await loadNotes()

        if (Number.isInteger(noteId) && noteId > 0) {
          suppressEditorBroadcastRef.current = true
          const noteRes = await api.dbQuery('notes', 'SELECT * FROM notes WHERE id = ?', [noteId])
          const row = Array.isArray(noteRes?.data) ? (noteRes.data[0] as Note | undefined) : undefined
          setActiveNoteId(noteId)
          if (typeof draft?.title === 'string') setNoteTitle(draft.title)
          else if (typeof row?.title === 'string') setNoteTitle(row.title)

          const isPrivate = Boolean(draft?.isPrivate) || Number(row?.is_private || 0) === 1
          setActiveDraftIsPrivate(isPrivate)
          setIsPrivateNoteUnlocked(Boolean(isPrivate && draft?.privateUnlocked))
          if (isPrivate) {
            setNoteContent(typeof draft?.content === 'string' ? draft.content : '')
          } else if (typeof row?.content === 'string') {
            setNoteContent(row.content)
          } else if (typeof draft?.content === 'string') {
            setNoteContent(draft.content)
          }
          setUnlockPromptNote(null)
          setPrivateDialogMode(null)
          requestAnimationFrame(() => {
            suppressEditorBroadcastRef.current = false
          })
        }

        pendingExternalEditorDraftRef.current = null
        setIsEditorWindowOpen(false)
        setIsEditorWindowRestoring(false)
      })()
    })
  }, [activeNoteId, api, loadNotes, popup])

  useEffect(() => {
    if (!popup || !api?.onNoteEditorCloseRequest) return
    return api.onNoteEditorCloseRequest(() => {
      void (async () => {
        const saved = await handleSaveNote()
        if (saved) await api.confirmNoteEditorClose?.()
      })()
    })
  }, [api, handleSaveNote, popup])

  useEffect(() => {
    if (!activeNoteId || suppressEditorBroadcastRef.current) return
    if (isMainNoteRenderSuspended) return
    const signature = JSON.stringify({
      noteId: activeNoteId,
      title: noteTitle,
      content: noteContent,
      isPrivate: activeNoteIsPrivate,
      privateUnlocked: activeNoteIsPrivate && isPrivateNoteUnlocked,
    })
    if (signature === lastEditorBroadcastRef.current) return
    const timer = window.setTimeout(() => {
      lastEditorBroadcastRef.current = signature
      api?.sendNoteEditorDraft?.({
        source: popup ? 'popup' : 'main',
        noteId: activeNoteId,
        title: noteTitle,
        content: noteContent,
        isPrivate: activeNoteIsPrivate,
        privateUnlocked: activeNoteIsPrivate && isPrivateNoteUnlocked,
      })
    }, 420)
    return () => window.clearTimeout(timer)
  }, [
    activeNoteId,
    activeNoteIsPrivate,
    api,
    isMainNoteRenderSuspended,
    isPrivateNoteUnlocked,
    noteContent,
    noteTitle,
    popup,
  ])

  const copyPreviewImage = async (url: string) => {
    const res = await api?.copyNoteImage?.(url)
    showToast(res?.success ? t('notes.toast_image_copied') : res?.error || t('notes.error_image_copy_failed'))
    setNoteImageMenu(null)
  }

  const savePreviewImage = async (url: string) => {
    const res = await api?.saveNoteImage?.(url)
    if (res?.success) {
      if (res.saved !== false) showToast(t('notes.toast_image_saved'))
    } else {
      showToast(res?.error || t('notes.error_image_save_failed'))
    }
    setNoteImageMenu(null)
  }

  const openNoteEditorWindow = async () => {
    if (!activeNoteId || !api?.openNoteEditorWindow) {
      showToast(t('common.error_electron_required'))
      return
    }
    await handleSaveNote()
    const res = await api.openNoteEditorWindow({
      noteId: activeNoteId,
      title: noteTitle,
      content: noteContent,
      isPrivate: activeNoteIsPrivate,
      privateUnlocked: activeNoteIsPrivate && isPrivateNoteUnlocked,
    })
    if (res?.success) {
      pendingExternalEditorDraftRef.current = null
      setIsEditorWindowOpen(true)
      setIsEditorWindowRestoring(false)
    } else {
      showToast(res?.error || t('notes.error_open_popup_failed'))
    }
  }

  const closeNoteEditorWindow = async () => {
    const saved = await handleSaveNote()
    if (saved) await api?.closeNoteEditorWindow?.()
  }

  const renderImageSizeControls = () =>
    selectedNoteImage ? (
      <div className="note-image-size-controls">
        <span>{t('notes.image_size')}</span>
        <label>
          {t('notes.image_width')}
          <input
            type="number"
            min={48}
            max={4096}
            value={selectedNoteImage.width}
            onChange={(event) => {
              const width = Number(event.target.value)
              if (Number.isFinite(width)) {
                setSelectedNoteImage((current) => {
                  if (!current) return current
                  const safeWidth = clampNoteImageDimension(width)
                  const aspectRatio = current.height / Math.max(current.width, 1) || 1
                  return {
                    ...current,
                    width: safeWidth,
                    height: clampNoteImageDimension(safeWidth * aspectRatio),
                  }
                })
              }
            }}
            onBlur={() =>
              updateNoteImageDimensions(
                selectedNoteImage.url,
                selectedNoteImage.width,
                selectedNoteImage.height,
              )
            }
          />
        </label>
        <label>
          {t('notes.image_height')}
          <input
            type="number"
            min={48}
            max={4096}
            value={selectedNoteImage.height}
            onChange={(event) => {
              const height = Number(event.target.value)
              if (Number.isFinite(height)) {
                setSelectedNoteImage((current) => {
                  if (!current) return current
                  const safeHeight = clampNoteImageDimension(height)
                  const aspectRatio = current.width / Math.max(current.height, 1) || 1
                  return {
                    ...current,
                    width: clampNoteImageDimension(safeHeight * aspectRatio),
                    height: safeHeight,
                  }
                })
              }
            }}
            onBlur={() =>
              updateNoteImageDimensions(
                selectedNoteImage.url,
                selectedNoteImage.width,
                selectedNoteImage.height,
              )
            }
          />
        </label>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            updateNoteImageDimensions(selectedNoteImage.url, 0, 0, true)
            setSelectedNoteImage(null)
          }}
        >
          {t('notes.image_size_reset')}
        </button>
        <span className="note-image-size-hint">{t('notes.image_resize_hint')}</span>
      </div>
    ) : null

  const renderMarkdownRenderStatus = () =>
    isMarkdownRendering ? (
      <div className="note-render-loading" role="status" aria-live="polite">
        <Loader2 className="note-render-loading__spinner" size={16} aria-hidden="true" />
        <span>{t('notes.rendering_preview')}</span>
        <progress value={markdownRenderProgress || undefined} max={100} />
      </div>
    ) : null

  return (
    <div
      style={{
        animation: 'enter 0.15s ease both',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {!popup && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('notes.title')}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('notes.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" onClick={openCreatePrivateNoteDialog}>
              <Lock size={16} />
              {t('notes.new_private_note')}
            </button>
            <button className="btn primary" onClick={handleCreateNote}>
              <Plus size={16} />
              {t('notes.new_note')}
            </button>
          </div>
        </div>
      )}

      {/* Main 2-column layout */}
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: popup ? '1fr' : '280px 1fr',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        {!popup && (
          <NotebookSidebar
            notebooks={notebooks}
            notes={notes}
            activeNotebook={activeNotebook}
            activeNoteId={activeNoteId}
            getNotebookDisplayName={(notebook) => getNotebookDisplayName(notebook.name, notebook.id)}
            getCategoryDisplayName={getNotebookCategoryDisplayName}
            formatTime={formatTime}
            onSelectNotebook={handleNotebookScopeSelect}
            onSelectNote={(sidebarNote, scope) => {
              const note = notes.find((candidate) => candidate.id === sidebarNote.id)
              if (note) selectNote(note, scope)
            }}
            onCreateNotebook={handleCreateNotebook}
            onRenameNotebook={(notebook) => handleRenameNotebook(notebook as Notebook)}
            onEditTranslations={(notebook) => handleRenameNotebook(notebook as Notebook, true)}
            onDeleteNotebook={(notebook) => handleDeleteNotebook(notebook as Notebook)}
          />
        )}

        {/* Column 3: Rich Markdown editor + preview */}
        {isMainNoteRenderSuspended ? (
          <section className="notes-external-editor-state" aria-labelledby="notes-external-editor-title">
            <div className="notes-empty-state__icon" aria-hidden="true">
              {isEditorWindowRestoring ? (
                <Loader2 className="note-render-loading__spinner" />
              ) : (
                <Maximize2 />
              )}
            </div>
            <h2 id="notes-external-editor-title">
              {isEditorWindowRestoring
                ? t('notes.popup_editor_restoring_title')
                : t('notes.popup_editor_active_title')}
            </h2>
            <p>
              {isEditorWindowRestoring
                ? t('notes.popup_editor_restoring_description')
                : t('notes.popup_editor_active_description')}
            </p>
            {isEditorWindowRestoring && <progress />}
          </section>
        ) : activeNoteId && (!activeNoteIsPrivate || isPrivateNoteUnlocked) ? (
          <div
            className="notebook-modal"
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
            }}
          >
            {/* Common Header */}
            <div
              className="notes-editor-header"
              style={{
                minHeight: '42px',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                justifyContent: 'space-between',
                flexShrink: 0,
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              <input
                className="notes-editor-title-input"
                style={{
                  border: 'none',
                  outline: 'none',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  width: '35%',
                  backgroundColor: 'transparent',
                  color: 'var(--text-main)',
                }}
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                onBlur={handleSaveNote}
                placeholder={t('notes.new_note')}
              />
              <div className="notes-editor-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* Segmented Control for Editor View Mode */}
                <div
                  className="notes-editor-view-modes"
                  style={{
                    display: 'flex',
                    backgroundColor: 'var(--bg-app)',
                    padding: '2px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <button
                    className="note-view-mode-button"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      border: 'none',
                      borderRadius: '4px',
                      backgroundColor: viewMode === 'edit' ? 'var(--bg-surface)' : 'transparent',
                      color: viewMode === 'edit' ? 'var(--text-main)' : 'var(--text-muted)',
                      fontSize: '11px',
                      fontWeight: viewMode === 'edit' ? 'bold' : 'normal',
                      cursor: 'pointer',
                      boxShadow: viewMode === 'edit' ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => setViewMode('edit')}
                    title={t('notes.focus_mode')}
                    aria-label={t('notes.focus_mode')}
                  >
                    <Edit2 size={11} />
                    <span className="note-view-mode-label">{t('notes.focus_mode')}</span>
                  </button>
                  <button
                    className="note-view-mode-button"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      border: 'none',
                      borderRadius: '4px',
                      backgroundColor: viewMode === 'typora' ? 'var(--bg-surface)' : 'transparent',
                      color: viewMode === 'typora' ? 'var(--text-main)' : 'var(--text-muted)',
                      fontSize: '11px',
                      fontWeight: viewMode === 'typora' ? 'bold' : 'normal',
                      cursor: 'pointer',
                      boxShadow: viewMode === 'typora' ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => setViewMode('typora')}
                    title={t('notes.typora_mode')}
                    aria-label={t('notes.typora_mode')}
                  >
                    <NotebookPen size={11} />
                    <span className="note-view-mode-label">{t('notes.typora_mode')}</span>
                  </button>
                  <button
                    className="note-view-mode-button"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      border: 'none',
                      borderRadius: '4px',
                      backgroundColor: viewMode === 'split' ? 'var(--bg-surface)' : 'transparent',
                      color: viewMode === 'split' ? 'var(--text-main)' : 'var(--text-muted)',
                      fontSize: '11px',
                      fontWeight: viewMode === 'split' ? 'bold' : 'normal',
                      cursor: 'pointer',
                      boxShadow: viewMode === 'split' ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => setViewMode('split')}
                    title={t('notes.split_edit')}
                    aria-label={t('notes.split_edit')}
                  >
                    <Columns size={11} />
                    <span className="note-view-mode-label">{t('notes.split_edit')}</span>
                  </button>
                  <button
                    className="note-view-mode-button"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      border: 'none',
                      borderRadius: '4px',
                      backgroundColor: viewMode === 'preview' ? 'var(--bg-surface)' : 'transparent',
                      color: viewMode === 'preview' ? 'var(--text-main)' : 'var(--text-muted)',
                      fontSize: '11px',
                      fontWeight: viewMode === 'preview' ? 'bold' : 'normal',
                      cursor: 'pointer',
                      boxShadow: viewMode === 'preview' ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => setViewMode('preview')}
                    title={t('notes.preview_mode')}
                    aria-label={t('notes.preview_mode')}
                  >
                    <Eye size={11} />
                    <span className="note-view-mode-label">{t('notes.preview_mode')}</span>
                  </button>
                </div>

                {activeNoteIsPrivate && (
                  <button
                    className="btn sm note-editor-action-button"
                    onClick={() => void handleLockPrivateNote()}
                    title={t('notes.lock_private_note')}
                    aria-label={t('notes.lock_private_note')}
                    disabled={isSavingPrivate}
                  >
                    <KeyRound size={12} />
                    <span className="note-editor-action-label">
                      {isSavingPrivate ? t('notes.saving_private') : t('notes.lock_private_note')}
                    </span>
                  </button>
                )}

                {popup ? (
                  <button
                    className="btn sm note-editor-action-button"
                    onClick={() => void closeNoteEditorWindow()}
                    title={t('notes.close_popup_editor')}
                    aria-label={t('notes.close_popup_editor')}
                  >
                    <X size={12} />
                    <span className="note-editor-action-label">{t('notes.close_popup_editor')}</span>
                  </button>
                ) : (
                  <button
                    className="btn sm note-editor-action-button"
                    onClick={() => void openNoteEditorWindow()}
                    title={t('notes.open_popup_editor')}
                    aria-label={t('notes.open_popup_editor')}
                  >
                    <Maximize2 size={12} />
                    <span className="note-editor-action-label">{t('notes.open_popup_editor')}</span>
                  </button>
                )}

                <button
                  className="btn sm note-editor-action-button"
                  onClick={() => void handleSelectAttachments()}
                  disabled={isAttaching}
                  title={t('notes.attachment_hint')}
                  aria-label={isAttaching ? t('notes.adding_attachment') : t('notes.add_attachment')}
                >
                  <Paperclip size={12} />
                  <span className="note-editor-action-label">
                    {isAttaching ? t('notes.adding_attachment') : t('notes.add_attachment')}
                  </span>
                </button>

                {/* Export Button & Dropdown */}
                <div ref={exportDropdownRef} style={{ position: 'relative' }}>
                  <button
                    className="btn sm note-editor-action-button"
                    onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                    disabled={isExporting}
                    aria-haspopup="menu"
                    aria-expanded={isExportDropdownOpen}
                    aria-label={isExporting ? t('notes.exporting') : t('notes.export_note')}
                    title={isExporting ? t('notes.exporting') : t('notes.export_note')}
                  >
                    <Download size={12} />
                    <span className="note-editor-action-label">
                      {isExporting ? t('notes.exporting') : t('notes.export_note')}
                    </span>
                  </button>
                  {isExportDropdownOpen && (
                    <div
                      role="menu"
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '4px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                        zIndex: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: '135px',
                        overflow: 'hidden',
                      }}
                    >
                      <button
                        style={{
                          padding: '8px 12px',
                          background: 'none',
                          border: 'none',
                          textAlign: 'left',
                          fontSize: '12px',
                          cursor: 'pointer',
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                        onClick={() => handleExportNote('md')}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = 'var(--bg-app)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = 'transparent')
                        }
                      >
                        📄 Markdown (.md)
                      </button>
                      <button
                        style={{
                          padding: '8px 12px',
                          background: 'none',
                          border: 'none',
                          textAlign: 'left',
                          fontSize: '12px',
                          cursor: 'pointer',
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                        onClick={() => handleExportNote('html')}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = 'var(--bg-app)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = 'transparent')
                        }
                      >
                        🌐 Web Page (.html)
                      </button>
                      <button
                        style={{
                          padding: '8px 12px',
                          background: 'none',
                          border: 'none',
                          textAlign: 'left',
                          fontSize: '12px',
                          cursor: 'pointer',
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                        onClick={() => handleExportNote('docx')}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = 'var(--bg-app)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = 'transparent')
                        }
                      >
                        📝 Word Document (.docx)
                      </button>
                      <button
                        style={{
                          padding: '8px 12px',
                          background: 'none',
                          border: 'none',
                          textAlign: 'left',
                          fontSize: '12px',
                          cursor: 'pointer',
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                        onClick={() => handleExportNote('pdf')}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = 'var(--bg-app)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = 'transparent')
                        }
                      >
                        📕 PDF Document (.pdf)
                      </button>
                      <button
                        style={{
                          padding: '8px 12px',
                          background: 'none',
                          border: 'none',
                          textAlign: 'left',
                          fontSize: '12px',
                          cursor: 'pointer',
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                        onClick={() => handleExportNote('txt')}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = 'var(--bg-app)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = 'transparent')
                        }
                      >
                        ✏️ Plain Text (.txt)
                      </button>
                    </div>
                  )}
                </div>

                <button className="btn sm" onClick={() => handleDeleteNote(activeNoteId)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Split / Editor / Preview Panels */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: viewMode === 'split' ? '1fr 1fr' : '1fr',
                flexGrow: 1,
                minHeight: 0,
              }}
            >
              {/* Editor panel (visible in 'edit' and 'split' mode) */}
              {(viewMode === 'edit' || viewMode === 'split') && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    borderRight: viewMode === 'split' ? '1px solid var(--color-border)' : 'none',
                    height: '100%',
                    minHeight: 0,
                  }}
                >
                  <textarea
                    ref={editorRef}
                    style={{
                      flexGrow: 1,
                      border: 'none',
                      outline: 'none',
                      resize: 'none',
                      padding: '16px',
                      lineHeight: '1.6',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      backgroundColor: 'transparent',
                      color: 'var(--text-main)',
                    }}
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    onPaste={(event) => void handleEditorPaste(event)}
                    onBlur={handleSaveNote}
                    placeholder={t('notes.editor_placeholder')}
                  />
                </div>
              )}

              {viewMode === 'typora' && (
                <div className="typora-editor-shell">
                  <div className="typora-toolbar" role="toolbar" aria-label={t('notes.typora_toolbar')}>
                    {[
                      { command: 'heading', icon: Heading1, label: t('notes.toolbar_heading') },
                      { command: 'bold', icon: Bold, label: t('notes.toolbar_bold') },
                      { command: 'italic', icon: Italic, label: t('notes.toolbar_italic') },
                      { command: 'quote', icon: Quote, label: t('notes.toolbar_quote') },
                      { command: 'code', icon: Code, label: t('notes.toolbar_code') },
                      { command: 'bullet', icon: List, label: t('notes.toolbar_bullet') },
                      { command: 'ordered', icon: ListOrdered, label: t('notes.toolbar_ordered') },
                      { command: 'link', icon: LinkIcon, label: t('notes.toolbar_link') },
                    ].map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.command}
                          type="button"
                          className="typora-toolbar__button"
                          title={item.label}
                          aria-label={item.label}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applyMarkdownCommand(item.command as Parameters<typeof applyMarkdownCommand>[0])}
                        >
                          <Icon size={15} />
                        </button>
                      )
                    })}
                    <span className="typora-toolbar__spacer" />
                    <button
                      type="button"
                      className="typora-toolbar__button"
                      title={t('notes.add_attachment')}
                      aria-label={t('notes.add_attachment')}
                      onClick={() => void handleSelectAttachments()}
                    >
                      <Paperclip size={15} />
                    </button>
                    <button
                      type="button"
                      className="typora-toolbar__button"
                      title={t('notes.save_now')}
                      aria-label={t('notes.save_now')}
                      onClick={() => void handleSaveNote()}
                    >
                      <Save size={15} />
                    </button>
                  </div>
                  {renderImageSizeControls()}
                  {renderMarkdownRenderStatus()}
                  <div
                    id="markdown-preview"
                    ref={typoraEditorRef}
                    className="preview-md typora-editor"
                    data-placeholder={t('notes.editor_placeholder')}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handleTyporaInput}
                    onPaste={(event) => void handleEditorPaste(event)}
                    onBlur={handleSaveNote}
                    dangerouslySetInnerHTML={{ __html: renderedMarkdownHtml }}
                  />
                </div>
              )}

              {/* Preview panel (visible in 'preview' and 'split' mode) */}
              {(viewMode === 'preview' || viewMode === 'split') && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    minHeight: 0,
                    backgroundColor: 'var(--bg-app)',
                  }}
                >
                  {viewMode === 'split' && (
                    <div
                      style={{
                        height: '24px',
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 12px',
                        color: 'var(--text-muted)',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        backgroundColor: 'var(--bg-surface)',
                      }}
                    >
                      {t('notes.live_preview')}
                    </div>
                  )}
                  {renderImageSizeControls()}
                  {renderMarkdownRenderStatus()}
                  <div
                    id="markdown-preview"
                    className="preview-md"
                    style={{ flexGrow: 1, overflowY: 'auto', padding: '16px' }}
                    aria-busy={isMarkdownRendering}
                    dangerouslySetInnerHTML={{ __html: renderedMarkdownHtml }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : activeNoteId && activeNoteIsPrivate ? (
          <section className="notes-empty-state" aria-labelledby="notes-private-locked-title">
            <div className="notes-empty-state__icon" aria-hidden="true">
              <Lock />
            </div>
            <h2 id="notes-private-locked-title">{t('notes.private_locked_title')}</h2>
            <p>{t('notes.private_locked_description')}</p>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (activeNote) setUnlockPromptNote(activeNote)
                setPrivateDialogMode('unlock')
              }}
            >
              <KeyRound size={16} aria-hidden="true" />
              {t('notes.unlock_private_note')}
            </button>
          </section>
        ) : (
          <section className="notes-empty-state" aria-labelledby="notes-empty-state-title">
            <div className="notes-empty-state__icon" aria-hidden="true">
              <NotebookPen />
            </div>
            <h2 id="notes-empty-state-title">{t('notes.empty_state_title')}</h2>
            <p>{t('notes.empty_state_description')}</p>
            <button type="button" className="btn primary" onClick={handleCreateNote}>
              <Plus size={16} aria-hidden="true" />
              {t('notes.new_note')}
            </button>
          </section>
        )}
      </div>

      {noteImageMenu && (
        <ViewportPortal>
          <div
            className="note-image-context-menu"
            role="menu"
            style={{ left: noteImageMenu.left, top: noteImageMenu.top }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => void copyPreviewImage(noteImageMenu.url)}>
              {t('notes.copy_image')}
            </button>
            <button type="button" role="menuitem" onClick={() => void savePreviewImage(noteImageMenu.url)}>
              {t('notes.save_image_as')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void api?.openNoteAttachment?.(noteImageMenu.url)
                setNoteImageMenu(null)
              }}
            >
              {t('notes.open_attachment')}
            </button>
          </div>
        </ViewportPortal>
      )}

      {privateDialogMode && (
        <ViewportPortal>
          <div className="dialog-overlay note-private-dialog__overlay">
            <div className="dialog-surface note-private-dialog" role="dialog" aria-modal="true">
              <h3>
                {privateDialogMode === 'create'
                  ? t('notes.create_private_note')
                  : t('notes.unlock_private_note')}
              </h3>
              <p>
                {privateDialogMode === 'create'
                  ? t('notes.create_private_note_description')
                  : t('notes.unlock_private_note_description')}
              </p>
              <input
                className="form-field"
                type="password"
                autoFocus
                value={privatePassword}
                placeholder={t('notes.private_password_placeholder')}
                onChange={(event) => setPrivatePassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void (privateDialogMode === 'create'
                      ? handleCreatePrivateNote()
                      : handleUnlockPrivateNote())
                  }
                }}
              />
              <div className="note-private-dialog__actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setPrivateDialogMode(null)
                    setPrivatePassword('')
                  }}
                >
                  {t('notes.cancel')}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    void (privateDialogMode === 'create'
                      ? handleCreatePrivateNote()
                      : handleUnlockPrivateNote())
                  }
                >
                  {privateDialogMode === 'create'
                    ? t('notes.create_private_note')
                    : t('notes.unlock_private_note')}
                </button>
              </div>
            </div>
          </div>
        </ViewportPortal>
      )}

      {/* Notebook Creation/Edit Modal */}
      {isNbModalOpen && (
        <ViewportPortal>
          <div
            className="dialog-overlay"
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              margin: 0,
              backgroundColor: 'var(--overlay-dialog-bg)',
              backdropFilter: 'blur(var(--overlay-dialog-blur))',
              WebkitBackdropFilter: 'blur(var(--overlay-dialog-blur))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => {
              // Do nothing on backdrop click
            }}
          >
            <div
              className="dialog-surface"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '20px',
                width: '360px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)' }}>
                {nbModalAction === 'create'
                  ? t('notes.create_notebook')
                  : isNbTranslationIntent
                    ? t('notes.edit_notebook_translations')
                    : t('notes.rename_notebook')}
              </h3>
              <div className="notebook-modal__locale">
                {t('notes.current_language_label', { language: currentLocaleLabel })}
              </div>
              <form
                onSubmit={handleNbModalSubmit}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {t('notes.notebook_name')}
                  </label>
                  <input
                    className="form-field"
                    style={{ width: '100%' }}
                    value={nbModalName}
                    onChange={(e) => setNbModalName(e.target.value)}
                    placeholder={t('notes.notebook_name_placeholder')}
                    required
                    autoFocus
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {t('notes.notebook_category')}
                  </label>
                  <input
                    className="form-field"
                    style={{ width: '100%' }}
                    list={notebookCategoryListId}
                    aria-describedby={notebookCategoryHelpId}
                    autoComplete="off"
                    value={nbModalCategory}
                    onChange={(e) => setNbModalCategory(e.target.value)}
                    placeholder={t('notes.notebook_category_placeholder')}
                    required
                  />
                  <datalist id={notebookCategoryListId}>
                    {notebookCategoryOptions.map((option) => (
                      <option key={option.storageName} value={option.displayName} />
                    ))}
                  </datalist>
                  <span id={notebookCategoryHelpId} className="notebook-modal__field-help">
                    {t('notes.notebook_category_help')}
                  </span>
                </div>

                <div className="notebook-modal__translations">
                  <button
                    type="button"
                    className={`notebook-modal__translations-toggle ${isNbTransOpen ? 'open' : ''}`}
                    aria-expanded={isNbTransOpen}
                    aria-controls={notebookTranslationsPanelId}
                    onClick={() => setIsNbTransOpen(!isNbTransOpen)}
                  >
                    <span className="notebook-modal__translations-toggle-copy">
                      <Languages aria-hidden="true" />
                      <span>{t('common.more_translations')}</span>
                    </span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                </div>

                {isNbTransOpen && (
                  <div
                    id={notebookTranslationsPanelId}
                    className="notebook-modal__translations-panel"
                  >
                    {configuredLocales
                      .filter((l) => l.code !== i18n.language)
                      .map((locale) => (
                        <div
                          key={locale.code}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            paddingBottom: '8px',
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 'bold',
                              fontSize: '11px',
                              color: 'var(--color-accent)',
                            }}
                          >
                            {locale.label}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              {t('notes.notebook_name')}
                            </label>
                            <input
                              className="form-field"
                              style={{ width: '100%', fontSize: '12px', padding: '4px 6px' }}
                              value={nbNameTrans[locale.code] || ''}
                              onChange={(e) =>
                                setNbNameTrans({ ...nbNameTrans, [locale.code]: e.target.value })
                              }
                              placeholder={t('notes.notebook_name_translation_placeholder', {
                                language: locale.label,
                              })}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              {t('notes.notebook_category')}
                            </label>
                            <input
                              className="form-field"
                              style={{ width: '100%', fontSize: '12px', padding: '4px 6px' }}
                              value={nbCatTrans[locale.code] || ''}
                              onChange={(e) =>
                                setNbCatTrans({ ...nbCatTrans, [locale.code]: e.target.value })
                              }
                              placeholder={t('notes.notebook_category_translation_placeholder', {
                                language: locale.label,
                              })}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    marginTop: '8px',
                  }}
                >
                  <button type="button" className="btn sm" onClick={() => setIsNbModalOpen(false)}>
                    {t('notes.cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={(e) => handleNbModalSubmit(e as unknown as React.FormEvent)}
                  >
                    {t('notes.confirm')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ViewportPortal>
      )}

      {deleteConfirmTarget && (
        <ViewportPortal>
          <div
            className="dialog-overlay"
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              margin: 0,
              backgroundColor: 'var(--overlay-dialog-bg)',
              backdropFilter: 'blur(var(--overlay-dialog-blur))',
              WebkitBackdropFilter: 'blur(var(--overlay-dialog-blur))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setDeleteConfirmTarget(null)}
          >
            <div
              className="dialog-surface"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '20px',
                width: '360px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)' }}>
                {deleteConfirmTarget.type === 'note'
                  ? t('notes.delete_note')
                  : t('notes.delete_notebook')}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                {deleteConfirmTarget.type === 'note'
                  ? t('notes.prompt_delete_confirm')
                  : t('notes.prompt_delete_notebook_confirm', { name: deleteConfirmTarget.name })}
              </p>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px',
                  marginTop: '8px',
                }}
              >
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setDeleteConfirmTarget(null)}
                >
                  {t('notes.cancel')}
                </button>
                <button
                  type="button"
                  className="btn sm primary"
                  style={{
                    backgroundColor: 'var(--color-danger, #ff4d4f)',
                    borderColor: 'var(--color-danger, #ff4d4f)',
                  }}
                  onClick={() => {
                    if (deleteConfirmTarget.type === 'note') {
                      executeDeleteNote(deleteConfirmTarget.id)
                    } else if (deleteConfirmTarget.type === 'notebook' && deleteConfirmTarget.nb) {
                      executeDeleteNotebook(deleteConfirmTarget.nb)
                    }
                  }}
                >
                  {t('notes.confirm')}
                </button>
              </div>
            </div>
          </div>
        </ViewportPortal>
      )}
    </div>
  )
}

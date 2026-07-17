import React, { useEffect, useState, useCallback, useId, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  Plus,
  NotebookPen,
  Eye,
  Edit2,
  Columns,
  Trash2,
  Download,
  Languages,
} from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { getConfiguredLocales } from '../localeRegistry'
import { ViewportPortal } from '../components/ViewportPortal'
import { NotebookSidebar } from './NotebookSidebar'
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
  created_at: string
  updated_at: string
}

interface DBResponse {
  success: boolean
  data: unknown
  error?: string
}

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
}

export const Notes: React.FC = () => {
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
  const [viewMode, setViewMode] = useState<'edit' | 'split' | 'preview'>('split')
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

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

  const selectNote = useCallback((note: Note, scope = note.notebook) => {
    setActiveNoteId(note.id)
    setNoteTitle(note.title)
    setNoteContent(note.content || '')
    setActiveNotebook(scope)
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
      const notesList = notesRes.data as Note[]
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
    loadNotes()
  }, [loadNotes, userId])

  const handleSaveNote = async () => {
    if (!api) {
      showToast(`⚠️ ${t('notes.error_save_failed')}: ${t('common.error_electron_required')}`)
      return
    }
    if (!activeNoteId) return
    const query =
      'UPDATE notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    const res = await api.dbQuery('notes', query, [noteTitle, noteContent, activeNoteId])
    if (res?.success) {
      showToast(t('notes.toast_saved'))
      loadNotes()
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

  const handleExportNote = async (format: 'md' | 'html' | 'doc' | 'pdf' | 'txt') => {
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
      if (link.startsWith('book:')) {
        const cleaned = link.replace('book:', '')
        const [bookId, chapter] = cleaned.split('#')

        showToast(t('notes.toast_navigating_shelf', { bookId, chapter: chapter || 'Default' }))
        setActiveScreen('books')

        // We pass state in localSession or trigger ebook loader in React window
        setTimeout(() => {
          const event = new CustomEvent('lifeos:open-book', {
            detail: { bookId: parseInt(bookId), chapter },
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

  // Mature Markdown parser using 'marked' and sanitized with 'DOMPurify'
  const parseMarkdown = (md: string) => {
    // 1. Process double links before parsing, so they are not treated as plain text or wrapped incorrectly.
    const doubleLinkRegex = /\[\[(.*?)\]\]/g
    const mdWithLinks = md.replace(doubleLinkRegex, (_, inner) => {
      const isBook = inner.startsWith('book:')
      const bookLabel = t('notes.book_ref_label', { id: inner.replace('book:', '') })
      return `<button class="deep-link-btn" data-link="${inner}" style="color: var(--color-accent); font-weight: bold; background: none; border: none; cursor: pointer; text-decoration: underline; display: inline-flex; align-items: center; gap: 4px;"><span style="font-size: 11px;">🔗</span>${isBook ? bookLabel : inner}</button>`
    })

    // 2. Parse Markdown to HTML using marked
    const rawHtml = marked.parse(mdWithLinks, {
      gfm: true,
      breaks: true,
    }) as string

    // 3. Sanitize HTML using DOMPurify to prevent XSS but allow our custom buttons and style/class attributes.
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ['button', 'span'],
      ADD_ATTR: ['data-link', 'style', 'class'],
    })

    return cleanHtml
  }

  // Attach event handlers to dynamic HTML buttons
  useEffect(() => {
    const previewContainer = document.getElementById('markdown-preview')
    if (previewContainer) {
      const buttons = previewContainer.querySelectorAll('.deep-link-btn')
      buttons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const link = (e.currentTarget as HTMLElement).getAttribute('data-link')
          if (link) handleDeepLinkClick(link)
        })
      })
    }
  }, [noteContent, viewMode, handleDeepLinkClick])

  return (
    <div
      style={{
        animation: 'enter 0.15s ease both',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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
        <button className="btn primary" onClick={handleCreateNote}>
          <Plus size={16} />
          {t('notes.new_note')}
        </button>
      </div>

      {/* Main 2-column layout */}
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
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

        {/* Column 3: Rich Markdown editor + preview */}
        {activeNoteId ? (
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
              style={{
                height: '42px',
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
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* Segmented Control for Editor View Mode */}
                <div
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
                  >
                    <Edit2 size={11} />
                    <span>{t('notes.focus_mode')}</span>
                  </button>
                  <button
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
                  >
                    <Columns size={11} />
                    <span>{t('notes.split_edit')}</span>
                  </button>
                  <button
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
                  >
                    <Eye size={11} />
                    <span>{t('notes.preview_mode')}</span>
                  </button>
                </div>

                {/* Export Button & Dropdown */}
                <div style={{ position: 'relative' }}>
                  <button
                    className="btn sm"
                    onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                    disabled={isExporting}
                  >
                    <Download size={12} />
                    {isExporting ? t('notes.exporting') : t('notes.export_note')}
                  </button>
                  {isExportDropdownOpen && (
                    <>
                      <div
                        style={{
                          position: 'fixed',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          zIndex: 9,
                        }}
                        onClick={() => setIsExportDropdownOpen(false)}
                      />
                      <div
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
                          onClick={() => handleExportNote('doc')}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = 'var(--bg-app)')
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = 'transparent')
                          }
                        >
                          📝 Word Doc (.doc)
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
                    </>
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
                    onBlur={handleSaveNote}
                    placeholder={t('notes.editor_placeholder')}
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
                  <div
                    id="markdown-preview"
                    className="preview-md"
                    style={{ flexGrow: 1, overflowY: 'auto', padding: '16px' }}
                    dangerouslySetInnerHTML={{ __html: parseMarkdown(noteContent) }}
                  />
                </div>
              )}
            </div>
          </div>
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

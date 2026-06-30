import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FileText,
  Plus,
  Eye,
  Edit2,
  Columns,
  Trash2,
  Download,
} from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const SUPPORTED_LOCALES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' },
]

interface Notebook {
  id: number
  name: string
  category: string
  created_at?: string
}

interface NotebookWithNotes extends Notebook {
  notes: Note[]
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
  const [expandedNotebooks, setExpandedNotebooks] = useState<{ [key: string]: boolean }>({})

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

  // Deletion Modal States
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    type: 'note' | 'notebook'
    id: number
    name?: string
    nb?: Notebook
  } | null>(null)

  const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI

  const selectNote = useCallback((note: Note) => {
    setActiveNoteId(note.id)
    setNoteTitle(note.title)
    setNoteContent(note.content || '')
    setActiveNotebook(note.notebook)
    setExpandedNotebooks((prev) => ({
      ...prev,
      [note.notebook]: true,
    }))
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

    // Select active notebook or fallback
    let currentActive = activeNotebook
    if (list.length > 0) {
      const exists = list.some((n: Notebook) => n.name === currentActive)
      if (!exists) {
        currentActive = list[0].name
        setActiveNotebook(currentActive)
      }
    } else {
      currentActive = ''
      setActiveNotebook('')
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
          // Select first note under active notebook if possible, otherwise first note overall
          let defaultNote = notesList.find((n: Note) => n.notebook === currentActive)
          if (!defaultNote) {
            defaultNote = notesList[0]
          }
          selectNote(defaultNote)
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
    const targetNotebookName = activeNotebook || '未分类'
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
    if (!api) return
    const res = await api.dbQuery('notes', 'DELETE FROM notebooks WHERE id = ?', [nb.id])
    if (res?.success) {
      // Clear translations for this notebook
      await api.dbQuery(
        'notes',
        "DELETE FROM translations WHERE entity_type = 'notebook' AND entity_id = ?",
        [String(nb.id)],
      )

      await api.dbQuery('notes', 'UPDATE notes SET notebook = ? WHERE notebook = ?', [
        '未分类',
        nb.name,
      ])

      const checkNb = await api.dbQuery(
        'notes',
        'SELECT count(*) as count FROM notebooks WHERE name = ?',
        ['未分类'],
      )
      if (
        checkNb?.success &&
        Array.isArray(checkNb.data) &&
        checkNb.data.length > 0 &&
        (checkNb.data[0] as { count: number }).count === 0
      ) {
        await api.dbQuery('notes', 'INSERT INTO notebooks (name, category) VALUES (?, ?)', [
          '未分类',
          '默认',
        ])
      }

      showToast(t('notes.toast_notebook_deleted'))
      if (activeNotebook === nb.name) {
        setActiveNotebook('未分类')
      } else {
        loadNotes()
      }
    } else {
      showToast(res?.error || t('notes.error_delete_notebook_failed'))
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
    setTargetNotebook(null)
    setIsNbModalOpen(true)
  }

  const handleRenameNotebook = (nb: Notebook) => {
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
    SUPPORTED_LOCALES.forEach((locale) => {
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
    setIsNbTransOpen(false)
    setTargetNotebook(nb)
    setIsNbModalOpen(true)
  }

  const handleNbModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!api) {
      showToast(`⚠️ ${t('common.error_db_connect')}`)
      return
    }
    if (!nbModalName.trim()) return

    const mainName = nbModalName.trim()
    let categoryToSave = nbModalCategory.trim()
    if (
      categoryToSave === t('common.default_category') ||
      categoryToSave.toLowerCase() === 'default' ||
      categoryToSave === '默认'
    ) {
      categoryToSave = '默认'
    }

    if (nbModalAction === 'create') {
      const res = await api.dbQuery(
        'notes',
        'INSERT INTO notebooks (name, category) VALUES (?, ?)',
        [mainName, categoryToSave],
      )
      if (res?.success) {
        let nbId = (res.data as any)?.lastInsertRowid
        if (!nbId) {
          const findNb = await api.dbQuery('notes', 'SELECT id FROM notebooks WHERE name = ?', [
            mainName,
          ])
          if (findNb?.success && Array.isArray(findNb.data) && findNb.data.length > 0) {
            nbId = (findNb.data as any)[0].id
          }
        }

        if (nbId) {
          const nbIdStr = String(nbId)
          // Insert active language translation for notebook name
          await api.dbQuery(
            'notes',
            'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ("notebook", ?, ?, ?)',
            [nbIdStr, i18n.language, mainName],
          )
          // Insert other language translations for notebook name
          for (const locale of SUPPORTED_LOCALES) {
            if (locale.code === i18n.language) continue
            const val = (nbNameTrans[locale.code] || '').trim() || mainName
            await api.dbQuery(
              'notes',
              'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ("notebook", ?, ?, ?)',
              [nbIdStr, locale.code, val],
            )
          }

          // Insert translations for category (if custom)
          if (categoryToSave !== '默认') {
            await api.dbQuery(
              'notes',
              'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ("notebook_category", ?, ?, ?)',
              [categoryToSave, i18n.language, nbModalCategory.trim()],
            )
            for (const locale of SUPPORTED_LOCALES) {
              if (locale.code === i18n.language) continue
              const val = (nbCatTrans[locale.code] || '').trim() || nbModalCategory.trim()
              await api.dbQuery(
                'notes',
                'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ("notebook_category", ?, ?, ?)',
                [categoryToSave, locale.code, val],
              )
            }
          }
        }

        showToast(t('notes.toast_notebook_created'))
        setActiveNotebook(mainName)
        setExpandedNotebooks((prev) => ({
          ...prev,
          [mainName]: true,
        }))
        setIsNbModalOpen(false)
        loadNotes()
      } else {
        const errMsg = `${t('common.db_error')}: ${res?.error || t('common.db_error_hint')}`
        alert(errMsg)
        showToast(t('notes.toast_notebook_exists') || res?.error || '')
      }
    } else if (nbModalAction === 'rename' && targetNotebook) {
      const res = await api.dbQuery(
        'notes',
        'UPDATE notebooks SET name = ?, category = ? WHERE id = ?',
        [mainName, categoryToSave, targetNotebook.id],
      )
      if (res?.success) {
        await api.dbQuery('notes', 'UPDATE notes SET notebook = ? WHERE notebook = ?', [
          mainName,
          targetNotebook.name,
        ])

        const nbIdStr = String(targetNotebook.id)
        // Save notebook name translations
        await api.dbQuery(
          'notes',
          'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ("notebook", ?, ?, ?)',
          [nbIdStr, i18n.language, mainName],
        )
        for (const locale of SUPPORTED_LOCALES) {
          if (locale.code === i18n.language) continue
          const val = (nbNameTrans[locale.code] || '').trim() || mainName
          await api.dbQuery(
            'notes',
            'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ("notebook", ?, ?, ?)',
            [nbIdStr, locale.code, val],
          )
        }

        // Save notebook category translations
        if (categoryToSave !== '默认') {
          await api.dbQuery(
            'notes',
            'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ("notebook_category", ?, ?, ?)',
            [categoryToSave, i18n.language, nbModalCategory.trim()],
          )
          for (const locale of SUPPORTED_LOCALES) {
            if (locale.code === i18n.language) continue
            const val = (nbCatTrans[locale.code] || '').trim() || nbModalCategory.trim()
            await api.dbQuery(
              'notes',
              'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ("notebook_category", ?, ?, ?)',
              [categoryToSave, locale.code, val],
            )
          }
        }

        showToast(t('notes.toast_notebook_renamed'))
        setIsNbModalOpen(false)
        if (activeNotebook === targetNotebook.name) {
          setActiveNotebook(mainName)
        } else {
          loadNotes()
        }
      } else {
        const errMsg = `${t('common.db_error')}: ${res?.error || t('common.db_error_hint')}`
        alert(errMsg)
        showToast(t('notes.toast_notebook_exists') || res?.error || '')
      }
    }
  }

  const handleDeleteNotebook = (nb: Notebook) => {
    if (!api) {
      showToast(`⚠️ ${t('common.error_electron_required')}`)
      return
    }
    setDeleteConfirmTarget({ type: 'notebook', id: nb.id, name: nb.name, nb })
  }

  const handleNotebookHeaderClick = (notebookName: string) => {
    setActiveNotebook(notebookName)
    setExpandedNotebooks((prev) => ({
      ...prev,
      [notebookName]: !prev[notebookName],
    }))
  }

  const groupedNotebooks = React.useMemo(() => {
    const groups: { [key: string]: NotebookWithNotes[] } = {}

    // Group notes by notebook in memory
    const notesByNotebook: { [key: string]: Note[] } = {}
    notes.forEach((note) => {
      const nbName = note.notebook || '未分类'
      if (!notesByNotebook[nbName]) {
        notesByNotebook[nbName] = []
      }
      notesByNotebook[nbName].push(note)
    })

    // Group notebooks by category and assign their corresponding notes
    notebooks.forEach((nb) => {
      const cat = nb.category || '默认'
      if (!groups[cat]) {
        groups[cat] = []
      }
      groups[cat].push({
        ...nb,
        notes: notesByNotebook[nb.name] || [],
      })
    })

    return groups
  }, [notebooks, notes])

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
        {/* Combined Navigation Column (Tree Explorer) */}
        <div
          style={{
            borderRight: '1px solid var(--color-border)',
            padding: '12px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                margin: 0,
              }}
            >
              {t('notes.notebooks')}
            </h3>
            <button
              onClick={handleCreateNotebook}
              title={t('notes.create_notebook')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <FolderPlus size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {Object.entries(groupedNotebooks).map(([category, items]) => (
              <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 'bold',
                    color: 'var(--text-muted)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {getNotebookCategoryDisplayName(category)}
                </div>
                {items.map((nb) => {
                  const isExpanded = !!expandedNotebooks[nb.name]
                  const isActive = activeNotebook === nb.name
                  return (
                    <div key={nb.id} style={{ display: 'flex', flexDirection: 'column' }}>
                      {/* Notebook Header Row */}
                      <div
                        className="notebook-item"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderRadius: '6px',
                          background: isActive ? 'rgba(59, 130, 246, 0.06)' : 'none',
                          paddingRight: '6px',
                        }}
                      >
                        <button
                          onClick={() => handleNotebookHeaderClick(nb.name)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px',
                            borderRadius: '6px',
                            border: 'none',
                            background: 'none',
                            color: isActive ? 'var(--color-accent)' : 'var(--text-main)',
                            fontWeight: isActive ? 'bold' : 'normal',
                            textAlign: 'left',
                            cursor: 'pointer',
                            flexGrow: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                          }}
                        >
                          {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
                          <span
                            style={{
                              fontSize: '13px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {nb.name === '未分类'
                              ? t('notes.default_title')
                              : getNotebookDisplayName(nb.name, nb.id)}
                            {` (${nb.notes.length})`}
                          </span>
                        </button>
                        <div className="notebook-actions" style={{ display: 'flex', gap: '2px' }}>
                          <button
                            onClick={() => handleRenameNotebook(nb)}
                            title={t('common.edit')}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '2px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={() => handleDeleteNotebook(nb)}
                            title={t('common.delete')}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '2px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>

                      {/* Collapsible Notes List */}
                      {isExpanded && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            paddingLeft: '18px',
                            marginTop: '2px',
                            borderLeft: '1px dashed var(--color-border)',
                            marginLeft: '15px',
                          }}
                        >
                          {nb.notes.length === 0 ? (
                            <div
                              style={{
                                padding: '6px 8px',
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                                fontStyle: 'italic',
                              }}
                            >
                              {t('notes.empty_note_placeholder')}
                            </div>
                          ) : (
                            nb.notes.map((note) => {
                              const isNoteActive = activeNoteId === note.id
                              return (
                                <div
                                  key={note.id}
                                  onClick={() => selectNote(note)}
                                  style={{
                                    padding: '6px 8px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px',
                                    backgroundColor: isNoteActive ? 'var(--bg-app)' : 'transparent',
                                    border:
                                      '1px solid ' +
                                      (isNoteActive ? 'var(--color-accent)' : 'transparent'),
                                    transition: 'all 0.1s ease',
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isNoteActive) {
                                      e.currentTarget.style.backgroundColor =
                                        'rgba(255, 255, 255, 0.03)'
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isNoteActive) {
                                      e.currentTarget.style.backgroundColor = 'transparent'
                                    }
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: '12px',
                                      fontWeight: isNoteActive ? 600 : 'normal',
                                      color: isNoteActive ? 'var(--text-main)' : 'var(--text-main)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                    }}
                                  >
                                    <FileText
                                      size={12}
                                      style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                                    />
                                    <span
                                      style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {note.title || t('notes.title_placeholder')}
                                    </span>
                                  </div>
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      color: 'var(--text-muted)',
                                      paddingLeft: '18px',
                                    }}
                                  >
                                    {formatTime(note.created_at)}
                                  </span>
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Rich Markdown editor + preview */}
        {activeNoteId ? (
          <div
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              fontSize: '12px',
            }}
          >
            {t('notes.no_note_selected')}
          </div>
        )}
      </div>

      {/* Notebook Creation/Edit Modal */}
      {isNbModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(4px)',
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
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '20px',
              width: '320px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)' }}>
              {nbModalAction === 'create' ? t('notes.create_notebook') : t('notes.rename_notebook')}
            </h3>
            <form
              onSubmit={handleNbModalSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {t('notes.notebook_name')} ({t('common.main_name_label')})
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
                  {t('notes.notebook_category')} ({t('common.main_category_label')})
                </label>
                <input
                  className="form-field"
                  style={{ width: '100%' }}
                  value={nbModalCategory}
                  onChange={(e) => setNbModalCategory(e.target.value)}
                  placeholder={t('notes.notebook_category_placeholder')}
                  required
                />
              </div>

              {/* Collapsible panel for other translations */}
              <div style={{ marginTop: '4px', marginBottom: '8px' }}>
                <button
                  type="button"
                  className="btn sm"
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: 0,
                  }}
                  onClick={() => setIsNbTransOpen(!isNbTransOpen)}
                >
                  {t('common.more_translations')} {isNbTransOpen ? '▲' : '▼'}
                </button>
              </div>

              {isNbTransOpen && (
                <div
                  style={{
                    padding: '10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    marginBottom: '10px',
                  }}
                >
                  {SUPPORTED_LOCALES.filter((l) => l.code !== i18n.language).map((locale) => (
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
                          placeholder={`e.g. name in ${locale.label}`}
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
                          placeholder={`e.g. category in ${locale.label}`}
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
      )}

      {deleteConfirmTarget && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setDeleteConfirmTarget(null)}
        >
          <div
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
              <button type="button" className="btn sm" onClick={() => setDeleteConfirmTarget(null)}>
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
      )}
    </div>
  )
}

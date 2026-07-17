import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  ExternalLink,
  Edit3,
  Save,
  Copy,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import {
  getActiveTocIndex,
  getAnnotationEditorFocusOptions,
  getPageOfParagraph,
  getPagesForReadingBlocks,
  getParagraphOffsetOfPage,
  getPdfPageRenderWidth,
  getReadingBlockText,
  getReaderContentGridColumns,
  getReadingProgressForLocation,
  isReadingBlockHeading,
  resolveReaderTocEntry,
  shouldCloseReaderDrawersOnContentClick,
  shouldShowEpubToc,
  type ReadingBlock,
  type TocEntry,
} from './bookReaderUtils'
import { BookCategorySidebar, type BookShelf } from './BookCategorySidebar'
import { AccessibleDialog } from '../components/AccessibleDialog'
import { getConfiguredLocales } from '../localeRegistry'
import {
  buildBookCategoryMigrationStatements,
  buildCategoryStorageAliasMap,
  getActiveCategoryAfterDelete,
  isReservedBookCategory,
} from './bookCategorySidebarUtils'

export const Books: React.FC = () => {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
  const userId = useAppStore((state) => state.userId)
  const configuredLocales = useMemo(
    () => getConfiguredLocales(i18n.language),
    [i18n.language],
  )

  // DB States
  const [categories, setCategories] = useState<any[]>([])
  const [books, setBooks] = useState<any[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('all')

  // Reader Overlay State
  const [readingBook, setReadingBook] = useState<any | null>(null)
  const [readingProgress, setReadingProgress] = useState<number>(0)

  // Modals state
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importTitle, setImportTitle] = useState('')
  const [importAuthor, setImportAuthor] = useState('')
  const [importCategory, setImportCategory] = useState('')
  const [importCustomCategory, setImportCustomCategory] = useState('')
  const [isCustomCategory, setIsCustomCategory] = useState(false)
  const [importFilePath, setImportFilePath] = useState('')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [importFormat, setImportFormat] = useState('EPUB')

  // eBook edit and delete states
  const [editingBookInfo, setEditingBookInfo] = useState<any | null>(null)
  const [editBookTitle, setEditBookTitle] = useState('')
  const [editBookAuthor, setEditBookAuthor] = useState('')
  const [editBookCategory, setEditBookCategory] = useState('')
  const [editBookCustomCategory, setEditBookCustomCategory] = useState('')
  const [isEditBookCustomCategory, setIsEditBookCustomCategory] = useState(false)
  const [deletingBookInfo, setDeletingBookInfo] = useState<any | null>(null)

  // eBook reader content states
  const [bookChapters, setBookChapters] = useState<any[] | null>(null)
  // Hierarchical table of contents for EPUB: [{ title, level, chapterIndex, paragraphOffset }].
  const [bookToc, setBookToc] = useState<
    { title: string; level: number; chapterIndex: number; paragraphOffset?: number }[] | null
  >(null)
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [currentParagraphOffset, setCurrentParagraphOffset] = useState(0)
  const [pdfData, setPdfData] = useState<number[] | null>(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [pdfNumPages, setPdfNumPages] = useState<number>(0)
  const [isLoadingReader, setIsLoadingReader] = useState(false)
  const [pdfLayoutMode, setPdfLayoutMode] = useState<'single' | 'dual' | 'scroll' | 'simulation'>(
    'single',
  )
  // EPUB reflow view mode: paged single-page, dual-column, or continuous scroll.
  const [epubLayoutMode, setEpubLayoutMode] = useState<'single' | 'dual' | 'scroll'>('single')
  const [isAutoPlaying, setIsAutoPlaying] = useState(false)
  const [autoPlaySpeed, setAutoPlaySpeed] = useState(10) // seconds per page
  const pdfInitializedRef = useRef(false)
  const readerContentRef = useRef<HTMLDivElement | null>(null)
  const readerMainRef = useRef<HTMLElement | null>(null)
  const pdfScrollRef = useRef<HTMLDivElement | null>(null)
  const annotationInputRef = useRef<HTMLInputElement | null>(null)
  // Guards the scroll handler from fighting a programmatic scroll (button / progress jump).
  const isProgrammaticScrollRef = useRef(false)
  const skipNextEpubAlignRef = useRef(false)
  const [navBtnPosition, setNavBtnPosition] = useState<{ left: number; right: number; top: number }>(
    {
      left: 16,
      right: 16,
      top: 0,
    },
  )
  // Category editing and deleting states
  const [editingCategory, setEditingCategory] = useState<any | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editCatTrans, setEditCatTrans] = useState<{ [key: string]: string }>({})
  const [isEditCatTransOpen, setIsEditCatTransOpen] = useState(false)
  const [deletingCategory, setDeletingCategory] = useState<any | null>(null)
  const [isDeletingCategoryPending, setIsDeletingCategoryPending] = useState(false)
  const deleteCategoryPendingRef = useRef(false)
  const categoryDialogReturnFocusRef = useRef<(() => void) | null>(null)
  const editCategoryNameInputRef = useRef<HTMLInputElement | null>(null)
  const deleteCategoryCancelButtonRef = useRef<HTMLButtonElement | null>(null)

  const restoreCategoryDialogFocus = useCallback(() => {
    const returnFocus = categoryDialogReturnFocusRef.current
    categoryDialogReturnFocusRef.current = null
    returnFocus?.()
  }, [])

  // Category translations state
  const [translations, setTranslations] = useState<any[]>([])
  const categoryStorageAliases = useMemo(
    () => buildCategoryStorageAliasMap(categories, translations),
    [categories, translations],
  )

  // Get translation matching current locale from database or default back to name
  const getCategoryDisplayName = (catName: string, catId?: any) => {
    const currentLocale = i18n.language

    if (catName === '未分类' || !catName) {
      const trans = translations.find(
        (t) =>
          t.entity_type === 'category' &&
          t.entity_id === 'uncategorized' &&
          t.locale === currentLocale,
      )
      return trans ? trans.translation : t('books.uncategorized')
    }

    if (catId) {
      const trans = translations.find(
        (t) =>
          t.entity_type === 'category' &&
          t.entity_id === String(catId) &&
          t.locale === currentLocale,
      )
      if (trans) return trans.translation
    } else {
      const cat = categories.find((c) => c.name === catName)
      if (cat) {
        const trans = translations.find(
          (t) =>
            t.entity_type === 'category' &&
            t.entity_id === String(cat.id) &&
            t.locale === currentLocale,
        )
        if (trans) return trans.translation
      }
    }

    return catName
  }

  const isBookInCategory = (book: any, cat: any) => {
    if (typeof book.category !== 'string') return false
    const storedCategory = book.category.trim()
    if (!storedCategory) return false
    return categoryStorageAliases.get(String(cat.id))?.has(storedCategory) ?? false
  }

  const chapters = [
    t('books.chapter_1'),
    t('books.chapter_2'),
    t('books.chapter_3'),
    t('books.chapter_4'),
  ]

  const [currentChapter, setCurrentChapter] = useState(chapters[0])
  // Index-based chapter identity for real (EPUB/TXT) books. Titles are NOT unique
  // across spine files, so navigation must key off the index, not the title string.
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0)

  useEffect(() => {
    // Sync current chapter selection on language toggling
    setCurrentChapter((prev) => {
      if (prev.includes('第一章') || prev.includes('Chapter 1')) return chapters[0]
      if (prev.includes('第二章') || prev.includes('Chapter 2')) return chapters[1]
      if (prev.includes('第三章') || prev.includes('Chapter 3')) return chapters[2]
      if (prev.includes('第四章') || prev.includes('Chapter 4')) return chapters[3]
      return prev
    })
  }, [i18n.language])

  const [fontSize, setFontSize] = useState(15)
  const [readerBg, setReaderBg] = useState('#FDFBF7') // Sepia default
  const [highlights, setHighlights] = useState<any[]>([])
  const [newAnnotation, setNewAnnotation] = useState('')
  const [selectedHighlightText, setSelectedHighlightText] = useState('')
  const [isTocDrawerOpen, setIsTocDrawerOpen] = useState(false)
  const [isAnnotationsDrawerOpen, setIsAnnotationsDrawerOpen] = useState(false)
  const [readerMainWidth, setReaderMainWidth] = useState(0)

  const api = (window as any).electronAPI

  const loadData = async () => {
    if (!api) return

    // Load categories
    const catRes = await api.dbQuery('books', 'SELECT * FROM categories ORDER BY sort_order ASC')
    if (catRes?.success) {
      setCategories(catRes.data)

      // Load translations
      const transRes = await api.dbQuery(
        'books',
        "SELECT * FROM translations WHERE entity_type = 'category'",
      )
      if (transRes?.success) {
        setTranslations(transRes.data)
      }
    }

    // Load books
    const bookRes = await api.dbQuery('books', 'SELECT * FROM books')
    if (bookRes?.success) setBooks(bookRes.data)
  }

  useEffect(() => {
    loadData()

    // Listen to deep linking events from Notes view
    const handleOpenBookEvent = async (e: Event) => {
      const { bookId, chapter } = (e as CustomEvent).detail
      if (!api) return

      const res = await api.dbQuery('books', 'SELECT * FROM books WHERE id = ?', [bookId])
      if (res?.success && res.data.length > 0) {
        const book = res.data[0]
        setReadingBook(book)
        setReadingProgress(Math.round(book.progress || 0))
        if (chapter) setCurrentChapter(decodeURIComponent(chapter))

        // Load highlights for this book
        const hlRes = await api.dbQuery('books', 'SELECT * FROM highlights WHERE book_id = ?', [
          bookId,
        ])
        if (hlRes?.success) setHighlights(hlRes.data)
      }
    }

    window.addEventListener('lifeos:open-book', handleOpenBookEvent)
    return () => {
      window.removeEventListener('lifeos:open-book', handleOpenBookEvent)
    }
  }, [userId])

  const createCategory = async (name: string) => {
    if (!api?.dbTransaction) {
      return { ok: false as const, error: t('books.toast_category_create_failed') }
    }

    const mainName = name.trim()
    if (!mainName) {
      return { ok: false as const, error: t('books.shelf_name_required') }
    }
    if (
      isReservedBookCategory(mainName) ||
      categories.some((category) => category.name === mainName)
    ) {
      return { ok: false as const, error: t('books.shelf_name_duplicate') }
    }

    try {
      const transactionResult = await api.dbTransaction('books', [
        {
          sql: 'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
          params: [mainName, categories.length + 1],
        },
        {
          sql: `
            INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation)
            VALUES ('category', CAST(last_insert_rowid() AS TEXT), ?, ?)
          `,
          params: [i18n.language, mainName],
        },
      ])
      if (!transactionResult?.success) {
        await loadData()
        return { ok: false as const, error: t('books.toast_category_create_failed') }
      }

      await loadData()
      setActiveCategory(mainName)
      showToast(t('books.toast_category_added', { name: mainName }))
      return { ok: true as const }
    } catch {
      await loadData()
      return { ok: false as const, error: t('books.toast_category_create_failed') }
    }
  }

  const renameCategoryInline = async (category: BookShelf, name: string) => {
    if (!api?.dbTransaction) {
      return { ok: false as const, error: t('books.toast_category_update_failed') }
    }

    const newName = name.trim()
    if (!newName) {
      return { ok: false as const, error: t('books.shelf_name_required') }
    }
    if (
      isReservedBookCategory(newName) ||
      categories.some(
        (candidate) => candidate.name === newName && String(candidate.id) !== String(category.id),
      )
    ) {
      return { ok: false as const, error: t('books.shelf_name_duplicate') }
    }
    if (newName === category.name) {
      return { ok: true as const }
    }

    try {
      const categoryAliases = categoryStorageAliases.get(String(category.id)) ?? [category.name]
      const transactionResult = await api.dbTransaction('books', [
        ...buildBookCategoryMigrationStatements(categoryAliases, newName),
        {
          sql: 'UPDATE categories SET name = ? WHERE id = ?',
          params: [newName, category.id],
        },
        {
          sql: 'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
          params: ['category', String(category.id), i18n.language, newName],
        },
      ])

      if (!transactionResult?.success) {
        await loadData()
        return { ok: false as const, error: t('books.toast_category_update_failed') }
      }

      setActiveCategory((current) => (current === category.name ? newName : current))
      await loadData()
      showToast(t('books.toast_category_updated'))
      return { ok: true as const }
    } catch {
      await loadData()
      return { ok: false as const, error: t('books.toast_category_update_failed') }
    }
  }

  const closeCategoryTranslationEditor = () => {
    setEditingCategory(null)
    setEditCatName('')
    setEditCatTrans({})
    setIsEditCatTransOpen(false)
  }

  const openCategoryTranslationEditor = (category: BookShelf, returnFocus: () => void) => {
    const currentLocale = i18n.language
    const primaryTranslation = translations.find(
      (translation) =>
        translation.entity_type === 'category' &&
        translation.entity_id === String(category.id) &&
        translation.locale === currentLocale,
    )
    const otherTranslations: { [key: string]: string } = {}
    configuredLocales.forEach((locale) => {
      if (locale.code === currentLocale) return
      const translation = translations.find(
        (candidate) =>
          candidate.entity_type === 'category' &&
          candidate.entity_id === String(category.id) &&
          candidate.locale === locale.code,
      )
      otherTranslations[locale.code] = translation?.translation ?? ''
    })

    categoryDialogReturnFocusRef.current = returnFocus
    setEditingCategory(category)
    setEditCatName(primaryTranslation?.translation ?? category.name)
    setEditCatTrans(otherTranslations)
    setIsEditCatTransOpen(true)
  }

  const openCategoryDeleteDialog = (category: BookShelf, returnFocus: () => void) => {
    categoryDialogReturnFocusRef.current = returnFocus
    setDeletingCategory(category)
  }

  const closeCategoryDeleteDialog = () => {
    if (!deleteCategoryPendingRef.current) setDeletingCategory(null)
  }

  const handleSelectBookFile = async () => {
    if (!api) {
      showToast(t('books.toast_file_picker_unavailable'))
      return
    }
    const res = await api.selectBookFile()
    if (res?.success) {
      setImportFilePath(res.relativePath)
      setSelectedFileName(res.fileName)
      const ext = res.fileName.split('.').pop()?.toUpperCase() || 'EPUB'
      setImportFormat(ext)
      // Auto-populate Title if it was empty
      if (!importTitle.trim()) {
        setImportTitle(res.title)
      }
    } else if (res?.error && res.error !== 'Canceled') {
      showToast(res.error)
    }
  }

  // Confirm E-book Import
  const confirmImportBook = async () => {
    if (!api || !importTitle.trim()) return

    const title = importTitle.trim()
    const author = importAuthor.trim() || t('books.unknown_author')

    let finalCategory = ''
    if (isCustomCategory) {
      finalCategory = importCustomCategory.trim()
    } else {
      finalCategory = importCategory.trim()
    }

    if (!finalCategory) {
      finalCategory = '未分类'
    }

    // Insert category automatically if not existing and not "未分类"
    const isUncat = isReservedBookCategory(finalCategory)
    if (!isUncat && !categories.some((c) => c.name === finalCategory)) {
      await api.dbQuery(
        'books',
        'INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)',
        [finalCategory, categories.length + 1],
      )
    }

    const finalPath = importFilePath || `/books/${title}.epub`
    const query = `
      INSERT INTO books (title, author, path, cover, category, progress, status)
      VALUES (?, ?, ?, ?, ?, 0.0, 'want')
    `
    const res = await api.dbQuery('books', query, [
      title,
      author,
      finalPath,
      importFormat,
      finalCategory,
    ])

    if (res?.success) {
      showToast(t('books.toast_book_imported', { title }))
      setIsImportOpen(false)
      setImportTitle('')
      setImportAuthor('')
      setImportCategory('')
      setImportCustomCategory('')
      setIsCustomCategory(false)
      setImportFilePath('')
      setSelectedFileName('')
      setImportFormat('EPUB')
      loadData()
    }
  }

  const confirmEditCategory = async () => {
    if (!editingCategory) return
    if (!api?.dbTransaction) {
      showToast(t('books.toast_category_update_failed'))
      return
    }

    const newName = editCatName.trim()
    if (!newName) {
      showToast(t('books.shelf_name_required'))
      return
    }
    const oldName = editingCategory.name
    if (
      isReservedBookCategory(newName) ||
      categories.some(
        (category) =>
          category.name === newName && String(category.id) !== String(editingCategory.id),
      )
    ) {
      showToast(t('books.shelf_name_duplicate'))
      return
    }

    try {
      const catIdStr = String(editingCategory.id)
      const categoryAliases = categoryStorageAliases.get(catIdStr) ?? [oldName]
      const statements = [
        ...buildBookCategoryMigrationStatements(categoryAliases, newName),
        {
          sql: 'UPDATE categories SET name = ? WHERE id = ?',
          params: [newName, editingCategory.id],
        },
        {
          sql: 'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
          params: ['category', catIdStr, i18n.language, newName],
        },
      ]

      for (const locale of configuredLocales) {
        if (locale.code === i18n.language) continue
        const transValue = (editCatTrans[locale.code] || '').trim() || newName
        statements.push({
          sql: 'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
          params: ['category', catIdStr, locale.code, transValue],
        })
      }

      const transactionResult = await api.dbTransaction('books', statements)
      if (!transactionResult?.success) {
        await loadData()
        showToast(t('books.toast_category_update_failed'))
        return
      }

      setActiveCategory((current) => (current === oldName ? newName : current))
      closeCategoryTranslationEditor()
      await loadData()
      showToast(t('books.toast_category_updated'))
    } catch {
      await loadData()
      showToast(t('books.toast_category_update_failed'))
    }
  }

  const confirmDeleteCategory = async () => {
    if (!deletingCategory) return
    if (deleteCategoryPendingRef.current) return
    deleteCategoryPendingRef.current = true
    setIsDeletingCategoryPending(true)
    try {
      if (!api?.dbTransaction) {
        setDeletingCategory(null)
        await loadData()
        showToast(t('books.toast_category_delete_failed'))
        return
      }

      const category = deletingCategory
      const categoryName = category.name
      const categoryId = String(category.id)
      const mappedAliases = categoryStorageAliases.get(categoryId)
      const storageAliases = new Set(mappedAliases ?? [])
      if (!mappedAliases && typeof categoryName === 'string' && categoryName.trim()) {
        storageAliases.add(categoryName.trim())
      }

      const statements = Array.from(storageAliases, (alias) => ({
        sql: "UPDATE books SET category = '未分类' WHERE TRIM(category) = ?",
        params: [alias],
      }))
      statements.push(
        { sql: 'DELETE FROM categories WHERE id = ?', params: [category.id] },
        {
          sql: "DELETE FROM translations WHERE entity_type = 'category' AND entity_id = ?",
          params: [categoryId],
        },
      )

      const transactionResult = await api.dbTransaction('books', statements)
      if (!transactionResult?.success) {
        setDeletingCategory(null)
        await loadData()
        showToast(t('books.toast_category_delete_failed'))
        return
      }

      setActiveCategory((current) => getActiveCategoryAfterDelete(current, categoryName))
      await loadData()
      setDeletingCategory(null)
      showToast(t('books.toast_category_deleted'))
    } catch {
      setDeletingCategory(null)
      await loadData()
      showToast(t('books.toast_category_delete_failed'))
    } finally {
      deleteCategoryPendingRef.current = false
      setIsDeletingCategoryPending(false)
    }
  }

  // Edit book handlers
  const handleStartEditBook = (book: any) => {
    setEditingBookInfo(book)
    setEditBookTitle(book.title)
    setEditBookAuthor(book.author || '')
    setEditBookCategory(book.category || '')
    setEditBookCustomCategory('')
    setIsEditBookCustomCategory(false)
  }

  const confirmEditBook = async () => {
    if (!api || !editingBookInfo || !editBookTitle.trim()) return

    const title = editBookTitle.trim()
    const author = editBookAuthor.trim() || t('books.unknown_author')

    let finalCategory = ''
    if (isEditBookCustomCategory) {
      finalCategory = editBookCustomCategory.trim()
    } else {
      finalCategory = editBookCategory.trim()
    }

    if (!finalCategory) {
      finalCategory = '未分类'
    }

    // Insert category automatically if not existing and not "未分类"
    const isUncat = isReservedBookCategory(finalCategory)
    if (!isUncat && !categories.some((c) => c.name === finalCategory)) {
      await api.dbQuery(
        'books',
        'INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)',
        [finalCategory, categories.length + 1],
      )
    }

    const res = await api.dbQuery(
      'books',
      'UPDATE books SET title = ?, author = ?, category = ? WHERE id = ?',
      [title, author, finalCategory, editingBookInfo.id],
    )

    if (res?.success) {
      showToast(t('books.toast_book_updated') || '书籍信息修改成功！')
      setEditingBookInfo(null)
      loadData()
    }
  }

  // Delete book handlers
  const handleStartDeleteBook = (book: any) => {
    setDeletingBookInfo(book)
  }

  const confirmDeleteBook = async () => {
    if (!api || !deletingBookInfo) return

    // 1. Delete file physically
    if (deletingBookInfo.path && !deletingBookInfo.path.startsWith('http')) {
      await api.deleteBookFile(deletingBookInfo.path)
    }

    // 2. Delete database record
    const res = await api.dbQuery('books', 'DELETE FROM books WHERE id = ?', [deletingBookInfo.id])
    if (res?.success) {
      showToast(t('books.toast_book_deleted') || '书籍已成功删除')
      setDeletingBookInfo(null)
      loadData()
    }
  }

  // Open book in custom reader overlay
  const handleOpenReader = async (book: any) => {
    setReadingBook(book)
    setReadingProgress(Math.round(book.progress || 0))
    setCurrentPageIndex(0)
    setCurrentParagraphOffset(0)
    setPdfData(null)
    setPdfNumPages(0)
    pdfInitializedRef.current = false

    // Mark reading status
    if (api && book.status === 'want') {
      await api.dbQuery('books', "UPDATE books SET status = 'reading' WHERE id = ?", [book.id])
      loadData()
    }

    // Load highlights
    if (api) {
      const hlRes = await api.dbQuery('books', 'SELECT * FROM highlights WHERE book_id = ?', [
        book.id,
      ])
      if (hlRes?.success) setHighlights(hlRes.data)
    }

    setIsLoadingReader(true)
    const isPdf = book.cover === 'PDF' || book.path.toLowerCase().endsWith('.pdf')

    if (isPdf) {
      if (api) {
        const bufferRes = await api.getBookBuffer(book.path)
        if (bufferRes?.success && bufferRes.data) {
          // bufferRes.data is a Uint8Array
          setPdfData(Array.from(bufferRes.data))
        } else {
          showToast(bufferRes?.error || t('books.toast_pdf_read_error'))
        }
      }
    } else {
      // Load real book chapters
      if (api) {
        const chaptersRes = await api.getBookChapters(book.path)
        if (chaptersRes?.success && chaptersRes.chapters?.length > 0) {
          setBookChapters(chaptersRes.chapters)
          setBookToc(
            Array.isArray(chaptersRes.toc) && chaptersRes.toc.length > 0 ? chaptersRes.toc : null,
          )

          // Calculate initial page based on progress
          const initialProgress = book.progress || 0
          const chapterPageCounts = chaptersRes.chapters.map(
            (c: any) => getPagesForReadingBlocks(c.paragraphs || []).length,
          )
          const totalBookPages = chapterPageCounts.reduce((a: number, b: number) => a + b, 0)

          const targetPageGlobal = Math.min(
            totalBookPages - 1,
            Math.max(0, Math.round((initialProgress / 100) * (totalBookPages - 1))),
          )

          let accumulatedPages = 0
          let targetChapterIdx = 0
          let targetLocalPageIdx = 0

          for (let i = 0; i < chaptersRes.chapters.length; i++) {
            const chPages = chapterPageCounts[i]
            if (targetPageGlobal < accumulatedPages + chPages) {
              targetChapterIdx = i
              targetLocalPageIdx = targetPageGlobal - accumulatedPages
              break
            }
            accumulatedPages += chPages
          }

          setCurrentChapter(chaptersRes.chapters[targetChapterIdx].title)
          setCurrentChapterIndex(targetChapterIdx)
          setCurrentPageIndex(targetLocalPageIdx)
          setCurrentParagraphOffset(
            getParagraphOffsetOfPage(
              chaptersRes.chapters[targetChapterIdx].paragraphs || [],
              targetLocalPageIdx,
            ),
          )
        } else {
          setBookChapters(null)
          setBookToc(null)
          setCurrentChapter('')
          setCurrentChapterIndex(0)
          setCurrentParagraphOffset(0)
          if (chaptersRes && !chaptersRes.success && chaptersRes.error) {
            if (chaptersRes.error !== 'Unsupported format for in-app reading') {
              showToast(t('books.toast_parse_failed', { error: chaptersRes.error }))
            }
          }
        }
      }
    }
    setIsLoadingReader(false)
  }

  // Close reader and save final progress percentage if changed
  const handleCloseReader = async () => {
    if (readingBook && api) {
      if (Math.round(readingBook.progress) !== readingProgress) {
        await api.dbQuery('books', 'UPDATE books SET progress = ? WHERE id = ?', [
          readingProgress,
          readingBook.id,
        ])
        showToast(t('books.toast_progress_saved', { progress: readingProgress }))
        loadData()
      }
    }
    setReadingBook(null)
    setBookChapters(null)
    setBookToc(null)
    setCurrentChapterIndex(0)
    setCurrentParagraphOffset(0)
    setPdfData(null)
    setPdfNumPages(0)
    setCurrentPageIndex(0)
    setSelectedHighlightText('')
    setNewAnnotation('')
    setIsTocDrawerOpen(false)
    setIsAnnotationsDrawerOpen(false)
  }

  // Get active paragraphs of current chapter
  const getActiveParagraphs = () => {
    if (bookChapters) {
      const chData = bookChapters[currentChapterIndex] || bookChapters[0]
      return chData ? (chData.paragraphs as ReadingBlock[]) : []
    }
    // Fallback to mock paragraphs
    return [t('books.mock_p1'), t('books.mock_p2'), t('books.mock_p3')]
  }

  // In scroll mode the scroll position is the source of truth, so jumping pages via
  // buttons / progress / mode-entry must physically scroll the container to the page.
  const scrollPdfToPage = (pageIdx: number, behavior: ScrollBehavior = 'smooth') => {
    const container = pdfScrollRef.current
    if (!container) return
    const target = container.querySelector(`[data-page-number="${pageIdx + 1}"]`)
    if (!target) return
    isProgrammaticScrollRef.current = true
    ;(target as HTMLElement).scrollIntoView({ behavior, block: 'start' })
    // Release the guard after the scroll settles so user scrolls resume syncing.
    window.setTimeout(() => {
      isProgrammaticScrollRef.current = false
    }, 400)
  }

  const handleNextPage = () => {
    const isPdf =
      readingBook &&
      (readingBook.cover === 'PDF' || readingBook.path.toLowerCase().endsWith('.pdf'))
    if (isPdf) {
      const step = pdfLayoutMode === 'dual' ? 2 : 1
      if (currentPageIndex < pdfNumPages - step) {
        const newPage = currentPageIndex + step
        setCurrentPageIndex(newPage)
        setReadingProgress(Math.round((newPage / (pdfNumPages - 1 || 1)) * 100))
        if (pdfLayoutMode === 'scroll') scrollPdfToPage(newPage)
      } else {
        showToast(t('books.toast_last_page') || '已是本书最后一页')
      }
      return
    }

    const goNextChapter = () => {
      if (bookChapters && currentChapterIndex < bookChapters.length - 1) {
        const nextIdx = currentChapterIndex + 1
        setCurrentChapterIndex(nextIdx)
        setCurrentChapter(bookChapters[nextIdx].title)
        setCurrentPageIndex(0)
        setCurrentParagraphOffset(0)
        showToast(
          t('books.toast_next_chapter', { name: bookChapters[nextIdx].title }) ||
            `进入下一章: ${bookChapters[nextIdx].title}`,
        )
      } else {
        showToast(t('books.toast_last_page') || '已是本书最后一页')
      }
    }

    // Scroll mode renders the whole chapter continuously, so paging jumps chapters.
    if (epubLayoutMode === 'scroll') {
      goNextChapter()
      return
    }

    const activeParas = getActiveParagraphs()
    const pgList = getPagesForReadingBlocks(activeParas)
    const step = epubLayoutMode === 'dual' ? 2 : 1
    if (currentPageIndex < pgList.length - step) {
      const newPage = currentPageIndex + step
      setCurrentPageIndex(newPage)
      setCurrentParagraphOffset(getParagraphOffsetOfPage(activeParas, newPage))
    } else {
      goNextChapter()
    }
  }

  const handlePrevPage = () => {
    const isPdf =
      readingBook &&
      (readingBook.cover === 'PDF' || readingBook.path.toLowerCase().endsWith('.pdf'))
    if (isPdf) {
      const step = pdfLayoutMode === 'dual' ? 2 : 1
      if (currentPageIndex >= step) {
        const newPage = currentPageIndex - step
        setCurrentPageIndex(newPage)
        setReadingProgress(Math.round((newPage / (pdfNumPages - 1 || 1)) * 100))
        if (pdfLayoutMode === 'scroll') scrollPdfToPage(newPage)
      } else {
        showToast(t('books.toast_first_page') || '已是本书第一页')
      }
      return
    }

    const goPrevChapter = (landOnLastPage: boolean) => {
      if (bookChapters && currentChapterIndex > 0) {
        const prevIdx = currentChapterIndex - 1
        const prevCh = bookChapters[prevIdx]
        setCurrentChapterIndex(prevIdx)
        setCurrentChapter(prevCh.title)

        if (landOnLastPage) {
          const prevParas = (prevCh.paragraphs || []) as ReadingBlock[]
          const prevPages = getPagesForReadingBlocks(prevParas)
          const step = epubLayoutMode === 'dual' ? 2 : 1
          // Align the last spread to an even page index in dual mode.
          const lastIdx = prevPages.length - 1
          const targetPage = step === 2 ? lastIdx - (lastIdx % 2) : lastIdx
          setCurrentPageIndex(targetPage)
          setCurrentParagraphOffset(getParagraphOffsetOfPage(prevParas, targetPage))
        } else {
          setCurrentPageIndex(0)
          setCurrentParagraphOffset(0)
        }
        showToast(
          t('books.toast_prev_chapter', { name: prevCh.title }) || `回到上一章: ${prevCh.title}`,
        )
      } else {
        showToast(t('books.toast_first_page') || '已是本书第一页')
      }
    }

    if (epubLayoutMode === 'scroll') {
      goPrevChapter(false)
      return
    }

    const step = epubLayoutMode === 'dual' ? 2 : 1
    if (currentPageIndex > 0) {
      const newPage = Math.max(0, currentPageIndex - step)
      setCurrentPageIndex(newPage)
      setCurrentParagraphOffset(getParagraphOffsetOfPage(getActiveParagraphs(), newPage))
    } else {
      goPrevChapter(true)
    }
  }

  const handleProgressChange = (newVal: number) => {
    setReadingProgress(newVal)
    const isPdf =
      readingBook &&
      (readingBook.cover === 'PDF' || readingBook.path.toLowerCase().endsWith('.pdf'))
    if (isPdf && pdfNumPages > 0) {
      const newPageIdx = Math.min(
        pdfNumPages - 1,
        Math.max(0, Math.round((newVal / 100) * (pdfNumPages - 1))),
      )
      setCurrentPageIndex(newPageIdx)
      if (pdfLayoutMode === 'scroll') {
        // Defer one frame so the render window can mount the target page first.
        requestAnimationFrame(() => scrollPdfToPage(newPageIdx, 'auto'))
      }
    } else if (!isPdf && bookChapters) {
      const chapterPageCounts = bookChapters.map((c: any) =>
        getPagesForReadingBlocks(c.paragraphs || []).length,
      )
      const totalBookPages = chapterPageCounts.reduce((a: number, b: number) => a + b, 0)
      const targetPageGlobal = Math.min(
        totalBookPages - 1,
        Math.max(0, Math.round((newVal / 100) * (totalBookPages - 1))),
      )
      let accumulatedPages = 0
      let targetChapterIdx = 0
      let targetLocalPageIdx = 0
      for (let i = 0; i < bookChapters.length; i++) {
        const chPages = chapterPageCounts[i]
        if (targetPageGlobal < accumulatedPages + chPages) {
          targetChapterIdx = i
          targetLocalPageIdx = targetPageGlobal - accumulatedPages
          break
        }
        accumulatedPages += chPages
      }
      const targetParas = bookChapters[targetChapterIdx]?.paragraphs || []
      setCurrentChapterIndex(targetChapterIdx)
      setCurrentChapter(bookChapters[targetChapterIdx]?.title || '')
      setCurrentPageIndex(targetLocalPageIdx)
      setCurrentParagraphOffset(getParagraphOffsetOfPage(targetParas, targetLocalPageIdx))
    }
  }

  const handleTextSelection = () => {
    const selection = window.getSelection()
    if (selection) {
      const selectedText = selection.toString().trim()
      if (selectedText) {
        setSelectedHighlightText(selectedText)
        setIsAnnotationsDrawerOpen(true)
      }
    }
  }

  const handleReaderContentClick = () => {
    const selectedText = window.getSelection()?.toString() || ''
    if (!shouldCloseReaderDrawersOnContentClick(selectedText)) return

    setIsTocDrawerOpen(false)
    setIsAnnotationsDrawerOpen(false)
  }

  const handlePdfLoadSuccess = ({ numPages }: { numPages: number }) => {
    setPdfNumPages(numPages)
    if (!pdfInitializedRef.current && readingBook) {
      pdfInitializedRef.current = true
      const initialProgress = readingBook.progress || 0
      const initialPage = Math.min(
        numPages - 1,
        Math.max(0, Math.round((initialProgress / 100) * (numPages - 1))),
      )
      setCurrentPageIndex(initialPage)
    }
  }

  const handlePdfWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (pdfLayoutMode === 'scroll') return

    if (Math.abs(e.deltaY) < 60) return

    const container = e.currentTarget
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 8
    const isAtTop = container.scrollTop <= 8

    if (e.deltaY > 0 && isAtBottom) {
      handleNextPage()
    } else if (e.deltaY < 0 && isAtTop) {
      handlePrevPage()
    }
  }

  const handlePdfScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (pdfLayoutMode !== 'scroll' || pdfNumPages <= 0) return
    if (isProgrammaticScrollRef.current) return

    const container = e.currentTarget
    // Query every page slot (rendered pages AND windowing placeholders) so a fast
    // scroll can jump currentPageIndex straight to the page now under the viewport,
    // instead of crawling one window-edge at a time and stalling on placeholders.
    const children = container.querySelectorAll('[data-page-number]')
    if (children.length === 0) return

    const containerRect = container.getBoundingClientRect()
    const viewportCenter = containerRect.top + containerRect.height / 2

    let closestPageIdx = currentPageIndex
    let minDistance = Infinity

    children.forEach((child) => {
      const pageNumAttr = child.getAttribute('data-page-number')
      if (!pageNumAttr) return

      const pageNum = parseInt(pageNumAttr, 10)
      const childRect = child.getBoundingClientRect()
      const childCenter = childRect.top + childRect.height / 2
      const distance = Math.abs(childCenter - viewportCenter)

      if (distance < minDistance) {
        minDistance = distance
        closestPageIdx = pageNum - 1
      }
    })

    if (closestPageIdx !== currentPageIndex) {
      setCurrentPageIndex(closestPageIdx)
      setReadingProgress(Math.round((closestPageIdx / (pdfNumPages - 1 || 1)) * 100))
    }
  }

  const handleEpubContinuousScroll = (e: React.UIEvent<HTMLElement>) => {
    if (epubLayoutMode !== 'scroll' || isPdf || !bookChapters) return
    if (isProgrammaticScrollRef.current) return

    const container = e.currentTarget
    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-epub-chapter-index][data-epub-block-offset]',
      ),
    )
    if (blocks.length === 0) return

    const anchorY = container.getBoundingClientRect().top + 48
    let activeBlock = blocks[0]

    for (const block of blocks) {
      if (block.getBoundingClientRect().top <= anchorY) {
        activeBlock = block
      } else {
        break
      }
    }

    const nextChapterIndex = Number(activeBlock.dataset.epubChapterIndex)
    const nextParagraphOffset = Number(activeBlock.dataset.epubBlockOffset)
    if (!Number.isFinite(nextChapterIndex) || !Number.isFinite(nextParagraphOffset)) return

    if (
      nextChapterIndex !== currentChapterIndex ||
      nextParagraphOffset !== currentParagraphOffset
    ) {
      skipNextEpubAlignRef.current = true
      const chapter = bookChapters[nextChapterIndex]
      const paragraphs = (chapter?.paragraphs || []) as ReadingBlock[]
      setCurrentChapterIndex(nextChapterIndex)
      setCurrentChapter(chapter?.title || '')
      setCurrentParagraphOffset(nextParagraphOffset)
      setCurrentPageIndex(getPageOfParagraph(paragraphs, nextParagraphOffset))
    }
  }

  useEffect(() => {
    if (!readingBook) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        handleNextPage()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        handlePrevPage()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    readingBook,
    currentPageIndex,
    currentChapterIndex,
    bookChapters,
    pdfNumPages,
    epubLayoutMode,
    pdfLayoutMode,
  ])

  // Keep the latest handleNextPage in a ref so the auto-play interval doesn't get
  // torn down / reset on every page change (which previously stopped it from firing).
  const handleNextPageRef = useRef(handleNextPage)
  handleNextPageRef.current = handleNextPage

  useEffect(() => {
    if (!isAutoPlaying || !readingBook) return

    const interval = setInterval(() => {
      handleNextPageRef.current()
    }, autoPlaySpeed * 1000)

    return () => clearInterval(interval)
  }, [isAutoPlaying, autoPlaySpeed, readingBook])

  // When the chapter/page changes in an EPUB, align to the exact TOC target block
  // when possible. This matters for sub-chapters that share a rendered page.
  useEffect(() => {
    if (isPdf) return
    if (skipNextEpubAlignRef.current) {
      skipNextEpubAlignRef.current = false
      return
    }
    const raf = requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = true
      const target = readerMainRef.current?.querySelector(
        `[data-epub-chapter-index="${currentChapterIndex}"][data-epub-block-offset="${currentParagraphOffset}"]`,
      )
      if (target) {
        ;(target as HTMLElement).scrollIntoView({ block: 'start', behavior: 'auto' })
      } else {
        readerMainRef.current?.scrollTo({ top: 0, behavior: 'auto' })
      }
      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false
      }, 120)
    })
    return () => cancelAnimationFrame(raf)
  }, [currentChapterIndex, currentPageIndex, currentParagraphOffset, epubLayoutMode])

  // On entering scroll mode (or once pages are known), align the scroll position to
  // the current page so content shows immediately instead of requiring a manual scroll.
  useEffect(() => {
    if (pdfLayoutMode !== 'scroll' || pdfNumPages <= 0) return
    // Two frames: let the render window mount the target page, then scroll to it.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollPdfToPage(currentPageIndex, 'auto'))
    })
    return () => cancelAnimationFrame(raf)
  }, [pdfLayoutMode, pdfNumPages])

  // Build a stable Blob URL from the loaded PDF bytes. Passing a URL string (instead
  // of an ArrayBuffer) avoids pdf.js transferring/detaching the buffer to its worker,
  // which previously crashed react-pdf's dequal compare on layout-mode switches.
  useEffect(() => {
    if (!pdfData) {
      setPdfBlobUrl(null)
      return
    }
    const blob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setPdfBlobUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [pdfData])

  // Keep the measured reader width current so PDF pages adapt to the reading column,
  // and keep fixed page buttons aligned with horizontally scrolled reader content.
  useEffect(() => {
    if (!readingBook) return

    const measure = () => {
      const el = readerMainRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const roundedReaderWidth = Math.round(rect.width)
      setReaderMainWidth((prev) => (prev === roundedReaderWidth ? prev : roundedReaderWidth))
      const vw = window.innerWidth
      const pdfContentWidth =
        pdfLayoutMode === 'dual'
          ? getPdfPageRenderWidth(rect.width, pdfLayoutMode) * 2 + 20
          : getPdfPageRenderWidth(rect.width, pdfLayoutMode)
      const contentWidth = isPdf ? Math.min(rect.width, pdfContentWidth) : Math.min(rect.width, 800)
      const contentLeft = rect.left + (rect.width - contentWidth) / 2
      const contentRight = contentLeft + contentWidth
      const BTN = 36
      const GAP = 8
      const left = Math.max(rect.left + GAP, contentLeft - BTN - GAP)
      const right = Math.max(vw - rect.right + GAP, vw - contentRight - BTN - GAP)
      const top = rect.top + rect.height / 2
      setNavBtnPosition({
        left: Math.round(left),
        right: Math.round(right),
        top: Math.round(top),
      })
    }

    measure()
    const ro = new ResizeObserver(measure)
    if (readerMainRef.current) ro.observe(readerMainRef.current)
    const readerContent = readerContentRef.current
    readerContent?.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      readerContent?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [
    readingBook,
    isLoadingReader,
    bookChapters,
    epubLayoutMode,
    pdfLayoutMode,
    pdfNumPages,
    isTocDrawerOpen,
    isAnnotationsDrawerOpen,
  ])

  // Save new highlight / annotation
  const handleAddHighlight = async () => {
    if (!selectedHighlightText || !readingBook || !api) return

    const hlId = `hl_${Date.now()}`
    const query = `
      INSERT INTO highlights (id, book_id, text, annotation, anchor)
      VALUES (?, ?, ?, ?, ?)
    `
    const res = await api.dbQuery('books', query, [
      hlId,
      readingBook.id,
      selectedHighlightText,
      newAnnotation || t('books.no_annotation'),
      JSON.stringify({ chapter: currentChapter, offset: 120 }),
    ])

    if (res?.success) {
      showToast(t('books.toast_highlight_saved'))
      setSelectedHighlightText('')
      setNewAnnotation('')

      // Reload highlights
      const hlRes = await api.dbQuery('books', 'SELECT * FROM highlights WHERE book_id = ?', [
        readingBook.id,
      ])
      if (hlRes?.success) setHighlights(hlRes.data)
    }
  }

  // Copy Deep Link
  const handleCopyLink = (hl: any) => {
    const deepLink = `book:${readingBook.id}#${encodeURIComponent(hl.anchor ? JSON.parse(hl.anchor).chapter : currentChapter)}`
    navigator.clipboard.writeText(`[[${deepLink}]]`)
    showToast(t('books.toast_link_copied'))
  }

  // Export highlights to Notes Module as Markdown (Incremental Sync)
  const handleExportHighlights = async () => {
    if (!readingBook || !api) return

    const noteTitle = t('books.note_title_template', { title: readingBook.title })

    // Check if the Note already exists
    const checkNote = await api.dbQuery('notes', 'SELECT * FROM notes WHERE title = ?', [noteTitle])
    // Format highlights to Markdown
    let mdContent = t('books.note_md_title', { title: readingBook.title })
    mdContent += t('books.note_md_author', {
      author: readingBook.author || t('books.unknown_author'),
    })
    mdContent += t('books.note_md_sync_time', { time: new Date().toLocaleString() })
    mdContent += t('books.note_md_progress', { progress: readingBook.progress })
    mdContent += t('books.note_md_highlights_header')

    highlights.forEach((hl, idx) => {
      mdContent += t('books.note_md_highlight_item_title', { idx: idx + 1 })
      mdContent += `> ${hl.text}\n\n`
      mdContent += t('books.note_md_highlight_annotation', {
        annotation: hl.annotation || t('books.no_annotation'),
      })
      mdContent += t('books.note_md_highlight_deep_link', {
        id: readingBook.id,
        chapter: encodeURIComponent(currentChapter),
      })
    })

    if (checkNote?.success && checkNote.data.length > 0) {
      const noteId = checkNote.data[0].id
      // Update
      await api.dbQuery(
        'notes',
        'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [mdContent, noteId],
      )
      showToast(t('books.toast_note_updated'))
    } else {
      // Create new
      const createRes = await api.dbQuery(
        'notes',
        "INSERT INTO notes (title, content, note_type) VALUES (?, ?, 'markdown')",
        [noteTitle, mdContent],
      )
      if (createRes?.success) {
        showToast(t('books.toast_note_synced'))
      }
    }
  }

  // Check if a book's category qualifies it as Uncategorized
  const isUncategorized = (book: any) => {
    if (!book.category) return true
    if (isReservedBookCategory(book.category)) return true
    return !categories.some((cat) => isBookInCategory(book, cat))
  }

  const uncategorizedBooksCount = books.filter(isUncategorized).length
  const deletingCategoryBookCount = deletingCategory
    ? books.filter((book) => isBookInCategory(book, deletingCategory)).length
    : 0

  const filteredBooks = books.filter((b) => {
    if (activeCategory === 'all') return true
    if (activeCategory === 'uncategorized') {
      return isUncategorized(b)
    }
    const cat = categories.find((c) => c.name === activeCategory)
    return cat ? isBookInCategory(b, cat) : b.category === activeCategory
  })

  // Styling variables for Modals
  const modalOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  }

  const modalContentStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '12px',
    padding: '24px',
    width: '420px',
    boxShadow: 'var(--shadow-app)',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  }

  const modalTitleStyle: React.CSSProperties = {
    fontSize: '16px',
    fontWeight: 700,
    margin: 0,
    color: 'var(--text-main)',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: '6px',
  }

  const activeParagraphs = getActiveParagraphs()
  const pages = getPagesForReadingBlocks(activeParagraphs)
  const clampedPageIndex = Math.max(0, Math.min(currentPageIndex, pages.length - 1))
  const currentPageParagraphs = pages[clampedPageIndex] || []

  // Renders a single EPUB paragraph with highlight styling + click-to-select.
  const renderEpubParagraph = (
    block: ReadingBlock,
    key: React.Key,
    blockOffset?: number,
    chapterIndex = currentChapterIndex,
  ) => {
    const text = getReadingBlockText(block)
    const isHeading = isReadingBlockHeading(block)
    const headingLevel = typeof block === 'object' ? block.level || 2 : 0
    const hasHighlight = !isHeading && highlights.some((hl) => hl.text === text)

    if (isHeading) {
      const fontScale = Math.max(1, 1.55 - (headingLevel - 1) * 0.14)
      return (
        <h3
          key={key}
          data-epub-chapter-index={chapterIndex}
          data-epub-block-offset={blockOffset}
          style={{
            margin: headingLevel <= 2 ? '28px 0 14px' : '22px 0 10px',
            fontSize: `${fontScale}em`,
            lineHeight: 1.35,
            fontWeight: headingLevel <= 2 ? 800 : 700,
            color: readerTextColor,
          }}
        >
          {text}
        </h3>
      )
    }

    return (
      <p
        key={key}
        data-epub-chapter-index={chapterIndex}
        data-epub-block-offset={blockOffset}
        style={{
          marginBottom: '16px',
          padding: '8px 12px',
          borderRadius: '6px',
          backgroundColor: hasHighlight ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
          borderLeft: hasHighlight ? '3px solid var(--color-accent)' : 'none',
          cursor: 'text',
          transition: 'all 0.15s ease',
          userSelect: 'text',
        }}
      >
        {text}
        {hasHighlight && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--color-accent)',
              marginLeft: '6px',
              fontWeight: 'bold',
            }}
          >
            ✓ {t('books.annotation_label')}
          </span>
        )}
      </p>
    )
  }

  const chList = bookChapters ? bookChapters.map((c) => c.title) : chapters
  const currentChIndex = bookChapters ? currentChapterIndex : chList.indexOf(currentChapter)
  const isPdf =
    readingBook && (readingBook.cover === 'PDF' || readingBook.path.toLowerCase().endsWith('.pdf'))
  const hasBookChapters = Boolean(bookChapters && bookChapters.length > 0)
  const showEpubToc = shouldShowEpubToc(Boolean(isPdf), hasBookChapters, epubLayoutMode)
  const showReaderToc = showEpubToc || Boolean(isPdf && pdfNumPages > 0)
  const tocDrawerWidth = 260
  const annotationsDrawerWidth = 320
  const readerMainMinWidth = isPdf
    ? pdfLayoutMode === 'dual'
      ? 700
      : 640
    : epubLayoutMode === 'dual'
      ? 720
      : 620
  const readerContentGridColumns = getReaderContentGridColumns(
    showReaderToc,
    isTocDrawerOpen,
    tocDrawerWidth,
    isAnnotationsDrawerOpen,
    annotationsDrawerWidth,
    Boolean(isPdf),
    readerMainMinWidth,
  )
  const pdfPageRenderWidth = getPdfPageRenderWidth(readerMainWidth, pdfLayoutMode)

  useEffect(() => {
    if (isPdf || !bookChapters || isLoadingReader) return
    setReadingProgress(
      getReadingProgressForLocation(bookChapters, currentChapterIndex, currentParagraphOffset),
    )
  }, [isPdf, bookChapters, currentChapterIndex, currentParagraphOffset, isLoadingReader])

  useEffect(() => {
    if (!selectedHighlightText || !isAnnotationsDrawerOpen) return

    const raf = requestAnimationFrame(() => {
      annotationInputRef.current?.focus(getAnnotationEditorFocusOptions())
    })
    return () => cancelAnimationFrame(raf)
  }, [selectedHighlightText, isAnnotationsDrawerOpen])

  // In EPUB scroll mode the whole chapter is shown, so paging is chapter-bound.
  const isEpubScroll = !isPdf && bookChapters && epubLayoutMode === 'scroll'
  const hasPrev = isPdf
    ? currentPageIndex > 0
    : isEpubScroll
      ? currentChIndex > 0
      : currentPageIndex > 0 || currentChIndex > 0
  const hasNext = isPdf
    ? currentPageIndex < pdfNumPages - 1
    : isEpubScroll
      ? currentChIndex >= 0 && currentChIndex < chList.length - 1
      : clampedPageIndex < pages.length - 1 ||
        (currentChIndex >= 0 && currentChIndex < chList.length - 1)

  const pdfFile = pdfBlobUrl
  const isDarkReader = readerBg === '#0F0F0F'
  const readerTextColor = isDarkReader ? '#D4D4D4' : '#2F2E2C'
  const readerBorderColor = isDarkReader ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'
  const readerCardBg = isDarkReader ? '#1F1F1F' : 'var(--bg-surface)'
  const readerCardBorder = isDarkReader ? 'rgba(255, 255, 255, 0.08)' : 'var(--color-border)'

  return (
    <div
      style={{
        animation: 'enter 0.15s ease both',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        .card:hover .book-actions {
          opacity: 1 !important;
        }
      `}</style>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('books.title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('books.subtitle')}</p>
        </div>
        <button
          type="button"
          className="btn primary"
          aria-label={t('books.import_book')}
          onPointerDown={() => setIsImportOpen(true)}
          onClick={() => setIsImportOpen(true)}
          style={{ position: 'relative', zIndex: 3, pointerEvents: 'auto' }}
        >
          <Plus size={16} />
          {t('books.import_book')}
        </button>
      </div>

      {/* Grid Shelf Layout */}
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '240px 1fr',
          gap: '16px',
        }}
      >
        <BookCategorySidebar
          categories={categories.filter((category) => !isReservedBookCategory(category.name))}
          activeCategory={activeCategory}
          allBooksCount={books.length}
          toOrganizeCount={uncategorizedBooksCount}
          getCategoryDisplayName={(category) => getCategoryDisplayName(category.name, category.id)}
          getCategoryBookCount={(category) =>
            books.filter((book) => isBookInCategory(book, category)).length
          }
          onSelectCategory={setActiveCategory}
          onCreateCategory={createCategory}
          onRenameCategory={renameCategoryInline}
          onEditTranslations={openCategoryTranslationEditor}
          onRequestDelete={openCategoryDeleteDialog}
        />

        {/* Right bookshelf grid */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '16px',
            alignContent: 'start',
            overflowY: 'auto',
            height: '100%',
          }}
        >
          {filteredBooks.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                gridColumn: '1/-1',
                padding: '48px',
                fontStyle: 'italic',
                fontSize: '13px',
              }}
            >
              {t('books.empty_shelf')}
            </div>
          ) : (
            filteredBooks.map((book) => (
              <div
                key={book.id}
                className="card"
                style={{
                  display: 'flex',
                  gap: '12px',
                  cursor: 'pointer',
                  transition: 'transform 0.15s ease',
                  position: 'relative',
                }}
                onClick={() => handleOpenReader(book)}
              >
                <div
                  className="book-actions"
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    display: 'flex',
                    gap: '4px',
                    opacity: 0,
                    transition: 'opacity 0.15s ease',
                    zIndex: 10,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="btn sm"
                    style={{
                      padding: '4px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--color-border)',
                    }}
                    onClick={() => handleStartEditBook(book)}
                    title={t('books.edit_book') || '编辑'}
                  >
                    <Edit3 size={12} />
                  </button>
                  <button
                    className="btn sm danger"
                    style={{
                      padding: '4px 6px',
                      backgroundColor: 'var(--color-danger)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      border: 'none',
                    }}
                    onClick={() => handleStartDeleteBook(book)}
                    title={t('books.delete_book') || '删除'}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div
                  style={{
                    width: '64px',
                    height: '88px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--color-accent)',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 'bold',
                    fontSize: '11px',
                    flexShrink: 0,
                    boxShadow: 'var(--shadow-app)',
                  }}
                >
                  {book.cover || 'EPUB'}
                </div>
                <div
                  style={{
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    flexGrow: 1,
                  }}
                >
                  <div>
                    <h3
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        margin: 0,
                      }}
                    >
                      {book.title}
                    </h3>
                    <p
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: '11.5px',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {book.author}
                    </p>
                  </div>
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        marginBottom: '4px',
                      }}
                    >
                      <span>
                        {t('books.category_label')}: {getCategoryDisplayName(book.category)}
                      </span>
                      <span>{Math.round(book.progress)}%</span>
                    </div>
                    <div
                      style={{
                        height: '4px',
                        backgroundColor: 'var(--color-border)',
                        borderRadius: '99px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${book.progress}%`,
                          backgroundColor: 'var(--color-accent)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {/* FULLSCREEN E-BOOK READER MOCK DIALOG */}
      {readingBook && (
        <div
          style={{
            position: 'fixed',
            top: '38px',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: readerBg,
            color: readerTextColor,
            zIndex: 1000,
            display: 'grid',
            gridTemplateRows: '50px 1fr',
            animation: 'enter 0.18s ease both',
          }}
        >
          {/* Reader Header */}
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 24px',
              borderBottom: `1px solid ${readerBorderColor}`,
              backgroundColor: isDarkReader ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                minWidth: 0,
                flex: '1 1 auto',
                overflow: 'hidden',
              }}
            >
              <button className="btn sm" onClick={handleCloseReader}>
                ✕ {t('books.exit_reader')}
              </button>
              <strong
                style={{
                  fontSize: '13.5px',
                  flex: '1 1 auto',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${t('books.reading_label')}:《${readingBook.title}》`}
              >
                {t('books.reading_label')}:《{readingBook.title}》
              </strong>

              {/* Progress Slider */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginLeft: '12px',
                  borderLeft: `1px solid ${readerBorderColor}`,
                  paddingLeft: '16px',
                }}
              >
                <span style={{ fontSize: '11px', color: isDarkReader ? '#888' : '#666' }}>
                  {t('books.progress_label') || '进度'}:
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={readingProgress}
                  onChange={(e) => handleProgressChange(parseInt(e.target.value, 10))}
                  style={{
                    width: '90px',
                    accentColor: 'var(--color-accent)',
                    cursor: 'pointer',
                    height: '4px',
                  }}
                />
                <span
                  style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', minWidth: '32px' }}
                >
                  {readingProgress}%
                </span>
              </div>
            </div>

            {/* Custom font and bg adjustments */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: '0 0 auto' }}>
              <button className="btn sm" onClick={() => handleExportHighlights()}>
                <ExternalLink size={12} /> {t('books.export_notes_btn')}
              </button>
              <button
                className={`btn sm ${isAnnotationsDrawerOpen ? 'primary' : ''}`}
                onClick={() => setIsAnnotationsDrawerOpen((open) => !open)}
                title={
                  isAnnotationsDrawerOpen
                    ? t('books.hide_annotations') || '收起批注'
                    : t('books.show_annotations') || '展开批注'
                }
              >
                {isAnnotationsDrawerOpen ? (
                  <PanelRightClose size={12} />
                ) : (
                  <PanelRightOpen size={12} />
                )}
                {t('books.highlights_annotations_title')} ({highlights.length})
              </button>
              <div
                style={{
                  borderRight: `1px solid ${readerBorderColor}`,
                  height: '20px',
                  margin: '0 4px',
                }}
              />
              {isPdf ? (
                <>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {t('books.view_label')}:
                  </span>
                  <select
                    value={pdfLayoutMode}
                    onChange={(e) => setPdfLayoutMode(e.target.value as any)}
                    style={{
                      fontSize: '12px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      backgroundColor: isDarkReader ? '#222' : '#fff',
                      border: '1px solid var(--color-border)',
                      color: 'inherit',
                      outline: 'none',
                    }}
                  >
                    <option value="single">{t('books.view_single')}</option>
                    <option value="dual">{t('books.view_dual')}</option>
                    <option value="scroll">{t('books.view_scroll')}</option>
                    <option value="simulation">{t('books.view_simulation')}</option>
                  </select>

                  <div
                    style={{
                      borderRight: `1px solid ${readerBorderColor}`,
                      height: '20px',
                      margin: '0 4px',
                    }}
                  />

                  <button
                    className={`btn sm ${isAutoPlaying ? 'primary' : ''}`}
                    onClick={() => setIsAutoPlaying(!isAutoPlaying)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '12px',
                    }}
                  >
                    {isAutoPlaying ? t('books.auto_play_stop') : t('books.auto_play')}
                  </button>

                  {isAutoPlaying && (
                    <select
                      value={autoPlaySpeed}
                      onChange={(e) => setAutoPlaySpeed(parseInt(e.target.value, 10))}
                      style={{
                        fontSize: '12px',
                        padding: '4px 4px',
                        borderRadius: '4px',
                        backgroundColor: isDarkReader ? '#222' : '#fff',
                        border: '1px solid var(--color-border)',
                        color: 'inherit',
                        outline: 'none',
                      }}
                    >
                      <option value="5">{t('books.auto_play_speed', { sec: 5 })}</option>
                      <option value="10">{t('books.auto_play_speed', { sec: 10 })}</option>
                      <option value="15">{t('books.auto_play_speed', { sec: 15 })}</option>
                      <option value="20">{t('books.auto_play_speed', { sec: 20 })}</option>
                    </select>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="btn sm"
                    onClick={() => setFontSize(Math.max(12, fontSize - 1))}
                  >
                    A-
                  </button>
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                    {fontSize}px
                  </span>
                  <button
                    className="btn sm"
                    onClick={() => setFontSize(Math.min(22, fontSize + 1))}
                  >
                    A+
                  </button>
                  {bookChapters && (
                    <>
                      <div
                        style={{
                          borderRight: `1px solid ${readerBorderColor}`,
                          height: '20px',
                          margin: '0 4px',
                        }}
                      />
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {t('books.view_label')}:
                      </span>
                      <select
                        value={epubLayoutMode}
                        onChange={(e) => {
                          setEpubLayoutMode(e.target.value as any)
                          setCurrentPageIndex(0)
                          setCurrentParagraphOffset(0)
                        }}
                        style={{
                          fontSize: '12px',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          backgroundColor: isDarkReader ? '#222' : '#fff',
                          border: '1px solid var(--color-border)',
                          color: 'inherit',
                          outline: 'none',
                        }}
                      >
                        <option value="single">{t('books.view_single')}</option>
                        <option value="dual">{t('books.view_dual')}</option>
                        <option value="scroll">{t('books.view_scroll')}</option>
                      </select>
                    </>
                  )}
                </>
              )}
              <div
                style={{
                  borderRight: `1px solid ${readerBorderColor}`,
                  height: '20px',
                  margin: '0 4px',
                }}
              />
              {/* Bg toggler */}
              <button
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: '#FDFBF7',
                  border: '1px solid #ddd',
                  cursor: 'pointer',
                }}
                onClick={() => setReaderBg('#FDFBF7')}
              />
              <button
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #ddd',
                  cursor: 'pointer',
                }}
                onClick={() => setReaderBg('#FFFFFF')}
              />
              <button
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: '#0F0F0F',
                  border: '1px solid #444',
                  cursor: 'pointer',
                }}
                onClick={() => setReaderBg('#0F0F0F')}
              />
            </div>
          </header>

          <div
            ref={readerContentRef}
            style={{
              display: 'grid',
              gridTemplateColumns: readerContentGridColumns,
              height: '100%',
              minHeight: 0,
              position: 'relative',
              overflowX: 'auto',
              overflowY: 'hidden',
              transition: 'grid-template-columns 0.2s ease',
            }}
          >
            {showReaderToc && !isLoadingReader && (
              <button
                onClick={() => setIsTocDrawerOpen((open) => !open)}
                title={
                  isTocDrawerOpen
                    ? t('books.hide_toc') || '收起目录'
                    : t('books.show_toc') || '展开目录'
                }
                style={{
                  position: 'absolute',
                  left: isTocDrawerOpen ? `${tocDrawerWidth + 8}px` : '12px',
                  top: '16px',
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  backgroundColor: isDarkReader ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                  border: `1px solid ${readerBorderColor}`,
                  color: 'inherit',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow: 'var(--shadow-app)',
                  transition: 'left 0.2s ease, background-color 0.15s ease',
                  zIndex: 40,
                }}
              >
                {isTocDrawerOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
              </button>
            )}

            {isLoadingReader ? (
              <div
                style={{
                  gridColumn: '1 / -1',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: readerBg,
                  color: readerTextColor,
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: '3px solid var(--color-border)',
                    borderTopColor: 'var(--color-accent)',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span style={{ fontSize: '13.5px', color: 'var(--text-muted)' }}>
                  {t('books.loading_book')}
                </span>
                <style>{`
                  @keyframes spin {
                    to { transform: rotate(360deg); }
                  }
                `}</style>
              </div>
            ) : (
              <>
                {/* Docked chapters / TOC drawer */}
                {showReaderToc && (
                  <aside
                    aria-hidden={!isTocDrawerOpen}
                    style={{
                      gridColumn: 1,
                      minWidth: 0,
                      width: '100%',
                      height: '100%',
                      boxSizing: 'border-box',
                      borderRight: isTocDrawerOpen
                        ? `1px solid ${readerBorderColor}`
                        : '0 solid transparent',
                      padding: isTocDrawerOpen ? '16px' : '0',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      backgroundColor: isDarkReader ? '#151515' : '#FBFAF7',
                      boxShadow: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      opacity: isTocDrawerOpen ? 1 : 0,
                      transition:
                        'opacity 0.15s ease, padding 0.2s ease, border-right-width 0.2s ease',
                      pointerEvents: isTocDrawerOpen ? 'auto' : 'none',
                      zIndex: 10,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        gap: '8px',
                        marginBottom: '10px',
                      }}
                    >
                      <h4
                        style={{
                          fontSize: '11px',
                          color: isDarkReader ? '#888' : 'var(--text-muted)',
                          textTransform: 'uppercase',
                          fontWeight: 600,
                          margin: 0,
                        }}
                      >
                        {t('books.toc_title')}
                      </h4>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        fontSize: '12px',
                      }}
                    >
                      {(() => {
                        if (isPdf) {
                          return Array.from({ length: pdfNumPages }).map((_, idx) => {
                            const pageIndex = idx
                            const isActive =
                              pdfLayoutMode === 'dual'
                                ? pageIndex >= currentPageIndex && pageIndex <= currentPageIndex + 1
                                : pageIndex === currentPageIndex
                            return (
                              <button
                                key={pageIndex}
                                onClick={() => {
                                  setCurrentPageIndex(pageIndex)
                                  setReadingProgress(
                                    Math.round((pageIndex / (pdfNumPages - 1 || 1)) * 100),
                                  )
                                  if (pdfLayoutMode === 'scroll') {
                                    requestAnimationFrame(() => {
                                      requestAnimationFrame(() => scrollPdfToPage(pageIndex, 'auto'))
                                    })
                                  }
                                }}
                                title={t('books.page_label', { num: pageIndex + 1 })}
                                style={{
                                  border: 'none',
                                  background: isActive
                                    ? isDarkReader
                                      ? 'rgba(245, 158, 11, 0.14)'
                                      : 'rgba(245, 158, 11, 0.12)'
                                    : 'none',
                                  textAlign: 'left',
                                  padding: '6px 8px',
                                  borderRadius: '4px',
                                  color: isActive ? 'var(--color-accent)' : 'inherit',
                                  fontWeight: isActive ? 700 : 500,
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {t('books.page_label', { num: pageIndex + 1 })}
                              </button>
                            )
                          })
                        }

                        if (!bookChapters) return null

                        const tocList =
                          bookToc && bookToc.length > 0
                            ? bookToc
                            : bookChapters.map((c, idx) => ({
                                title: c.title,
                                level: 0,
                                chapterIndex: idx,
                                paragraphOffset: 0,
                              }))
                        const resolvedTocList = (tocList as TocEntry[]).map((entry) =>
                          resolveReaderTocEntry(entry, bookChapters),
                        )
                        const activeIdx = getActiveTocIndex(
                          resolvedTocList,
                          currentChapterIndex,
                          currentParagraphOffset,
                        )

                        return tocList.map((entry, idx) => {
                          const targetEntry = resolvedTocList[idx]
                          const isActive = idx === activeIdx
                          return (
                            <button
                              key={idx}
                              onClick={() => {
                                setCurrentChapterIndex(targetEntry.chapterIndex)
                                setCurrentChapter(
                                  bookChapters[targetEntry.chapterIndex]?.title || entry.title,
                                )
                                const paras = bookChapters[targetEntry.chapterIndex]?.paragraphs || []
                                const targetPage = getPageOfParagraph(
                                  paras,
                                  targetEntry.paragraphOffset || 0,
                                )
                                setCurrentPageIndex(targetPage)
                                setCurrentParagraphOffset(targetEntry.paragraphOffset || 0)
                              }}
                              title={entry.title}
                              style={{
                                border: 'none',
                                background: 'none',
                                textAlign: 'left',
                                padding: '6px 8px',
                                paddingLeft: `${8 + entry.level * 14}px`,
                                borderRadius: '4px',
                                color: isActive ? 'var(--color-accent)' : 'inherit',
                                fontWeight: isActive
                                  ? 'bold'
                                  : entry.level === 0
                                    ? 600
                                    : 'normal',
                                fontSize: entry.level === 0 ? '12px' : '11.5px',
                                opacity: entry.level > 0 ? 0.85 : 1,
                                cursor: 'pointer',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {entry.title}
                            </button>
                          )
                        })
                      })()}
                    </div>
                  </aside>
                )}

                {/* Middle Column: Text content */}
                <main
                  ref={readerMainRef}
                  onScroll={
                    epubLayoutMode === 'scroll' && !isPdf ? handleEpubContinuousScroll : undefined
                  }
                  onMouseUp={!isPdf ? handleTextSelection : undefined}
                  onClick={handleReaderContentClick}
                  style={{
                    gridColumn: 2,
                    padding: '32px 48px',
                    overflowY: 'auto',
                    minWidth: 0,
                    userSelect: 'text',
                    fontSize: `${fontSize}px`,
                    lineHeight: '1.8',
                    maxWidth: isPdf ? 'none' : '800px',
                    margin: '0 auto',
                    width: '100%',
                    position: 'relative',
                    display: !bookChapters && !pdfData ? 'flex' : 'block',
                    flexDirection: 'column',
                    justifyContent: !bookChapters && !pdfData ? 'center' : 'initial',
                    alignItems: !bookChapters && !pdfData ? 'center' : 'initial',
                    textAlign: !bookChapters && !pdfData ? 'center' : 'initial',
                  }}
                >
                  <style>{`
                    @keyframes flipPage {
                      0% {
                        transform: rotateY(15deg);
                        opacity: 0.8;
                      }
                      100% {
                        transform: rotateY(0deg);
                        opacity: 1;
                      }
                    }
                    .pdf-flip-page {
                      animation: flipPage 0.25s ease-out both;
                      transform-origin: left center;
                    }
                  `}</style>
                  {pdfData ? (
                    <div
                      ref={pdfScrollRef}
                      onScroll={pdfLayoutMode === 'scroll' ? handlePdfScroll : undefined}
                      onMouseUp={pdfLayoutMode !== 'scroll' ? handleTextSelection : undefined}
                      onWheel={pdfLayoutMode !== 'scroll' ? handlePdfWheel : undefined}
                      style={
                        pdfLayoutMode === 'scroll'
                          ? {
                              width: '100%',
                              height: '100%',
                              overflowY: 'auto',
                            }
                          : {
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minHeight: '100%',
                              userSelect: 'text',
                              perspective: pdfLayoutMode === 'simulation' ? '1200px' : 'none',
                            }
                      }
                    >
                      {/* Single persistent Document: never remounts on layout change,
                          so switching view modes no longer re-parses the whole PDF. */}
                      <Document
                        file={pdfFile}
                        onLoadSuccess={handlePdfLoadSuccess}
                        loading={
                          <div style={{ color: 'var(--text-muted)' }}>{t('books.pdf_loading')}</div>
                        }
                        error={
                          <div style={{ color: 'var(--color-danger)' }}>
                            {t('books.pdf_load_error')}
                          </div>
                        }
                      >
                        {pdfLayoutMode === 'scroll' ? (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '24px',
                              padding: '16px 0',
                            }}
                          >
                            {Array.from({ length: pdfNumPages }).map((_, idx) => {
                              const isNearViewport = Math.abs(idx - currentPageIndex) <= 2
                              if (!isNearViewport) {
                                return (
                                  <div
                                    key={idx}
                                    data-page-number={idx + 1}
                                    style={{
                                      height: `${Math.round((pdfPageRenderWidth || 600) * 1.414)}px`,
                                      width: `${pdfPageRenderWidth || 600}px`,
                                      backgroundColor: 'rgba(0,0,0,0.02)',
                                      border: '1px dashed var(--color-border)',
                                      borderRadius: '6px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: 'var(--text-muted)',
                                      fontSize: '13px',
                                    }}
                                  >
                                    {t('books.page_label', { num: idx + 1 })}
                                  </div>
                                )
                              }
                              return (
                                <div
                                  key={idx}
                                  className="react-pdf__Page"
                                  data-page-number={idx + 1}
                                >
                                  <Page
                                    pageNumber={idx + 1}
                                    renderTextLayer={true}
                                    renderAnnotationLayer={false}
                                    width={pdfPageRenderWidth || undefined}
                                    loading={
                                      <div style={{ color: 'var(--text-muted)' }}>
                                        {t('books.pdf_rendering_page', { num: idx + 1 })}
                                      </div>
                                    }
                                  />
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <>
                            <div
                              key={currentPageIndex}
                              className={pdfLayoutMode === 'simulation' ? 'pdf-flip-page' : ''}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {pdfLayoutMode === 'dual' ? (
                                <div
                                  style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}
                                >
                                  <div
                                    className="react-pdf__Page"
                                    data-page-number={currentPageIndex + 1}
                                  >
                                    <Page
                                      pageNumber={currentPageIndex + 1}
                                      renderTextLayer={true}
                                      renderAnnotationLayer={false}
                                      width={pdfPageRenderWidth || undefined}
                                      loading={
                                        <div style={{ color: 'var(--text-muted)' }}>
                                          {t('books.pdf_rendering_page', {
                                            num: currentPageIndex + 1,
                                          })}
                                        </div>
                                      }
                                    />
                                  </div>
                                  {currentPageIndex + 1 < pdfNumPages && (
                                    <div
                                      className="react-pdf__Page"
                                      data-page-number={currentPageIndex + 2}
                                    >
                                      <Page
                                        pageNumber={currentPageIndex + 2}
                                        renderTextLayer={true}
                                        renderAnnotationLayer={false}
                                        width={pdfPageRenderWidth || undefined}
                                        loading={
                                          <div style={{ color: 'var(--text-muted)' }}>
                                            {t('books.pdf_rendering_page', {
                                              num: currentPageIndex + 2,
                                            })}
                                          </div>
                                        }
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <Page
                                  pageNumber={currentPageIndex + 1}
                                  renderTextLayer={true}
                                  renderAnnotationLayer={false}
                                  width={pdfPageRenderWidth || undefined}
                                  loading={
                                    <div style={{ color: 'var(--text-muted)' }}>
                                      {t('books.pdf_rendering_page', {
                                        num: currentPageIndex + 1,
                                      })}
                                    </div>
                                  }
                                />
                              )}
                            </div>

                            <div
                              style={{
                                textAlign: 'center',
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                                marginTop: '24px',
                              }}
                            >
                              {pdfLayoutMode === 'dual' ? (
                                <>
                                  {currentPageIndex + 1}
                                  {currentPageIndex + 2 <= pdfNumPages
                                    ? ` - ${currentPageIndex + 2}`
                                    : ''}{' '}
                                  / {pdfNumPages}
                                </>
                              ) : (
                                `${currentPageIndex + 1} / ${pdfNumPages}`
                              )}
                            </div>
                          </>
                        )}
                      </Document>
                    </div>
                  ) : bookChapters ? (
                    <>
                      {epubLayoutMode !== 'scroll' &&
                        currentPageIndex === 0 &&
                        !isReadingBlockHeading(activeParagraphs[0]) && (
                          <h2 style={{ fontSize: '20px', marginBottom: '24px', fontWeight: 800 }}>
                            {currentChapter}
                          </h2>
                        )}

                      {epubLayoutMode === 'scroll' ? (
                        // Continuous: render the whole EPUB so native scrolling crosses chapters.
                        <div>
                          {bookChapters.map((chapter, chapterIdx) => (
                            <section
                              key={chapterIdx}
                              data-epub-chapter-section={chapterIdx}
                              style={{
                                paddingTop: chapterIdx === 0 ? 0 : '36px',
                                marginTop: chapterIdx === 0 ? 0 : '28px',
                                borderTop:
                                  chapterIdx === 0 ? 'none' : `1px solid ${readerBorderColor}`,
                              }}
                            >
                              {(chapter.paragraphs || []).map(
                                (block: ReadingBlock, idx: number) =>
                                  renderEpubParagraph(block, `${chapterIdx}-${idx}`, idx, chapterIdx),
                              )}
                            </section>
                          ))}
                        </div>
                      ) : epubLayoutMode === 'dual' ? (
                        // Two page-chunks side by side, like an open book.
                        <div style={{ display: 'flex', gap: '40px', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {(pages[clampedPageIndex] || []).map((block, idx) => {
                              const pageStart = getParagraphOffsetOfPage(
                                activeParagraphs,
                                clampedPageIndex,
                              )
                              return renderEpubParagraph(block, `l-${idx}`, pageStart + idx)
                            })}
                          </div>
                          {clampedPageIndex + 1 < pages.length && (
                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                                borderLeft: `1px solid ${readerBorderColor}`,
                                paddingLeft: '40px',
                              }}
                            >
                              {(pages[clampedPageIndex + 1] || []).map((block, idx) => {
                                const pageStart = getParagraphOffsetOfPage(
                                  activeParagraphs,
                                  clampedPageIndex + 1,
                                )
                                return renderEpubParagraph(block, `r-${idx}`, pageStart + idx)
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        // Single page.
                        currentPageParagraphs.map((block, idx) => {
                          const pageStart = getParagraphOffsetOfPage(
                            activeParagraphs,
                            clampedPageIndex,
                          )
                          return renderEpubParagraph(block, idx, pageStart + idx)
                        })
                      )}

                      <div
                        style={{
                          textAlign: 'center',
                          fontSize: '12px',
                          color: 'var(--text-muted)',
                          marginTop: '32px',
                          paddingTop: '16px',
                          borderTop: `1px solid ${readerBorderColor}`,
                        }}
                      >
                        {epubLayoutMode === 'scroll'
                          ? `${currentChIndex + 1} / ${chList.length}`
                          : epubLayoutMode === 'dual'
                            ? `${clampedPageIndex + 1}${
                                clampedPageIndex + 2 <= pages.length
                                  ? ` - ${clampedPageIndex + 2}`
                                  : ''
                              } / ${pages.length}`
                            : `${clampedPageIndex + 1} / ${pages.length}`}
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        maxWidth: '480px',
                        padding: '32px',
                        backgroundColor: readerCardBg,
                        border: `1px solid ${readerCardBorder}`,
                        borderRadius: '12px',
                        boxShadow: 'var(--shadow-app)',
                        animation: 'enter 0.15s ease both',
                      }}
                    >
                      <div
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '50%',
                          backgroundColor: 'rgba(245, 158, 11, 0.12)',
                          color: 'var(--color-accent)',
                          display: 'grid',
                          placeItems: 'center',
                          margin: '0 auto 16px auto',
                        }}
                      >
                        <ExternalLink size={24} />
                      </div>
                      <h3
                        style={{
                          fontSize: '16px',
                          fontWeight: 700,
                          marginBottom: '8px',
                          color: 'var(--text-main)',
                          marginTop: 0,
                        }}
                      >
                        {t('books.unsupported_reader_title') || '无法在应用内阅读'}
                      </h3>
                      <p
                        style={{
                          fontSize: '13px',
                          color: 'var(--text-muted)',
                          lineHeight: '1.6',
                          marginBottom: '20px',
                          marginTop: 0,
                        }}
                      >
                        {t('books.unsupported_reader_desc', { format: readingBook.cover }) ||
                          `${readingBook.cover || 'PDF'} 格式不支持在应用内进行文本排版阅读。您可以使用系统默认应用程序直接打开它。`}
                      </p>
                      <button
                        className="btn primary"
                        style={{
                          padding: '8px 16px',
                          fontSize: '13px',
                          margin: '0 auto',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                        onClick={async () => {
                          const res = await api.openExternalFile(readingBook.path)
                          if (res && !res.success) {
                            showToast(res.error)
                          }
                        }}
                      >
                        <ExternalLink size={14} />{' '}
                        {t('books.open_externally_btn') || '用系统默认程序打开'}
                      </button>
                    </div>
                  )}

                  {(bookChapters || pdfData) && hasPrev && (
                    <button
                      onClick={handlePrevPage}
                      style={{
                        position: 'fixed',
                        left: `${navBtnPosition.left}px`,
                        top: `${navBtnPosition.top}px`,
                        transform: 'translateY(-50%)',
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor: isDarkReader
                          ? 'rgba(255,255,255,0.06)'
                          : 'rgba(0,0,0,0.04)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        color: 'inherit',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: 'var(--shadow-app)',
                        zIndex: 20,
                      }}
                      title={t('books.prev_page') || '上一页'}
                    >
                      ←
                    </button>
                  )}
                  {(bookChapters || pdfData) && hasNext && (
                    <button
                      onClick={handleNextPage}
                      style={{
                        position: 'fixed',
                        right: `${navBtnPosition.right}px`,
                        top: `${navBtnPosition.top}px`,
                        transform: 'translateY(-50%)',
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor: isDarkReader
                          ? 'rgba(255,255,255,0.06)'
                          : 'rgba(0,0,0,0.04)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        color: 'inherit',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: 'var(--shadow-app)',
                        zIndex: 20,
                      }}
                      title={t('books.next_page') || '下一页'}
                    >
                      →
                    </button>
                  )}
                </main>

                {/* Docked annotations drawer */}
                <aside
                  aria-hidden={!isAnnotationsDrawerOpen}
                  style={{
                    gridColumn: 3,
                    minWidth: 0,
                    width: '100%',
                    height: '100%',
                    boxSizing: 'border-box',
                    borderLeft: isAnnotationsDrawerOpen
                      ? `1px solid ${readerBorderColor}`
                      : '0 solid transparent',
                    padding: isAnnotationsDrawerOpen ? '16px' : '0',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    backgroundColor: isDarkReader ? '#151515' : '#FBFAF7',
                    boxShadow: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    opacity: isAnnotationsDrawerOpen ? 1 : 0,
                    transition:
                      'opacity 0.15s ease, padding 0.2s ease, border-left-width 0.2s ease',
                    pointerEvents: isAnnotationsDrawerOpen ? 'auto' : 'none',
                    zIndex: 10,
                  }}
                >
                  {/* Inline editor inside right sidebar instead of overlay popover to prevent shifting */}
                  {selectedHighlightText && (
                    <div
                      style={{
                        padding: '12px',
                        border: `1px solid ${readerBorderColor}`,
                        borderRadius: '8px',
                        backgroundColor: readerCardBg,
                        boxShadow: 'var(--shadow-app)',
                        marginBottom: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '11px',
                          color: isDarkReader ? '#888' : 'var(--text-muted)',
                        }}
                      >
                        <strong>{t('books.selected_text_label')}：</strong>
                        <span style={{ fontStyle: 'italic' }}>"{selectedHighlightText}"</span>
                      </div>
                      <input
                        ref={annotationInputRef}
                        className="form-field"
                        style={{
                          fontSize: '12px',
                          padding: '6px 8px',
                          backgroundColor: isDarkReader ? '#121212' : '#fff',
                          color: readerTextColor,
                          border: `1px solid ${readerBorderColor}`,
                        }}
                        placeholder={t('books.annotation_placeholder')}
                        value={newAnnotation}
                        onChange={(e) => setNewAnnotation(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          className="btn sm"
                          onClick={() => {
                            setSelectedHighlightText('')
                            setNewAnnotation('')
                          }}
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          className="btn sm primary"
                          onClick={handleAddHighlight}
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                        >
                          <Save size={10} /> {t('books.save_annotation_btn')}
                        </button>
                      </div>
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '10px',
                    }}
                  >
                    <h4
                      style={{
                        fontSize: '11px',
                        color: isDarkReader ? '#888' : 'var(--text-muted)',
                        textTransform: 'uppercase',
                        fontWeight: 600,
                        margin: 0,
                      }}
                    >
                      {t('books.highlights_annotations_title')} ({highlights.length})
                    </h4>
                    <button
                      className="btn sm"
                      onClick={() => setIsAnnotationsDrawerOpen(false)}
                      title={t('books.hide_annotations') || '收起批注'}
                      style={{
                        width: '28px',
                        height: '28px',
                        padding: 0,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <PanelRightClose size={13} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {highlights.map((hl) => (
                      <div
                        key={hl.id}
                        style={{
                          padding: '10px',
                          backgroundColor: readerCardBg,
                          border: `1px solid ${readerCardBorder}`,
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      >
                        <p
                          style={{
                            fontStyle: 'italic',
                            color: isDarkReader ? '#aaa' : 'var(--text-muted)',
                            borderLeft: '2px solid var(--color-accent)',
                            paddingLeft: '6px',
                            marginBottom: '6px',
                          }}
                        >
                          "{hl.text}"
                        </p>
                        <p
                          style={{
                            fontWeight: 600,
                            color: isDarkReader ? '#fff' : 'var(--text-main)',
                          }}
                        >
                          {t('books.annotation_label')}: {hl.annotation}
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '6px',
                            marginTop: '8px',
                          }}
                        >
                          <button
                            className="btn sm"
                            onClick={() => handleCopyLink(hl)}
                            title={t('books.copy_link_tooltip')}
                            style={{
                              fontSize: '11px',
                              padding: '3px 6px',
                              backgroundColor: isDarkReader ? '#2A2A2A' : '#f0f0f0',
                              border: 'none',
                              color: readerTextColor,
                            }}
                          >
                            <Copy size={11} /> {t('books.copy_link_btn')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </aside>
              </>
            )}
          </div>
        </div>
      )}

      {/* Premium Import Book Modal */}
      {isImportOpen && (
        <div className="dialog-overlay" style={modalOverlayStyle}>
          <div className="dialog-surface" style={modalContentStyle}>
            <h3 style={modalTitleStyle}>{t('books.import_book')}</h3>

            {/* File Selection */}
            <div>
              <label style={labelStyle}>{t('books.select_file_label') || '选择电子书文件:'}</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="form-field"
                  style={{ width: '100%', cursor: 'pointer' }}
                  readOnly
                  placeholder={
                    t('books.select_file_placeholder') || '请选择 .epub, .pdf, .txt, .mobi 文件...'
                  }
                  value={selectedFileName}
                  onClick={handleSelectBookFile}
                />
                <button
                  className="btn"
                  type="button"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={handleSelectBookFile}
                >
                  {t('books.browse_btn') || '浏览...'}
                </button>
              </div>
            </div>

            {/* Title */}
            <div>
              <label style={labelStyle}>{t('books.prompt_import_title')}</label>
              <input
                className="form-field"
                style={{ width: '100%' }}
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                placeholder={t('books.prompt_import_title')}
              />
            </div>

            {/* Author */}
            <div>
              <label style={labelStyle}>{t('books.prompt_import_author')}</label>
              <input
                className="form-field"
                style={{ width: '100%' }}
                value={importAuthor}
                onChange={(e) => setImportAuthor(e.target.value)}
                placeholder={t('books.prompt_import_author')}
              />
            </div>

            {/* Category selection */}
            <div>
              <label style={labelStyle}>{t('books.prompt_import_category')}</label>
              <select
                className="form-field"
                style={{ width: '100%', marginBottom: isCustomCategory ? '10px' : '0' }}
                value={isCustomCategory ? 'custom' : importCategory}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setIsCustomCategory(true)
                  } else {
                    setIsCustomCategory(false)
                    setImportCategory(e.target.value)
                  }
                }}
              >
                <option value="">{t('books.uncategorized')}</option>
                {categories
                  .filter((cat) => !isReservedBookCategory(cat.name))
                  .map((cat) => (
                    <option key={cat.id} value={cat.name}>
                      {getCategoryDisplayName(cat.name, cat.id)}
                    </option>
                  ))}
                <option value="custom">＋ {t('books.prompt_add_category')}</option>
              </select>

              {isCustomCategory && (
                <input
                  className="form-field"
                  style={{ width: '100%' }}
                  value={importCustomCategory}
                  onChange={(e) => setImportCustomCategory(e.target.value)}
                  placeholder={t('books.prompt_add_category')}
                  autoFocus
                />
              )}
            </div>

            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}
            >
              <button
                className="btn"
                onClick={() => {
                  setIsImportOpen(false)
                  setImportTitle('')
                  setImportAuthor('')
                  setImportCategory('')
                  setImportCustomCategory('')
                  setIsCustomCategory(false)
                  setImportFilePath('')
                  setSelectedFileName('')
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn primary"
                onClick={confirmImportBook}
                disabled={!importTitle.trim() || !importFilePath}
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Premium Edit Category Modal */}
      {editingCategory && (
        <AccessibleDialog
          title={t('books.prompt_edit_category')}
          onClose={closeCategoryTranslationEditor}
          returnFocus={restoreCategoryDialogFocus}
          initialFocusRef={editCategoryNameInputRef}
          overlayStyle={modalOverlayStyle}
          contentStyle={modalContentStyle}
          titleStyle={modalTitleStyle}
        >
          {/* Primary input */}
          <div>
            <label style={labelStyle}>{t('common.main_name_label')}</label>
            <input
              ref={editCategoryNameInputRef}
              className="form-field"
              style={{ width: '100%' }}
              value={editCatName}
              onChange={(e) => setEditCatName(e.target.value)}
              placeholder={t('books.prompt_edit_category')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmEditCategory()
              }}
            />
          </div>

          {/* Collapsible panel for other translations */}
          <div style={{ marginTop: '8px', marginBottom: '12px' }}>
            <button
              type="button"
              className="btn sm"
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--text-muted)',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: 0,
              }}
              onClick={() => setIsEditCatTransOpen(!isEditCatTransOpen)}
            >
              {t('common.more_translations')} {isEditCatTransOpen ? '▲' : '▼'}
            </button>

            {isEditCatTransOpen && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {configuredLocales.filter((l) => l.code !== i18n.language).map((locale) => (
                  <div
                    key={locale.code}
                    style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
                  >
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {locale.label}
                    </label>
                    <input
                      className="form-field"
                      style={{ width: '100%', fontSize: '12px', padding: '6px 8px' }}
                      value={editCatTrans[locale.code] || ''}
                      onChange={(e) =>
                        setEditCatTrans({ ...editCatTrans, [locale.code]: e.target.value })
                      }
                      placeholder={`e.g. translation for ${locale.label}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button className="btn" onClick={closeCategoryTranslationEditor}>
              {t('common.cancel')}
            </button>
            <button
              className="btn primary"
              onClick={confirmEditCategory}
              disabled={!editCatName.trim()}
            >
              {t('common.confirm')}
            </button>
          </div>
        </AccessibleDialog>
      )}

      {/* Premium Delete Category Confirm Modal */}
      {deletingCategory && (
        <AccessibleDialog
          title={t('books.confirm_delete_shelf_title')}
          onClose={closeCategoryDeleteDialog}
          returnFocus={restoreCategoryDialogFocus}
          initialFocusRef={deleteCategoryCancelButtonRef}
          overlayStyle={modalOverlayStyle}
          contentStyle={modalContentStyle}
          titleStyle={{ ...modalTitleStyle, color: 'var(--color-danger)' }}
        >
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-main)',
              margin: '0 0 12px 0',
              lineHeight: 1.5,
            }}
          >
            {t('books.confirm_delete_shelf_desc', {
              name: getCategoryDisplayName(deletingCategory.name, deletingCategory.id),
              count: deletingCategoryBookCount,
            })}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              ref={deleteCategoryCancelButtonRef}
              className="btn"
              disabled={isDeletingCategoryPending}
              onClick={closeCategoryDeleteDialog}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn primary"
              disabled={isDeletingCategoryPending}
              style={{
                backgroundColor: 'var(--color-danger)',
                borderColor: 'var(--color-danger)',
              }}
              onClick={confirmDeleteCategory}
            >
              {t('common.confirm')}
            </button>
          </div>
        </AccessibleDialog>
      )}

      {/* Premium Edit Book Modal */}
      {editingBookInfo && (
        <div className="dialog-overlay" style={modalOverlayStyle}>
          <div className="dialog-surface" style={modalContentStyle}>
            <h3 style={modalTitleStyle}>{t('books.edit_book') || '编辑书籍信息'}</h3>

            {/* Title */}
            <div>
              <label style={labelStyle}>{t('books.prompt_import_title')}</label>
              <input
                className="form-field"
                style={{ width: '100%' }}
                value={editBookTitle}
                onChange={(e) => setEditBookTitle(e.target.value)}
                placeholder={t('books.prompt_import_title')}
              />
            </div>

            {/* Author */}
            <div>
              <label style={labelStyle}>{t('books.prompt_import_author')}</label>
              <input
                className="form-field"
                style={{ width: '100%' }}
                value={editBookAuthor}
                onChange={(e) => setEditBookAuthor(e.target.value)}
                placeholder={t('books.prompt_import_author')}
              />
            </div>

            {/* Category selection */}
            <div>
              <label style={labelStyle}>{t('books.prompt_import_category')}</label>
              <select
                className="form-field"
                style={{ width: '100%', marginBottom: isEditBookCustomCategory ? '10px' : '0' }}
                value={isEditBookCustomCategory ? 'custom' : editBookCategory}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setIsEditBookCustomCategory(true)
                  } else {
                    setIsEditBookCustomCategory(false)
                    setEditBookCategory(e.target.value)
                  }
                }}
              >
                <option value="">{t('books.uncategorized')}</option>
                {categories
                  .filter((cat) => !isReservedBookCategory(cat.name))
                  .map((cat) => (
                    <option key={cat.id} value={cat.name}>
                      {getCategoryDisplayName(cat.name, cat.id)}
                    </option>
                  ))}
                <option value="custom">＋ {t('books.prompt_add_category')}</option>
              </select>

              {isEditBookCustomCategory && (
                <input
                  className="form-field"
                  style={{ width: '100%' }}
                  value={editBookCustomCategory}
                  onChange={(e) => setEditBookCustomCategory(e.target.value)}
                  placeholder={t('books.prompt_add_category')}
                  autoFocus
                />
              )}
            </div>

            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}
            >
              <button
                className="btn"
                onClick={() => {
                  setEditingBookInfo(null)
                  setEditBookTitle('')
                  setEditBookAuthor('')
                  setEditBookCategory('')
                  setEditBookCustomCategory('')
                  setIsEditBookCustomCategory(false)
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn primary"
                onClick={confirmEditBook}
                disabled={!editBookTitle.trim()}
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Premium Delete Book Confirm Modal */}
      {deletingBookInfo && (
        <div className="dialog-overlay" style={modalOverlayStyle}>
          <div className="dialog-surface" style={modalContentStyle}>
            <h3 style={{ ...modalTitleStyle, color: '#EF4444' }}>
              {t('books.delete_book') || '删除书籍确认'}
            </h3>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-main)',
                margin: '0 0 12px 0',
                lineHeight: 1.5,
              }}
            >
              {t('books.delete_book_confirm', { name: deletingBookInfo.title }) ||
                `确定要删除书籍《${deletingBookInfo.title}》吗？该操作不可逆，将同时删除该书的所有高亮划线与批注。`}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn" onClick={() => setDeletingBookInfo(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn primary"
                style={{ backgroundColor: '#EF4444', borderColor: '#EF4444' }}
                onClick={confirmDeleteBook}
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

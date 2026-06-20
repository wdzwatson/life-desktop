import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { FolderPlus, BookOpen, Plus, Tag, ExternalLink, Bookmark, Edit3, Save, Copy } from 'lucide-react'

export const Books: React.FC = () => {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore(state => state.showToast)
  const userId = useAppStore(state => state.userId)

  // DB States
  const [categories, setCategories] = useState<any[]>([])
  const [books, setBooks] = useState<any[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('all')
  
  // Reader Overlay State
  const [readingBook, setReadingBook] = useState<any | null>(null)
  
  const chapters = [
    t('books.chapter_1'),
    t('books.chapter_2'),
    t('books.chapter_3'),
    t('books.chapter_4')
  ]

  const [currentChapter, setCurrentChapter] = useState(chapters[0])

  useEffect(() => {
    // Sync current chapter selection on language toggling
    setCurrentChapter(prev => {
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

  const api = (window as any).electronAPI

  const loadData = async () => {
    if (!api) return
    
    // Load categories
    const catRes = await api.dbQuery('books', 'SELECT * FROM categories ORDER BY sort_order ASC')
    if (catRes?.success) setCategories(catRes.data)

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
        setReadingBook(res.data[0])
        if (chapter) setCurrentChapter(decodeURIComponent(chapter))
        
        // Load highlights for this book
        const hlRes = await api.dbQuery('books', 'SELECT * FROM highlights WHERE book_id = ?', [bookId])
        if (hlRes?.success) setHighlights(hlRes.data)
      }
    }

    window.addEventListener('lifeos:open-book', handleOpenBookEvent)
    return () => {
      window.removeEventListener('lifeos:open-book', handleOpenBookEvent)
    }
  }, [userId])

  // Category addition
  const handleAddCategory = async () => {
    if (!api) return
    const name = window.prompt(t('books.prompt_add_category'))
    if (!name?.trim()) return

    const res = await api.dbQuery('books', 'INSERT INTO categories (name, sort_order) VALUES (?, ?)', [
      name.trim(),
      categories.length + 1
    ])
    if (res?.success) {
      showToast(t('books.toast_category_added', { name }))
      loadData()
    }
  }

  // Import E-book Mock
  const handleImportBook = async () => {
    if (!api) return
    const title = window.prompt(t('books.prompt_import_title'))
    if (!title?.trim()) return
    const author = window.prompt(t('books.prompt_import_author')) || t('books.unknown_author')
    const category = window.prompt(t('books.prompt_import_category')) || t('books.uncategorized')

    const query = `
      INSERT INTO books (title, author, path, cover, category, progress, status)
      VALUES (?, ?, ?, 'EPUB', ?, 0.0, 'want')
    `
    const res = await api.dbQuery('books', query, [
      title.trim(),
      author.trim(),
      `/books/${title.trim()}.epub`,
      category.trim()
    ])

    if (res?.success) {
      showToast(t('books.toast_book_imported', { title }))
      loadData()
    }
  }

  // Open book in custom reader overlay
  const handleOpenReader = async (book: any) => {
    setReadingBook(book)
    // Mark reading status
    if (api && book.status === 'want') {
      await api.dbQuery('books', 'UPDATE books SET status = "reading" WHERE id = ?', [book.id])
      loadData()
    }

    // Load highlights
    if (api) {
      const hlRes = await api.dbQuery('books', 'SELECT * FROM highlights WHERE book_id = ?', [book.id])
      if (hlRes?.success) setHighlights(hlRes.data)
    }
  }

  // Close reader and save final progress percentage
  const handleCloseReader = async () => {
    if (readingBook && api) {
      // update mock progress
      const newProgress = Math.min(100, Math.round(readingBook.progress + 5))
      await api.dbQuery('books', 'UPDATE books SET progress = ? WHERE id = ?', [newProgress, readingBook.id])
      showToast(t('books.toast_progress_saved', { progress: newProgress }))
      loadData()
    }
    setReadingBook(null)
  }

  // Simulated highlight click selection
  const simulateSelection = (text: string) => {
    setSelectedHighlightText(text)
  }

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
      JSON.stringify({ chapter: currentChapter, offset: 120 })
    ])

    if (res?.success) {
      showToast(t('books.toast_highlight_saved'))
      setSelectedHighlightText('')
      setNewAnnotation('')
      
      // Reload highlights
      const hlRes = await api.dbQuery('books', 'SELECT * FROM highlights WHERE book_id = ?', [readingBook.id])
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
    let noteId: number | null = null

    // Format highlights to Markdown
    let mdContent = t('books.note_md_title', { title: readingBook.title })
    mdContent += t('books.note_md_author', { author: readingBook.author || t('books.unknown_author') })
    mdContent += t('books.note_md_sync_time', { time: new Date().toLocaleString() })
    mdContent += t('books.note_md_progress', { progress: readingBook.progress })
    mdContent += t('books.note_md_highlights_header')

    highlights.forEach((hl, idx) => {
      mdContent += t('books.note_md_highlight_item_title', { index: idx + 1 })
      mdContent += `> ${hl.text}\n\n`
      mdContent += t('books.note_md_highlight_annotation', { annotation: hl.annotation || t('books.no_annotation') })
      mdContent += t('books.note_md_highlight_deep_link', { id: readingBook.id, chapter: encodeURIComponent(currentChapter) })
    })

    if (checkNote?.success && checkNote.data.length > 0) {
      noteId = checkNote.data[0].id
      // Update
      await api.dbQuery('notes', 'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        mdContent,
        noteId
      ])
      showToast(t('books.toast_note_updated'))
    } else {
      // Create new
      const createRes = await api.dbQuery('notes', 'INSERT INTO notes (title, content, note_type) VALUES (?, ?, "markdown")', [
        noteTitle,
        mdContent
      ])
      if (createRes?.success) {
        showToast(t('books.toast_note_synced'))
      }
    }
  }

  const filteredBooks = books.filter(b => activeCategory === 'all' || b.category === activeCategory)

  return (
    <div style={{ animation: 'enter 0.15s ease both', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('books.title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('books.subtitle')}</p>
        </div>
        <button className="btn primary" onClick={handleImportBook}>
          <Plus size={16} />
          {t('books.import_book')}
        </button>
      </div>

      {/* Grid Shelf Layout */}
      <div style={{
        flexGrow: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        gap: '16px'
      }}>
        {/* Left Categories pane */}
        <aside className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '13px' }}>{t('books.categories')}</strong>
            <button className="btn sm" style={{ padding: '0 6px' }} onClick={handleAddCategory}>＋</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button 
              className={`nav-item ${activeCategory === 'all' ? 'active' : ''}`}
              onClick={() => setActiveCategory('all')}
              style={{ width: '100%', border: 'none', background: 'none' }}
            >
              <span className="nav-icon"><Bookmark size={15} /></span>
              <span className="nav-label">{t('books.all_books')} ({books.length})</span>
            </button>
            {categories.map(cat => {
              const catBooks = books.filter(b => b.category === cat.name)
              return (
                <button 
                  key={cat.id}
                  className={`nav-item ${activeCategory === cat.name ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat.name)}
                  style={{ width: '100%', border: 'none', background: 'none' }}
                >
                  <span className="nav-icon"><Tag size={14} /></span>
                  <span className="nav-label">
                    {cat.name === '未分类' ? t('books.uncategorized') : cat.name} ({catBooks.length})
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* Right bookshelf grid */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px', alignContent: 'start', overflowY: 'auto', height: '100%' }}>
          {filteredBooks.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', gridColumn: '1/-1', padding: '48px', fontStyle: 'italic', fontSize: '13px' }}>
              {t('books.empty_shelf')}
            </div>
          ) : (
            filteredBooks.map(book => (
              <div 
                key={book.id} 
                className="card" 
                style={{ display: 'flex', gap: '12px', cursor: 'pointer', transition: 'transform 0.15s ease' }}
                onClick={() => handleOpenReader(book)}
              >
                <div style={{
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
                  boxShadow: 'var(--shadow-app)'
                }}>
                  {book.cover || 'EPUB'}
                </div>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1 }}>
                  <div>
                    <h3 style={{ fontSize: '13px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                      {book.title}
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '11.5px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {book.author}
                    </p>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      <span>{t('books.category_label')}: {book.category === '未分类' ? t('books.uncategorized') : book.category}</span>
                      <span>{Math.round(book.progress)}%</span>
                    </div>
                    <div style={{ height: '4px', backgroundColor: 'var(--color-border)', borderRadius: '99px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${book.progress}%`, backgroundColor: 'var(--color-accent)' }} />
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
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: readerBg,
          color: readerBg === '#0F0F0F' ? '#D4D4D4' : '#2F2E2C',
          zIndex: 1000,
          display: 'grid',
          gridTemplateRows: '50px 1fr',
          animation: 'enter 0.18s ease both'
        }}>
          {/* Reader Header */}
          <header style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 24px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            backgroundColor: 'rgba(0,0,0,0.02)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button className="btn sm" onClick={handleCloseReader}>✕ {t('books.exit_reader')}</button>
              <strong style={{ fontSize: '13.5px' }}>{t('books.reading_label')}:《{readingBook.title}》</strong>
            </div>

            {/* Custom font and bg adjustments */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="btn sm" onClick={() => handleExportHighlights()}>
                <ExternalLink size={12} /> {t('books.export_notes_btn')}
              </button>
              <div style={{ borderRight: '1px solid rgba(0,0,0,0.1)', height: '20px', margin: '0 4px' }} />
              <button className="btn sm" onClick={() => setFontSize(Math.max(12, fontSize - 1))}>A-</button>
              <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}>{fontSize}px</span>
              <button className="btn sm" onClick={() => setFontSize(Math.min(22, fontSize + 1))}>A+</button>
              <div style={{ borderRight: '1px solid rgba(0,0,0,0.1)', height: '20px', margin: '0 4px' }} />
              {/* Bg toggler */}
              <button style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#FDFBF7', border: '1px solid #ddd', cursor: 'pointer' }} onClick={() => setReaderBg('#FDFBF7')} />
              <button style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#FFFFFF', border: '1px solid #ddd', cursor: 'pointer' }} onClick={() => setReaderBg('#FFFFFF')} />
              <button style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#0F0F0F', border: '1px solid #444', cursor: 'pointer' }} onClick={() => setReaderBg('#0F0F0F')} />
            </div>
          </header>

          {/* Reader Body Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 300px', height: '100%', minHeight: 0 }}>
            {/* Left Column: Chapters / TOC */}
            <aside style={{ borderRight: '1px solid rgba(0,0,0,0.06)', padding: '16px', overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.01)' }}>
              <h4 style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>{t('books.toc_title')}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                {chapters.map(ch => (
                  <button 
                    key={ch}
                    onClick={() => setCurrentChapter(ch)}
                    style={{
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      color: currentChapter === ch ? 'var(--color-accent)' : 'inherit',
                      fontWeight: currentChapter === ch ? 'bold' : 'normal',
                      cursor: 'pointer'
                    }}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </aside>

            {/* Middle Column: Text content */}
            <main style={{ padding: '32px 48px', overflowY: 'auto', fontSize: `${fontSize}px`, lineHeight: '1.8', maxWidth: '800px', margin: '0 auto' }}>
              <h2 style={{ fontSize: '20px', marginBottom: '24px', fontWeight: 800 }}>{currentChapter}</h2>
              
              <p style={{ marginBottom: '16px' }} onClick={() => simulateSelection(t('books.mock_p1'))}>
                {t('books.mock_p1')}
                <span style={{ fontSize: '11px', color: 'var(--color-accent)', cursor: 'pointer', marginLeft: '6px' }}>({t('books.click_to_select')})</span>
              </p>

              <p style={{ marginBottom: '16px' }} onClick={() => simulateSelection(t('books.mock_p2'))}>
                {t('books.mock_p2')}
                <span style={{ fontSize: '11px', color: 'var(--color-accent)', cursor: 'pointer', marginLeft: '6px' }}>({t('books.click_to_select')})</span>
              </p>

              {/* Selection menu popup mockup */}
              {selectedHighlightText && (
                <div style={{
                  padding: '12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-surface)',
                  boxShadow: 'var(--shadow-app)',
                  marginTop: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    <strong>{t('books.selected_text_label')}：</strong>"{selectedHighlightText}"
                  </div>
                  <input 
                    className="form-field" 
                    placeholder={t('books.annotation_placeholder')} 
                    value={newAnnotation} 
                    onChange={e => setNewAnnotation(e.target.value)} 
                  />
                  <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-end' }}>
                    <button className="btn sm" onClick={() => setSelectedHighlightText('')}>{t('common.cancel')}</button>
                    <button className="btn sm primary" onClick={handleAddHighlight}>
                      <Save size={12} /> {t('books.save_annotation_btn')}
                    </button>
                  </div>
                </div>
              )}
            </main>

            {/* Right Column: Highlights & Annotations Panel */}
            <aside style={{ borderLeft: '1px solid rgba(0,0,0,0.06)', padding: '16px', overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.01)' }}>
              <h4 style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>{t('books.highlights_annotations_title')} ({highlights.length})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {highlights.map((hl) => (
                  <div key={hl.id} style={{
                    padding: '10px',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}>
                    <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', borderLeft: '2px solid var(--color-accent)', paddingLeft: '6px', marginBottom: '6px' }}>
                      "{hl.text}"
                    </p>
                    <p style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                      {t('books.annotation_label')}: {hl.annotation}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '8px' }}>
                      <button className="btn sm" onClick={() => handleCopyLink(hl)} title={t('books.copy_link_tooltip')}>
                        <Copy size={11} /> {t('books.copy_link_btn')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}

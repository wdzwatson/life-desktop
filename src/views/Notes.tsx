import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import { Folder, FolderOpen, FileText, Plus, Eye, Edit2, Link2, BookOpen, Trash2 } from 'lucide-react'

export const Notes: React.FC = () => {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore(state => state.showToast)
  const userId = useAppStore(state => state.userId)
  const setActiveScreen = useAppStore(state => state.setActiveScreen)

  // DB States
  const [notebooks, setNotebooks] = useState<string[]>(['LifeOS', '产品设计', '技术架构', 'Reading'])
  const [activeNotebook, setActiveNotebook] = useState('产品设计')
  const [notes, setNotes] = useState<any[]>([])
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null)
  
  // Editor States
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [isEditMode, setIsEditMode] = useState(true)

  const api = (window as any).electronAPI

  const loadNotes = async () => {
    if (!api) return
    
    // Load notebooks
    const nbRes = await api.dbQuery('notes', 'SELECT DISTINCT notebook FROM notes')
    if (nbRes?.success) {
      const list = nbRes.data.map((r: any) => r.notebook || '未分类')
      // Ensure default values are included
      if (!list.includes('产品设计')) list.push('产品设计')
      if (!list.includes('技术架构')) list.push('技术架构')
      setNotebooks(list)
      if (!activeNotebook && list.length > 0) setActiveNotebook(list[0])
    }

    // Load notes for active notebook
    const notebookParam = activeNotebook || '产品设计'
    const notesRes = await api.dbQuery('notes', 'SELECT * FROM notes WHERE notebook = ? ORDER BY updated_at DESC', [notebookParam])
    if (notesRes?.success) {
      setNotes(notesRes.data)
      // Auto select first note if none selected
      if (activeNoteId === null && notesRes.data.length > 0) {
        selectNote(notesRes.data[0])
      }
    }
  }

  useEffect(() => {
    loadNotes()
  }, [activeNotebook, userId])

  const selectNote = (note: any) => {
    setActiveNoteId(note.id)
    setNoteTitle(note.title)
    setNoteContent(note.content || '')
  }

  const handleSaveNote = async () => {
    if (!activeNoteId || !api) return
    const query = 'UPDATE notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    const res = await api.dbQuery('notes', query, [noteTitle, noteContent, activeNoteId])
    if (res?.success) {
      showToast(t('notes.toast_saved'))
      loadNotes()
    }
  }

  const handleCreateNote = async () => {
    if (!api) return
    const query = 'INSERT INTO notes (title, content, note_type, notebook) VALUES (?, ?, ?, ?)'
    const defaultTitle = t('notes.default_title')
    const defaultContent = t('notes.default_content')
    const res = await api.dbQuery('notes', query, [defaultTitle, defaultContent, 'markdown', activeNotebook || '产品设计'])
    if (res?.success) {
      const newId = res.data.insertId
      showToast(t('notes.toast_created'))
      setActiveNoteId(newId)
      setNoteTitle(defaultTitle)
      setNoteContent(defaultContent)
      loadNotes()
    }
  }

  const handleDeleteNote = async (id: number) => {
    if (!api || !window.confirm(t('notes.prompt_delete_confirm'))) return
    const res = await api.dbQuery('notes', 'DELETE FROM notes WHERE id = ?', [id])
    if (res?.success) {
      showToast(t('notes.toast_deleted'))
      setActiveNoteId(null)
      loadNotes()
    }
  }

  // Handle Double Link Click or E-book Deep Link Click
  const handleDeepLinkClick = (link: string) => {
    // 1. E-book Link format: book:BookID#ChapterTitle
    if (link.startsWith('book:')) {
      const cleaned = link.replace('book:', '')
      const [bookId, chapter] = cleaned.split('#')
      
      showToast(t('notes.toast_navigating_shelf', { bookId, chapter: chapter || 'Default' }))
      setActiveScreen('books')
      
      // We pass state in localSession or trigger ebook loader in React window
      setTimeout(() => {
        const event = new CustomEvent('lifeos:open-book', { detail: { bookId: parseInt(bookId), chapter } })
        window.dispatchEvent(event)
      }, 200)
      return
    }

    // 2. Obsidian Double Link format: [[Note Title]]
    const foundNote = notes.find(n => n.title.toLowerCase() === link.toLowerCase())
    if (foundNote) {
      selectNote(foundNote)
      showToast(t('notes.toast_navigated_linked', { title: foundNote.title }))
    } else {
      showToast(t('notes.toast_linked_not_found', { link }))
    }
  }

  // Very simple Markdown parser for the Live Preview side
  const parseMarkdown = (md: string) => {
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^### (.*)$/gm, '<h3 style="margin-top: 12px; margin-bottom: 6px; font-size: 15px; border-bottom: 1px solid var(--color-border); padding-bottom: 4px;">$1</h3>')
      .replace(/^## (.*)$/gm, '<h2 style="margin-top: 18px; margin-bottom: 8px; font-size: 18px;">$1</h2>')
      .replace(/^# (.*)$/gm, '<h1 style="margin-top: 24px; margin-bottom: 12px; font-size: 22px; font-weight: 800;">$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="font-family: var(--font-mono); background-color: var(--bg-app); border: 1px solid var(--color-border); padding: 2px 4px; borderRadius: 4px; fontSize: 12px;">$1</code>')
      .replace(/^&gt; (.*)$/gm, '<blockquote style="border-left: 3px solid var(--color-accent); padding: 8px 12px; background-color: rgba(59, 130, 246, 0.04); color: var(--text-muted); margin: 12px 0;">$1</blockquote>')
      .replace(/^- (.*)$/gm, '<li style="margin-left: 20px; font-size: 13.5px; margin-top: 4px;">$1</li>')
    
    // Parse Double Links [[Note Title]] or [[book:BookID#Chapter]]
    const doubleLinkRegex = /\[\[(.*?)\]\]/g
    html = html.replace(doubleLinkRegex, (_, inner) => {
      const isBook = inner.startsWith('book:')
      const bookLabel = t('notes.book_ref_label', { id: inner.replace('book:', '') })
      return `<button 
        class="deep-link-btn" 
        data-link="${inner}" 
        style="color: var(--color-accent); font-weight: bold; background: none; border: none; cursor: pointer; text-decoration: underline; display: inline-flex; align-items: center; gap: 4px;"
      >
        <span style="font-size: 11px;">🔗</span>
        ${isBook ? bookLabel : inner}
      </button>`
    })

    // Group LI elements into UL
    html = html.replace(/(<li.*?>.*?<\/li>(\n<li.*?>.*?<\/li>)*)/gs, '<ul style="margin: 12px 0;">$1</ul>')
    
    // Group paragraphs
    html = html.split(/\n{2,}/).map(block => {
      if (/^<\/?(h1|h2|h3|ul|blockquote|button)/.test(block.trim())) {
        return block
      }
      return `<p style="margin-bottom: 10px; font-size: 13.5px; line-height: 1.6;">${block.replace(/\n/g, '<br/>')}</p>`
    }).join('')

    return html
  }

  // Attach event handlers to dynamic HTML buttons
  useEffect(() => {
    const previewContainer = document.getElementById('markdown-preview')
    if (previewContainer) {
      const buttons = previewContainer.querySelectorAll('.deep-link-btn')
      buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const link = (e.currentTarget as HTMLElement).getAttribute('data-link')
          if (link) handleDeepLinkClick(link)
        })
      })
    }
  }, [noteContent, isEditMode])

  return (
    <div style={{ animation: 'enter 0.15s ease both', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('notes.title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('notes.subtitle')}</p>
        </div>
        <button className="btn primary" onClick={handleCreateNote}>
          <Plus size={16} />
          {t('notes.new_note')}
        </button>
      </div>

      {/* Main 3-column layout */}
      <div style={{
        flexGrow: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: '200px 240px 1fr',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        backgroundColor: 'var(--bg-surface)'
      }}>
        {/* Column 1: Notebook list */}
        <div style={{ borderRight: '1px solid var(--color-border)', padding: '12px', overflowY: 'auto' }}>
          <h3 style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
            {t('notes.notebooks')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {notebooks.map(nb => (
              <button
                key={nb}
                onClick={() => setActiveNotebook(nb)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: activeNotebook === nb ? 'rgba(59, 130, 246, 0.06)' : 'none',
                  color: activeNotebook === nb ? 'var(--color-accent)' : 'var(--text-main)',
                  fontWeight: activeNotebook === nb ? 'bold' : 'normal',
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                {activeNotebook === nb ? <FolderOpen size={16} /> : <Folder size={16} />}
                <span style={{ fontSize: '13px' }}>
                  {nb === '产品设计' ? t('notes.product_design') : 
                   nb === '技术架构' ? t('notes.tech_architecture') : 
                   nb}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Column 2: Note list */}
        <div style={{ borderRight: '1px solid var(--color-border)', padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
            {t('notes.notes_list_title')} ({notes.length})
          </h3>
          {notes.map(note => (
            <div 
              key={note.id}
              onClick={() => selectNote(note)}
              style={{
                padding: '10px',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                cursor: 'pointer',
                backgroundColor: activeNoteId === note.id ? 'var(--bg-app)' : 'transparent',
                borderColor: activeNoteId === note.id ? 'var(--color-accent)' : 'var(--color-border)'
              }}
            >
              <h4 style={{ fontSize: '12.5px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileText size={13} color="var(--text-muted)" />
                {note.title}
              </h4>
              <p style={{
                fontSize: '11.5px',
                color: 'var(--text-muted)',
                marginTop: '4px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {note.content?.replace(/[#*`]/g, '').slice(0, 30) || t('notes.empty_note_label')}
              </p>
            </div>
          ))}
        </div>

        {/* Column 3: Rich Markdown editor + preview */}
        {activeNoteId ? (
          <div style={{ display: 'grid', gridTemplateColumns: isEditMode ? '1fr 1fr' : '1fr', height: '100%', minHeight: 0 }}>
            {/* Editor Input panel */}
            <div style={{ display: 'flex', flexDirection: 'column', borderRight: isEditMode ? '1px solid var(--color-border)' : 'none', height: '100%', minHeight: 0 }}>
              <div style={{ height: '42px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', padding: '0 12px', justifyContent: 'space-between' }}>
                <input 
                  style={{
                    border: 'none',
                    outline: 'none',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    width: '60%',
                    backgroundColor: 'transparent',
                    color: 'var(--text-main)'
                  }}
                  value={noteTitle}
                  onChange={e => setNoteTitle(e.target.value)}
                  onBlur={handleSaveNote}
                  placeholder={t('notes.default_title')}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn sm" onClick={() => setIsEditMode(!isEditMode)}>
                    {isEditMode ? <Eye size={12} /> : <Edit2 size={12} />}
                    {isEditMode ? t('notes.focus_mode') : t('notes.split_edit')}
                  </button>
                  <button className="btn sm" onClick={() => handleDeleteNote(activeNoteId)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
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
                  color: 'var(--text-main)'
                }}
                value={noteContent}
                onChange={e => setNoteContent(e.target.value)}
                onBlur={handleSaveNote}
                placeholder={t('notes.editor_placeholder')}
              />
            </div>

            {/* Sync live preview panel */}
            {isEditMode && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, backgroundColor: 'var(--bg-app)' }}>
                <div style={{ height: '42px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', padding: '0 12px', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 'bold' }}>
                  {t('notes.live_preview')}
                </div>
                <div 
                  id="markdown-preview"
                  className="preview-md" 
                  style={{ flexGrow: 1, overflowY: 'auto', padding: '16px' }}
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(noteContent) }}
                />
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>
            {t('notes.no_note_selected')}
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Search, Trash2, Type, Image, Video, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import { useAppStore } from '../../store/useAppStore'

export type AIModelCatalogItem = {
  id: number
  name: string
  category: string
  capabilities: Array<'text' | 'image' | 'video'>
  createdAt: string
  updatedAt: string
}

type Props = { onChanged: () => void | Promise<void> }
type ModelCapability = AIModelCatalogItem['capabilities'][number]
type ModelDraft = { name: string; category: string; capabilities: ModelCapability[] }

const CAPABILITY_ICONS = { text: Type, image: Image, video: Video } as const
const CATEGORY_SUGGESTIONS = ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek', 'qwen', 'other']

function errorMessage(response: any, fallback: string) {
  return response?.error?.message || fallback
}

export function ModelManager({ onChanged }: Props) {
  const { t } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
  const api = (window as any).electronAPI
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const [models, setModels] = useState<AIModelCatalogItem[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ModelCapability | ''>('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [editing, setEditing] = useState<AIModelCatalogItem | null>(null)
  const [draft, setDraft] = useState<ModelDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!api?.listAIModels) return
    setBusy(true)
    const response = await api.listAIModels()
    setBusy(false)
    if (!response?.success) {
      setError(errorMessage(response, t('aiChat.models.load_failed')))
      return
    }
    setModels((response.data ?? []).map((model: AIModelCatalogItem) => ({
      ...model,
      category: typeof model.category === 'string' && model.category.trim() ? model.category : 'other',
    })))
    setError('')
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return models.filter((model) => (!filter || model.capabilities.includes(filter))
      && (!categoryFilter || model.category === categoryFilter)
      && (!query || model.name.toLocaleLowerCase().includes(query)))
  }, [categoryFilter, filter, models, search])
  const categories = useMemo(
    () => [...new Set(models.map((model) => model.category))].sort((left, right) => left.localeCompare(right)),
    [models],
  )

  const openCreate = (trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setEditing(null)
    setDraft({ name: '', category: categoryFilter || 'other', capabilities: [filter || 'text'] })
    setError('')
  }

  const openEdit = (model: AIModelCatalogItem, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setEditing(model)
    setDraft({ name: model.name, category: model.category, capabilities: [...model.capabilities] })
    setError('')
  }

  const closeEditor = () => {
    setDraft(null)
    setEditing(null)
  }

  const handleDrawerClose = () => closeEditor()

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const response = editing
        ? await api.updateAIModel(editing.id, draft)
        : await api.createAIModel(draft)
      if (!response?.success) throw new Error(errorMessage(response, t('aiChat.models.save_failed')))
      const synced = await api.syncAIModels?.()
      if (synced && !synced.success) throw new Error(errorMessage(synced, t('aiChat.models.sync_failed')))
      setDraft(null)
      setEditing(null)
      showToast(t(editing ? 'aiChat.models.updated' : 'aiChat.models.created'))
      await load()
      await onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('aiChat.models.save_failed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (model: AIModelCatalogItem) => {
    if (!window.confirm(t('aiChat.models.delete_confirm', { model: model.name }))) return
    setBusy(true)
    setError('')
    try {
      const response = await api.deleteAIModel(model.id)
      if (!response?.success) throw new Error(errorMessage(response, t('aiChat.models.delete_failed')))
      showToast(t('aiChat.models.deleted'))
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('aiChat.models.delete_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-model-manager" aria-busy={busy}>
      <div className="ai-model-toolbar">
        <label><Search size={14} aria-hidden="true" /><span className="sr-only">{t('aiChat.models.search_label')}</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('aiChat.models.search_placeholder')} />
        </label>
        <select className="form-field" value={filter} onChange={(event) => setFilter(event.target.value as ModelCapability | '')} aria-label={t('aiChat.models.capability_filter')}>
          <option value="">{t('aiChat.models.all_models')}</option>
          {(['text', 'image', 'video'] as const).map((capability) => <option key={capability} value={capability}>{t(`aiChat.models.capability_${capability}`)}</option>)}
        </select>
        <select className="form-field" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label={t('aiChat.models.category_filter')}>
          <option value="">{t('aiChat.models.all_categories')}</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <button className="btn primary ai-model-toolbar__add" onClick={(event) => openCreate(event.currentTarget)}>
          <Plus size={15} aria-hidden="true" />{t('aiChat.models.add')}
        </button>
      </div>
      {error && <p className="ai-provider-error" role="alert">{error}</p>}

      <div className="ai-model-list" role="list" aria-label={t('aiChat.models.all_models')}>
        {!busy && filtered.length === 0 && <div className="ai-provider-empty"><Type size={24} aria-hidden="true" />
          <h2>{t('aiChat.models.empty_title')}</h2><p>{t('aiChat.models.empty_desc')}</p></div>}
        {filtered.map((model) => {
          return <article className="ai-model-card" key={model.id} role="listitem">
            <div className="ai-model-card__body">
              <div className="ai-model-card__title"><h3>{model.name}</h3><span className="ai-model-card__category">{model.category}</span></div>
              <div className="ai-model-card__capabilities">{model.capabilities.map((capability) => { const Icon = CAPABILITY_ICONS[capability]; return <span key={capability}><Icon size={12} aria-hidden="true" />{t(`aiChat.models.capability_${capability}`)}</span> })}</div>
            </div>
            <div className="ai-model-card__actions">
              <button className="ai-chat-icon-button" onClick={(event) => openEdit(model, event.currentTarget)} aria-label={t('aiChat.models.edit_name', { model: model.name })}><Pencil size={14} /></button>
              <button className="ai-chat-icon-button is-danger" onClick={() => void remove(model)} aria-label={t('aiChat.models.delete_name', { model: model.name })}><Trash2 size={14} /></button>
            </div>
          </article>
        })}
      </div>

      {draft && <AccessibleDialog
        title={<span className="ai-settings-drawer__title"><span>{t(editing ? 'aiChat.models.edit_title' : 'aiChat.models.add_title')}</span><button type="button" onClick={handleDrawerClose} aria-label={t('common.close')}><X size={16} /></button></span>}
        onClose={closeEditor} returnFocus={() => triggerRef.current?.focus()} initialFocusRef={nameRef}
        overlayClassName="ai-settings-drawer-overlay" contentClassName="ai-settings-drawer ai-settings-drawer--model" closeOnOverlay
      >
        <div className="ai-model-form">
          <label className="ai-model-form__field"><span>{t('aiChat.models.model_id')}</span><input ref={nameRef} className="form-field" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t('aiChat.models.model_placeholder')} /></label>
          <label className="ai-model-form__field"><span>{t('aiChat.models.category')}</span><input className="form-field" list="ai-model-category-suggestions" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder={t('aiChat.models.category_placeholder')} /><datalist id="ai-model-category-suggestions">{CATEGORY_SUGGESTIONS.map((category) => <option key={category} value={category} />)}</datalist></label>
          <fieldset className="ai-model-form__section"><legend>{t('aiChat.models.capability')}</legend><p className="ai-model-form__section-hint">{t('aiChat.models.capability_hint')}</p><div className="ai-model-form__capabilities">
            {(['text', 'image', 'video'] as const).map((capability) => { const Icon = CAPABILITY_ICONS[capability]; const selected = draft.capabilities.includes(capability); return <label key={capability} className={selected ? 'is-selected' : ''}>
              <input type="checkbox" value={capability} checked={selected} onChange={() => setDraft({ ...draft, capabilities: selected ? draft.capabilities.filter((item) => item !== capability) : [...draft.capabilities, capability] })} /><Icon size={15} /><span>{t(`aiChat.models.capability_${capability}`)}</span>
            </label> })}
          </div></fieldset>
          {error && <p className="ai-provider-error" role="alert">{error}</p>}
          <div className="ai-model-form__actions"><button className="btn" onClick={closeEditor}>{t('common.cancel')}</button><button className="btn primary" disabled={busy || !draft.name.trim() || draft.capabilities.length === 0} onClick={() => void save()}>{t('common.save')}</button></div>
        </div>
      </AccessibleDialog>}
    </div>
  )
}

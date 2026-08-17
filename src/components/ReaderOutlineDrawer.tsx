import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ListCollapse, LocateFixed, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ReaderOutlineNode = {
  id: string
  title: string
  level: number
  parentId?: string | null
  pageNumber?: number | null
  disabled?: boolean
}

export type ReaderOutlineStatus =
  'idle' | 'cached' | 'analyzing' | 'partial' | 'fallback' | 'ready' | 'failed'

export type ReaderOutlineTreeModel = {
  nodes: ReaderOutlineNode[]
  roots: ReaderOutlineNode[]
  childrenByParent: Map<string, ReaderOutlineNode[]>
  parentById: Map<string, string | null>
}

export const buildReaderOutlineTree = (input: ReaderOutlineNode[]): ReaderOutlineTreeModel => {
  const nodes: ReaderOutlineNode[] = []
  const knownIds = new Set<string>()
  const parentById = new Map<string, string | null>()
  const childrenByParent = new Map<string, ReaderOutlineNode[]>()
  const levelStack: ReaderOutlineNode[] = []

  input.forEach((candidate, index) => {
    const id = String(candidate.id || `outline-${index}`).trim() || `outline-${index}`
    if (knownIds.has(id)) return
    const level = Math.max(0, Math.trunc(Number(candidate.level) || 0))
    while (levelStack.length > 0 && levelStack[levelStack.length - 1].level >= level) {
      levelStack.pop()
    }
    const explicitParentId = String(candidate.parentId || '').trim()
    const parentId =
      explicitParentId && knownIds.has(explicitParentId)
        ? explicitParentId
        : level > 0
          ? levelStack[levelStack.length - 1]?.id || null
          : null
    const node = { ...candidate, id, level, parentId }
    nodes.push(node)
    knownIds.add(id)
    parentById.set(id, parentId)
    const siblings = childrenByParent.get(parentId || '') || []
    siblings.push(node)
    childrenByParent.set(parentId || '', siblings)
    levelStack.push(node)
  })

  return {
    nodes,
    roots: childrenByParent.get('') || [],
    childrenByParent,
    parentById,
  }
}

export const getReaderOutlineAncestorIds = (
  activeNodeId: string | null | undefined,
  parentById: Map<string, string | null>,
) => {
  const ancestors: string[] = []
  const visited = new Set<string>()
  let parentId = activeNodeId ? parentById.get(activeNodeId) || null : null
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    ancestors.unshift(parentId)
    parentId = parentById.get(parentId) || null
  }
  return ancestors
}

const readExpandedIds = (storageKey: string) => {
  if (!storageKey) return new Set<string>()
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

type OutlineBranchProps = {
  node: ReaderOutlineNode
  activeNodeId?: string | null
  childrenByParent: Map<string, ReaderOutlineNode[]>
  expandedIds: Set<string>
  expandLabel: string
  collapseLabel: string
  onSelect: (node: ReaderOutlineNode) => void
  onToggle: (nodeId: string) => void
}

const OutlineBranch = React.memo(function OutlineBranch({
  node,
  activeNodeId,
  childrenByParent,
  expandedIds,
  expandLabel,
  collapseLabel,
  onSelect,
  onToggle,
}: OutlineBranchProps) {
  const children = childrenByParent.get(node.id) || []
  const hasChildren = children.length > 0
  const isExpanded = hasChildren && expandedIds.has(node.id)
  const isActive = node.id === activeNodeId

  return (
    <div
      className="reader-outline__branch"
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <div className={`reader-outline__row ${isActive ? 'is-active' : ''}`}>
        {hasChildren ? (
          <button
            type="button"
            className="reader-outline__toggle"
            aria-label={isExpanded ? collapseLabel : expandLabel}
            onClick={() => onToggle(node.id)}
          >
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        ) : (
          <span className="reader-outline__toggle-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className="reader-outline__label"
          data-reader-outline-id={node.id}
          data-pdf-toc-page={node.pageNumber ?? undefined}
          aria-current={isActive ? 'location' : undefined}
          disabled={node.disabled}
          title={node.title}
          onClick={() => onSelect(node)}
        >
          <span>{node.title}</span>
          {node.pageNumber ? <small>{node.pageNumber}</small> : null}
        </button>
      </div>
      {isExpanded ? (
        <div className="reader-outline__children" role="group">
          {children.map((child) => (
            <OutlineBranch
              key={child.id}
              node={child}
              activeNodeId={activeNodeId}
              childrenByParent={childrenByParent}
              expandedIds={expandedIds}
              expandLabel={expandLabel}
              collapseLabel={collapseLabel}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
})

export const ReaderOutlineDrawer = React.memo(function ReaderOutlineDrawer({
  nodes,
  activeNodeId,
  storageKey,
  status = 'idle',
  statusMessage,
  progress = 0,
  onSelect,
  onRetry,
}: {
  nodes: ReaderOutlineNode[]
  activeNodeId?: string | null
  storageKey: string
  status?: ReaderOutlineStatus
  statusMessage?: string | null
  progress?: number
  onSelect: (node: ReaderOutlineNode) => void
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const treeRef = useRef<HTMLDivElement | null>(null)
  const model = useMemo(() => buildReaderOutlineTree(nodes), [nodes])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => readExpandedIds(storageKey))

  useEffect(() => {
    setExpandedIds(readExpandedIds(storageKey))
  }, [storageKey])

  const expandCurrentPath = useCallback(() => {
    const ancestors = getReaderOutlineAncestorIds(activeNodeId, model.parentById)
    setExpandedIds((current) => {
      if (ancestors.every((nodeId) => current.has(nodeId))) return current
      return new Set([...current, ...ancestors])
    })
  }, [activeNodeId, model.parentById])

  useEffect(() => {
    expandCurrentPath()
  }, [expandCurrentPath])

  useEffect(() => {
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...expandedIds]))
    } catch {
      // Expansion persistence is optional and must not interrupt reading.
    }
  }, [expandedIds, storageKey])

  useEffect(() => {
    if (!activeNodeId) return
    const frame = requestAnimationFrame(() => {
      const activeNode = Array.from(
        treeRef.current?.querySelectorAll<HTMLElement>('[data-reader-outline-id]') || [],
      ).find((element) => element.dataset.readerOutlineId === activeNodeId)
      activeNode?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeNodeId, expandedIds])

  const handleToggle = useCallback((nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)))
  const showStatus =
    status === 'cached' ||
    status === 'analyzing' ||
    status === 'partial' ||
    status === 'fallback' ||
    status === 'failed'
  const statusLabel =
    statusMessage ||
    (status === 'cached'
      ? t('books.outline_status_cached')
      : status === 'partial'
        ? t('books.outline_status_partial')
        : status === 'fallback'
          ? t('books.outline_status_fallback')
          : status === 'failed'
            ? t('books.outline_status_failed')
            : t('books.outline_status_analyzing', { progress: percent }))

  return (
    <section className="reader-outline" aria-label={t('books.toc_title')}>
      <div className="reader-outline__toolbar">
        <h4>{t('books.toc_title')}</h4>
        <div className="reader-outline__actions">
          <button
            type="button"
            className="reader-outline__action"
            title={t('books.outline_expand_current')}
            aria-label={t('books.outline_expand_current')}
            disabled={!activeNodeId}
            onClick={expandCurrentPath}
          >
            <LocateFixed size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="reader-outline__action"
            title={t('books.outline_collapse_all')}
            aria-label={t('books.outline_collapse_all')}
            onClick={() => setExpandedIds(new Set())}
          >
            <ListCollapse size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {showStatus ? (
        <div
          className={`reader-outline__status is-${status}`}
          role={status === 'failed' ? 'alert' : 'status'}
        >
          <span>{statusLabel}</span>
          {(status === 'analyzing' || status === 'partial') && (
            <progress max={100} value={percent} aria-label={statusLabel} />
          )}
          {(status === 'failed' || status === 'fallback') && onRetry ? (
            <button type="button" onClick={onRetry}>
              <RefreshCw size={13} aria-hidden="true" />
              {t('books.outline_retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      {model.roots.length > 0 ? (
        <div className="reader-outline__tree" role="tree" ref={treeRef}>
          {model.roots.map((node) => (
            <OutlineBranch
              key={node.id}
              node={node}
              activeNodeId={activeNodeId}
              childrenByParent={model.childrenByParent}
              expandedIds={expandedIds}
              expandLabel={t('books.outline_expand_node')}
              collapseLabel={t('books.outline_collapse_node')}
              onSelect={onSelect}
              onToggle={handleToggle}
            />
          ))}
        </div>
      ) : status !== 'analyzing' ? (
        <div className="reader-outline__empty">{t('books.no_toc')}</div>
      ) : null}
    </section>
  )
})

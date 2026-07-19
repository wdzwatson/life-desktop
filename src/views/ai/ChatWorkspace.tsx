import {
  Boxes,
  ChevronDown,
  Database,
  Download,
  Gauge,
  ImagePlus,
  MessageSquare,
  Send,
  Settings2,
  Square,
  TimerReset,
  TriangleAlert,
  Video,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  Fragment,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ConversationList } from './ConversationList'
import { ConversationDeleteDialog } from './ConversationDeleteDialog'
import { ConversationRenameDialog } from './ConversationRenameDialog'
import { MessageRenderer } from './MessageRenderer'
import { ToolApprovalDialog } from './ToolApprovalDialog'
import {
  applyAIChatRunEvent,
  buildAIConversationMarkdown,
  createAIConversationTitle,
  createOptimisticMediaMessages,
  createOptimisticRunMessages,
  getAIChatRetryText,
  getAIComposerIntent,
  loadAllAIChatMessages,
  mergeAIChatMessages,
  reduceAIChatRunState,
  shouldFollowAIChatScroll,
  sortAIConversations,
  type AIChatConversation,
  type AIChatMessage,
  type AIChatRunEvent,
  type AIChatRunState,
  type AIChatToolApproval,
} from './chatUtils'

export type AIChatModel = {
  id: number
  name: string
  description: string
  providerName: string
  textModel: string
  providers: { text: number; image?: number; video?: number }
  enabled: boolean
  isDefault: boolean
  configurationStatus: 'ready' | 'incomplete'
  issues: string[]
}

type ChatWorkspaceProps = {
  models: AIChatModel[]
  hasProvider: boolean
  onOpenSettings: () => void
  onOpenProviders: () => void
  onOpenModels: () => void
}

type ApiResponse<T> = { success: true; data: T } | { success: false; error?: { message?: string } }

type ModelSwitchMarker = {
  id: number
  conversationId: number
  afterMessageId: number | null
  fromAgentId: number
  fromProvider: string
  fromModel: string
  toAgentId: number
  toProvider: string
  toModel: string
  ready: boolean
  dirty: boolean
  saving: boolean
}

type ModelSwitchConversationEvent = {
  id: number
  conversationId: number
  eventType: 'model_switch'
  afterMessageId: number | null
  payload: Omit<ModelSwitchMarker, 'id' | 'conversationId' | 'afterMessageId' | 'ready' | 'dirty' | 'saving'>
  createdAt: string
}

function isTerminalRun(status: AIChatRunState['status'] | undefined) {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

function normalizeRunStatus(value: unknown): AIChatRunState['status'] {
  if (value === 'completed' || value === 'failed' || value === 'cancelled' || value === 'interrupted') {
    return value
  }
  return 'running'
}

function errorMessage(response: unknown, fallback: string) {
  if (response && typeof response === 'object' && 'error' in response) {
    const error = (response as { error?: { message?: unknown } }).error
    if (typeof error?.message === 'string' && error.message) return error.message
  }
  return fallback
}

export function ChatWorkspace({ models, hasProvider, onOpenSettings, onOpenProviders, onOpenModels }: ChatWorkspaceProps) {
  const { t, i18n } = useTranslation()
  const api = (window as any).electronAPI
  const readyModels = useMemo(
    () => models.filter((model) => model.enabled && model.configurationStatus === 'ready'),
    [models],
  )
  const providerOptions = useMemo(() => {
    const providers = new Map<number, { id: number; name: string; models: AIChatModel[] }>()
    for (const model of readyModels) {
      const providerId = model.providers.text
      const provider = providers.get(providerId)
      if (provider) provider.models.push(model)
      else providers.set(providerId, { id: providerId, name: model.providerName, models: [model] })
    }
    return [...providers.values()]
  }, [readyModels])
  const defaultAgentId = readyModels.find((model) => model.isDefault)?.id ?? readyModels[0]?.id ?? null
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(defaultAgentId)
  const [conversations, setConversations] = useState<AIChatConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<AIChatMessage[]>([])
  const [runStates, setRunStates] = useState<Record<number, AIChatRunState>>({})
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [toolApprovals, setToolApprovals] = useState<Record<string, AIChatToolApproval>>({})
  const [submittingApproval, setSubmittingApproval] = useState(false)
  const [deletingConversation, setDeletingConversation] = useState<AIChatConversation | null>(null)
  const [deletingConversationBusy, setDeletingConversationBusy] = useState(false)
  const [renamingConversation, setRenamingConversation] = useState<AIChatConversation | null>(null)
  const [renamingConversationBusy, setRenamingConversationBusy] = useState(false)
  const [exportingConversation, setExportingConversation] = useState(false)
  const [imageMode, setImageMode] = useState(false)
  const [videoMode, setVideoMode] = useState(false)
  const [activeMediaGeneration, setActiveMediaGeneration] = useState<{
    conversationId: number
    mediaType: 'image' | 'video'
  } | null>(null)
  const [runAnnouncement, setRunAnnouncement] = useState('')
  const [showRunInspector, setShowRunInspector] = useState(false)
  const [modelSwitchMarkers, setModelSwitchMarkers] = useState<ModelSwitchMarker[]>([])
  const activeConversationRef = useRef<number | null>(null)
  const messagesRef = useRef<AIChatMessage[]>([])
  const lastSequenceRef = useRef(new Map<string, number>())
  const pendingRunEventsRef = useRef<AIChatRunEvent[]>([])
  const runEventFlushTimerRef = useRef<number | null>(null)
  const conversationRequestRef = useRef(0)
  const messageRequestRef = useRef(0)
  const conversationEventRequestRef = useRef(0)
  const timelineRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runInspectorToggleRef = useRef<HTMLButtonElement>(null)
  const conversationActionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const followOutputRef = useRef(true)
  const mediaCancellationRequestedRef = useRef(false)
  const modelSwitchMarkerIdRef = useRef(0)
  const modelSwitchSavingRef = useRef(new Set<string>())

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  )
  const activeRun = activeConversationId ? runStates[activeConversationId] : undefined
  const isRunning = activeRun?.status === 'running'
  const isMediaRunning = activeMediaGeneration !== null
  const activeModel = readyModels.find((model) => model.id === selectedAgentId)
  const selectedProviderId = activeModel?.providers.text ?? providerOptions[0]?.id ?? null
  const providerModels = providerOptions.find((provider) => provider.id === selectedProviderId)?.models ?? []
  const chatReady = hasProvider && readyModels.length > 0
  const visibleModelSwitchMarkers = useMemo(
    () => modelSwitchMarkers.filter((marker) => marker.conversationId === activeConversationId && marker.ready),
    [activeConversationId, modelSwitchMarkers],
  )
  const modelSwitchMarkersByMessage = useMemo(() => {
    const grouped = new Map<number, ModelSwitchMarker[]>()
    for (const marker of visibleModelSwitchMarkers) {
      if (marker.afterMessageId === null) continue
      const current = grouped.get(marker.afterMessageId) ?? []
      current.push(marker)
      grouped.set(marker.afterMessageId, current)
    }
    return grouped
  }, [visibleModelSwitchMarkers])
  const trailingModelSwitchMarkers = useMemo(() => {
    const messageIds = new Set(messages.map((message) => message.id))
    const latestMessageId = messages.at(-1)?.id ?? null
    return visibleModelSwitchMarkers.filter(
      (marker) => marker.afterMessageId === null || (
        latestMessageId !== null
        && marker.afterMessageId > latestMessageId
        && !messageIds.has(marker.afterMessageId)
      ),
    )
  }, [messages, visibleModelSwitchMarkers])

  const closeRunInspector = useCallback(() => {
    setShowRunInspector(false)
    requestAnimationFrame(() => runInspectorToggleRef.current?.focus())
  }, [])

  useEffect(() => {
    activeConversationRef.current = activeConversationId
  }, [activeConversationId])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (!showRunInspector) return

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      closeRunInspector()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [closeRunInspector, showRunInspector])

  useEffect(() => {
    const status = activeRun?.status
    if (!status) {
      setRunAnnouncement('')
      return
    }
    const timer = window.setTimeout(() => {
      setRunAnnouncement(t(`aiChat.chat.announcement_${status}`))
    }, 240)
    return () => window.clearTimeout(timer)
  }, [activeRun?.runId, activeRun?.status, t])

  useEffect(() => {
    if (selectedAgentId && readyModels.some((model) => model.id === selectedAgentId)) return
    setSelectedAgentId(defaultAgentId)
  }, [defaultAgentId, readyModels, selectedAgentId])

  const loadConversations = useCallback(async () => {
    if (!api?.listAIConversations) return
    const requestId = ++conversationRequestRef.current
    setLoadingConversations(true)
    const response = (await api.listAIConversations({
      search,
      archived: showArchived,
      limit: 200,
    })) as ApiResponse<AIChatConversation[]>
    if (requestId !== conversationRequestRef.current) return
    if (!response?.success) {
      setNotice(errorMessage(response, t('aiChat.chat.load_failed')))
      setLoadingConversations(false)
      return
    }
    const ordered = sortAIConversations(response.data ?? [])
    setConversations(ordered)
    setActiveConversationId((current) =>
      current && ordered.some((conversation) => conversation.id === current)
        ? current
        : ordered[0]?.id ?? null,
    )
    setLoadingConversations(false)
  }, [api, search, showArchived, t])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 140)
    return () => window.clearTimeout(timer)
  }, [loadConversations])

  const loadMessages = useCallback(
    async (conversationId: number, mode: 'replace' | 'prepend' = 'replace') => {
      if (!api?.listAIConversationMessages) return
      const beforeId = mode === 'prepend' ? messagesRef.current[0]?.id : undefined
      if (mode === 'prepend' && !beforeId) return
      const timeline = timelineRef.current
      const previousHeight = timeline?.scrollHeight ?? 0
      const requestId = ++messageRequestRef.current
      setLoadingMessages(true)
      const response = (await api.listAIConversationMessages(conversationId, {
        ...(beforeId ? { beforeId } : {}),
        limit: 50,
      })) as ApiResponse<AIChatMessage[]>
      if (requestId !== messageRequestRef.current) return
      if (!response?.success) {
        setNotice(errorMessage(response, t('aiChat.chat.messages_load_failed')))
        setLoadingMessages(false)
        return
      }
      if (activeConversationRef.current !== conversationId) {
        setLoadingMessages(false)
        return
      }
      setMessages((current) => mergeAIChatMessages(current, response.data ?? [], mode))
      setHasOlderMessages((response.data?.length ?? 0) === 50)
      setLoadingMessages(false)
      if (mode === 'prepend') {
        window.requestAnimationFrame(() => {
          const currentTimeline = timelineRef.current
          if (currentTimeline) currentTimeline.scrollTop += currentTimeline.scrollHeight - previousHeight
        })
      } else {
        followOutputRef.current = true
      }
    },
    [api, t],
  )

  const loadConversationEvents = useCallback(async (conversationId: number) => {
    if (!api?.listAIConversationEvents) return
    const requestId = ++conversationEventRequestRef.current
    const response = (await api.listAIConversationEvents(conversationId)) as ApiResponse<ModelSwitchConversationEvent[]>
    if (requestId !== conversationEventRequestRef.current || activeConversationRef.current !== conversationId) return
    if (!response?.success) {
      setNotice(errorMessage(response, t('aiChat.chat.messages_load_failed')))
      return
    }
    const persisted = (response.data ?? [])
      .filter((event) => event.eventType === 'model_switch')
      .map<ModelSwitchMarker>((event) => ({
        id: event.id,
        conversationId: event.conversationId,
        afterMessageId: event.afterMessageId,
        ...event.payload,
        ready: true,
        dirty: false,
        saving: false,
      }))
    const latestTargetAgentId = persisted.at(-1)?.toAgentId
    if (latestTargetAgentId && readyModels.some((model) => model.id === latestTargetAgentId)) {
      setSelectedAgentId(latestTargetAgentId)
    }
    setModelSwitchMarkers((current) => {
      const local = current.filter((marker) =>
        marker.conversationId === conversationId && (marker.id < 0 || marker.dirty || marker.saving),
      )
      const localAnchors = new Set(local.map((marker) => marker.afterMessageId ?? 0))
      return [
        ...current.filter((marker) => marker.conversationId !== conversationId),
        ...persisted.filter((marker) => !localAnchors.has(marker.afterMessageId ?? 0)),
        ...local,
      ]
    })
  }, [api, readyModels, t])

  useEffect(() => {
    setMessages([])
    setHasOlderMessages(false)
    if (!activeConversationId) return
    void loadMessages(activeConversationId)
    void loadConversationEvents(activeConversationId)
    if (api?.listAIConversationRuns) {
      void api.listAIConversationRuns(activeConversationId, 1).then((response: ApiResponse<any[]>) => {
        if (!response?.success || activeConversationRef.current !== activeConversationId) return
        const latest = response.data?.[0]
        if (!latest) return
        setRunStates((current) => ({
          ...current,
          [activeConversationId]: {
            conversationId: activeConversationId,
            runId: latest.id,
            messageId: latest.assistantMessageId ?? 0,
            status: normalizeRunStatus(latest.status),
            sequence: current[activeConversationId]?.sequence ?? 0,
            startedAt: latest.startedAt ?? latest.createdAt,
            updatedAt: latest.completedAt ?? latest.lastActivityAt ?? latest.createdAt,
            usage: latest.usage ?? {},
            ...(latest.error?.code
              ? { error: { code: latest.error.code, message: latest.error.message ?? '', retryable: false } }
              : {}),
          },
        }))
      })
    }
  }, [activeConversationId, api, loadConversationEvents, loadMessages])

  const flushRunEvents = useCallback(() => {
    if (runEventFlushTimerRef.current !== null) {
      window.clearTimeout(runEventFlushTimerRef.current)
      runEventFlushTimerRef.current = null
    }
    const batch = pendingRunEventsRef.current.splice(0)
    if (batch.length === 0) return
    setRunStates((current) => {
      const next = { ...current }
      for (const event of batch) {
        next[event.conversationId] = reduceAIChatRunState(next[event.conversationId], event)
      }
      return next
    })
    const activeId = activeConversationRef.current
    if (activeId !== null) {
      setMessages((current) =>
        batch
          .filter((event) => event.conversationId === activeId)
          .reduce((next, event) => applyAIChatRunEvent(next, event), current),
      )
    }
  }, [])

  useEffect(() => {
    if (!api?.onAIRunEvent) return
    return api.onAIRunEvent((value: unknown) => {
      if (!value || typeof value !== 'object') return
      const event = value as AIChatRunEvent
      if (
        !Number.isInteger(event.conversationId) ||
        !Number.isInteger(event.runId) ||
        !Number.isInteger(event.messageId) ||
        !Number.isInteger(event.sequence)
      ) {
        return
      }
      const key = `${event.conversationId}:${event.runId}`
      const previousSequence = lastSequenceRef.current.get(key) ?? 0
      if (event.sequence <= previousSequence) return
      lastSequenceRef.current.set(key, event.sequence)
      pendingRunEventsRef.current.push(event)
      if (event.type === 'approval_required' && event.toolCallId && event.serverId && event.serverName && event.toolName && event.risk) {
        setToolApprovals((current) => ({
          ...current,
          [`${event.runId}:${event.toolCallId}`]: {
            conversationId: event.conversationId,
            runId: event.runId,
            messageId: event.messageId,
            toolCallId: event.toolCallId as string,
            serverId: event.serverId as number,
            serverName: event.serverName as string,
            toolName: event.toolName as string,
            risk: event.risk as AIChatToolApproval['risk'],
            argumentsSummary: event.argumentsSummary ?? '{}',
          },
        }))
      }
      if (['tool_running', 'tool_completed', 'tool_failed', 'tool_rejected'].includes(event.type) && event.toolCallId) {
        setToolApprovals((current) => {
          const key = `${event.runId}:${event.toolCallId}`
          if (!current[key]) return current
          const next = { ...current }
          delete next[key]
          return next
        })
      }
      const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(event.type)
      if (terminal) flushRunEvents()
      else if (runEventFlushTimerRef.current === null) {
        runEventFlushTimerRef.current = window.setTimeout(flushRunEvents, 32)
      }
      if (terminal) {
        setModelSwitchMarkers((current) => current.map((marker) =>
          marker.conversationId === event.conversationId && !marker.ready
            ? { ...marker, afterMessageId: marker.afterMessageId ?? event.messageId, ready: true }
            : marker,
        ))
        setToolApprovals((current) => Object.fromEntries(
          Object.entries(current).filter(([, approval]) => approval.runId !== event.runId),
        ))
        void loadConversations()
        if (activeConversationRef.current === event.conversationId) {
          window.setTimeout(() => void loadMessages(event.conversationId), 0)
        }
      }
    })
  }, [api, flushRunEvents, loadConversations, loadMessages])

  useEffect(
    () => () => {
      if (runEventFlushTimerRef.current !== null) window.clearTimeout(runEventFlushTimerRef.current)
      pendingRunEventsRef.current = []
    },
    [],
  )

  useEffect(() => {
    if (!followOutputRef.current) return
    window.requestAnimationFrame(() => {
      const timeline = timelineRef.current
      if (timeline) timeline.scrollTop = timeline.scrollHeight
    })
  }, [messages, visibleModelSwitchMarkers])

  useEffect(() => {
    if (activeConversationId === null || isRunning || isMediaRunning || submitting) return
    setModelSwitchMarkers((current) => current.map((marker) =>
      marker.conversationId === activeConversationId && !marker.ready ? { ...marker, ready: true } : marker,
    ))
  }, [activeConversationId, isMediaRunning, isRunning, submitting])

  useEffect(() => {
    if (!api?.upsertAIModelSwitchEvent) return
    const pending = modelSwitchMarkers.filter((marker) => marker.ready && marker.dirty && !marker.saving)
    for (const marker of pending) {
      const saveKey = `${marker.conversationId}:${marker.afterMessageId ?? 0}`
      if (modelSwitchSavingRef.current.has(saveKey)) continue
      modelSwitchSavingRef.current.add(saveKey)
      setModelSwitchMarkers((current) => current.map((item) =>
        item.id === marker.id ? { ...item, saving: true } : item,
      ))
      void api.upsertAIModelSwitchEvent({
        conversationId: marker.conversationId,
        afterMessageId: marker.afterMessageId,
        payload: {
          fromAgentId: marker.fromAgentId,
          fromProvider: marker.fromProvider,
          fromModel: marker.fromModel,
          toAgentId: marker.toAgentId,
          toProvider: marker.toProvider,
          toModel: marker.toModel,
        },
      }).then((response: ApiResponse<ModelSwitchConversationEvent>) => {
        modelSwitchSavingRef.current.delete(saveKey)
        if (!response?.success) {
          setModelSwitchMarkers((current) => current.map((item) =>
            item.id === marker.id ? { ...item, dirty: false, saving: false } : item,
          ))
          setNotice(errorMessage(response, t('aiChat.chat.messages_load_failed')))
          return
        }
        setModelSwitchMarkers((current) => current.map((item) => {
          if (item.id !== marker.id) return item
          const unchanged = item.toAgentId === marker.toAgentId
            && item.fromAgentId === marker.fromAgentId
            && item.afterMessageId === marker.afterMessageId
          return {
            ...item,
            id: response.data.id,
            dirty: unchanged ? false : item.dirty,
            saving: false,
          }
        }))
      })
    }
  }, [api, modelSwitchMarkers, t])

  const createConversation = async (agentId = selectedAgentId) => {
    if (!agentId || !api?.createAIConversation) {
      setNotice(t('aiChat.chat.model_required'))
      return null
    }
    const timestamp = new Intl.DateTimeFormat(i18n.language, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date())
    const response = (await api.createAIConversation(
      t('aiChat.chat.untitled_timestamp', { value: timestamp }),
      agentId,
    )) as ApiResponse<AIChatConversation>
    if (!response?.success) {
      setNotice(errorMessage(response, t('aiChat.chat.create_failed')))
      return null
    }
    setConversations((current) => sortAIConversations([response.data, ...current]))
    setSelectedAgentId(agentId)
    setActiveConversationId(response.data.id)
    setMessages([])
    setNotice(null)
    return response.data
  }

  const titleConversationFromPrompt = async (conversation: AIChatConversation, text: string) => {
    if (conversation.messageCount !== 0 || !api?.renameAIConversation) return conversation
    const title = createAIConversationTitle(text)
    if (!title) return conversation
    const renamed = (await api.renameAIConversation(conversation.id, title)) as ApiResponse<AIChatConversation>
    if (!renamed?.success) return conversation
    setConversations((current) =>
      sortAIConversations(current.map((item) => (item.id === renamed.data.id ? renamed.data : item))),
    )
    return renamed.data
  }

  const sendText = async (requestedText?: string) => {
    const text = (requestedText ?? draft).trim()
    if (!text || submitting || isRunning) return
    const sendMethodAvailable = imageMode
      ? Boolean(api?.generateAIImages)
      : videoMode
        ? Boolean(api?.generateAIVideos)
        : Boolean(api?.startAIRun)
    if (!sendMethodAvailable) return
    let conversation = activeConversation
    if (!conversation) conversation = await createConversation()
    if (!conversation) return
    conversation = await titleConversationFromPrompt(conversation, text)
    const agentId = selectedAgentId
    if (!agentId) {
      setNotice(t('aiChat.chat.model_required'))
      return
    }
    if (imageMode) {
      if (!activeModel?.providers.image || !api?.generateAIImages) {
        setNotice(t('aiChat.images.provider_required'))
        return
      }
      setSubmitting(true)
      setActiveMediaGeneration({ conversationId: conversation.id, mediaType: 'image' })
      mediaCancellationRequestedRef.current = false
      setNotice(null)
      const optimisticTime = new Date().toISOString()
      if (activeConversationRef.current === conversation.id) {
        setMessages((current) => mergeAIChatMessages(current, createOptimisticMediaMessages({
          conversationId: conversation.id,
          mediaType: 'image',
          text,
          timestamp: optimisticTime,
          temporaryUserId: -Date.now(),
        }), 'append'))
      }
      if (!requestedText) setDraft('')
      followOutputRef.current = true
      const imageResponse = await api.generateAIImages({
        conversationId: conversation.id,
        agentId,
        prompt: text,
        count: 1,
      })
      setSubmitting(false)
      setActiveMediaGeneration(null)
      if (!imageResponse?.success) {
        setNotice(mediaCancellationRequestedRef.current
          ? t('aiChat.media.cancelled')
          : errorMessage(imageResponse, t('aiChat.images.generate_failed')))
        mediaCancellationRequestedRef.current = false
        await loadMessages(conversation.id)
        return
      }
      mediaCancellationRequestedRef.current = false
      followOutputRef.current = true
      await loadMessages(conversation.id)
      void loadConversations()
      return
    }
    if (videoMode) {
      if (!activeModel?.providers.video || !api?.generateAIVideos) {
        setNotice(t('aiChat.videos.provider_required'))
        return
      }
      setSubmitting(true)
      setActiveMediaGeneration({ conversationId: conversation.id, mediaType: 'video' })
      mediaCancellationRequestedRef.current = false
      setNotice(null)
      const optimisticTime = new Date().toISOString()
      const optimisticUserId = -Date.now()
      if (activeConversationRef.current === conversation.id) {
        setMessages((current) => mergeAIChatMessages(current, createOptimisticMediaMessages({
          conversationId: conversation.id,
          mediaType: 'video',
          text,
          timestamp: optimisticTime,
          temporaryUserId: optimisticUserId,
        }), 'append'))
      }
      if (!requestedText) setDraft('')
      followOutputRef.current = true
      const videoResponse = await api.generateAIVideos({
        conversationId: conversation.id,
        agentId,
        prompt: text,
      })
      setSubmitting(false)
      setActiveMediaGeneration(null)
      if (!videoResponse?.success) {
        setNotice(mediaCancellationRequestedRef.current
          ? t('aiChat.media.cancelled')
          : errorMessage(videoResponse, t('aiChat.videos.generate_failed')))
        mediaCancellationRequestedRef.current = false
        await loadMessages(conversation.id)
        return
      }
      mediaCancellationRequestedRef.current = false
      followOutputRef.current = true
      await loadMessages(conversation.id)
      void loadConversations()
      return
    }
    setSubmitting(true)
    setNotice(null)
    const response = (await api.startAIRun({
      conversationId: conversation.id,
      agentId,
      text,
      attachmentAssetIds: [],
    })) as ApiResponse<{
      conversationId: number
      runId: number
      triggerMessageId: number
      messageId: number
      status: 'running'
    }>
    setSubmitting(false)
    if (!response?.success) {
      setNotice(errorMessage(response, t('aiChat.chat.send_failed')))
      return
    }
    const now = new Date().toISOString()
    if (activeConversationRef.current === conversation.id) {
      setMessages((current) =>
        mergeAIChatMessages(
          current,
          createOptimisticRunMessages({
            conversationId: conversation.id,
            triggerMessageId: response.data.triggerMessageId,
            messageId: response.data.messageId,
            text,
            timestamp: now,
          }),
          'append',
        ),
      )
    }
    setRunStates((current) =>
      current[conversation.id]?.runId === response.data.runId
        ? current
        : {
            ...current,
            [conversation.id]: {
              conversationId: conversation.id,
              runId: response.data.runId,
              messageId: response.data.messageId,
              status: 'running',
              sequence: 0,
              startedAt: now,
              updatedAt: now,
              usage: {},
            },
          },
    )
    if (!requestedText) setDraft('')
    followOutputRef.current = true
    void loadConversations()
  }

  const stopRun = async () => {
    if (!activeConversationId || !activeRun || !api?.cancelAIRun) return
    const response = await api.cancelAIRun(activeConversationId, activeRun.runId)
    if (!response?.success) setNotice(errorMessage(response, t('aiChat.chat.stop_failed')))
  }

  const stopCurrentWork = async () => {
    if (!activeMediaGeneration) {
      await stopRun()
      return
    }
    const cancel = activeMediaGeneration.mediaType === 'image'
      ? api?.cancelAIImageGeneration
      : api?.cancelAIVideoGeneration
    if (!cancel) {
      setNotice(t('aiChat.media.stop_failed'))
      return
    }
    mediaCancellationRequestedRef.current = true
    const response = await cancel(activeMediaGeneration.conversationId)
    if (!response?.success || !response.data?.cancelled) {
      mediaCancellationRequestedRef.current = false
      setNotice(errorMessage(response, t('aiChat.media.stop_failed')))
    }
  }

  const activeApproval = useMemo(
    () => Object.values(toolApprovals).find((approval) => approval.conversationId === activeConversationId) ?? null,
    [activeConversationId, toolApprovals],
  )

  const decideToolApproval = async (decision: 'approve_once' | 'approve_session' | 'reject') => {
    if (!activeApproval || !api?.approveAITool || submittingApproval) return
    setSubmittingApproval(true)
    const response = await api.approveAITool(activeApproval.runId, activeApproval.toolCallId, decision)
    setSubmittingApproval(false)
    if (!response?.success) {
      setNotice(errorMessage(response, t('aiChat.tools.approval_failed')))
      return
    }
    const key = `${activeApproval.runId}:${activeApproval.toolCallId}`
    setToolApprovals((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const intent = getAIComposerIntent({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    })
    if (intent !== 'send') return
    event.preventDefault()
    void sendText()
  }

  const handleModelChange = (agentId: number) => {
    const nextModel = readyModels.find((model) => model.id === agentId)
    const previousModel = activeModel
    setSelectedAgentId(agentId)
    if (!activeConversationId || !nextModel || !previousModel || previousModel.id === nextModel.id) return
    const roundActive = isRunning || isMediaRunning || submitting
    const afterMessageId = isRunning && activeRun?.messageId
      ? activeRun.messageId
      : roundActive
        ? null
        : messages.at(-1)?.id ?? null
    if (!roundActive && afterMessageId === null) return
    const nextMarker: ModelSwitchMarker = {
      id: --modelSwitchMarkerIdRef.current,
      conversationId: activeConversationId,
      afterMessageId,
      fromAgentId: previousModel.id,
      fromProvider: previousModel.providerName,
      fromModel: previousModel.textModel,
      toAgentId: nextModel.id,
      toProvider: nextModel.providerName,
      toModel: nextModel.textModel,
      ready: !roundActive,
      dirty: true,
      saving: false,
    }
    setModelSwitchMarkers((current) => {
      const latestIndex = current.findLastIndex((marker) => marker.conversationId === activeConversationId)
      const latest = latestIndex >= 0 ? current[latestIndex] : undefined
      if (latest && latest.afterMessageId === nextMarker.afterMessageId && latest.ready === nextMarker.ready) {
        if (latest.fromAgentId === nextMarker.toAgentId) {
          if (latest.ready && api?.deleteAIModelSwitchEvent) {
            void api.deleteAIModelSwitchEvent(latest.conversationId, latest.afterMessageId).then((response: ApiResponse<{ deleted: boolean }>) => {
              if (!response?.success) setNotice(errorMessage(response, t('aiChat.chat.messages_load_failed')))
            })
          }
          return current.filter((_, index) => index !== latestIndex)
        }
        return current.map((marker, index) => index === latestIndex ? {
          ...marker,
          toAgentId: nextMarker.toAgentId,
          toProvider: nextMarker.toProvider,
          toModel: nextMarker.toModel,
          dirty: true,
        } : marker)
      }
      return [...current, nextMarker]
    })
  }

  const handleProviderChange = (providerId: number) => {
    const provider = providerOptions.find((item) => item.id === providerId)
    const nextModel = provider?.models.find((model) => model.isDefault) ?? provider?.models[0]
    if (nextModel) handleModelChange(nextModel.id)
  }

  const confirmRenameConversation = async (title: string) => {
    if (!renamingConversation || renamingConversationBusy) return
    setRenamingConversationBusy(true)
    const response = (await api.renameAIConversation(renamingConversation.id, title)) as ApiResponse<AIChatConversation>
    setRenamingConversationBusy(false)
    if (!response?.success) {
      setNotice(errorMessage(response, t('aiChat.chat.rename_failed')))
      return
    }
    setRenamingConversation(null)
    void loadConversations()
  }

  const restoreConversationActionFocus = () => {
    const trigger = conversationActionTriggerRef.current
    if (trigger?.isConnected) trigger.focus()
    else textareaRef.current?.focus()
  }

  const togglePinned = async (conversation: AIChatConversation) => {
    const response = await api.setAIConversationPinned(conversation.id, !conversation.isPinned)
    if (!response?.success) setNotice(errorMessage(response, t('aiChat.chat.action_failed')))
    else void loadConversations()
  }

  const toggleArchived = async (conversation: AIChatConversation) => {
    const response = await api.setAIConversationArchived(conversation.id, !conversation.isArchived)
    if (!response?.success) setNotice(errorMessage(response, t('aiChat.chat.action_failed')))
    else void loadConversations()
  }

  const confirmDeleteConversation = async (deleteUnreferencedMedia: boolean) => {
    if (!deletingConversation || deletingConversationBusy) return
    setDeletingConversationBusy(true)
    const response = await api.deleteAIConversation(deletingConversation.id, deleteUnreferencedMedia)
    setDeletingConversationBusy(false)
    if (!response?.success) {
      setNotice(errorMessage(response, t('aiChat.chat.delete_failed')))
      return
    }
    setDeletingConversation(null)
    void loadConversations()
  }

  const exportConversation = async () => {
    if (!activeConversation || !api?.listAIConversationMessages || exportingConversation) return
    const conversation = activeConversation
    setExportingConversation(true)
    setNotice(null)
    let completeMessages: AIChatMessage[]
    try {
      completeMessages = await loadAllAIChatMessages(async (options) => {
        const response = (await api.listAIConversationMessages(conversation.id, options)) as ApiResponse<AIChatMessage[]>
        if (!response?.success) {
          throw new Error(errorMessage(response, t('aiChat.chat.export_failed')))
        }
        return response.data ?? []
      })
    } catch (error) {
      setExportingConversation(false)
      setNotice(error instanceof Error && error.message ? error.message : t('aiChat.chat.export_failed'))
      return
    }
    setExportingConversation(false)
    const markdown = buildAIConversationMarkdown(conversation.title, completeMessages)
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${conversation.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'ai-conversation'}.md`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setNotice(t('aiChat.chat.exported'))
  }

  const retryMessage = (message: AIChatMessage) => {
    const text = getAIChatRetryText(messages, message.id)
    if (text) void sendText(text)
  }

  return (
    <section className="ai-chat-workspace">
      <ConversationList
        conversations={conversations}
        activeId={activeConversationId}
        search={search}
        showArchived={showArchived}
        loading={loadingConversations}
        canCreate={chatReady}
        onSearchChange={setSearch}
        onShowArchivedChange={setShowArchived}
        onSelect={(conversation) => setActiveConversationId(conversation.id)}
        onCreate={() => void createConversation()}
        onRename={(conversation, trigger) => {
          conversationActionTriggerRef.current = trigger
          setRenamingConversation(conversation)
        }}
        onTogglePinned={(conversation) => void togglePinned(conversation)}
        onToggleArchived={(conversation) => void toggleArchived(conversation)}
        onDelete={(conversation, trigger) => {
          conversationActionTriggerRef.current = trigger
          setDeletingConversation(conversation)
        }}
      />

      <section className={`ai-chat-stage ${!chatReady ? 'has-setup' : ''}`} aria-label={t('aiChat.chat.workspace')}>
        <header className="ai-chat-stage__header">
          <div>
            <h2>{activeConversation?.title ?? t('aiChat.chat.start_title')}</h2>
            <p>{activeModel ? `${activeModel.providerName} · ${activeModel.textModel}` : t('aiChat.chat.start_desc')}</p>
          </div>
          <div className="ai-chat-stage__controls">
            <button
              className="ai-chat-stage__settings"
              onClick={onOpenSettings}
              aria-label={t('aiChat.settings')}
              title={t('aiChat.settings')}
            >
              <Settings2 size={14} aria-hidden="true" />
            </button>
            <label className="ai-chat-stage__selector ai-chat-stage__selector--provider">
              <Database size={14} aria-hidden="true" />
              <span className="sr-only">{t('aiChat.chat.select_provider')}</span>
              <select
                value={selectedProviderId ?? ''}
                disabled={providerOptions.length === 0}
                onChange={(event) => handleProviderChange(Number(event.target.value))}
                aria-label={t('aiChat.chat.select_provider')}
              >
                {providerOptions.length === 0 && <option value="">{t('aiChat.chat.no_provider_option')}</option>}
                {providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
            <label className="ai-chat-stage__selector ai-chat-stage__selector--model">
              <Boxes size={14} aria-hidden="true" />
              <span className="sr-only">{t('aiChat.chat.select_model')}</span>
              <select
                value={selectedAgentId ?? ''}
                disabled={providerModels.length === 0}
                onChange={(event) => handleModelChange(Number(event.target.value))}
                aria-label={t('aiChat.chat.select_model')}
              >
                {providerModels.length === 0 && <option value="">{t('aiChat.chat.no_model_option')}</option>}
                {providerModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
            <button
              className="ai-chat-stage__export"
              onClick={() => void exportConversation()}
              disabled={!activeConversation || messages.length === 0 || exportingConversation}
            >
              <Download size={13} aria-hidden="true" />
              {t(exportingConversation ? 'aiChat.chat.exporting' : 'aiChat.chat.export')}
            </button>
            <button
              ref={runInspectorToggleRef}
              className="ai-run-inspector-toggle"
              onClick={() => setShowRunInspector((value) => !value)}
              aria-expanded={showRunInspector}
              aria-controls="ai-run-inspector"
            >
              <Gauge size={13} aria-hidden="true" />
              {t('aiChat.chat.run_inspector_short')}
            </button>
          </div>
        </header>

        {!chatReady && (
          <div className="ai-chat-setup-banner" role="status">
            {hasProvider ? <Boxes size={16} aria-hidden="true" /> : <Database size={16} aria-hidden="true" />}
            <div>
              <strong>{t(hasProvider ? 'aiChat.chat.setup_model_title' : 'aiChat.chat.setup_provider_title')}</strong>
              <span>{t(hasProvider ? 'aiChat.chat.setup_model_desc' : 'aiChat.chat.setup_provider_desc')}</span>
            </div>
            <button className="btn primary" onClick={hasProvider ? onOpenModels : onOpenProviders}>
              {t(hasProvider ? 'aiChat.chat.configure_model' : 'aiChat.chat.connect_provider')}
            </button>
          </div>
        )}

        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {runAnnouncement}
        </div>

        <div
          className="ai-message-timeline"
          ref={timelineRef}
          onScroll={(event) => {
            followOutputRef.current = shouldFollowAIChatScroll(event.currentTarget)
          }}
          aria-busy={loadingMessages}
        >
          {hasOlderMessages && messages.length > 0 && (
            <button
              className="ai-message-load-older"
              onClick={() => activeConversationId && void loadMessages(activeConversationId, 'prepend')}
              disabled={loadingMessages}
            >
              {t('aiChat.chat.load_older')}
            </button>
          )}
          {!activeConversation && chatReady && (
            <div className="ai-chat-welcome">
              <div className="ai-chat-welcome__visual" aria-hidden="true">
                <MessageSquare size={30} />
              </div>
              <h2>{t('aiChat.chat.welcome_title')}</h2>
              <p>{t('aiChat.chat.welcome_desc')}</p>
              <div className="ai-chat-suggestions">
                {(['one', 'two', 'three'] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      setDraft(t(`aiChat.chat.suggestion_${key}`))
                      textareaRef.current?.focus()
                    }}
                  >
                    {t(`aiChat.chat.suggestion_${key}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!activeConversation && !chatReady && (
            <div className="ai-chat-welcome ai-chat-welcome--setup">
              <div className="ai-chat-welcome__visual" aria-hidden="true">
                {hasProvider ? <Boxes size={30} /> : <Database size={30} />}
              </div>
              <h2>{t(hasProvider ? 'aiChat.chat.setup_model_title' : 'aiChat.chat.setup_provider_title')}</h2>
              <p>{t(hasProvider ? 'aiChat.chat.setup_model_desc' : 'aiChat.chat.setup_provider_desc')}</p>
              <button className="btn primary" onClick={hasProvider ? onOpenModels : onOpenProviders}>
                {t(hasProvider ? 'aiChat.chat.configure_model' : 'aiChat.chat.connect_provider')}
              </button>
            </div>
          )}
          {activeConversation && messages.length === 0 && !loadingMessages && (
            <div className="ai-chat-welcome ai-chat-welcome--compact">
              <h2>{t('aiChat.chat.empty_conversation_title')}</h2>
              <p>{t('aiChat.chat.empty_conversation_desc', { model: activeModel?.name })}</p>
            </div>
          )}
          {messages.map((message) => (
            <Fragment key={message.id}>
              <MessageRenderer
                message={message}
                onRetry={retryMessage}
                retryDisabled={isRunning || submitting}
              />
              {(modelSwitchMarkersByMessage.get(message.id) ?? []).map((marker) => (
                <div className="ai-model-switch-divider" role="separator" key={marker.id}>
                  <span>{t(marker.fromProvider === marker.toProvider
                    ? 'aiChat.chat.model_switch_same_provider'
                    : 'aiChat.chat.model_switch_provider', marker.fromProvider === marker.toProvider ? {
                      provider: marker.toProvider,
                      fromModel: marker.fromModel,
                      toModel: marker.toModel,
                    } : {
                      fromProvider: marker.fromProvider,
                      toProvider: marker.toProvider,
                      fromModel: marker.fromModel,
                      toModel: marker.toModel,
                    })}</span>
                </div>
              ))}
            </Fragment>
          ))}
          {trailingModelSwitchMarkers.map((marker) => (
            <div className="ai-model-switch-divider" role="separator" key={marker.id}>
              <span>{t(marker.fromProvider === marker.toProvider
                ? 'aiChat.chat.model_switch_same_provider'
                : 'aiChat.chat.model_switch_provider', marker.fromProvider === marker.toProvider ? {
                  provider: marker.toProvider,
                  fromModel: marker.fromModel,
                  toModel: marker.toModel,
                } : {
                  fromProvider: marker.fromProvider,
                  toProvider: marker.toProvider,
                  fromModel: marker.fromModel,
                  toModel: marker.toModel,
                })}</span>
            </div>
          ))}
        </div>

        {notice && (
          <div className="ai-chat-notice" role="status">
            <TriangleAlert size={13} aria-hidden="true" />
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label={t('common.close')}>×</button>
          </div>
        )}

        <div className="ai-chat-composer">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={!chatReady
              ? t('aiChat.chat.setup_composer_placeholder')
              : imageMode
                ? t('aiChat.images.composer_placeholder')
                : videoMode
                  ? t('aiChat.videos.composer_placeholder')
                  : t('aiChat.chat.composer_placeholder')}
            aria-label={t('aiChat.chat.composer_label')}
            disabled={submitting || !chatReady}
            rows={2}
          />
          <div className="ai-chat-composer__footer">
            <div className="ai-chat-composer__mode">
              <button
                className={imageMode ? 'is-active' : ''}
                onClick={() => {
                  if (!activeModel?.providers.image) {
                    setNotice(t('aiChat.images.provider_required_action'))
                    return
                  }
                  if (!api?.generateAIImages) {
                    setNotice(t('aiChat.images.feature_unavailable'))
                    return
                  }
                  setImageMode((value) => !value)
                  setVideoMode(false)
                }}
                disabled={submitting || isRunning}
                aria-pressed={imageMode}
                title={activeModel?.providers.image ? t('aiChat.images.toggle') : t('aiChat.images.provider_required')}
              >
                <ImagePlus size={13} aria-hidden="true" />
                {t(imageMode ? 'aiChat.images.mode_active' : 'aiChat.images.mode')}
              </button>
              <button
                className={videoMode ? 'is-active' : ''}
                onClick={() => {
                  if (!activeModel?.providers.video) {
                    setNotice(t('aiChat.videos.provider_required_action'))
                    return
                  }
                  if (!api?.generateAIVideos) {
                    setNotice(t('aiChat.videos.feature_unavailable'))
                    return
                  }
                  setVideoMode((value) => !value)
                  setImageMode(false)
                }}
                disabled={submitting || isRunning}
                aria-pressed={videoMode}
                title={activeModel?.providers.video ? t('aiChat.videos.toggle') : t('aiChat.videos.provider_required')}
              >
                <Video size={13} aria-hidden="true" />
                {t(videoMode ? 'aiChat.videos.mode_active' : 'aiChat.videos.mode')}
              </button>
              <span>{t(imageMode ? 'aiChat.images.composer_hint' : videoMode ? 'aiChat.videos.composer_hint' : 'aiChat.chat.composer_hint')}</span>
            </div>
            {isRunning || isMediaRunning ? (
              <button className="ai-chat-stop" onClick={() => void stopCurrentWork()}>
                <Square size={13} fill="currentColor" aria-hidden="true" />
                {t('aiChat.chat.stop')}
              </button>
            ) : (
              <button
                className="ai-chat-send"
                onClick={() => void sendText()}
                disabled={!chatReady || !draft.trim() || submitting}
              >
                <Send size={14} aria-hidden="true" />
                {t('aiChat.chat.send')}
              </button>
            )}
          </div>
        </div>
      </section>

      <aside
        id="ai-run-inspector"
        className={`ai-run-inspector ${showRunInspector ? 'is-open' : ''}`}
        aria-label={t('aiChat.chat.run_inspector')}
      >
        <div className="ai-run-inspector__heading">
          <Gauge size={15} aria-hidden="true" />
          <h2>{t('aiChat.chat.run_inspector')}</h2>
          <button
            className="ai-run-inspector__close"
            onClick={closeRunInspector}
            aria-label={t('common.close')}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <dl>
          <div>
            <dt>{t('aiChat.chat.run_status')}</dt>
            <dd className={`is-${isMediaRunning ? 'running' : activeRun?.status ?? 'idle'}`}>
              {t(`aiChat.chat.run_${isMediaRunning ? 'running' : activeRun?.status ?? 'idle'}`)}
            </dd>
          </div>
          <div>
            <dt>{t('aiChat.chat.run_model')}</dt>
            <dd>{activeModel?.name ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('aiChat.chat.run_id')}</dt>
            <dd>{activeRun?.runId ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('aiChat.chat.tokens')}</dt>
            <dd>{activeRun?.usage.totalTokens ?? activeRun?.usage.outputTokens ?? '—'}</dd>
          </div>
        </dl>
        {(isMediaRunning || (activeRun && !isTerminalRun(activeRun.status))) && (
          <div className="ai-run-inspector__activity">
            <TimerReset size={14} aria-hidden="true" />
            <span>{t(activeMediaGeneration?.mediaType === 'image'
              ? 'aiChat.images.generating'
              : activeMediaGeneration?.mediaType === 'video'
                ? 'aiChat.videos.generating'
                : 'aiChat.chat.run_streaming')}</span>
          </div>
        )}
        {activeRun?.error && (
          <div className="ai-run-inspector__error">
            <TriangleAlert size={14} aria-hidden="true" />
            <div>
              <strong>{activeRun.error.code}</strong>
              <p>{activeRun.error.message}</p>
            </div>
          </div>
        )}
        <p className="ai-run-inspector__privacy">{t('aiChat.chat.privacy_note')}</p>
      </aside>
      {activeApproval && (
        <ToolApprovalDialog
          approval={activeApproval}
          submitting={submittingApproval}
          onDecision={(decision) => void decideToolApproval(decision)}
          returnFocus={() => textareaRef.current?.focus()}
        />
      )}
      {deletingConversation && (
        <ConversationDeleteDialog
          conversation={deletingConversation}
          submitting={deletingConversationBusy}
          onCancel={() => setDeletingConversation(null)}
          onConfirm={(deleteUnreferencedMedia) => void confirmDeleteConversation(deleteUnreferencedMedia)}
          returnFocus={restoreConversationActionFocus}
        />
      )}
      {renamingConversation && (
        <ConversationRenameDialog
          conversation={renamingConversation}
          submitting={renamingConversationBusy}
          onCancel={() => setRenamingConversation(null)}
          onConfirm={(title) => void confirmRenameConversation(title)}
          returnFocus={restoreConversationActionFocus}
        />
      )}
    </section>
  )
}

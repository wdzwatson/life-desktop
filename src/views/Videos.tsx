import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Database,
  Download,
  ExternalLink,
  Folder,
  Library,
  MoreVertical,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SortAsc,
  SortDesc,
  Trash2,
  X,
} from 'lucide-react'
import {
  canStartVideoDownloadWithEngine,
  createVideoDetailDraft,
  getDescendantGroupIds,
  getBulkSelectionState,
  getChipStyle,
  getDownloadFailureToastData,
  getFloatingDropdownFrame,
  getPlaybackOverlayChrome,
  getPendingDownloadRecordStatus,
  getProgressPercentLabel,
  getSelectedGroupPathLabel,
  getVideoDrawerTitleKey,
  getVideoDetailsSaveSuccessFeedback,
  getVideoDurationLabel,
  getVideoGroupOptions,
  getVideoLibraryVideos,
  getVideoSourceUrl,
  nextVideoDrawerState,
  normalizeVideoGroupName,
  parseTagInput,
  runVideoDownloadTasksWithLimit,
  toggleSelectedTag,
  toggleBulkSelection,
} from './videoLibraryUtils'
import type { VideoDrawerAction, VideoDrawerState, VideoEngineStatus } from './videoLibraryUtils'
import {
  applyParsedVideoMetadataDefaults,
  canEditVideoDetails,
  canPlayVideoRecord,
  buildParsedVideoTitle,
  createBulkMetadataEditPlan,
  createVideoBatchKey,
  getBulkDownloadSelectionPlan,
  getBulkMetadataActionLabels,
  getBulkTagEditButtonLabels,
  getBulkVisibleSelectionAction,
  getParseResultActionLabels,
  getSortDirectionIconName,
  getStatusBadgeTone,
  getVideoRowDownloadAction,
  getVideoRowStyle,
  isBulkMetadataWriteResultSuccess,
  normalizeVideoStatus,
  parseBulkGroupPickerValue,
  parseParsedVideoImportTagDraft,
  sortVideoRecords,
  toggleSortDirection,
  toggleVisibleBulkSelection,
} from './videoStateUtils'
import type { VideoSortState } from './videoStateUtils'
import { VideoGroupSidebar } from './VideoGroupSidebar'
import { DouyinFavoritesPanel } from './DouyinFavoritesPanel'
import type { VideoGroupMutationResult } from './VideoGroupSidebar'
import { useConfirmation } from '../components/ConfirmationProvider'
import { getConfiguredLocales } from '../localeRegistry'
import { ViewportPortal } from '../components/ViewportPortal'
import {
  buildCreateVideoGroupStatements,
  buildDeleteVideoGroupStatements,
  buildRenameVideoGroupStatements,
  buildUpdateVideoGroupTranslationsStatements,
  findSiblingCanonicalNameConflict,
  findSiblingDisplayNameConflict,
  getProposedVideoGroupDisplayNames,
  getVideoGroupTransactionError,
  localizeVideoGroups,
  localizeVideoRecords,
  normalizeVideoGroupDisplayName,
  repairVideoGroupSelection,
} from './videoGroupSidebarUtils'
import type {
  VideoGroupRecord,
  VideoGroupTranslation,
  VideoRecord,
  VideoTagRecord,
} from './videoTypes'
import type { VideoSortKey } from './videoTypes'

gsap.registerPlugin(useGSAP)

type FilterId = number | null | 'all'

type VideoDataLoadResult = { ok: true } | { ok: false; error: string }

type VideoDownloadAuthTarget = {
  source?: string | null
  sourceUrl?: string | null
  url?: string | null
}

function getVideoDownloadPhaseKey(video: VideoRecord) {
  if (video.download_phase === 'processing') return 'videos.download_stage_processing'
  if (video.download_phase === 'downloading') return 'videos.download_stage_downloading'
  if (video.download_phase === 'preparing') return 'videos.download_stage_preparing'
  if ((video.download_progress || 0) >= 99) return 'videos.download_stage_processing'
  return 'videos.download_stage_preparing'
}

function replaceVideoGroupTranslationValues(
  current: VideoGroupTranslation[],
  groupId: number,
  values: Record<string, string>,
) {
  const replacedLocales = new Set(Object.keys(values))
  const retained = current.filter(
    (translation) => translation.group_id !== groupId || !replacedLocales.has(translation.locale),
  )
  const replacements = Object.entries(values).flatMap(([locale, rawValue]) => {
    const translation = normalizeVideoGroupName(rawValue)
    return translation ? [{ group_id: groupId, locale, translation }] : []
  })
  return [...retained, ...replacements]
}

export const Videos: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { confirm } = useConfirmation()
  const showToast = useAppStore((state) => state.showToast)
  const setActiveScreen = useAppStore((state) => state.setActiveScreen)
  const setSettingsMenu = useAppStore((state) => state.setSettingsMenu)
  const userId = useAppStore((state) => state.userId)
  const api = (window as any).electronAPI
  const playbackChrome = getPlaybackOverlayChrome(Boolean(api?.isMac))

  const [videoUrl, setVideoUrl] = useState('')
  const [isParsingUrl, setIsParsingUrl] = useState(false)
  const [isAddingToQueue, setIsAddingToQueue] = useState(false)
  const [parsedData, setParsedData] = useState<any | null>(null)
  const [editablePlaylistTitle, setEditablePlaylistTitle] = useState('')
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([])
  const [parseImportGroupId, setParseImportGroupId] = useState<number | null>(null)
  const [parseImportTagDraft, setParseImportTagDraft] = useState('')
  const [, setDownloadQueue] = useState<any[]>([])
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(3)
  const [groups, setGroups] = useState<VideoGroupRecord[]>([])
  const [groupTranslations, setGroupTranslations] = useState<VideoGroupTranslation[]>([])
  const [tags, setTags] = useState<VideoTagRecord[]>([])
  const [localVideos, setLocalVideos] = useState<VideoRecord[]>([])
  const [isRefreshingData, setIsRefreshingData] = useState(false)
  const [bulkSelectedVideoIds, setBulkSelectedVideoIds] = useState<number[]>([])
  const [bulkTagDraft, setBulkTagDraft] = useState('')
  const [bulkMetadataMode, setBulkMetadataMode] = useState<'group' | 'tags' | null>(null)
  const [isBulkMoreMenuOpen, setIsBulkMoreMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [videoSort, setVideoSort] = useState<VideoSortState>({ key: 'default', direction: 'desc' })
  const [activeVideoWorkspace, setActiveVideoWorkspace] = useState<'library' | 'douyin'>('library')
  const [activeGroupId, setActiveGroupId] = useState<FilterId>('all')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<any | null>(null)
  const [drawerState, setDrawerState] = useState<VideoDrawerState>({ open: false })
  const [isDrawerMounted, setIsDrawerMounted] = useState(false)
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  const [groupDropdownFrame, setGroupDropdownFrame] = useState<ReturnType<
    typeof getFloatingDropdownFrame
  > | null>(null)
  const [groupSearchQuery, setGroupSearchQuery] = useState('')
  const [draftGroupId, setDraftGroupId] = useState<number | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [playingVideo, setPlayingVideo] = useState<any | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState('')
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [videoEngineStatus, setVideoEngineStatus] = useState<VideoEngineStatus>({ status: 'idle' })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const drawerOverlayRef = useRef<HTMLDivElement | null>(null)
  const drawerPanelRef = useRef<HTMLElement | null>(null)
  const groupDropdownButtonRef = useRef<HTMLButtonElement | null>(null)
  const groupDropdownPanelRef = useRef<HTMLDivElement | null>(null)
  const loadDataRequestIdRef = useRef(0)

  const loadData = useCallback(async (): Promise<VideoDataLoadResult> => {
    const fallbackError = t('videos.toast_video_details_save_failed')
    if (!api) return { ok: false, error: fallbackError }
    const requestId = loadDataRequestIdRef.current + 1
    loadDataRequestIdRef.current = requestId
    setIsRefreshingData(true)
    try {
      void Promise.resolve()
        .then(() => api.getSettings?.())
        .then((settings) => {
          if (settings && requestId === loadDataRequestIdRef.current) {
            setMaxConcurrentDownloads((settings as Record<string, any>).maxDownloads ?? 3)
          }
        })
        .catch(() => undefined)

      const [groupsRes, translationsRes, tagsRes, videosRes] = await Promise.all([
        api.dbQuery('videos', 'SELECT * FROM video_groups ORDER BY sort_order ASC, name ASC'),
        api.dbQuery('videos', 'SELECT group_id, locale, translation FROM video_group_translations'),
        api.dbQuery('videos', 'SELECT * FROM video_tags ORDER BY name ASC'),
        api.dbQuery(
          'videos',
          `
          SELECT v.*,
                 g.name as group_name,
                 b.batch_key as download_batch_key,
                 b.created_at as download_batch_created_at,
                 COALESCE(GROUP_CONCAT(t.name), '') as tag_names
          FROM videos v
          LEFT JOIN video_groups g ON g.id = v.group_id
          LEFT JOIN video_download_batches b ON b.id = v.download_batch_id
          LEFT JOIN video_tag_links vtl ON vtl.video_id = v.id
          LEFT JOIN video_tags t ON t.id = vtl.tag_id
          GROUP BY v.id
          ORDER BY v.priority = 'high' DESC, v.priority = 'mid' DESC, v.favorite_time DESC
          `,
        ),
      ])
      const failedResult = [groupsRes, translationsRes, tagsRes, videosRes].find(
        (result) => !result?.success,
      )
      if (requestId !== loadDataRequestIdRef.current) return { ok: true }
      if (failedResult) return { ok: false, error: failedResult.error || fallbackError }

      const nextGroups = groupsRes.data as VideoGroupRecord[]
      const nextTranslations = translationsRes.data as VideoGroupTranslation[]
      const nextTags = tagsRes.data as VideoTagRecord[]
      const nextVideos = videosRes.data.map((video: any) => ({
        ...video,
        tags: video.tag_names ? String(video.tag_names).split(',').filter(Boolean) : [],
      })) as VideoRecord[]
      const nextValidGroupIds = new Set(nextGroups.map((group) => group.id))

      setGroups(nextGroups)
      setGroupTranslations(nextTranslations)
      setTags(nextTags)
      setLocalVideos(nextVideos)
      setActiveGroupId((current) => repairVideoGroupSelection(current, nextValidGroupIds, 'all'))
      setDraftGroupId((current) => repairVideoGroupSelection(current, nextValidGroupIds, null))
      setParseImportGroupId((current) =>
        repairVideoGroupSelection(current, nextValidGroupIds, null),
      )
      setSelectedVideo((current: any) =>
        current ? nextVideos.find((video) => video.id === current.id) || null : null,
      )

      return { ok: true }
    } catch (cause) {
      if (requestId !== loadDataRequestIdRef.current) return { ok: true }
      const error = cause instanceof Error && cause.message ? cause.message : fallbackError
      return { ok: false, error }
    } finally {
      if (requestId === loadDataRequestIdRef.current) setIsRefreshingData(false)
    }
  }, [api, t])

  const refreshData = useCallback(async () => {
    const result = await loadData()
    if (!result.ok) showToast(result.error)
    return result
  }, [loadData, showToast])

  const finishSuccessfulGroupMutation = async (successToastKey: string) => {
    const reloadResult = await loadData()
    showToast(
      reloadResult.ok
        ? t(successToastKey)
        : t('videos.toast_group_saved_refresh_failed', { error: reloadResult.error }),
    )
  }

  const finishFailedGroupMutation = async (error: string): Promise<VideoGroupMutationResult> => {
    await loadData()
    return { ok: false, error }
  }

  useEffect(() => {
    void refreshData()

    if (!api) return
    const unsubProgress = api.onDownloadProgress((data: any) => {
      setLocalVideos((prev) =>
        prev.map((video) =>
          (data.videoId && video.id === data.videoId) || video.title === data.title
            ? {
                ...video,
                status: 'downloading',
                download_progress:
                  typeof data.progress === 'number' ? data.progress : video.download_progress,
                download_phase: data.phase || video.download_phase,
                download_message: data.message || video.download_message,
              }
            : video,
        ),
      )
      setDownloadQueue((prev) =>
        prev.map((item) =>
          item.id === data.videoId || item.title === data.title
            ? {
                ...item,
                status: 'downloading',
                message: data.message || item.message || '',
                progress: typeof data.progress === 'number' ? data.progress : item.progress,
              }
            : item,
        ),
      )
    })

    const unsubFinished = api.onDownloadFinished((data: any) => {
      showToast(t('videos.toast_download_finished', { title: data.title }))
      setDownloadQueue((prev) => prev.filter((item) => item.title !== data.title))
      void refreshData()
    })
    const unsubFailed = api.onDownloadFailed?.((data: any) => {
      showToast(
        t('videos.toast_download_failed', getDownloadFailureToastData(data.title, data.message)),
      )
      setDownloadQueue((prev) =>
        prev.map((item) =>
          item.id === data.videoId || item.title === data.title
            ? { ...item, status: 'failed', message: data.message || '' }
            : item,
        ),
      )
      void refreshData()
    })

    return () => {
      loadDataRequestIdRef.current += 1
      unsubProgress()
      unsubFinished()
      unsubFailed?.()
    }
  }, [api, i18n.language, refreshData, showToast, t, userId])

  useEffect(() => {
    if (!api) return
    let disposed = false
    const applyStatus = (status: VideoEngineStatus) => {
      if (!disposed && status?.status) setVideoEngineStatus(status)
    }
    api.getVideoEngineStatus?.().then((status: VideoEngineStatus) => {
      applyStatus(status)
      if (status?.status === 'idle')
        api
          .loadVideoEngine?.()
          .then(applyStatus)
          .catch(() => undefined)
    })
    const unsubscribe = api.onVideoEngineStatus?.(applyStatus)
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [api])

  useEffect(() => {
    if (!selectedVideo) {
      setDraftGroupId(null)
      setDraftTitle('')
      setSelectedTagNames([])
      setTagDraft('')
      return
    }
    const draft = createVideoDetailDraft(selectedVideo)
    setDraftGroupId(
      repairVideoGroupSelection(
        draft.groupId,
        groups.map((group) => group.id),
        null,
      ),
    )
    setDraftTitle(selectedVideo.title || '')
    setSelectedTagNames(draft.tags)
    setTagDraft('')
    setIsGroupDropdownOpen(false)
    setGroupSearchQuery('')
  }, [selectedVideo?.id])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed
  }, [playbackSpeed, playbackUrl])

  useEffect(() => {
    if (drawerState.open) setIsDrawerMounted(true)
  }, [drawerState.open])

  useGSAP(
    () => {
      if (!isDrawerMounted) return
      const overlay = drawerOverlayRef.current
      const panel = drawerPanelRef.current
      if (!overlay || !panel) return

      gsap.killTweensOf([overlay, panel])
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReducedMotion) {
        gsap.set([overlay, panel], { clearProps: 'opacity,transform' })
        if (!drawerState.open) setIsDrawerMounted(false)
        return
      }

      if (drawerState.open) {
        const timeline = gsap.timeline()
        timeline
          .fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power2.out' })
          .fromTo(
            panel,
            { x: 48, opacity: 0.72, scale: 0.985, transformOrigin: 'right center' },
            { x: 0, opacity: 1, scale: 1, duration: 0.42, ease: 'power3.out' },
            0,
          )
        return () => timeline.kill()
      }

      const timeline = gsap.timeline({ onComplete: () => setIsDrawerMounted(false) })
      timeline
        .to(panel, { x: 48, opacity: 0, scale: 0.985, duration: 0.28, ease: 'power2.in' })
        .to(overlay, { opacity: 0, duration: 0.2, ease: 'power1.in' }, 0.04)
      return () => timeline.kill()
    },
    { dependencies: [drawerState.open, isDrawerMounted] },
  )

  useEffect(() => {
    setBulkSelectedVideoIds((current) =>
      current.filter((id) => localVideos.some((video) => video.id === id)),
    )
  }, [localVideos])

  useEffect(() => {
    if (!isGroupDropdownOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (groupDropdownButtonRef.current?.contains(target)) return
      if (groupDropdownPanelRef.current?.contains(target)) return
      setIsGroupDropdownOpen(false)
    }
    const closeOnResize = () => setIsGroupDropdownOpen(false)
    document.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('resize', closeOnResize)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [isGroupDropdownOpen])

  const localizedGroups = useMemo(
    () => localizeVideoGroups(groups, groupTranslations, i18n.language),
    [groupTranslations, groups, i18n.language],
  )
  const localizedVideos = useMemo(
    () => localizeVideoRecords(localVideos, localizedGroups),
    [localVideos, localizedGroups],
  )
  const groupOptions = useMemo(() => getVideoGroupOptions(localizedGroups), [localizedGroups])
  const validGroupIds = useMemo(() => groups.map((group) => group.id), [groups])
  const selectedGroupIds = useMemo(
    () =>
      typeof activeGroupId === 'number' ? getDescendantGroupIds(groups, activeGroupId) : undefined,
    [groups, activeGroupId],
  )
  const filteredGroupOptions = useMemo(() => {
    const query = groupSearchQuery.trim().toLowerCase()
    if (!query) return groupOptions
    const matched = groupOptions.filter((group) => group.path.toLowerCase().includes(query))
    if (draftGroupId && !matched.some((group) => group.id === draftGroupId)) {
      const current = groupOptions.find((group) => group.id === draftGroupId)
      return current ? [current, ...matched] : matched
    }
    return matched
  }, [draftGroupId, groupOptions, groupSearchQuery])

  const filteredLocalVideos = useMemo(
    () =>
      sortVideoRecords(
        getVideoLibraryVideos(localizedVideos, {
          query: searchQuery,
          groupId: activeGroupId,
          groupIds: selectedGroupIds,
          validGroupIds,
          tag: activeTag,
        }),
        videoSort,
      ),
    [
      localizedVideos,
      searchQuery,
      activeGroupId,
      selectedGroupIds,
      validGroupIds,
      activeTag,
      videoSort,
    ],
  )
  const bulkSelectedVideos = useMemo(
    () => localVideos.filter((video) => bulkSelectedVideoIds.includes(video.id)),
    [localVideos, bulkSelectedVideoIds],
  )
  const bulkEditPlan = useMemo(
    () => createBulkMetadataEditPlan(bulkSelectedVideos),
    [bulkSelectedVideos],
  )
  const visibleVideoIds = useMemo(
    () => filteredLocalVideos.map((video) => video.id),
    [filteredLocalVideos],
  )
  const bulkVisibleSelectionAction = useMemo(
    () => getBulkVisibleSelectionAction(visibleVideoIds, bulkSelectedVideoIds),
    [visibleVideoIds, bulkSelectedVideoIds],
  )

  const parsedItems = parsedData?.items || []
  const shouldEditParsedPlaylistTitle = parsedData?.source === 'bilibili' && parsedItems.length > 1
  const parsedItemIds = parsedItems.map((item: any) => item.id)
  const bulkSelection = getBulkSelectionState(parsedItemIds, selectedVideoIds)
  const parseActionLabels = getParseResultActionLabels()
  const bulkActionLabels = getBulkMetadataActionLabels()
  const bulkTagButtonLabels = getBulkTagEditButtonLabels()
  const updateDrawer = (action: VideoDrawerAction) => {
    setDrawerState((current) => nextVideoDrawerState(current, action))
  }
  const toggleGroupDropdown = () => {
    if (isGroupDropdownOpen) {
      setIsGroupDropdownOpen(false)
      return
    }
    const rect = groupDropdownButtonRef.current?.getBoundingClientRect()
    if (rect) {
      setGroupDropdownFrame(
        getFloatingDropdownFrame(
          { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
          window.innerHeight,
        ),
      )
    }
    setIsGroupDropdownOpen(true)
  }

  const handleLoadVideoEngine = async () => {
    if (!api?.loadVideoEngine) return
    setVideoEngineStatus((current) => ({
      ...current,
      status: 'loading',
      message: current.message,
      updatedAt: new Date().toISOString(),
    }))
    try {
      const status = await api.loadVideoEngine()
      if (status?.status) setVideoEngineStatus(status)
    } catch (error: any) {
      const message = error?.message || String(error)
      setVideoEngineStatus({ status: 'error', message, updatedAt: new Date().toISOString() })
      showToast(t('videos.toast_video_engine_failed', { error: message }))
    }
  }

  const handleOpenVideoSettings = () => {
    setSettingsMenu('video')
    setActiveScreen('settings')
  }

  const getAuthCheckUrl = (target: VideoDownloadAuthTarget) =>
    target.sourceUrl || target.url || ''

  const needsBilibiliAuthCheck = (target: VideoDownloadAuthTarget) => {
    const url = getAuthCheckUrl(target)
    return target.source === 'bilibili' || /(^|\.)bilibili\.com\//i.test(url)
  }

  const guardVideoCookieAccess = async (targets: VideoDownloadAuthTarget[]) => {
    if (!api?.getVideoCookieAccessStatus) return true
    const target = targets.find((item) => needsBilibiliAuthCheck(item) && getAuthCheckUrl(item))
    if (!target) return true
    const result = await api.getVideoCookieAccessStatus(getAuthCheckUrl(target))
    if (result?.success && (!result.required || result.hasAccess)) return true
    showToast(t('videos.toast_bilibili_cookie_required'))
    handleOpenVideoSettings()
    return false
  }

  const guardVideoDownload = () => {
    const gate = canStartVideoDownloadWithEngine(videoEngineStatus)
    if (gate.canStart) return true
    if (videoEngineStatus.status === 'idle') {
      api?.loadVideoEngine?.().then((status: VideoEngineStatus) => {
        if (status?.status) setVideoEngineStatus(status)
      })
    }
    showToast(
      t(gate.toastKey || 'videos.toast_video_engine_loading', {
        error: videoEngineStatus.message || t('videos.video_engine_not_ready'),
      }),
    )
    return false
  }

  const handleParseUrl = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!videoUrl.trim() || !api) return

    showToast(t('videos.toast_parsing_url'))
    setIsParsingUrl(true)
    try {
      const data = await api.parseVideoUrl(videoUrl.trim())
      if (data) {
        setParsedData(data)
        setEditablePlaylistTitle(data.playlistTitle || data.title || '')
        setSelectedVideoIds((data.items || []).map((item: any) => item.id))
      }
    } catch (error: any) {
      showToast(t('videos.toast_parse_failed', { error: error?.message || String(error) }))
    } finally {
      setIsParsingUrl(false)
    }
  }

  const closeParsedData = () => {
    setParsedData(null)
    setEditablePlaylistTitle('')
    setParseImportGroupId(null)
    setParseImportTagDraft('')
  }

  const getParsedPlaylistTitleForSave = () =>
    shouldEditParsedPlaylistTitle ? editablePlaylistTitle.trim() : parsedData?.playlistTitle

  const prepareParsedItemForSave = (item: any) =>
    shouldEditParsedPlaylistTitle
      ? {
          ...item,
          title: buildParsedVideoTitle(editablePlaylistTitle, item),
        }
      : item

  const createDownloadBatch = async (items: any[]) => {
    const batchKey = createVideoBatchKey(new Date(), Date.now() % 1000 || 1)
    const playlistTitle = getParsedPlaylistTitleForSave()
    const result = await api.dbQuery(
      'videos',
      `
      INSERT INTO video_download_batches (batch_key, source_url, source, title, item_count, status)
      VALUES (?, ?, ?, ?, ?, 'downloading')
      `,
      [
        batchKey,
        videoUrl.trim() || parsedData?.sourceUrl || null,
        parsedData?.source || 'other',
        playlistTitle || parsedData?.title || parsedData?.playlistTitle || batchKey,
        items.length,
      ],
    )
    return { id: Number(result?.data?.lastInsertRowid), batchKey }
  }

  const attachVideoTags = async (videoId: number, tagNames: string[]) => {
    const nextTags = parseTagInput(tagNames.join(','))
    for (const tagName of nextTags) {
      const insertTagResult = await api.dbQuery(
        'videos',
        'INSERT OR IGNORE INTO video_tags (name) VALUES (?)',
        [tagName],
      )
      if (!insertTagResult?.success)
        throw new Error(insertTagResult?.error || t('videos.toast_video_details_save_failed'))
      const res = await api.dbQuery('videos', 'SELECT id FROM video_tags WHERE name = ?', [tagName])
      if (!res?.success) throw new Error(res?.error || t('videos.toast_video_details_save_failed'))
      const tagId = res?.data?.[0]?.id
      if (tagId) {
        const linkTagResult = await api.dbQuery(
          'videos',
          'INSERT OR IGNORE INTO video_tag_links (video_id, tag_id) VALUES (?, ?)',
          [videoId, tagId],
        )
        if (!linkTagResult?.success)
          throw new Error(linkTagResult?.error || t('videos.toast_video_details_save_failed'))
      }
    }
  }

  const insertParsedVideo = async (
    item: any,
    initialStatus: string,
    batch?: { id: number; order: number },
  ) => {
    const playlistTitle = getParsedPlaylistTitleForSave()
    const result = await api.dbQuery(
      'videos',
      `
      INSERT INTO videos
        (title, url, source_url, source_id, source_cid, playlist_id, playlist_title, part_index, thumbnail_url, duration, duration_seconds, source, group_id, status, download_progress, download_batch_id, download_batch_order, parse_status, diagnostic_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      [
        item.title,
        item.sourceUrl,
        item.sourceUrl,
        item.sourceId,
        item.sourceCid || null,
        item.playlistId || parsedData.playlistId,
        playlistTitle,
        item.partIndex,
        item.thumbnailUrl,
        getVideoDurationLabel({
          id: 0,
          title: item.title,
          duration: item.durationLabel,
          duration_seconds: item.durationSeconds,
        }),
        item.durationSeconds || null,
        item.source,
        item.group_id ?? null,
        initialStatus,
        initialStatus === 'downloading' ? 0 : null,
        batch?.id || null,
        batch?.order || item.partIndex || null,
        parsedData.diagnostics?.[0]?.code || 'ok',
        parsedData.diagnostics?.map((diagnostic: any) => diagnostic.message).join('\n') || '',
      ],
    )
    const videoId = Number(result?.data?.lastInsertRowid)
    if (videoId && item.tags?.length) await attachVideoTags(videoId, item.tags)
    return videoId
  }

  const runDownloadTask = async (task: {
    id: number
    title: string
    sourceUrl: string
    source?: string
    sourceCid?: string | null
    durationSeconds?: number | null
  }) => {
    setDownloadQueue((prev) =>
      prev.map((item) =>
        item.id === task.id || item.title === task.title
          ? {
              ...item,
              id: task.id,
              title: task.title,
              sourceUrl: task.sourceUrl,
              status: 'downloading',
              message: '',
              progress: 0,
            }
          : item,
      ),
    )
    await api.dbQuery(
      'videos',
      "UPDATE videos SET status = 'downloading', download_progress = 0, download_error = NULL, invalid_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [task.id],
    )
    try {
      await api.startDownload({
        id: task.id,
        title: task.title,
        sourceUrl: task.sourceUrl,
        url: task.sourceUrl,
        source: task.source,
        sourceCid: task.sourceCid,
        durationSeconds: task.durationSeconds,
      })
    } catch (error: any) {
      const message = error?.message || String(error)
      setDownloadQueue((prev) =>
        prev.map((item) =>
          item.id === task.id || item.title === task.title
            ? { ...item, status: 'failed', message }
            : item,
        ),
      )
      await api.dbQuery(
        'videos',
        'UPDATE videos SET status = ?, download_error = ?, diagnostic_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['download_failed', message, message, task.id],
      )
      showToast(t('videos.toast_download_failed', { title: task.title, error: message }))
    }
    void refreshData()
  }

  const handleAddSelectedToVideoList = async () => {
    if (!parsedData || !api) return
    const selected = parsedItems.filter((item: any) => selectedVideoIds.includes(item.id))
    if (selected.length === 0) {
      showToast(t('videos.toast_select_at_least_one'))
      return
    }

    setIsAddingToQueue(true)
    try {
      for (const item of selected) {
        await insertParsedVideo(
          applyParsedVideoMetadataDefaults(prepareParsedItemForSave(item), {
            groupId: parseImportGroupId,
            tagNames: parseParsedVideoImportTagDraft(parseImportTagDraft),
          }),
          'not_downloaded',
        )
      }
      closeParsedData()
      setVideoUrl('')
      showToast(t('videos.toast_videos_added_to_list', { count: selected.length }))
      void refreshData()
    } catch (error: any) {
      showToast(t('videos.toast_parse_failed', { error: error?.message || String(error) }))
    } finally {
      setIsAddingToQueue(false)
    }
  }

  const handleDownloadSelected = async () => {
    if (!parsedData || !api) return
    const selected = parsedItems.filter((item: any) => selectedVideoIds.includes(item.id))
    if (selected.length === 0) {
      showToast(t('videos.toast_select_at_least_one'))
      return
    }
    if (!guardVideoDownload()) return
    if (!(await guardVideoCookieAccess(selected))) return

    setIsAddingToQueue(true)
    try {
      const tasks: Array<{
        id: number
        title: string
        sourceUrl: string
        source?: string
        sourceCid?: string | null
        durationSeconds?: number | null
      }> = []
      const batch = await createDownloadBatch(selected)
      for (const [index, item] of selected.entries()) {
        const preparedItem = applyParsedVideoMetadataDefaults(prepareParsedItemForSave(item), {
          groupId: parseImportGroupId,
          tagNames: parseParsedVideoImportTagDraft(parseImportTagDraft),
        })
        const videoId = await insertParsedVideo(preparedItem, getPendingDownloadRecordStatus(), {
          id: batch.id,
          order: item.partIndex || index + 1,
        })
        tasks.push({
          id: videoId,
          title: preparedItem.title,
          sourceUrl: preparedItem.sourceUrl,
          source: preparedItem.source,
          sourceCid: preparedItem.sourceCid,
          durationSeconds: preparedItem.durationSeconds,
        })
      }

      setDownloadQueue((prev) => [
        ...prev,
        ...tasks.map((task) => ({ ...task, status: 'queued', message: '', progress: 0 })),
      ])
      closeParsedData()
      setVideoUrl('')
      showToast(t('videos.toast_videos_download_started', { count: selected.length }))
      void refreshData()

      await runVideoDownloadTasksWithLimit(tasks, maxConcurrentDownloads, runDownloadTask)
    } catch (error: any) {
      showToast(t('videos.toast_download_failed', { title: error?.message || String(error) }))
    } finally {
      setIsAddingToQueue(false)
    }
  }

  const handleDownloadVideoFromList = async (
    video: VideoRecord,
    options: { skipCookieCheck?: boolean } = {},
  ) => {
    if (!api) return
    const action = getVideoRowDownloadAction(video)
    if (action.disabled) return
    if (!guardVideoDownload()) return
    const sourceUrl = video.source_url || video.url
    if (!sourceUrl) {
      showToast(t('videos.toast_missing_download_source'))
      return
    }
    if (!options.skipCookieCheck && !(await guardVideoCookieAccess([{ ...video, sourceUrl }])))
      return
    const task = {
      id: video.id,
      title: video.title,
      sourceUrl,
      source: video.source,
      sourceCid: video.source_cid,
      durationSeconds: video.duration_seconds,
    }
    setDownloadQueue((prev) => {
      const withoutCurrent = prev.filter((item) => item.id !== task.id && item.title !== task.title)
      return [...withoutCurrent, { ...task, status: 'queued', message: '', progress: 0 }]
    })
    await runDownloadTask(task)
  }

  const handleCreateGroup = async (
    parentId: number | null,
    rawName: string,
  ): Promise<VideoGroupMutationResult> => {
    const fallbackError = t('videos.group_create_failed')
    if (!api?.dbTransaction) return { ok: false, error: fallbackError }
    try {
      if (parentId != null && !groups.some((group) => group.id === parentId)) {
        return finishFailedGroupMutation(t('videos.group_unavailable'))
      }
      const name = normalizeVideoGroupDisplayName(rawName)
      if (!name) {
        return { ok: false, error: t('videos.group_name_required') }
      }
      if (findSiblingCanonicalNameConflict({ groups, parentId, name })) {
        return { ok: false, error: t('videos.group_name_duplicate') }
      }
      const configuredLocales = getConfiguredLocales(i18n.language)
      const localeLabels = new Map(configuredLocales.map((locale) => [locale.code, locale.label]))
      for (const proposal of getProposedVideoGroupDisplayNames({
        configuredLocales,
        translations: groupTranslations,
        canonicalName: name,
        values: { [i18n.language]: name },
      })) {
        if (
          !findSiblingDisplayNameConflict({
            groups,
            translations: groupTranslations,
            parentId,
            locale: proposal.locale,
            name: proposal.displayName,
          })
        ) {
          continue
        }
        return {
          ok: false,
          error:
            proposal.locale === i18n.language
              ? t('videos.group_name_duplicate')
              : t('videos.group_translation_duplicate', {
                  language: localeLabels.get(proposal.locale) || proposal.locale,
                }),
        }
      }
      const sortOrder =
        groups.reduce(
          (highest, group) =>
            (group.parent_id ?? null) === parentId
              ? Math.max(highest, group.sort_order ?? 0)
              : highest,
          0,
        ) + 1
      const result = await api.dbTransaction(
        'videos',
        buildCreateVideoGroupStatements(name, parentId, i18n.language, sortOrder),
      )
      if (!result?.success) {
        return finishFailedGroupMutation(
          getVideoGroupTransactionError(result?.error, fallbackError),
        )
      }
      const createChanges = Number(result?.data?.[0]?.changes)
      if (createChanges === 0) {
        return finishFailedGroupMutation(t('videos.group_unavailable'))
      }
      if (!Number.isFinite(createChanges)) {
        return finishFailedGroupMutation(fallbackError)
      }
      const insertedId = Number(result?.data?.[0]?.lastInsertRowid)
      const groupId = Number.isFinite(insertedId) && insertedId > 0 ? insertedId : undefined
      if (groupId === undefined) {
        return finishFailedGroupMutation(fallbackError)
      }

      const optimisticGroup: VideoGroupRecord = {
        id: groupId,
        name,
        parent_id: parentId,
        sort_order: sortOrder,
      }
      setGroups((current) =>
        current.some((item) => item.id === groupId) ? current : [...current, optimisticGroup],
      )
      setGroupTranslations((current) =>
        replaceVideoGroupTranslationValues(current, groupId, {
          [i18n.language]: name,
        }),
      )
      setActiveGroupId(groupId)
      await finishSuccessfulGroupMutation('videos.toast_group_created')
      return { ok: true, groupId }
    } catch (error) {
      return finishFailedGroupMutation(error instanceof Error ? error.message : fallbackError)
    }
  }

  const handleRenameGroup = async (
    group: VideoGroupRecord,
    rawName: string,
  ): Promise<VideoGroupMutationResult> => {
    const fallbackError = t('videos.group_update_failed')
    if (!api?.dbTransaction) return { ok: false, error: fallbackError }
    try {
      const target = groups.find((candidate) => candidate.id === group.id)
      if (!target) {
        return finishFailedGroupMutation(t('videos.group_unavailable'))
      }
      const name = normalizeVideoGroupDisplayName(rawName)
      if (!name) {
        return { ok: false, error: t('videos.group_name_required') }
      }
      const parentId = target.parent_id ?? null
      if (
        findSiblingCanonicalNameConflict({
          groups,
          parentId,
          name,
          excludeGroupId: target.id,
        })
      ) {
        return { ok: false, error: t('videos.group_name_duplicate') }
      }
      const configuredLocales = getConfiguredLocales(i18n.language)
      const localeLabels = new Map(configuredLocales.map((locale) => [locale.code, locale.label]))
      for (const proposal of getProposedVideoGroupDisplayNames({
        configuredLocales,
        translations: groupTranslations,
        groupId: target.id,
        canonicalName: name,
        values: { [i18n.language]: name },
      })) {
        if (
          !findSiblingDisplayNameConflict({
            groups,
            translations: groupTranslations,
            parentId,
            locale: proposal.locale,
            name: proposal.displayName,
            excludeGroupId: target.id,
          })
        ) {
          continue
        }
        return {
          ok: false,
          error:
            proposal.locale === i18n.language
              ? t('videos.group_name_duplicate')
              : t('videos.group_translation_duplicate', {
                  language: localeLabels.get(proposal.locale) || proposal.locale,
                }),
        }
      }
      const result = await api.dbTransaction(
        'videos',
        buildRenameVideoGroupStatements(target.id, name, i18n.language),
      )
      if (!result?.success) {
        return finishFailedGroupMutation(
          getVideoGroupTransactionError(result?.error, fallbackError),
        )
      }
      const renameChanges = Number(result?.data?.[0]?.changes)
      if (renameChanges === 0) {
        return finishFailedGroupMutation(t('videos.group_unavailable'))
      }
      if (!Number.isFinite(renameChanges)) {
        return finishFailedGroupMutation(fallbackError)
      }

      setGroups((current) =>
        current.map((item) => (item.id === target.id ? { ...item, name } : item)),
      )
      setGroupTranslations((current) =>
        replaceVideoGroupTranslationValues(current, target.id, {
          [i18n.language]: name,
        }),
      )
      setLocalVideos((current) =>
        current.map((video) =>
          video.group_id === target.id ? { ...video, group_name: name } : video,
        ),
      )
      setSelectedVideo((current: VideoRecord | null) =>
        current?.group_id === target.id ? { ...current, group_name: name } : current,
      )
      await finishSuccessfulGroupMutation('videos.toast_group_updated')
      return { ok: true, groupId: target.id }
    } catch (error) {
      return finishFailedGroupMutation(error instanceof Error ? error.message : fallbackError)
    }
  }

  const handleSaveGroupTranslations = async (
    group: VideoGroupRecord,
    values: Record<string, string>,
  ): Promise<VideoGroupMutationResult> => {
    const fallbackError = t('videos.group_update_failed')
    if (!api?.dbTransaction) return { ok: false, error: fallbackError }
    try {
      const target = groups.find((candidate) => candidate.id === group.id)
      if (!target) {
        return finishFailedGroupMutation(t('videos.group_unavailable'))
      }
      const currentLocaleName = normalizeVideoGroupDisplayName(values[i18n.language])
      const nextCanonicalName = currentLocaleName || target.name
      const parentId = target.parent_id ?? null
      if (
        findSiblingCanonicalNameConflict({
          groups,
          parentId,
          name: nextCanonicalName,
          excludeGroupId: target.id,
        })
      ) {
        return { ok: false, error: t('videos.group_name_duplicate') }
      }

      const configuredLocales = getConfiguredLocales(i18n.language)
      const localeLabels = new Map(configuredLocales.map((locale) => [locale.code, locale.label]))
      for (const proposal of getProposedVideoGroupDisplayNames({
        configuredLocales,
        translations: groupTranslations,
        groupId: target.id,
        canonicalName: nextCanonicalName,
        values,
      })) {
        if (
          findSiblingDisplayNameConflict({
            groups,
            translations: groupTranslations,
            parentId,
            locale: proposal.locale,
            name: proposal.displayName,
            excludeGroupId: target.id,
          })
        ) {
          return {
            ok: false,
            error: t('videos.group_translation_duplicate', {
              language: localeLabels.get(proposal.locale) || proposal.locale,
            }),
          }
        }
      }

      const result = await api.dbTransaction('videos', [
        {
          sql: 'UPDATE video_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          params: [nextCanonicalName, target.id],
        },
        ...buildUpdateVideoGroupTranslationsStatements(target.id, values),
      ])
      if (!result?.success) {
        return finishFailedGroupMutation(
          getVideoGroupTransactionError(result?.error, fallbackError),
        )
      }
      const translationChanges = Number(result?.data?.[0]?.changes)
      if (translationChanges === 0) {
        return finishFailedGroupMutation(t('videos.group_unavailable'))
      }
      if (!Number.isFinite(translationChanges)) {
        return finishFailedGroupMutation(fallbackError)
      }

      const nextCurrentLocaleDisplayName = currentLocaleName || nextCanonicalName
      setGroups((current) =>
        current.map((item) =>
          item.id === target.id ? { ...item, name: nextCanonicalName } : item,
        ),
      )
      setLocalVideos((current) =>
        current.map((video) =>
          video.group_id === target.id
            ? { ...video, group_name: nextCurrentLocaleDisplayName }
            : video,
        ),
      )
      setSelectedVideo((current: VideoRecord | null) =>
        current?.group_id === target.id
          ? { ...current, group_name: nextCurrentLocaleDisplayName }
          : current,
      )
      setGroupTranslations((current) =>
        replaceVideoGroupTranslationValues(current, target.id, values),
      )
      await finishSuccessfulGroupMutation('videos.toast_group_updated')
      return { ok: true, groupId: target.id }
    } catch (error) {
      return finishFailedGroupMutation(error instanceof Error ? error.message : fallbackError)
    }
  }

  const handleDeleteGroup = async (group: VideoGroupRecord): Promise<VideoGroupMutationResult> => {
    const fallbackError = t('videos.group_delete_failed')
    if (!api?.dbTransaction) return { ok: false, error: fallbackError }
    try {
      const target = groups.find((candidate) => candidate.id === group.id)
      if (!target) {
        return finishFailedGroupMutation(t('videos.group_unavailable'))
      }
      const result = await api.dbTransaction(
        'videos',
        buildDeleteVideoGroupStatements(target.id, target.parent_id ?? null),
      )
      if (!result?.success) {
        return finishFailedGroupMutation(
          getVideoGroupTransactionError(result?.error, fallbackError),
        )
      }
      const finalDeleteResult = Array.isArray(result?.data) ? result.data.at(-1) : undefined
      const deleteChanges = Number(finalDeleteResult?.changes)
      if (deleteChanges === 0) {
        return finishFailedGroupMutation(t('videos.group_unavailable'))
      }
      if (!Number.isFinite(deleteChanges)) {
        return finishFailedGroupMutation(fallbackError)
      }

      setGroups((current) =>
        current
          .filter((item) => item.id !== target.id)
          .map((item) =>
            item.parent_id === target.id ? { ...item, parent_id: target.parent_id ?? null } : item,
          ),
      )
      setGroupTranslations((current) =>
        current.filter((translation) => translation.group_id !== target.id),
      )
      setLocalVideos((current) =>
        current.map((video) =>
          video.group_id === target.id ? { ...video, group_id: null, group_name: null } : video,
        ),
      )
      setActiveGroupId((current) => (current === target.id ? 'all' : current))
      setDraftGroupId((current) => (current === target.id ? null : current))
      setParseImportGroupId((current) => (current === target.id ? null : current))
      setSelectedVideo((current: VideoRecord | null) =>
        current?.group_id === target.id
          ? { ...current, group_id: null, group_name: null }
          : current,
      )
      await finishSuccessfulGroupMutation('videos.toast_group_deleted')
      return { ok: true }
    } catch (error) {
      return finishFailedGroupMutation(error instanceof Error ? error.message : fallbackError)
    }
  }

  const handleSaveVideoDetails = async (
    videoId: number,
    title: string,
    groupId: number | null,
    tagNames: string[],
  ) => {
    if (!api) return
    if (selectedVideo && !canEditVideoDetails(selectedVideo)) return
    const showSaveFailedToast = (message?: string) => {
      showToast(message || t('videos.toast_video_details_save_failed'))
    }
    const groupResult = await api.dbQuery(
      'videos',
      'UPDATE videos SET title = ?, group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [title.trim() || selectedVideo?.title || '', groupId, videoId],
    )
    if (!groupResult?.success) {
      showSaveFailedToast(groupResult?.error)
      return
    }
    const nextTags = parseTagInput(tagNames.join(','))
    const deleteTagsResult = await api.dbQuery(
      'videos',
      'DELETE FROM video_tag_links WHERE video_id = ?',
      [videoId],
    )
    if (!deleteTagsResult?.success) {
      showSaveFailedToast(deleteTagsResult?.error)
      return
    }
    for (const tagName of nextTags) {
      const insertTagResult = await api.dbQuery(
        'videos',
        'INSERT OR IGNORE INTO video_tags (name) VALUES (?)',
        [tagName],
      )
      if (!insertTagResult?.success) {
        showSaveFailedToast(insertTagResult?.error)
        return
      }
      const res = await api.dbQuery('videos', 'SELECT id FROM video_tags WHERE name = ?', [tagName])
      if (!res?.success) {
        showSaveFailedToast(res?.error)
        return
      }
      const tagId = res?.data?.[0]?.id
      if (tagId) {
        const linkTagResult = await api.dbQuery(
          'videos',
          'INSERT OR IGNORE INTO video_tag_links (video_id, tag_id) VALUES (?, ?)',
          [videoId, tagId],
        )
        if (!linkTagResult?.success) {
          showSaveFailedToast(linkTagResult?.error)
          return
        }
      }
    }
    const feedback = getVideoDetailsSaveSuccessFeedback()
    showToast(t(feedback.toastKey))
    updateDrawer(feedback.drawerAction)
    void refreshData()
  }

  const handleAddTagDraft = () => {
    const nextTags = parseTagInput(tagDraft)
    if (nextTags.length === 0) return
    setSelectedTagNames((current) => Array.from(new Set([...current, ...nextTags])))
    setTagDraft('')
  }

  const handlePlayVideo = async (video: any) => {
    if (!api) return
    const localPath = video.local_path || video.path
    if (!localPath) {
      showToast(t('videos.toast_download_before_play'))
      return
    }
    const res = await api.getVideoPlaybackUrl(localPath)
    if (!res?.success) {
      showToast(res?.error || t('videos.toast_playback_failed'))
      return
    }
    setPlayingVideo(video)
    setPlaybackUrl(res.url)
  }

  const handleDeleteVideo = async (id: number) => {
    if (!api) return
    if (!(await confirm({ description: t('videos.confirm_delete'), confirmLabel: t('common.delete'), tone: 'danger' }))) return
    await api.dbQuery('videos', 'DELETE FROM videos WHERE id = ?', [id])
    if (selectedVideo?.id === id) setSelectedVideo(null)
    showToast(t('videos.toast_video_deleted'))
    void refreshData()
  }

  const closeBulkMetadataOperation = async () => {
    setBulkTagDraft('')
    setBulkMetadataMode(null)
    setBulkSelectedVideoIds([])
    await refreshData()
  }

  const handleReadonlyOnlyBulkMetadataSelection = async () => {
    if (bulkEditPlan.skippedCount === 0) return false
    showToast(t('videos.bulk_skipped_readonly', { count: bulkEditPlan.skippedCount }))
    await closeBulkMetadataOperation()
    return true
  }

  const showBulkMetadataWriteFailure = (message?: string) => {
    showToast(
      t('videos.bulk_update_failed', {
        error: message || t('videos.toast_video_details_save_failed'),
      }),
    )
  }

  const handleBulkMoveToGroup = async (groupId: number | null) => {
    if (!api) return
    if (bulkEditPlan.editableIds.length === 0) {
      await handleReadonlyOnlyBulkMetadataSelection()
      return
    }
    const result = await api.dbQuery(
      'videos',
      `
      UPDATE videos
      SET group_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${bulkEditPlan.editableIds.map(() => '?').join(',')})
      `,
      [groupId, ...bulkEditPlan.editableIds],
    )
    if (!isBulkMetadataWriteResultSuccess(result)) {
      showBulkMetadataWriteFailure(result?.error)
      return
    }
    showToast(t('videos.bulk_group_updated', { count: bulkEditPlan.editableCount }))
    if (bulkEditPlan.skippedCount > 0) {
      showToast(t('videos.bulk_skipped_readonly', { count: bulkEditPlan.skippedCount }))
    }
    await closeBulkMetadataOperation()
  }

  const handleBulkUpdateTags = async (mode: 'add' | 'remove') => {
    if (!api) return
    const names = Array.from(
      new Set(
        bulkTagDraft
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    )
    if (names.length === 0) return
    if (bulkEditPlan.editableIds.length === 0) {
      await handleReadonlyOnlyBulkMetadataSelection()
      return
    }

    const result = await api.bulkUpdateVideoTags?.({
      videoIds: bulkEditPlan.editableIds,
      tagNames: names,
      mode,
    })
    if (!isBulkMetadataWriteResultSuccess(result)) {
      showBulkMetadataWriteFailure(result?.error)
      return
    }

    showToast(t('videos.bulk_tags_updated', { count: bulkEditPlan.editableCount }))
    if (bulkEditPlan.skippedCount > 0) {
      showToast(t('videos.bulk_skipped_readonly', { count: bulkEditPlan.skippedCount }))
    }
    await closeBulkMetadataOperation()
  }

  const handleBulkDownloadSelected = async () => {
    const selectedVideos = bulkSelectedVideos
    const downloadPlan = getBulkDownloadSelectionPlan(selectedVideos)
    setIsBulkMoreMenuOpen(false)
    setBulkMetadataMode(null)

    if (downloadPlan.downloadableCount === 0) {
      showToast(
        t(
          downloadPlan.allSelectedDownloaded
            ? 'videos.bulk_no_download_needed'
            : 'videos.bulk_no_downloadable_selected',
        ),
      )
      setBulkSelectedVideoIds([])
      return
    }

    if (!guardVideoDownload()) return
    const downloadableVideos = selectedVideos.filter((video) => {
      const action = getVideoRowDownloadAction(video)
      return action.visible && !action.disabled
    })
    if (!(await guardVideoCookieAccess(downloadableVideos))) return

    setBulkSelectedVideoIds([])
    showToast(t('videos.bulk_download_started', { count: downloadPlan.downloadableCount }))
    if (downloadPlan.skippedCount > 0) {
      showToast(t('videos.bulk_download_skipped', { count: downloadPlan.skippedCount }))
    }

    for (const video of downloadableVideos) {
      await handleDownloadVideoFromList(video, { skipCookieCheck: true })
    }
  }

  const handleBulkDeleteSelected = async () => {
    if (!api) return
    setIsBulkMoreMenuOpen(false)
    setBulkMetadataMode(null)
    if (
      !(await confirm({
        description: t('videos.confirm_bulk_delete', { count: bulkSelectedVideoIds.length }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    for (const videoId of bulkSelectedVideoIds) {
      const deleteResult = await api.dbQuery('videos', 'DELETE FROM videos WHERE id = ?', [videoId])
      if (!isBulkMetadataWriteResultSuccess(deleteResult)) {
        showBulkMetadataWriteFailure(deleteResult?.error)
        await refreshData()
        return
      }
    }
    if (selectedVideo && bulkSelectedVideoIds.includes(selectedVideo.id)) setSelectedVideo(null)
    showToast(t('videos.bulk_deleted', { count: bulkSelectedVideoIds.length }))
    setBulkMetadataMode(null)
    setBulkSelectedVideoIds([])
    await refreshData()
  }

  const selectedDetailsEditable = selectedVideo ? canEditVideoDetails(selectedVideo) : false
  const videoEngineTone =
    videoEngineStatus.status === 'ready'
      ? 'success'
      : videoEngineStatus.status === 'error'
        ? 'danger'
        : 'muted'
  const videoEngineLabelKey =
    videoEngineStatus.status === 'ready'
      ? 'videos.video_engine_ready'
      : videoEngineStatus.status === 'error'
        ? 'videos.video_engine_error'
        : videoEngineStatus.status === 'loading'
          ? 'videos.video_engine_loading'
          : 'videos.video_engine_idle'
  const isVideoEngineLoading = videoEngineStatus.status === 'loading'
  const videoEngineBadgeStyle =
    videoEngineTone === 'success'
      ? {
          backgroundColor: 'rgba(34, 197, 94, 0.14)',
          color: '#15803d',
          borderColor: 'rgba(34, 197, 94, 0.28)',
        }
      : videoEngineTone === 'danger'
        ? {
            backgroundColor: 'rgba(220, 38, 38, 0.12)',
            color: '#b91c1c',
            borderColor: 'rgba(220, 38, 38, 0.24)',
          }
        : {
            backgroundColor: 'rgba(100, 116, 139, 0.12)',
            color: 'var(--text-muted)',
            borderColor: 'var(--color-border)',
          }

  return (
    <div
      style={{
        animation: 'enter 0.15s ease both',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('videos.title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('videos.subtitle')}</p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={handleOpenVideoSettings}
          title={t('videos.open_download_settings')}
          style={{ flexShrink: 0 }}
        >
          <SlidersHorizontal size={14} />
          {t('videos.open_download_settings')}
        </button>
      </header>

      <div
        role="tablist"
        aria-label={t('videos.workspace_tabs')}
        style={{ display: 'flex', gap: '6px', marginBottom: '12px', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeVideoWorkspace === 'library'}
          className={`btn sm ${activeVideoWorkspace === 'library' ? 'primary' : 'ghost'}`}
          onClick={() => setActiveVideoWorkspace('library')}
        >
          <Library size={14} />
          {t('videos.workspace_library')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeVideoWorkspace === 'douyin'}
          className={`btn sm ${activeVideoWorkspace === 'douyin' ? 'primary' : 'ghost'}`}
          onClick={() => setActiveVideoWorkspace('douyin')}
        >
          <Folder size={14} />
          {t('videos.workspace_douyin')}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: activeVideoWorkspace === 'library' ? '240px minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: '16px',
          minHeight: 0,
          minWidth: 0,
          flexGrow: 1,
        }}
      >
        {activeVideoWorkspace === 'library' ? (
          <VideoGroupSidebar
            groups={groups}
            translations={groupTranslations}
            videos={localVideos}
            tags={tags}
            activeGroupId={activeGroupId}
            activeTag={activeTag}
            locale={i18n.language}
            onSelectGroup={setActiveGroupId}
            onSelectTag={setActiveTag}
            onCreateGroup={handleCreateGroup}
            onRenameGroup={handleRenameGroup}
            onSaveTranslations={handleSaveGroupTranslations}
            onDeleteGroup={handleDeleteGroup}
          />
        ) : null}

        <main
          className="video-library-main"
          aria-busy={isRefreshingData}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <div
            className={`video-refresh-indicator ${isRefreshingData ? 'is-visible' : ''}`}
            role="status"
            aria-label="Refreshing video library"
          />
          {activeVideoWorkspace === 'douyin' ? (
            <DouyinFavoritesPanel showToast={showToast} workspace />
          ) : (
            <>
          <section
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
            }}
          >
            <span
              style={{
                ...videoEngineBadgeStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                border: `1px solid ${videoEngineBadgeStyle.borderColor}`,
                borderRadius: '999px',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {isVideoEngineLoading && (
                <span className="video-engine-loading-dot" aria-hidden="true" />
              )}
              {videoEngineStatus.status === 'error' ? (
                <AlertTriangle size={13} />
              ) : (
                <Download size={13} />
              )}
              {t(videoEngineLabelKey)}
            </span>
            <span
              title={videoEngineStatus.message || ''}
              style={{
                minWidth: 0,
                flexGrow: 1,
                color: 'var(--text-muted)',
                fontSize: '11.5px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {videoEngineStatus.message || t('videos.video_engine_ready_hint')}
            </span>
            <button
              type="button"
              className={`btn sm video-engine-load-button ${isVideoEngineLoading ? 'is-loading' : ''}`}
              onClick={handleLoadVideoEngine}
              disabled={isVideoEngineLoading}
              aria-busy={isVideoEngineLoading}
              style={{ flexShrink: 0 }}
            >
              <RefreshCw size={13} className={isVideoEngineLoading ? 'animate-spin' : undefined} />
              {isVideoEngineLoading
                ? t('videos.video_engine_loading_short')
                : videoEngineStatus.status === 'idle'
                  ? t('videos.btn_load_video_engine')
                  : t('videos.btn_reload_video_engine')}
            </button>
          </section>

          <form
            onSubmit={handleParseUrl}
            className="card"
            style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
          >
            <input
              className="form-field"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder={t('videos.input_url_placeholder')}
              style={{ flex: '1 1 260px', minWidth: 0 }}
            />
            <button
              type="submit"
              className="btn primary"
              disabled={isParsingUrl}
              style={{ flexShrink: 0 }}
            >
              <Search size={14} />
              {isParsingUrl ? t('videos.status_parsing') : t('videos.btn_parse_url')}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={handleOpenVideoSettings}
              title={t('videos.download_settings_hint')}
              style={{ flexShrink: 0 }}
            >
              <SlidersHorizontal size={14} />
              {t('videos.settings_shortcut')}
            </button>
          </form>

          <section
            className="card"
            style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                minWidth: 0,
              }}
            >
              <strong
                title={`${t('videos.video_list_title')} (${filteredLocalVideos.length})`}
                style={{
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flex: '1 1 132px',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <Database size={14} />
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('videos.video_list_title')} ({filteredLocalVideos.length})
                </span>
              </strong>
              <button
                type="button"
                className="btn sm ghost"
                disabled={visibleVideoIds.length === 0}
                onClick={() =>
                  setBulkSelectedVideoIds((current) =>
                    toggleVisibleBulkSelection(visibleVideoIds, current),
                  )
                }
                style={{ height: '30px', flex: '0 0 auto' }}
              >
                {t(
                  bulkVisibleSelectionAction === 'invert'
                    ? bulkActionLabels.invertVisible
                    : bulkActionLabels.selectVisible,
                )}
              </button>
              <select
                className="form-field"
                value={videoSort.key}
                onChange={(event) =>
                  setVideoSort({ key: event.target.value as VideoSortKey, direction: 'desc' })
                }
                style={{ width: '104px', height: '30px', flex: '0 0 104px' }}
              >
                <option value="default">{t('videos.sort_default')}</option>
                <option value="recently_added">{t('videos.sort_recently_added')}</option>
                <option value="recently_downloaded">{t('videos.sort_recently_downloaded')}</option>
                <option value="download_batch">{t('videos.sort_download_batch')}</option>
                <option value="title">{t('videos.sort_title')}</option>
                <option value="duration">{t('videos.sort_duration')}</option>
                <option value="status">{t('videos.sort_status')}</option>
                <option value="group">{t('videos.sort_group')}</option>
              </select>
              {videoSort.key !== 'default' && (
                <button
                  type="button"
                  className="btn sm btn-icon"
                  title={t(`videos.sort_${videoSort.direction}`)}
                  aria-label={t(`videos.sort_${videoSort.direction}`)}
                  aria-pressed={videoSort.direction === 'asc'}
                  onClick={() =>
                    setVideoSort((current) => ({
                      ...current,
                      direction: toggleSortDirection(current.direction),
                    }))
                  }
                  style={{
                    width: '30px',
                    height: '30px',
                    minWidth: '30px',
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '0 0 30px',
                  }}
                >
                  {getSortDirectionIconName(videoSort.direction) === 'sort-asc' ? (
                    <SortAsc size={14} />
                  ) : (
                    <SortDesc size={14} />
                  )}
                </button>
              )}
              <input
                className="form-field"
                placeholder={t('videos.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: '1 1 180px', minWidth: '140px', maxWidth: '260px', height: '30px' }}
              />
            </div>

            {bulkSelectedVideoIds.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                  alignItems: 'center',
                  columnGap: '10px',
                  rowGap: '8px',
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--color-border)',
                  backgroundColor: 'var(--bg-surface)',
                }}
              >
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', flex: '0 0 auto' }}>
                  {t(bulkActionLabels.selectedCount, { count: bulkSelectedVideoIds.length })}
                </span>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    minWidth: 0,
                    flexWrap: 'wrap',
                  }}
                >
                  <button className="btn sm" onClick={() => setBulkMetadataMode('group')}>
                    {t(bulkActionLabels.group)}
                  </button>
                  <button className="btn sm" onClick={() => setBulkMetadataMode('tags')}>
                    {t(bulkActionLabels.tags)}
                  </button>
                  {bulkMetadataMode === 'group' && (
                    <select
                      className="form-field"
                      autoFocus
                      onChange={(event) => {
                        const groupId = parseBulkGroupPickerValue(event.target.value)
                        if (groupId !== undefined) handleBulkMoveToGroup(groupId)
                      }}
                      defaultValue="__choose__"
                      style={{ width: '180px', height: '30px' }}
                    >
                      <option value="__choose__" disabled>
                        {t('videos.bulk_choose_group')}
                      </option>
                      <option value="__none__">{t('videos.group_none')}</option>
                      {groupOptions.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.path}
                        </option>
                      ))}
                    </select>
                  )}
                  {bulkMetadataMode === 'tags' && (
                    <div
                      style={{
                        display: 'inline-grid',
                        gridTemplateColumns: 'minmax(120px, 180px) 30px 30px',
                        alignItems: 'center',
                        gap: '6px',
                        maxWidth: '100%',
                      }}
                    >
                      <input
                        className="form-field"
                        value={bulkTagDraft}
                        onChange={(event) => setBulkTagDraft(event.target.value)}
                        autoFocus
                        style={{ width: '100%', height: '30px', minWidth: 0 }}
                      />
                      <button
                        type="button"
                        className="btn sm btn-icon"
                        title={t(bulkTagButtonLabels.add)}
                        aria-label={t(bulkTagButtonLabels.add)}
                        onClick={() => handleBulkUpdateTags('add')}
                        style={{ width: '30px', height: '30px', minWidth: '30px', padding: 0 }}
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn sm btn-icon"
                        title={t(bulkTagButtonLabels.remove)}
                        aria-label={t(bulkTagButtonLabels.remove)}
                        onClick={() => handleBulkUpdateTags('remove')}
                        style={{ width: '30px', height: '30px', minWidth: '30px', padding: 0 }}
                      >
                        <Minus size={13} />
                      </button>
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginLeft: 'auto',
                    flex: '0 0 auto',
                  }}
                >
                  <button
                    type="button"
                    className="btn sm btn-icon ghost"
                    title={t(bulkActionLabels.cancel)}
                    aria-label={t(bulkActionLabels.cancel)}
                    onClick={() => {
                      setBulkSelectedVideoIds([])
                      setBulkMetadataMode(null)
                      setBulkTagDraft('')
                      setIsBulkMoreMenuOpen(false)
                    }}
                    style={{
                      width: '30px',
                      height: '30px',
                      minWidth: '30px',
                      borderColor: 'transparent',
                      backgroundColor: 'transparent',
                    }}
                  >
                    <X size={14} />
                  </button>
                  <div
                    onMouseEnter={() => setIsBulkMoreMenuOpen(true)}
                    onMouseLeave={() => setIsBulkMoreMenuOpen(false)}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setIsBulkMoreMenuOpen(false)
                      }
                    }}
                    style={{ position: 'relative', flex: '0 0 auto' }}
                  >
                    <button
                      type="button"
                      className="btn sm btn-icon"
                      title={t(bulkActionLabels.more)}
                      aria-label={t(bulkActionLabels.more)}
                      aria-haspopup="menu"
                      aria-expanded={isBulkMoreMenuOpen}
                      onFocus={() => setIsBulkMoreMenuOpen(true)}
                      onClick={() => setIsBulkMoreMenuOpen((current) => !current)}
                      style={{
                        width: '30px',
                        height: '30px',
                        minWidth: '30px',
                        borderColor: 'transparent',
                        backgroundColor: 'transparent',
                      }}
                    >
                      <MoreVertical size={15} />
                    </button>
                    {isBulkMoreMenuOpen && (
                      <div
                        role="menu"
                        style={{
                          position: 'absolute',
                          top: '34px',
                          right: 0,
                          zIndex: 20,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          minWidth: '128px',
                          padding: '6px',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-card)',
                          backgroundColor: 'var(--bg-surface)',
                          boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16)',
                        }}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="btn sm"
                          onClick={handleBulkDownloadSelected}
                          style={{ justifyContent: 'flex-start', width: '100%' }}
                        >
                          <Download size={13} />
                          {t('videos.bulk_download_selected')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="btn sm"
                          onClick={handleBulkDeleteSelected}
                          style={{
                            justifyContent: 'flex-start',
                            width: '100%',
                            color: 'var(--color-danger)',
                          }}
                        >
                          <Trash2 size={13} />
                          {t('videos.bulk_delete_selected')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}
            >
              {filteredLocalVideos.length === 0 ? (
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '12.5px',
                    padding: '32px',
                    textAlign: 'center',
                  }}
                >
                  {t('videos.empty_library_tip')}
                </p>
              ) : (
                filteredLocalVideos.map((video: any) => {
                  const status = normalizeVideoStatus(video.status)
                  const rowStyle = getVideoRowStyle(video)
                  const badgeTone = getStatusBadgeTone(video.status)
                  const canPlay = canPlayVideoRecord(video)
                  const downloadAction = getVideoRowDownloadAction(video)
                  const isBulkSelected = bulkSelectedVideoIds.includes(video.id)
                  const downloadTitle =
                    downloadAction.reason === 'retry'
                      ? t('videos.btn_retry_download')
                      : downloadAction.reason === 'active'
                        ? t(`videos.status_${status}`)
                        : downloadAction.reason === 'missing-source'
                          ? t('videos.toast_missing_download_source')
                          : t('videos.btn_download')
                  const badgeStyle =
                    badgeTone === 'danger'
                      ? { backgroundColor: 'rgba(220, 38, 38, 0.12)', color: '#b91c1c' }
                      : badgeTone === 'success'
                        ? { backgroundColor: 'rgba(34, 197, 94, 0.14)', color: '#15803d' }
                        : badgeTone === 'accent'
                          ? { backgroundColor: 'rgba(14, 165, 233, 0.14)', color: '#0369a1' }
                          : badgeTone === 'muted'
                            ? { backgroundColor: 'rgba(100, 116, 139, 0.16)', color: '#475569' }
                            : {
                                backgroundColor: 'rgba(148, 163, 184, 0.14)',
                                color: 'var(--text-muted)',
                              }
                  return (
                    <article
                      key={video.id}
                      className={`video-library-row${
                        selectedVideo?.id === video.id ? ' is-active' : ''
                      }${isBulkSelected ? ' is-checked' : ''}`}
                      data-status={status}
                      onClick={() => {
                        setSelectedVideo(video)
                        updateDrawer('open-details')
                      }}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '18px 36px minmax(0, 1fr) auto',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px',
                        border: `1px solid ${selectedVideo?.id === video.id ? 'var(--color-accent)' : rowStyle.borderColor}`,
                        borderRadius: '8px',
                        backgroundColor: rowStyle.backgroundColor,
                        opacity: rowStyle.opacity,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isBulkSelected}
                        aria-label={t(
                          isBulkSelected
                            ? 'videos.bulk_deselect_video'
                            : 'videos.bulk_select_video',
                          {
                            title: video.title,
                          },
                        )}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setBulkSelectedVideoIds((current) =>
                            checked
                              ? Array.from(new Set([...current, video.id]))
                              : current.filter((id) => id !== video.id),
                          )
                        }}
                        style={{
                          width: '14px',
                          height: '14px',
                          opacity: bulkSelectedVideoIds.length > 0 ? 1 : undefined,
                        }}
                      />
                      <button
                        className={`btn sm btn-icon video-library-row__play ${canPlay ? 'primary' : ''}`}
                        disabled={!canPlay}
                        onClick={(event) => {
                          event.stopPropagation()
                          handlePlayVideo(video)
                        }}
                        style={{ opacity: canPlay ? 1 : 0.45 }}
                      >
                        <Play size={14} fill={canPlay ? '#fff' : 'none'} />
                      </button>
                      <div className="video-library-row__body" style={{ minWidth: 0 }}>
                        <h4
                          className="video-library-row__title"
                          title={video.title}
                          style={{
                            display: 'block',
                            maxWidth: '100%',
                            minWidth: 0,
                            margin: 0,
                            fontSize: '13px',
                            fontWeight: 700,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {video.title}
                        </h4>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                            {video.source || 'local'} ·{' '}
                            {getVideoDurationLabel(video) || t('videos.duration_unknown')} ·{' '}
                            {video.group_name || t('videos.uncategorized')}
                          </p>
                          <span
                            style={{
                              ...badgeStyle,
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: '999px',
                              lineHeight: 1.4,
                            }}
                          >
                            {t(`videos.status_${status}`)}
                          </span>
                        </div>
                        {status === 'downloading' && (
                          <div style={{ display: 'grid', gap: '4px', marginTop: '6px' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                              {t(getVideoDownloadPhaseKey(video))} ·{' '}
                              {t('videos.download_progress_label')}{' '}
                              {getProgressPercentLabel(video.download_progress || 0)}
                            </span>
                            <div
                              style={{
                                height: '6px',
                                borderRadius: '999px',
                                backgroundColor: 'var(--bg-muted)',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  width: `${Math.max(0, Math.min(100, video.download_progress || 0))}%`,
                                  height: '100%',
                                  backgroundColor: 'var(--color-accent)',
                                  transition: 'width 0.18s ease',
                                }}
                              />
                            </div>
                          </div>
                        )}
                        {status === 'download_failed' && video.download_error && (
                          <p
                            style={{
                              color: 'var(--color-danger)',
                              fontSize: '10.5px',
                              marginTop: '4px',
                            }}
                          >
                            {String(video.download_error).slice(0, 160)}
                          </p>
                        )}
                        {status === 'invalid' && video.invalid_reason && (
                          <p
                            style={{
                              color: 'var(--text-muted)',
                              fontSize: '10.5px',
                              marginTop: '4px',
                            }}
                          >
                            {String(video.invalid_reason).slice(0, 160)}
                          </p>
                        )}
                        <div
                          style={{
                            display: 'flex',
                            gap: '4px',
                            flexWrap: 'wrap',
                            marginTop: '4px',
                          }}
                        >
                          {(video.tags || []).map((tagName: string) => {
                            const chip = getChipStyle(tagName)
                            return (
                              <span
                                key={tagName}
                                style={{
                                  fontSize: '10.5px',
                                  padding: '2px 6px',
                                  borderRadius: '999px',
                                  backgroundColor: chip.backgroundColor,
                                  color: chip.color,
                                  border: `1px solid ${chip.borderColor}`,
                                }}
                              >
                                {tagName}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                      <div
                        className="video-library-row__actions"
                        style={{ display: 'flex', gap: '6px' }}
                      >
                        {downloadAction.visible && (
                          <button
                            className="btn sm btn-icon"
                            disabled={downloadAction.disabled}
                            title={downloadTitle}
                            onClick={(event) => {
                              event.stopPropagation()
                              handleDownloadVideoFromList(video)
                            }}
                            style={{
                              opacity: downloadAction.disabled ? 0.45 : 1,
                            }}
                          >
                            <Download size={14} />
                          </button>
                        )}
                        <button
                          className="btn sm btn-icon"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleDeleteVideo(video.id)
                          }}
                        >
                          <Trash2 size={14} color="var(--color-danger)" />
                        </button>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>
            </>
          )}
        </main>
      </div>

      {isDrawerMounted && (
        <ViewportPortal>
          <div
            ref={drawerOverlayRef}
            aria-hidden={!drawerState.open}
            onClick={() => updateDrawer('outside-click')}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 900,
              width: '100vw',
              height: '100vh',
              margin: 0,
              backgroundColor: 'var(--overlay-drawer-bg)',
              backdropFilter: 'blur(var(--overlay-drawer-blur))',
              WebkitBackdropFilter: 'blur(var(--overlay-drawer-blur))',
              display: 'flex',
              justifyContent: 'flex-end',
              pointerEvents: drawerState.open ? 'auto' : 'none',
              willChange: 'opacity',
            }}
          >
            <aside
              ref={drawerPanelRef}
              onClick={(event) => event.stopPropagation()}
              className="card"
              style={{
                width: '360px',
                maxWidth: 'calc(100vw - 24px)',
                height: '100%',
                borderRadius: 0,
                borderTop: 0,
                borderRight: 0,
                borderBottom: 0,
                borderLeft: '1px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxShadow: 'var(--shadow-lg, 0 18px 45px rgba(15, 23, 42, 0.18))',
                willChange: 'transform, opacity',
              }}
            >
              <header style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '13px' }}>{t(getVideoDrawerTitleKey())}</strong>
                <button
                  className="btn sm btn-icon"
                  onClick={() => updateDrawer('close')}
                  style={{ marginLeft: 'auto' }}
                >
                  <X size={14} />
                </button>
              </header>

              <div
                style={{
                  minHeight: 0,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {selectedVideo ? (
                    <>
                      {(() => {
                        const detailsEditable = canEditVideoDetails(selectedVideo)
                        const selectedStatus = normalizeVideoStatus(selectedVideo.status)
                        const sourceUrl = getVideoSourceUrl(selectedVideo)
                        return (
                          <>
                            <label
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                fontSize: '11px',
                              }}
                            >
                              {t('videos.title_label')}
                              <input
                                className="form-field"
                                value={draftTitle}
                                onChange={(event) => setDraftTitle(event.target.value)}
                                disabled={!detailsEditable}
                              />
                            </label>
                            {selectedStatus === 'downloading' && (
                              <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                                {t('videos.details_readonly_downloading')}
                              </p>
                            )}
                            {selectedStatus === 'invalid' && (
                              <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                                {t('videos.details_readonly_invalid')}
                              </p>
                            )}
                            <label
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                fontSize: '11px',
                              }}
                            >
                              {t('videos.source_url_label')}
                              {sourceUrl ? (
                                <a
                                  href={sourceUrl}
                                  title={sourceUrl}
                                  onClick={async (event) => {
                                    event.preventDefault()
                                    const res = await api.openExternal?.(sourceUrl)
                                    if (res && !res.success)
                                      showToast(res.error || t('videos.toast_playback_failed'))
                                  }}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    color: 'var(--color-accent)',
                                    fontSize: '12px',
                                    lineHeight: 1.5,
                                    textDecoration: 'none',
                                  }}
                                >
                                  <ExternalLink size={13} style={{ flexShrink: 0 }} />
                                  <span
                                    style={{
                                      minWidth: 0,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {sourceUrl}
                                  </span>
                                </a>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                                  -
                                </span>
                              )}
                            </label>
                          </>
                        )
                      })()}
                      <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        {selectedVideo.source || 'local'} · {selectedVideo.status || 'unclassified'}
                      </p>
                      <label
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          fontSize: '11px',
                        }}
                      >
                        {t('videos.groups_title')}
                        <div>
                          <button
                            ref={groupDropdownButtonRef}
                            type="button"
                            className="form-field"
                            onClick={toggleGroupDropdown}
                            disabled={!selectedDetailsEditable}
                            style={{
                              width: '100%',
                              height: '34px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '8px',
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {getSelectedGroupPathLabel(
                                groupOptions,
                                draftGroupId,
                                t('videos.uncategorized'),
                              )}
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>⌄</span>
                          </button>
                          {isGroupDropdownOpen && groupDropdownFrame && (
                            <ViewportPortal>
                              <div
                                ref={groupDropdownPanelRef}
                                style={{
                                  position: 'fixed',
                                  top: `${groupDropdownFrame.top}px`,
                                  left: `${groupDropdownFrame.left}px`,
                                  width: `${groupDropdownFrame.width}px`,
                                  zIndex: 1200,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '6px',
                                  maxHeight: `${groupDropdownFrame.maxHeight}px`,
                                  padding: '8px',
                                  border: '1px solid var(--color-border)',
                                  borderRadius: '8px',
                                  backgroundColor: 'var(--bg-surface)',
                                  boxShadow: 'var(--shadow-lg, 0 18px 45px rgba(15, 23, 42, 0.18))',
                                  overflow: 'hidden',
                                }}
                              >
                                <input
                                  className="form-field"
                                  value={groupSearchQuery}
                                  onChange={(e) => setGroupSearchQuery(e.target.value)}
                                  placeholder={t('videos.group_search_placeholder')}
                                  autoFocus
                                  style={{ height: '30px' }}
                                />
                                <div
                                  style={{
                                    maxHeight: `${Math.max(80, groupDropdownFrame.maxHeight - 58)}px`,
                                    minHeight: 0,
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                  }}
                                >
                                  <button
                                    type="button"
                                    className={`btn sm ${!draftGroupId ? 'primary' : ''}`}
                                    disabled={!selectedDetailsEditable}
                                    onClick={() => {
                                      setDraftGroupId(null)
                                      setIsGroupDropdownOpen(false)
                                      setGroupSearchQuery('')
                                    }}
                                    style={{ justifyContent: 'flex-start' }}
                                  >
                                    {t('videos.uncategorized')}
                                  </button>
                                  {filteredGroupOptions.length === 0 ? (
                                    <span
                                      style={{
                                        color: 'var(--text-muted)',
                                        fontSize: '11px',
                                        padding: '8px',
                                      }}
                                    >
                                      {t('videos.empty_group_search_tip')}
                                    </span>
                                  ) : (
                                    filteredGroupOptions.map((group) => (
                                      <button
                                        key={group.id}
                                        type="button"
                                        className={`btn sm ${draftGroupId === group.id ? 'primary' : ''}`}
                                        disabled={!selectedDetailsEditable}
                                        onClick={() => {
                                          setDraftGroupId(group.id)
                                          setIsGroupDropdownOpen(false)
                                          setGroupSearchQuery('')
                                        }}
                                        style={{
                                          justifyContent: 'flex-start',
                                          paddingLeft: `${8 + Math.min(group.depth, 5) * 12}px`,
                                        }}
                                        title={group.path}
                                      >
                                        <span
                                          style={{
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {group.path}
                                        </span>
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            </ViewportPortal>
                          )}
                        </div>
                      </label>
                      <section
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          fontSize: '11px',
                        }}
                      >
                        {t('videos.tags_title')}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {tags.map((tagItem) => {
                            const selected = selectedTagNames.includes(tagItem.name)
                            const chip = getChipStyle(tagItem.name)
                            return (
                              <button
                                key={tagItem.id}
                                className={`btn sm ${selected ? 'primary' : ''}`}
                                disabled={!selectedDetailsEditable}
                                onClick={() =>
                                  setSelectedTagNames((current) =>
                                    toggleSelectedTag(current, tagItem.name),
                                  )
                                }
                                style={{
                                  fontSize: '11px',
                                  backgroundColor: selected ? undefined : chip.backgroundColor,
                                  color: selected ? undefined : chip.color,
                                  borderColor: selected ? undefined : chip.borderColor,
                                }}
                              >
                                {tagItem.name}
                              </button>
                            )
                          })}
                          {selectedTagNames
                            .filter((tagName) => !tags.some((tagItem) => tagItem.name === tagName))
                            .map((tagName) => {
                              const chip = getChipStyle(tagName)
                              return (
                                <button
                                  key={tagName}
                                  className="btn sm"
                                  disabled={!selectedDetailsEditable}
                                  onClick={() =>
                                    setSelectedTagNames((current) =>
                                      toggleSelectedTag(current, tagName),
                                    )
                                  }
                                  style={{
                                    fontSize: '11px',
                                    backgroundColor: chip.backgroundColor,
                                    color: chip.color,
                                    borderColor: chip.borderColor,
                                  }}
                                >
                                  {tagName}
                                </button>
                              )
                            })}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            className="form-field"
                            value={tagDraft}
                            onChange={(e) => setTagDraft(e.target.value)}
                            disabled={!selectedDetailsEditable}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleAddTagDraft()
                              }
                            }}
                            placeholder={t('videos.tags_input_placeholder')}
                            style={{ minWidth: 0, height: '30px' }}
                          />
                          <button
                            className="btn sm"
                            onClick={handleAddTagDraft}
                            disabled={!selectedDetailsEditable}
                          >
                            {t('videos.btn_add_tag')}
                          </button>
                        </div>
                      </section>
                      <button
                        className="btn primary sm"
                        disabled={!selectedDetailsEditable}
                        onClick={() =>
                          handleSaveVideoDetails(
                            selectedVideo.id,
                            draftTitle,
                            draftGroupId,
                            selectedTagNames,
                          )
                        }
                      >
                        {t('common.save')}
                      </button>
                      {selectedVideo.diagnostic_message && (
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            color: 'var(--text-muted)',
                            fontSize: '11px',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          <AlertTriangle size={14} />
                          {selectedVideo.diagnostic_message}
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {t('videos.empty_details_tip')}
                    </p>
                  )}
                </section>
              </div>
            </aside>
          </div>
        </ViewportPortal>
      )}

      {parsedData && (
        <ViewportPortal>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              margin: 0,
              backgroundColor: 'var(--overlay-dialog-bg)',
              backdropFilter: 'blur(var(--overlay-dialog-blur))',
              WebkitBackdropFilter: 'blur(var(--overlay-dialog-blur))',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              className="card"
              style={{
                width: '620px',
                maxHeight: '82vh',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 800 }}>
                    {t('videos.parse_result_title')}
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                    {parsedData.title || parsedData.playlistTitle}
                  </p>
                </div>
                <button className="btn sm btn-icon" onClick={closeParsedData}>
                  <X size={14} />
                </button>
              </div>
              {parsedData.diagnostics?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {parsedData.diagnostics.map((diagnostic: any, index: number) => (
                    <p key={index} style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                      {diagnostic.message}
                    </p>
                  ))}
                </div>
              )}
              {parsedItems.length > 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {shouldEditParsedPlaylistTitle && (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        {t('videos.playlist_title_label')}
                      </span>
                      <input
                        className="form-field"
                        value={editablePlaylistTitle}
                        onChange={(event) => setEditablePlaylistTitle(event.target.value)}
                        placeholder={t('videos.playlist_title_placeholder')}
                      />
                    </label>
                  )}
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}
                  >
                    <input
                      type="checkbox"
                      checked={bulkSelection.checked}
                      ref={(node) => {
                        if (node) node.indeterminate = bulkSelection.indeterminate
                      }}
                      onChange={() =>
                        setSelectedVideoIds(toggleBulkSelection(parsedItemIds, selectedVideoIds))
                      }
                    />
                    {t('videos.select_all_parts')}
                  </label>
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                  gap: '8px',
                }}
              >
                <label style={{ display: 'grid', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {t('videos.parse_import_group_label')}
                  </span>
                  <select
                    className="form-field"
                    value={parseImportGroupId ?? ''}
                    onChange={(event) =>
                      setParseImportGroupId(event.target.value ? Number(event.target.value) : null)
                    }
                  >
                    <option value="">{t('videos.group_none')}</option>
                    {groupOptions.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.path}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {t('videos.parse_import_tags_label')}
                  </span>
                  <input
                    className="form-field"
                    value={parseImportTagDraft}
                    onChange={(event) => setParseImportTagDraft(event.target.value)}
                  />
                </label>
              </div>
              <div
                style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {parsedItems.map((item: any) => {
                  const checked = selectedVideoIds.includes(item.id)
                  return (
                    <label
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '20px minmax(0, 1fr) auto',
                        gap: '10px',
                        alignItems: 'center',
                        padding: '8px',
                        border: '1px solid var(--color-border)',
                        borderRadius: '6px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedVideoIds((prev) =>
                            checked ? prev.filter((id) => id !== item.id) : [...prev, item.id],
                          )
                        }
                      />
                      <span
                        style={{
                          fontSize: '12.5px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.partIndex ? `P${item.partIndex} · ` : ''}
                        {item.title}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        {item.durationLabel}
                      </span>
                    </label>
                  )
                })}
                {parsedItems.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '16px' }}>
                    {t('videos.empty_parse_items_tip')}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn" onClick={closeParsedData}>
                  {t(parseActionLabels.cancel)}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleAddSelectedToVideoList}
                  disabled={isAddingToQueue}
                >
                  {t(parseActionLabels.addToList)}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={handleDownloadSelected}
                  disabled={isAddingToQueue}
                >
                  {isAddingToQueue ? t('videos.status_queued') : t(parseActionLabels.download)}
                </button>
              </div>
            </div>
          </div>
        </ViewportPortal>
      )}

      {playingVideo && (
        <ViewportPortal>
          <div
            style={{
              position: 'fixed',
              top: playbackChrome.topInset,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: '#000',
              color: '#fff',
              zIndex: 2000,
              display: 'grid',
              gridTemplateRows: '52px minmax(0, 1fr)',
              ...({ WebkitAppRegion: 'no-drag' } as any),
            }}
          >
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '0 18px',
                borderBottom: '1px solid rgba(255,255,255,0.12)',
                ...({ WebkitAppRegion: playbackChrome.headerAppRegion } as any),
              }}
            >
              <button
                className="btn sm"
                style={{
                  backgroundColor: '#222',
                  borderColor: '#444',
                  color: '#fff',
                  flexShrink: 0,
                  ...({ WebkitAppRegion: 'no-drag' } as any),
                }}
                onClick={() => {
                  setPlayingVideo(null)
                  setPlaybackUrl('')
                }}
              >
                <X size={14} />
                {t('common.close')}
              </button>
              <span
                style={{
                  fontSize: '13px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  flexGrow: 1,
                  textAlign: 'center',
                }}
              >
                {playingVideo.title}
              </span>
              <select
                className="form-field"
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                style={{
                  width: '92px',
                  flexShrink: 0,
                  backgroundColor: '#222',
                  color: '#fff',
                  borderColor: '#444',
                  ...({ WebkitAppRegion: 'no-drag' } as any),
                }}
              >
                <option value="0.5">0.5x</option>
                <option value="1">1.0x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2.0x</option>
                <option value="3">3.0x</option>
              </select>
            </header>
            <video
              ref={videoRef}
              src={playbackUrl}
              controls
              autoPlay
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                backgroundColor: '#000',
              }}
            />
          </div>
        </ViewportPortal>
      )}
    </div>
  )
}

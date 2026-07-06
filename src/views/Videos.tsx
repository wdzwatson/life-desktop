import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  Edit2,
  ExternalLink,
  FolderPlus,
  Play,
  RefreshCw,
  Search,
  SortAsc,
  SortDesc,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import {
  canStartVideoDownloadWithEngine,
  canPlayVideo,
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
  getVideoListDownloadAction,
  getVideoListItemBackground,
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
  getBulkMetadataActionLabels,
  getBulkTagEditButtonLabels,
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
} from './videoStateUtils'
import type { VideoSortState } from './videoStateUtils'
import type { VideoGroupRecord, VideoRecord } from './videoTypes'
import type { SortDirection, VideoSortKey } from './videoTypes'

interface VideoTag {
  id: number
  name: string
  color?: string
}

type FilterId = number | null | 'all'

function getVideoDownloadPhaseKey(video: VideoRecord) {
  if (video.download_phase === 'processing') return 'videos.download_stage_processing'
  if (video.download_phase === 'downloading') return 'videos.download_stage_downloading'
  if (video.download_phase === 'preparing') return 'videos.download_stage_preparing'
  if ((video.download_progress || 0) >= 99) return 'videos.download_stage_processing'
  return 'videos.download_stage_preparing'
}

export const Videos: React.FC = () => {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
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
  const [downloadQueue, setDownloadQueue] = useState<any[]>([])
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(3)
  const [groups, setGroups] = useState<VideoGroupRecord[]>([])
  const [tags, setTags] = useState<VideoTag[]>([])
  const [localVideos, setLocalVideos] = useState<VideoRecord[]>([])
  const [bulkSelectedVideoIds, setBulkSelectedVideoIds] = useState<number[]>([])
  const [bulkTagDraft, setBulkTagDraft] = useState('')
  const [bulkMetadataMode, setBulkMetadataMode] = useState<'group' | 'tags' | 'more' | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [videoSort, setVideoSort] = useState<VideoSortState>({ key: 'default', direction: 'desc' })
  const [activeGroupId, setActiveGroupId] = useState<FilterId>('all')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<any | null>(null)
  const [drawerState, setDrawerState] = useState<VideoDrawerState>({ open: false })
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  const [groupDropdownFrame, setGroupDropdownFrame] = useState<ReturnType<typeof getFloatingDropdownFrame> | null>(null)
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
  const groupDropdownButtonRef = useRef<HTMLButtonElement | null>(null)
  const groupDropdownPanelRef = useRef<HTMLDivElement | null>(null)

  const loadData = async () => {
    if (!api) return

    const settings = await api.getSettings?.()
    setMaxConcurrentDownloads((settings as Record<string, any>)?.maxDownloads ?? 3)

    const groupsRes = await api.dbQuery(
      'videos',
      'SELECT * FROM video_groups ORDER BY sort_order ASC, name ASC',
    )
    if (groupsRes?.success) setGroups(groupsRes.data)

    const tagsRes = await api.dbQuery('videos', 'SELECT * FROM video_tags ORDER BY name ASC')
    if (tagsRes?.success) setTags(tagsRes.data)

    const videosRes = await api.dbQuery(
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
    )
    if (videosRes?.success) {
      const nextVideos = videosRes.data.map((video: any) => ({
        ...video,
        tags: video.tag_names ? String(video.tag_names).split(',').filter(Boolean) : [],
      }))
      setLocalVideos(nextVideos)
      setSelectedVideo((current: any) =>
        current ? nextVideos.find((video: any) => video.id === current.id) || null : null,
      )
    }
  }

  useEffect(() => {
    loadData()

    if (!api) return
    const unsubProgress = api.onDownloadProgress((data: any) => {
      setLocalVideos((prev) =>
        prev.map((video) =>
          (data.videoId && video.id === data.videoId) || video.title === data.title
            ? {
                ...video,
                status: 'downloading',
                download_progress: typeof data.progress === 'number' ? data.progress : video.download_progress,
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
      loadData()
    })
    const unsubFailed = api.onDownloadFailed?.((data: any) => {
      showToast(t('videos.toast_download_failed', getDownloadFailureToastData(data.title, data.message)))
      setDownloadQueue((prev) =>
        prev.map((item) =>
          item.id === data.videoId || item.title === data.title
            ? { ...item, status: 'failed', message: data.message || '' }
            : item,
        ),
      )
      loadData()
    })

    return () => {
      unsubProgress()
      unsubFinished()
      unsubFailed?.()
    }
  }, [userId, i18n.language])

  useEffect(() => {
    if (!api) return
    let disposed = false
    const applyStatus = (status: VideoEngineStatus) => {
      if (!disposed && status?.status) setVideoEngineStatus(status)
    }
    api.getVideoEngineStatus?.().then((status: VideoEngineStatus) => {
      applyStatus(status)
      if (status?.status === 'idle') api.loadVideoEngine?.().then(applyStatus).catch(() => undefined)
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
    setDraftGroupId(draft.groupId)
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

  const groupOptions = useMemo(() => getVideoGroupOptions(groups), [groups])
  const selectedGroupIds = useMemo(
    () => (typeof activeGroupId === 'number' ? getDescendantGroupIds(groups, activeGroupId) : undefined),
    [groups, activeGroupId],
  )
  const filteredGroupOptions = useMemo(() => {
    const query = groupSearchQuery.trim().toLowerCase()
    if (!query) return groupOptions
    const matched = groupOptions.filter((group) => group.path.toLowerCase().includes(query))
    if (
      draftGroupId &&
      !matched.some((group) => group.id === draftGroupId)
    ) {
      const current = groupOptions.find((group) => group.id === draftGroupId)
      return current ? [current, ...matched] : matched
    }
    return matched
  }, [draftGroupId, groupOptions, groupSearchQuery])

  const filteredLocalVideos = useMemo(
    () =>
      sortVideoRecords(
        getVideoLibraryVideos(localVideos, {
          query: searchQuery,
          groupId: activeGroupId,
          groupIds: selectedGroupIds,
          tag: activeTag,
        }),
        videoSort,
      ),
    [localVideos, searchQuery, activeGroupId, selectedGroupIds, activeTag, videoSort],
  )
  const bulkSelectedVideos = useMemo(
    () => localVideos.filter((video) => bulkSelectedVideoIds.includes(video.id)),
    [localVideos, bulkSelectedVideoIds],
  )
  const bulkEditPlan = useMemo(
    () => createBulkMetadataEditPlan(bulkSelectedVideos),
    [bulkSelectedVideos],
  )

  const parsedItems = parsedData?.items || []
  const shouldEditParsedPlaylistTitle = parsedData?.source === 'bilibili' && parsedItems.length > 1
  const parsedItemIds = parsedItems.map((item: any) => item.id)
  const bulkSelection = getBulkSelectionState(parsedItemIds, selectedVideoIds)
  const parseActionLabels = getParseResultActionLabels()
  const bulkActionLabels = getBulkMetadataActionLabels()
  const bulkTagButtonLabels = getBulkTagEditButtonLabels()
  const getQueueItemForVideo = (video: VideoRecord) =>
    downloadQueue.find((item) => item.id === video.id || item.title === video.title)
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
      const insertTagResult = await api.dbQuery('videos', 'INSERT OR IGNORE INTO video_tags (name) VALUES (?)', [tagName])
      if (!insertTagResult?.success) throw new Error(insertTagResult?.error || t('videos.toast_video_details_save_failed'))
      const res = await api.dbQuery('videos', 'SELECT id FROM video_tags WHERE name = ?', [tagName])
      if (!res?.success) throw new Error(res?.error || t('videos.toast_video_details_save_failed'))
      const tagId = res?.data?.[0]?.id
      if (tagId) {
        const linkTagResult = await api.dbQuery(
          'videos',
          'INSERT OR IGNORE INTO video_tag_links (video_id, tag_id) VALUES (?, ?)',
          [videoId, tagId],
        )
        if (!linkTagResult?.success) throw new Error(linkTagResult?.error || t('videos.toast_video_details_save_failed'))
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
          ? { ...item, id: task.id, title: task.title, sourceUrl: task.sourceUrl, status: 'downloading', message: '', progress: 0 }
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
          item.id === task.id || item.title === task.title ? { ...item, status: 'failed', message } : item,
        ),
      )
      await api.dbQuery('videos', 'UPDATE videos SET status = ?, download_error = ?, diagnostic_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        'download_failed',
        message,
        message,
        task.id,
      ])
      showToast(t('videos.toast_download_failed', { title: task.title, error: message }))
    }
    loadData()
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
      loadData()
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
      loadData()

      await runVideoDownloadTasksWithLimit(tasks, maxConcurrentDownloads, runDownloadTask)
    } catch (error: any) {
      showToast(t('videos.toast_download_failed', { title: error?.message || String(error) }))
    } finally {
      setIsAddingToQueue(false)
    }
  }

  const handleDownloadVideoFromList = async (video: VideoRecord) => {
    if (!api) return
    const action = getVideoRowDownloadAction(video)
    if (action.disabled) return
    if (!guardVideoDownload()) return
    const sourceUrl = video.source_url || video.url
    if (!sourceUrl) {
      showToast(t('videos.toast_missing_download_source'))
      return
    }
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

  const handleCreateGroup = async () => {
    if (!api) return
    const name = normalizeVideoGroupName(newGroupName)
    if (!name) {
      showToast(t('videos.toast_group_name_required'))
      return
    }
    const parentId = typeof activeGroupId === 'number' ? activeGroupId : null
    const result = await api.dbQuery(
      'videos',
      'INSERT OR IGNORE INTO video_groups (name, parent_id, sort_order) VALUES (?, ?, ?)',
      [name, parentId, groups.length + 1],
    )
    if (!result?.success) {
      showToast(result?.error || t('videos.toast_group_save_failed'))
      return
    }
    setNewGroupName('')
    setIsCreatingGroup(false)
    showToast(t('videos.toast_group_created'))
    loadData()
  }

  const handleStartEditGroup = (group: VideoGroupRecord) => {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
  }

  const handleSaveGroupName = async (groupId: number) => {
    if (!api) return
    const name = normalizeVideoGroupName(editingGroupName)
    if (!name) {
      showToast(t('videos.toast_group_name_required'))
      return
    }
    const result = await api.dbQuery(
      'videos',
      'UPDATE video_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, groupId],
    )
    if (!result?.success) {
      showToast(result?.error || t('videos.toast_group_save_failed'))
      return
    }
    setEditingGroupId(null)
    setEditingGroupName('')
    showToast(t('videos.toast_group_updated'))
    loadData()
  }

  const handleDeleteGroup = async (group: VideoGroupRecord) => {
    if (!api || !window.confirm(t('videos.confirm_delete_group', { name: group.name }))) return
    const detachResult = await api.dbQuery('videos', 'UPDATE videos SET group_id = NULL WHERE group_id = ?', [
      group.id,
    ])
    if (!detachResult?.success) {
      showToast(detachResult?.error || t('videos.toast_group_save_failed'))
      return
    }
    const promoteResult = await api.dbQuery('videos', 'UPDATE video_groups SET parent_id = ? WHERE parent_id = ?', [
      group.parent_id || null,
      group.id,
    ])
    if (!promoteResult?.success) {
      showToast(promoteResult?.error || t('videos.toast_group_save_failed'))
      return
    }
    const deleteResult = await api.dbQuery('videos', 'DELETE FROM video_groups WHERE id = ?', [group.id])
    if (!deleteResult?.success) {
      showToast(deleteResult?.error || t('videos.toast_group_save_failed'))
      return
    }
    if (activeGroupId === group.id) setActiveGroupId('all')
    if (selectedVideo?.group_id === group.id) setSelectedVideo({ ...selectedVideo, group_id: null, group_name: null })
    if (draftGroupId === group.id) setDraftGroupId(null)
    showToast(t('videos.toast_group_deleted'))
    loadData()
  }

  const handleSaveVideoDetails = async (videoId: number, title: string, groupId: number | null, tagNames: string[]) => {
    if (!api) return
    if (selectedVideo && !canEditVideoDetails(selectedVideo)) return
    const showSaveFailedToast = (message?: string) => {
      showToast(message || t('videos.toast_video_details_save_failed'))
    }
    const groupResult = await api.dbQuery('videos', 'UPDATE videos SET title = ?, group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      title.trim() || selectedVideo?.title || '',
      groupId,
      videoId,
    ])
    if (!groupResult?.success) {
      showSaveFailedToast(groupResult?.error)
      return
    }
    const nextTags = parseTagInput(tagNames.join(','))
    const deleteTagsResult = await api.dbQuery('videos', 'DELETE FROM video_tag_links WHERE video_id = ?', [videoId])
    if (!deleteTagsResult?.success) {
      showSaveFailedToast(deleteTagsResult?.error)
      return
    }
    for (const tagName of nextTags) {
      const insertTagResult = await api.dbQuery('videos', 'INSERT OR IGNORE INTO video_tags (name) VALUES (?)', [tagName])
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
    loadData()
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
    if (!api || !window.confirm(t('videos.confirm_delete'))) return
    await api.dbQuery('videos', 'DELETE FROM videos WHERE id = ?', [id])
    if (selectedVideo?.id === id) setSelectedVideo(null)
    showToast(t('videos.toast_video_deleted'))
    loadData()
  }

  const closeBulkMetadataOperation = async () => {
    setBulkTagDraft('')
    setBulkMetadataMode(null)
    setBulkSelectedVideoIds([])
    await loadData()
  }

  const handleReadonlyOnlyBulkMetadataSelection = async () => {
    if (bulkEditPlan.skippedCount === 0) return false
    showToast(t('videos.bulk_skipped_readonly', { count: bulkEditPlan.skippedCount }))
    await closeBulkMetadataOperation()
    return true
  }

  const showBulkMetadataWriteFailure = (message?: string) => {
    showToast(t('videos.bulk_update_failed', { error: message || t('videos.toast_video_details_save_failed') }))
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
    const names = Array.from(new Set(bulkTagDraft.split(',').map((tag) => tag.trim()).filter(Boolean)))
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
    for (const video of bulkSelectedVideos) {
      const action = getVideoRowDownloadAction(video)
      if (action.visible && !action.disabled) {
        await handleDownloadVideoFromList(video)
      }
    }
    setBulkMetadataMode(null)
    setBulkSelectedVideoIds([])
  }

  const handleBulkDeleteSelected = async () => {
    if (!api) return
    if (!window.confirm(t('videos.confirm_bulk_delete', { count: bulkSelectedVideoIds.length }))) return
    for (const videoId of bulkSelectedVideoIds) {
      const deleteResult = await api.dbQuery('videos', 'DELETE FROM videos WHERE id = ?', [videoId])
      if (!isBulkMetadataWriteResultSuccess(deleteResult)) {
        showBulkMetadataWriteFailure(deleteResult?.error)
        await loadData()
        return
      }
    }
    if (selectedVideo && bulkSelectedVideoIds.includes(selectedVideo.id)) setSelectedVideo(null)
    setBulkMetadataMode(null)
    setBulkSelectedVideoIds([])
    await loadData()
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
      ? { backgroundColor: 'rgba(34, 197, 94, 0.14)', color: '#15803d', borderColor: 'rgba(34, 197, 94, 0.28)' }
      : videoEngineTone === 'danger'
        ? { backgroundColor: 'rgba(220, 38, 38, 0.12)', color: '#b91c1c', borderColor: 'rgba(220, 38, 38, 0.24)' }
        : { backgroundColor: 'rgba(100, 116, 139, 0.12)', color: 'var(--text-muted)', borderColor: 'var(--color-border)' }

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
      <header style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('videos.title')}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('videos.subtitle')}</p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 220px) minmax(0, 1fr)',
          gap: '16px',
          minHeight: 0,
          minWidth: 0,
          flexGrow: 1,
        }}
      >
        <aside className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '12px' }}>{t('videos.groups_title')}</strong>
              <button
                className="btn sm btn-icon"
                onClick={() => {
                  setIsCreatingGroup((current) => !current)
                  setEditingGroupId(null)
                }}
                title={t('videos.btn_new_group')}
              >
                <FolderPlus size={14} />
              </button>
            </div>
            {isCreatingGroup && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <input
                  className="form-field"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCreateGroup()
                    if (event.key === 'Escape') {
                      setIsCreatingGroup(false)
                      setNewGroupName('')
                    }
                  }}
                  placeholder={t('videos.group_name_placeholder')}
                  style={{ minWidth: 0, height: '30px', fontSize: '12px' }}
                />
                <button className="btn sm btn-icon primary" onClick={handleCreateGroup} title={t('common.save')}>
                  <Check size={14} />
                </button>
                <button
                  className="btn sm btn-icon"
                  onClick={() => {
                    setIsCreatingGroup(false)
                    setNewGroupName('')
                  }}
                  title={t('common.cancel')}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
              {[
                ['all', t('videos.all_videos')],
                [null, t('videos.uncategorized')],
              ].map(([id, label]) => (
                <button
                  key={String(id)}
                  className={`btn sm ${activeGroupId === id ? 'primary' : ''}`}
                  onClick={() => setActiveGroupId(id as FilterId)}
                  style={{ justifyContent: 'flex-start' }}
                >
                  {label}
                </button>
              ))}
              {groupOptions.map((group) => {
                const chip = getChipStyle(group.id)
                const active = activeGroupId === group.id
                const editing = editingGroupId === group.id
                return (
                  <div
                    key={group.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                      alignItems: 'center',
                      gap: '4px',
                      paddingLeft: `${Math.min(group.depth, 5) * 12}px`,
                    }}
                  >
                    {editing ? (
                      <input
                        className="form-field"
                        value={editingGroupName}
                        onChange={(event) => setEditingGroupName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') handleSaveGroupName(group.id)
                          if (event.key === 'Escape') {
                            setEditingGroupId(null)
                            setEditingGroupName('')
                          }
                        }}
                        style={{ minWidth: 0, height: '30px', fontSize: '12px' }}
                      />
                    ) : (
                      <button
                        className={`btn sm ${active ? 'primary' : ''}`}
                        onClick={() => setActiveGroupId(group.id)}
                        title={group.name}
                        style={{
                          justifyContent: 'flex-start',
                          minWidth: 0,
                          height: '30px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          backgroundColor: active ? undefined : chip.backgroundColor,
                          color: active ? undefined : chip.color,
                          borderColor: active ? undefined : chip.borderColor,
                        }}
                      >
                        {group.name}
                      </button>
                    )}
                    <button
                      className="btn sm btn-icon"
                      onClick={() => (editing ? handleSaveGroupName(group.id) : handleStartEditGroup(group))}
                      title={editing ? t('common.save') : t('videos.btn_edit_group')}
                    >
                      {editing ? <Check size={14} /> : <Edit2 size={14} />}
                    </button>
                    <button
                      className="btn sm btn-icon"
                      onClick={() => handleDeleteGroup(group)}
                      title={t('videos.btn_delete_group')}
                    >
                      <Trash2 size={14} color="var(--color-danger)" />
                    </button>
                  </div>
                )
              })}
            </div>
          </section>

          <section style={{ minHeight: 0 }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <Tag size={14} />
              {t('videos.tags_title')}
            </strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              {tags.length === 0 ? (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  {t('videos.empty_tags_tip')}
                </span>
              ) : (
                tags.map((tagItem) => {
                  const chip = getChipStyle(tagItem.name)
                  const active = activeTag === tagItem.name
                  return (
                    <button
                      key={tagItem.id}
                      className={`btn sm ${active ? 'primary' : ''}`}
                      onClick={() => setActiveTag(active ? null : tagItem.name)}
                      style={{
                        fontSize: '11px',
                        backgroundColor: active ? undefined : chip.backgroundColor,
                        color: active ? undefined : chip.color,
                        borderColor: active ? undefined : chip.borderColor,
                      }}
                    >
                      {tagItem.name}
                    </button>
                  )
                })
              )}
            </div>
          </section>
        </aside>

        <main style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
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
              {isVideoEngineLoading && <span className="video-engine-loading-dot" aria-hidden="true" />}
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
            <button type="submit" className="btn primary" disabled={isParsingUrl} style={{ flexShrink: 0 }}>
              <Search size={14} />
              {isParsingUrl ? t('videos.status_parsing') : t('videos.btn_parse_url')}
            </button>
          </form>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
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
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t('videos.video_list_title')} ({filteredLocalVideos.length})
                </span>
              </strong>
              <select
                className="form-field"
                value={videoSort.key}
                onChange={(event) =>
                  setVideoSort({ key: event.target.value as VideoSortKey, direction: 'desc' })
                }
                style={{ width: '118px', height: '30px', flex: '0 0 118px' }}
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--color-border)',
                  backgroundColor: 'var(--bg-surface)',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginRight: 'auto' }}>
                  {t(bulkActionLabels.selectedCount, { count: bulkSelectedVideoIds.length })}
                </span>
                <button className="btn sm" onClick={() => setBulkMetadataMode('group')}>
                  {t(bulkActionLabels.group)}
                </button>
                <button className="btn sm" onClick={() => setBulkMetadataMode('tags')}>
                  {t(bulkActionLabels.tags)}
                </button>
                <button className="btn sm" onClick={() => setBulkMetadataMode('more')}>
                  {t(bulkActionLabels.more)}
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    setBulkSelectedVideoIds([])
                    setBulkMetadataMode(null)
                    setBulkTagDraft('')
                  }}
                >
                  {t(bulkActionLabels.cancel)}
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
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      className="form-field"
                      value={bulkTagDraft}
                      onChange={(event) => setBulkTagDraft(event.target.value)}
                      autoFocus
                      style={{ width: '180px', height: '30px' }}
                    />
                    <button
                      className="btn sm"
                      title={t(bulkTagButtonLabels.add)}
                      aria-label={t(bulkTagButtonLabels.add)}
                      onClick={() => handleBulkUpdateTags('add')}
                    >
                      +
                    </button>
                    <button
                      className="btn sm"
                      title={t(bulkTagButtonLabels.remove)}
                      aria-label={t(bulkTagButtonLabels.remove)}
                      onClick={() => handleBulkUpdateTags('remove')}
                    >
                      -
                    </button>
                  </div>
                )}
                {bulkMetadataMode === 'more' && (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button className="btn sm" onClick={handleBulkDownloadSelected}>
                      {t('videos.bulk_download_selected')}
                    </button>
                    <button className="btn sm danger" onClick={handleBulkDeleteSelected}>
                      {t('videos.bulk_delete_selected')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
              {filteredLocalVideos.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', padding: '32px', textAlign: 'center' }}>
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
                            : { backgroundColor: 'rgba(148, 163, 184, 0.14)', color: 'var(--text-muted)' }
                  return (
                    <article
                      key={video.id}
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
                        aria-label={t(isBulkSelected ? 'videos.bulk_deselect_video' : 'videos.bulk_select_video', {
                          title: video.title,
                        })}
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
                        className={`btn sm btn-icon ${canPlay ? 'primary' : ''}`}
                        disabled={!canPlay}
                        onClick={(event) => {
                          event.stopPropagation()
                          handlePlayVideo(video)
                        }}
                        style={{ opacity: canPlay ? 1 : 0.45 }}
                      >
                        <Play size={14} fill={canPlay ? '#fff' : 'none'} />
                      </button>
                      <div style={{ minWidth: 0 }}>
                        <h4
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                            {video.source || 'local'} · {getVideoDurationLabel(video) || t('videos.duration_unknown')} ·{' '}
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
                              {t(getVideoDownloadPhaseKey(video))} · {t('videos.download_progress_label')}{' '}
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
                          <p style={{ color: 'var(--color-danger)', fontSize: '10.5px', marginTop: '4px' }}>
                            {String(video.download_error).slice(0, 160)}
                          </p>
                        )}
                        {status === 'invalid' && video.invalid_reason && (
                          <p style={{ color: 'var(--text-muted)', fontSize: '10.5px', marginTop: '4px' }}>
                            {String(video.invalid_reason).slice(0, 160)}
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
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
                      <div style={{ display: 'flex', gap: '6px' }}>
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
        </main>

      </div>

      {drawerState.open && (
        <div
          onClick={() => updateDrawer('outside-click')}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 900,
            backgroundColor: 'rgba(0,0,0,0.18)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <aside
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
            }}
          >
            <header style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '13px' }}>{t(getVideoDrawerTitleKey())}</strong>
              <button className="btn sm btn-icon" onClick={() => updateDrawer('close')} style={{ marginLeft: 'auto' }}>
                <X size={14} />
              </button>
            </header>

            <div style={{ minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {selectedVideo ? (
                    <>
                      {(() => {
                        const detailsEditable = canEditVideoDetails(selectedVideo)
                        const selectedStatus = normalizeVideoStatus(selectedVideo.status)
                        const sourceUrl = getVideoSourceUrl(selectedVideo)
                        return (
                          <>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
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
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                              {t('videos.source_url_label')}
                              {sourceUrl ? (
                                <a
                                  href={sourceUrl}
                                  title={sourceUrl}
                                  onClick={async (event) => {
                                    event.preventDefault()
                                    const res = await api.openExternal?.(sourceUrl)
                                    if (res && !res.success) showToast(res.error || t('videos.toast_playback_failed'))
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
                                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>-</span>
                              )}
                            </label>
                          </>
                        )
                      })()}
                      <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        {selectedVideo.source || 'local'} · {selectedVideo.status || 'unclassified'}
                      </p>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
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
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {getSelectedGroupPathLabel(
                                groupOptions,
                                draftGroupId,
                                t('videos.uncategorized'),
                              )}
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>⌄</span>
                          </button>
                          {isGroupDropdownOpen && groupDropdownFrame && (
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
                                  <span style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '8px' }}>
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
                          )}
                        </div>
                      </label>
                      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px' }}>
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
                                onClick={() => setSelectedTagNames((current) => toggleSelectedTag(current, tagItem.name))}
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
                                  onClick={() => setSelectedTagNames((current) => toggleSelectedTag(current, tagName))}
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
                          <button className="btn sm" onClick={handleAddTagDraft} disabled={!selectedDetailsEditable}>
                            {t('videos.btn_add_tag')}
                          </button>
                        </div>
                      </section>
                      <button
                        className="btn primary sm"
                        disabled={!selectedDetailsEditable}
                        onClick={() => handleSaveVideoDetails(selectedVideo.id, draftTitle, draftGroupId, selectedTagNames)}
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
                    <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('videos.empty_details_tip')}</p>
                  )}
              </section>
            </div>
          </aside>
        </div>
      )}

      {parsedData && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div className="card" style={{ width: '620px', maxHeight: '82vh', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800 }}>{t('videos.parse_result_title')}</h3>
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
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <input
                    type="checkbox"
                    checked={bulkSelection.checked}
                    ref={(node) => {
                      if (node) node.indeterminate = bulkSelection.indeterminate
                    }}
                    onChange={() => setSelectedVideoIds(toggleBulkSelection(parsedItemIds, selectedVideoIds))}
                  />
                  {t('videos.select_all_parts')}
                </label>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px' }}>
              <label style={{ display: 'grid', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{t('videos.parse_import_group_label')}</span>
                <select
                  className="form-field"
                  value={parseImportGroupId ?? ''}
                  onChange={(event) => setParseImportGroupId(event.target.value ? Number(event.target.value) : null)}
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
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{t('videos.parse_import_tags_label')}</span>
                <input
                  className="form-field"
                  value={parseImportTagDraft}
                  onChange={(event) => setParseImportTagDraft(event.target.value)}
                />
              </label>
            </div>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                    <span style={{ fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.partIndex ? `P${item.partIndex} · ` : ''}
                      {item.title}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{item.durationLabel}</span>
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
      )}

      {playingVideo && (
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
            style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
          />
        </div>
      )}
    </div>
  )
}

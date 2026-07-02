import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Database,
  Download,
  FolderPlus,
  Play,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { canPlayVideo, filterVideos, parseTagInput } from './videoLibraryUtils'
import type { VideoRecord } from './videoTypes'

interface VideoGroup {
  id: number
  name: string
}

interface VideoTag {
  id: number
  name: string
  color?: string
}

type FilterId = number | null | 'all' | 'downloaded' | 'downloading'

export const Videos: React.FC = () => {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
  const userId = useAppStore((state) => state.userId)
  const api = (window as any).electronAPI

  const [videoUrl, setVideoUrl] = useState('')
  const [parsedData, setParsedData] = useState<any | null>(null)
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([])
  const [downloadQueue, setDownloadQueue] = useState<any[]>([])
  const [groups, setGroups] = useState<VideoGroup[]>([])
  const [tags, setTags] = useState<VideoTag[]>([])
  const [localVideos, setLocalVideos] = useState<VideoRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<FilterId>('all')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<any | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [playingVideo, setPlayingVideo] = useState<any | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState('')
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const loadData = async () => {
    if (!api) return

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
             COALESCE(GROUP_CONCAT(t.name), '') as tag_names
      FROM videos v
      LEFT JOIN video_groups g ON g.id = v.group_id
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
      setDownloadQueue((prev) =>
        prev.map((item) =>
          item.title === data.title
            ? { ...item, status: 'downloading', message: data.message || '', progress: data.progress }
            : item,
        ),
      )
    })

    const unsubFinished = api.onDownloadFinished((data: any) => {
      showToast(t('videos.toast_download_finished', { title: data.title }))
      setDownloadQueue((prev) => prev.filter((item) => item.title !== data.title))
      loadData()
    })

    return () => {
      unsubProgress()
      unsubFinished()
    }
  }, [userId, i18n.language])

  useEffect(() => {
    if (!selectedVideo) {
      setTagInput('')
      return
    }
    setTagInput((selectedVideo.tags || []).join(', '))
  }, [selectedVideo?.id])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed
  }, [playbackSpeed, playbackUrl])

  const filteredLocalVideos = useMemo(
    () =>
      filterVideos(localVideos, {
        query: searchQuery,
        groupId: activeGroupId,
        tag: activeTag,
      }),
    [localVideos, searchQuery, activeGroupId, activeTag],
  )

  const parsedItems = parsedData?.items || []

  const handleParseUrl = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!videoUrl.trim() || !api) return

    showToast(t('videos.toast_parsing_url'))
    const data = await api.parseVideoUrl(videoUrl.trim())
    if (data) {
      setParsedData(data)
      setSelectedVideoIds((data.items || []).map((item: any) => item.id))
    }
  }

  const handleImportSelected = async () => {
    if (!parsedData || !api) return
    const selected = parsedItems.filter((item: any) => selectedVideoIds.includes(item.id))
    if (selected.length === 0) {
      showToast(t('videos.toast_select_at_least_one'))
      return
    }

    for (const item of selected) {
      await api.dbQuery(
        'videos',
        `
        INSERT INTO videos
          (title, url, source_url, source_id, playlist_id, playlist_title, part_index, thumbnail_url, duration, source, status, parse_status, diagnostic_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclassified', ?, ?)
        `,
        [
          item.title,
          item.sourceUrl,
          item.sourceUrl,
          item.sourceId,
          item.playlistId || parsedData.playlistId,
          parsedData.playlistTitle,
          item.partIndex,
          item.thumbnailUrl,
          item.durationLabel,
          item.source,
          parsedData.diagnostics?.[0]?.code || 'ok',
          parsedData.diagnostics?.map((diagnostic: any) => diagnostic.message).join('\n') || '',
        ],
      )
    }

    setParsedData(null)
    setVideoUrl('')
    showToast(t('videos.toast_videos_imported', { count: selected.length }))
    loadData()
  }

  const handleCreateGroup = async () => {
    const name = window.prompt(t('videos.prompt_group_name'))
    if (!api || !name?.trim()) return
    await api.dbQuery('videos', 'INSERT OR IGNORE INTO video_groups (name, sort_order) VALUES (?, ?)', [
      name.trim(),
      groups.length + 1,
    ])
    loadData()
  }

  const handleUpdateGroup = async (videoId: number, groupId: string) => {
    if (!api) return
    await api.dbQuery('videos', 'UPDATE videos SET group_id = ? WHERE id = ?', [
      groupId ? Number(groupId) : null,
      videoId,
    ])
    loadData()
  }

  const handleSaveVideoTags = async (videoId: number, input: string) => {
    if (!api) return
    const nextTags = parseTagInput(input)
    await api.dbQuery('videos', 'DELETE FROM video_tag_links WHERE video_id = ?', [videoId])
    for (const tagName of nextTags) {
      await api.dbQuery('videos', 'INSERT OR IGNORE INTO video_tags (name) VALUES (?)', [tagName])
      const res = await api.dbQuery('videos', 'SELECT id FROM video_tags WHERE name = ?', [tagName])
      const tagId = res?.data?.[0]?.id
      if (tagId) {
        await api.dbQuery(
          'videos',
          'INSERT OR IGNORE INTO video_tag_links (video_id, tag_id) VALUES (?, ?)',
          [videoId, tagId],
        )
      }
    }
    showToast(t('videos.toast_tags_saved'))
    loadData()
  }

  const handleDownloadVideo = async (video: any) => {
    if (!api) return
    setDownloadQueue((prev) => [
      ...prev,
      { title: video.title, status: 'queued', message: '', progress: 0 },
    ])
    await api.dbQuery('videos', "UPDATE videos SET status = 'downloading' WHERE id = ?", [video.id])
    await api.startDownload({
      id: video.id,
      title: video.title,
      sourceUrl: video.source_url || video.url,
      url: video.source_url || video.url,
    })
    loadData()
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
          gridTemplateColumns: '220px minmax(0, 1fr) 320px',
          gap: '16px',
          minHeight: 0,
          flexGrow: 1,
        }}
      >
        <aside className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '12px' }}>{t('videos.groups_title')}</strong>
              <button className="btn sm btn-icon" onClick={handleCreateGroup} title={t('videos.btn_new_group')}>
                <FolderPlus size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
              {[
                ['all', t('videos.all_videos')],
                [null, t('videos.uncategorized')],
                ['downloaded', t('videos.downloaded_filter')],
                ['downloading', t('videos.downloading_filter')],
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
              {groups.map((group) => (
                <button
                  key={group.id}
                  className={`btn sm ${activeGroupId === group.id ? 'primary' : ''}`}
                  onClick={() => setActiveGroupId(group.id)}
                  style={{ justifyContent: 'flex-start' }}
                >
                  {group.name}
                </button>
              ))}
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
                tags.map((tagItem) => (
                  <button
                    key={tagItem.id}
                    className={`btn sm ${activeTag === tagItem.name ? 'primary' : ''}`}
                    onClick={() => setActiveTag(activeTag === tagItem.name ? null : tagItem.name)}
                    style={{ fontSize: '11px' }}
                  >
                    {tagItem.name}
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <main style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <form onSubmit={handleParseUrl} className="card" style={{ display: 'flex', gap: '8px' }}>
            <input
              className="form-field"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder={t('videos.input_url_placeholder')}
              style={{ flexGrow: 1 }}
            />
            <button type="submit" className="btn primary">
              <Search size={14} />
              {t('videos.btn_parse_url')}
            </button>
          </form>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Database size={14} />
                {t('videos.downloaded_title')} ({filteredLocalVideos.length})
              </strong>
              <input
                className="form-field"
                placeholder={t('videos.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ marginLeft: 'auto', maxWidth: '260px', height: '30px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
              {filteredLocalVideos.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', padding: '32px', textAlign: 'center' }}>
                  {t('videos.empty_library_tip')}
                </p>
              ) : (
                filteredLocalVideos.map((video: any) => (
                  <article
                    key={video.id}
                    onClick={() => setSelectedVideo(video)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '36px minmax(0, 1fr) auto',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px',
                      border: `1px solid ${
                        selectedVideo?.id === video.id ? 'var(--color-accent)' : 'var(--color-border)'
                      }`,
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-app)',
                      cursor: 'pointer',
                    }}
                  >
                    <button
                      className={`btn sm btn-icon ${canPlayVideo(video) ? 'primary' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        handlePlayVideo(video)
                      }}
                    >
                      <Play size={14} fill={canPlayVideo(video) ? '#fff' : 'none'} />
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <h4
                        style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {video.title}
                      </h4>
                      <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        {video.source || 'local'} · {video.duration || t('videos.duration_unknown')} ·{' '}
                        {video.group_name || t('videos.uncategorized')}
                      </p>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                        {(video.tags || []).map((tagName: string) => (
                          <span
                            key={tagName}
                            style={{
                              fontSize: '10.5px',
                              padding: '2px 6px',
                              borderRadius: '999px',
                              backgroundColor: 'var(--bg-muted)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {tagName}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="btn sm btn-icon"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleDownloadVideo(video)
                        }}
                        title={t('videos.btn_download')}
                      >
                        <Download size={14} />
                      </button>
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
                ))
              )}
            </div>
          </section>
        </main>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <strong style={{ fontSize: '13px' }}>{t('videos.details_title')}</strong>
            {selectedVideo ? (
              <>
                <h3 style={{ fontSize: '14px', fontWeight: 800 }}>{selectedVideo.title}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  {selectedVideo.source || 'local'} · {selectedVideo.status || 'unclassified'}
                </p>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                  {t('videos.groups_title')}
                  <select
                    className="form-field"
                    value={selectedVideo.group_id || ''}
                    onChange={(e) => handleUpdateGroup(selectedVideo.id, e.target.value)}
                  >
                    <option value="">{t('videos.uncategorized')}</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
                  {t('videos.tags_title')}
                  <input
                    className="form-field"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder={t('videos.tags_input_placeholder')}
                  />
                </label>
                <button className="btn primary sm" onClick={() => handleSaveVideoTags(selectedVideo.id, tagInput)}>
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

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
            <strong style={{ fontSize: '13px' }}>
              {t('videos.download_queue')} ({downloadQueue.length})
            </strong>
            {downloadQueue.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('videos.empty_queue_tip')}</p>
            ) : (
              downloadQueue.map((item, index) => (
                <div key={`${item.title}-${index}`} style={{ borderTop: '1px solid var(--color-border)', paddingTop: '8px' }}>
                  <strong style={{ fontSize: '11px' }}>{item.title}</strong>
                  <p style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>
                    {item.status === 'queued' ? t('videos.status_queued') : t('videos.status_downloading')}
                  </p>
                  {item.message && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '10px', wordBreak: 'break-word' }}>
                      {item.message.slice(0, 140)}
                    </p>
                  )}
                </div>
              ))
            )}
          </section>
        </aside>
      </div>

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
              <button className="btn sm btn-icon" onClick={() => setParsedData(null)}>
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
              <button className="btn" onClick={() => setParsedData(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn primary" onClick={handleImportSelected}>
                {t('videos.btn_import_selected')}
              </button>
            </div>
          </div>
        </div>
      )}

      {playingVideo && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#000',
            color: '#fff',
            zIndex: 1000,
            display: 'grid',
            gridTemplateRows: '52px minmax(0, 1fr)',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 18px',
              borderBottom: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <button
              className="btn sm"
              style={{ backgroundColor: '#222', borderColor: '#444', color: '#fff' }}
              onClick={() => {
                setPlayingVideo(null)
                setPlaybackUrl('')
              }}
            >
              <X size={14} />
              {t('common.close')}
            </button>
            <span style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {playingVideo.title}
            </span>
            <select
              className="form-field"
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              style={{ width: '92px', backgroundColor: '#222', color: '#fff', borderColor: '#444' }}
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

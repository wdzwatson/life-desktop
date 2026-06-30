import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTranslation } from 'react-i18next'
import {
  Play,
  Settings,
  Trash2,
} from 'lucide-react'

export const Videos: React.FC = () => {
  const { t, i18n } = useTranslation()
  const showToast = useAppStore((state) => state.showToast)
  const userId = useAppStore((state) => state.userId)

  // URL input states
  const [videoUrl, setVideoUrl] = useState('')
  const [parsedData, setParsedData] = useState<any | null>(null)
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([])

  // Download states
  const [downloadQueue, setDownloadQueue] = useState<any[]>([])
  const [concurrencyLimit, setConcurrencyLimit] = useState(3)

  // Local videos states
  const [localVideos, setLocalVideos] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  // Player overlay states
  const [playingVideo, setPlayingVideo] = useState<any | null>(null)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)
  const [subtitlesQuery, setSubtitlesQuery] = useState('')
  const [subtitles, setSubtitles] = useState<any[]>([])

  useEffect(() => {
    setSubtitles([
      { time: '00:15', text: t('videos.subtitle_mock_1') },
      { time: '01:45', text: t('videos.subtitle_mock_2') },
      { time: '03:10', text: t('videos.subtitle_mock_3') },
      { time: '05:40', text: t('videos.subtitle_mock_4') },
    ])
  }, [i18n.language])

  const api = (window as any).electronAPI

  const loadData = async () => {
    if (!api) return

    // Load local videos
    const res = await api.dbQuery(
      'videos',
      "SELECT * FROM videos ORDER BY priority = 'high' DESC, priority = 'mid' DESC, favorite_time DESC",
    )
    if (res?.success) setLocalVideos(res.data)

    // Load concurrency settings
    const settings = await api.getSettings()
    if (settings && settings.maxDownloads) {
      setConcurrencyLimit(settings.maxDownloads)
    }
  }

  useEffect(() => {
    loadData()

    // Register download IPC listeners
    if (api) {
      const unsubProgress = api.onDownloadProgress((data: any) => {
        setDownloadQueue((prev) =>
          prev.map((item) => {
            if (item.title === data.title) {
              return { ...item, progress: data.progress, status: 'downloading' }
            }
            return item
          }),
        )
      })

      const unsubFinished = (data: any) => {
        showToast(t('videos.toast_download_finished', { title: data.title }))
        setDownloadQueue((prev) => prev.filter((item) => item.title !== data.title))
        loadData() // Reload local library
      }
      const unsubFinishedClean = api.onDownloadFinished(unsubFinished)

      return () => {
        unsubProgress()
        unsubFinishedClean()
      }
    }
  }, [userId, i18n.language])

  // Parse url trigger
  const handleParseUrl = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!videoUrl.trim() || !api) return

    showToast(t('videos.toast_parsing_url'))
    const data = await api.parseVideoUrl(videoUrl)
    if (data) {
      setParsedData(data)
      if (data.isPlaylist) {
        setSelectedVideoIds(data.videos.map((v: any) => v.id))
      }
    }
  }

  // Queue downloads
  const handleQueueDownload = async () => {
    if (!parsedData || !api) return

    if (parsedData.isPlaylist) {
      const selected = parsedData.videos.filter((v: any) => selectedVideoIds.includes(v.id))
      if (selected.length === 0) {
        showToast(t('videos.toast_select_at_least_one'))
        return
      }

      for (const item of selected) {
        // Add to download queue UI list
        setDownloadQueue((prev) => [...prev, { title: item.title, progress: 0, status: 'queued' }])
        await api.startDownload({ title: item.title, duration: item.duration })
      }
      showToast(t('videos.toast_videos_added', { count: selected.length }))
    } else {
      setDownloadQueue((prev) => [
        ...prev,
        { title: parsedData.title, progress: 0, status: 'queued' },
      ])
      await api.startDownload({ title: parsedData.title, duration: parsedData.duration })
      showToast(t('videos.toast_video_added'))
    }

    setParsedData(null)
    setVideoUrl('')
  }

  // Change video priority
  const handleUpdatePriority = async (id: number, priority: string) => {
    if (!api) return
    await api.dbQuery('videos', 'UPDATE videos SET priority = ? WHERE id = ?', [priority, id])
    showToast(t('videos.toast_priority_updated'))
    loadData()
  }

  // Delete video
  const handleDeleteVideo = async (id: number) => {
    if (!api || !window.confirm(t('videos.confirm_delete'))) return
    await api.dbQuery('videos', 'DELETE FROM videos WHERE id = ?', [id])
    showToast(t('videos.toast_video_deleted'))
    loadData()
  }

  // Update Settings Max Downloads
  const handleSaveConcurrency = async (limit: number) => {
    setConcurrencyLimit(limit)
    if (api) {
      const settings = await api.getSettings()
      settings.maxDownloads = limit
      await api.saveSettings(settings)
      showToast(t('videos.toast_concurrency_updated', { limit }))
    }
  }

  // Subtitles time jump mock
  const handleSubtitleJump = (time: string) => {
    showToast(t('videos.toast_jumped_time', { time }))
  }

  const filteredLocalVideos = localVideos.filter((v) =>
    v.title.toLowerCase().includes(searchQuery.toLowerCase()),
  )

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
          <h1 style={{ fontSize: '22px', fontWeight: 800 }}>{t('videos.title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('videos.subtitle')}</p>
        </div>
      </div>

      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 300px',
          gap: '16px',
        }}
      >
        {/* Left pane: URL parser input and Local Videos list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
          {/* URL Parser Input */}
          <form
            onSubmit={handleParseUrl}
            className="card"
            style={{ display: 'flex', gap: '8px', padding: '12px' }}
          >
            <input
              className="form-field"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder={t('videos.input_url_placeholder')}
              style={{ flexGrow: 1 }}
            />
            <button type="submit" className="btn primary">
              {t('videos.btn_parse_url')}
            </button>
          </form>

          {/* Local Library list */}
          <div
            className="card"
            style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '13px' }}>
                {t('videos.downloaded_title')} ({filteredLocalVideos.length})
              </strong>
              <div style={{ display: 'flex', gap: '8px', width: '220px' }}>
                <input
                  className="form-field"
                  placeholder={t('videos.search_placeholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ height: '28px' }}
                />
              </div>
            </div>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}
            >
              {filteredLocalVideos.length === 0 ? (
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '12.5px',
                    fontStyle: 'italic',
                    margin: 'auto',
                    padding: '36px',
                  }}
                >
                  {t('videos.empty_library_tip')}
                </p>
              ) : (
                filteredLocalVideos.map((video) => (
                  <div
                    key={video.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '40px 1fr auto auto auto',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-app)',
                    }}
                  >
                    {/* Play Btn */}
                    <button
                      className="btn primary sm btn-icon"
                      style={{ borderRadius: '50%', width: '32px', height: '32px' }}
                      onClick={() => setPlayingVideo(video)}
                    >
                      <Play size={13} fill="#fff" />
                    </button>
                    {/* Meta info */}
                    <div style={{ minWidth: 0 }}>
                      <h4
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {video.title}
                      </h4>
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {video.source} · {t('videos.duration_label')}: {video.duration || '42:15'}
                      </p>
                    </div>
                    {/* Priority Tag select */}
                    <select
                      className="form-field"
                      value={video.priority || 'low'}
                      onChange={(e) => handleUpdatePriority(video.id, e.target.value)}
                      style={{ width: '80px', height: '26px', padding: '0 4px', fontSize: '11px' }}
                    >
                      <option value="high">🔴 {t('tasks.priority_high')}</option>
                      <option value="mid">🟡 {t('tasks.priority_mid')}</option>
                      <option value="low">🟢 {t('tasks.priority_low')}</option>
                    </select>
                    {/* Date badge */}
                    <span
                      style={{
                        fontSize: '10.5px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {video.favorite_time?.slice(5, 16).replace('T', ' ')}
                    </span>
                    {/* Delete button */}
                    <button
                      className="btn sm"
                      onClick={() => handleDeleteVideo(video.id)}
                      style={{ border: 'none', background: 'none' }}
                    >
                      <Trash2 size={13} color="var(--color-danger)" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right pane: Download queues & concurrency configuration */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Concurrency settings panel */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Settings size={14} />
              {t('videos.settings_title')}
            </strong>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {t('videos.settings_label_concurrency')}: {concurrencyLimit}
            </label>
            <input
              type="range"
              min="1"
              max="5"
              value={concurrencyLimit}
              onChange={(e) => handleSaveConcurrency(parseInt(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>

          {/* Download Queue */}
          <div
            className="card"
            style={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              overflowY: 'auto',
            }}
          >
            <strong style={{ fontSize: '13px' }}>
              {t('videos.download_queue')} ({downloadQueue.length})
            </strong>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}
            >
              {downloadQueue.length === 0 ? (
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    fontStyle: 'italic',
                    margin: 'auto',
                    padding: '16px',
                    textAlign: 'center',
                  }}
                >
                  {t('videos.empty_queue_tip')}
                </p>
              ) : (
                downloadQueue.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11.5px',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '9.5px',
                        color: 'var(--text-muted)',
                        margin: '4px 0',
                      }}
                    >
                      <span>
                        {item.status === 'queued'
                          ? t('videos.status_queued')
                          : t('videos.status_downloading')}
                      </span>
                      <span>{item.progress}%</span>
                    </div>
                    <div
                      style={{
                        height: '4px',
                        backgroundColor: 'var(--color-border)',
                        borderRadius: '2px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${item.progress}%`,
                          backgroundColor: 'var(--color-accent)',
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* MODAL DIALOG: Playlists parsed list batch多选 selector */}
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
          <div
            className="card"
            style={{
              width: '520px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ fontSize: '15px', fontWeight: 800 }}>{t('videos.parse_result_title')}</h3>
            <div
              style={{
                flexGrow: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {parsedData.isPlaylist ? (
                parsedData.videos.map((v: any) => {
                  const isChecked = selectedVideoIds.includes(v.id)
                  return (
                    <label
                      key={v.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px',
                        border: '1px solid var(--color-border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            setSelectedVideoIds(selectedVideoIds.filter((id) => id !== v.id))
                          } else {
                            setSelectedVideoIds([...selectedVideoIds, v.id])
                          }
                        }}
                      />
                      <span style={{ fontSize: '12.5px' }}>{v.title}</span>
                      <span
                        style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}
                      >
                        {v.duration}
                      </span>
                    </label>
                  )
                })
              ) : (
                <div
                  style={{
                    padding: '10px',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{parsedData.title}</div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {t('videos.duration_label')}: {parsedData.duration}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setParsedData(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn primary" onClick={handleQueueDownload}>
                {t('videos.btn_confirm_download')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN INTEGRATED VIDEO PLAYER DIALOG */}
      {playingVideo && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#000',
            color: '#fff',
            zIndex: 1000,
            display: 'grid',
            gridTemplateRows: '50px 1fr',
            animation: 'enter 0.15s ease both',
          }}
        >
          {/* Header */}
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 24px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                className="btn sm"
                style={{ backgroundColor: '#222', borderColor: '#444', color: '#fff' }}
                onClick={() => setPlayingVideo(null)}
              >
                ✕ {t('common.close')}
              </button>
              <span style={{ fontSize: '13px' }}>
                {t('videos.playing_label')}: {playingVideo.title}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="btn sm"
                style={{ backgroundColor: '#222', borderColor: '#444', color: '#fff' }}
                onClick={() => {
                  showToast(t('videos.toast_pip_enabled'))
                }}
              >
                {t('videos.btn_pip_mode')}
              </button>
              <select
                className="form-field"
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                style={{
                  width: '80px',
                  height: '28px',
                  backgroundColor: '#222',
                  color: '#fff',
                  borderColor: '#444',
                  fontSize: '12px',
                }}
              >
                <option value="0.5">0.5x {t('videos.speed_suffix')}</option>
                <option value="1.0">1.0x {t('videos.speed_suffix')}</option>
                <option value="1.5">1.5x {t('videos.speed_suffix')}</option>
                <option value="2.0">2.0x {t('videos.speed_suffix')}</option>
                <option value="3.0">3.0x {t('videos.speed_suffix')}</option>
              </select>
            </div>
          </header>

          {/* Player body: screen + subtitle search */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 320px',
              height: '100%',
              minHeight: 0,
            }}
          >
            {/* Left Screen */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#0A0A0A',
                position: 'relative',
              }}
            >
              <div style={{ fontSize: '48px', color: '#666' }}>🎬</div>
              <p style={{ color: '#aaa', fontSize: '13px', marginTop: '16px' }}>
                {t('videos.playback_canvas_tip', { speed: playbackSpeed })}
              </p>

              {/* Timeline control */}
              <div
                style={{
                  position: 'absolute',
                  bottom: '24px',
                  left: '24px',
                  right: '24px',
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>12:15</span>
                <div
                  style={{
                    height: '4px',
                    backgroundColor: '#333',
                    borderRadius: '2px',
                    flexGrow: 1,
                    overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{ height: '100%', width: '30%', backgroundColor: 'var(--color-accent)' }}
                  />
                </div>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                  {playingVideo.duration || '42:15'}
                </span>
              </div>
            </div>

            {/* Right Subtitle Keyword Index Search Panel */}
            <aside
              style={{
                backgroundColor: '#111',
                borderLeft: '1px solid #222',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <h4 style={{ fontSize: '11.5px', color: '#888', textTransform: 'uppercase' }}>
                {t('videos.subtitle_search_title')}
              </h4>
              <input
                className="form-field"
                placeholder={t('videos.subtitle_search_placeholder')}
                value={subtitlesQuery}
                onChange={(e) => setSubtitlesQuery(e.target.value)}
                style={{ backgroundColor: '#222', color: '#fff', borderColor: '#444' }}
              />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  overflowY: 'auto',
                  flexGrow: 1,
                }}
              >
                {subtitles
                  .filter((s) => s.text.includes(subtitlesQuery))
                  .map((sub, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSubtitleJump(sub.time)}
                      style={{
                        padding: '8px',
                        backgroundColor: '#1E1E1E',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        border: '1px solid #333',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--color-accent)',
                          fontWeight: 600,
                          display: 'block',
                          marginBottom: '2px',
                        }}
                      >
                        {sub.time}
                      </span>
                      <p style={{ color: '#ddd' }}>{sub.text}</p>
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

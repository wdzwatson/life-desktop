import { forwardRef, useEffect, useRef, useState, type VideoHTMLAttributes } from 'react'
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { Slider } from './Slider'

type MediaPlayerProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'className' | 'controls'> & {
  className?: string
  label?: string
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '0:00'
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const MediaPlayer = forwardRef<HTMLVideoElement, MediaPlayerProps>(function MediaPlayer(
  { className, label, autoPlay = false, ...videoProps },
  forwardedRef,
) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(autoPlay)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

  useEffect(() => {
    if (autoPlay) void videoRef.current?.play().catch(() => setIsPlaying(false))
  }, [autoPlay, videoProps.src])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }

  const setVideoVolume = (nextVolume: number) => {
    const video = videoRef.current
    if (!video) return
    const safeVolume = Math.max(0, Math.min(1, nextVolume))
    video.volume = safeVolume
    video.muted = safeVolume === 0
    setVolume(safeVolume)
    setIsMuted(safeVolume === 0)
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    const nextMuted = !video.muted
    video.muted = nextMuted
    setIsMuted(nextMuted)
  }

  return (
    <div ref={rootRef} className={['media-player', className].filter(Boolean).join(' ')}>
      <video
        {...videoProps}
        ref={(element) => {
          videoRef.current = element
          if (typeof forwardedRef === 'function') forwardedRef(element)
          else if (forwardedRef) forwardedRef.current = element
        }}
        autoPlay={autoPlay}
        className="media-player__video"
        aria-label={label ?? videoProps['aria-label']}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration)
          videoProps.onLoadedMetadata?.(event)
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime)
          videoProps.onTimeUpdate?.(event)
        }}
        onPlay={(event) => {
          setIsPlaying(true)
          videoProps.onPlay?.(event)
        }}
        onPause={(event) => {
          setIsPlaying(false)
          videoProps.onPause?.(event)
        }}
      />
      <div className="media-player__controls" aria-label="Media controls">
        <button type="button" className="media-player__button" onClick={togglePlayback} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>
        <Slider
          className="media-player__seek"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(currentTime, duration || 1)}
          aria-label="Seek"
          onChange={(event) => {
            const nextTime = Number(event.target.value)
            if (videoRef.current) videoRef.current.currentTime = nextTime
            setCurrentTime(nextTime)
          }}
        />
        <span className="media-player__time">{formatTime(currentTime)} / {formatTime(duration)}</span>
        <button type="button" className="media-player__button" onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'} title={isMuted ? 'Unmute' : 'Mute'}>
          {isMuted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
        </button>
        <Slider
          className="media-player__volume"
          min={0}
          max={1}
          step={0.05}
          value={isMuted ? 0 : volume}
          aria-label="Volume"
          onChange={(event) => setVideoVolume(Number(event.target.value))}
        />
        <button type="button" className="media-player__button" onClick={() => void rootRef.current?.requestFullscreen?.()} aria-label="Fullscreen" title="Fullscreen">
          <Maximize2 size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
})

MediaPlayer.displayName = 'MediaPlayer'

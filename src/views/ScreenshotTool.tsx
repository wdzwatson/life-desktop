import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Crop,
  Film,
  Keyboard,
  LassoSelect,
  Layers3,
  MonitorUp,
  ScrollText,
  Timer,
  Video,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { displayShortcut } from '../shortcutUtils'
import { getGifCapturePlan } from './screenshotCaptureUtils'
import { NumberInput } from '../components/NumberInput'

const DEFAULT_SCREENSHOT_SHORTCUT = 'CommandOrControl+Shift+S'
const DEFAULT_RECORDING_STOP_SHORTCUT = 'CommandOrControl+Shift+R'

type ScreenshotSettings = { shortcuts?: { screenshot?: string } }
type CaptureStartResponse = { success?: boolean; error?: string }
type BurstResponse = CaptureStartResponse & { frames?: string[]; cancelled?: boolean }
type RecordingSourceResponse = CaptureStartResponse & { stopShortcut?: string }
type CaptureMode =
  'screen' | 'rectangle' | 'multi_frame' | 'gif' | 'video' | 'delay' | 'freeform' | 'long'

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
}

async function createContactSheet(frames: string[]) {
  const images = await Promise.all(frames.map(loadImage))
  const columns = Math.min(3, images.length)
  const tileWidth = Math.min(640, images[0].naturalWidth)
  const tileHeight = Math.round((tileWidth / images[0].naturalWidth) * images[0].naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = columns * tileWidth
  canvas.height = Math.ceil(images.length / columns) * tileHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to compose frames.')
  context.fillStyle = '#0f172a'
  context.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => {
    const x = (index % columns) * tileWidth
    const y = Math.floor(index / columns) * tileHeight
    context.drawImage(image, x, y, tileWidth, tileHeight)
  })
  return canvas.toDataURL('image/png')
}

async function createLongCapture(frames: string[]) {
  const images = await Promise.all(frames.map(loadImage))
  const width = Math.min(1600, images[0].naturalWidth)
  const dimensions = images.map((image) => ({
    width,
    height: Math.round((width / image.naturalWidth) * image.naturalHeight),
  }))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = dimensions.reduce((height, image) => height + image.height, 0)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to stitch frames.')
  let y = 0
  images.forEach((image, index) => {
    const { height } = dimensions[index]
    context.drawImage(image, 0, y, width, height)
    y += height
  })
  return canvas.toDataURL('image/png')
}

async function createGif(frames: string[], delay: number) {
  const images = await Promise.all(frames.map(loadImage))
  const width = Math.min(960, images[0].naturalWidth)
  const height = Math.round((width / images[0].naturalWidth) * images[0].naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to encode GIF.')
  const encoder = GIFEncoder()
  for (const image of images) {
    context.drawImage(image, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height).data
    const palette = quantize(pixels, 256)
    encoder.writeFrame(applyPalette(pixels, palette), width, height, { palette, delay, repeat: 0 })
  }
  encoder.finish()
  return encoder.bytes()
}

export function ScreenshotTool() {
  const { t } = useTranslation()
  const api = (window as any).electronAPI
  const [shortcut, setShortcut] = useState(DEFAULT_SCREENSHOT_SHORTCUT)
  const [frameCount, setFrameCount] = useState(5)
  const [frameInterval, setFrameInterval] = useState(700)
  const [gifDurationSeconds, setGifDurationSeconds] = useState(8)
  const [delaySeconds, setDelaySeconds] = useState(3)
  const [activeMode, setActiveMode] = useState<CaptureMode | null>(null)
  const [pendingMode, setPendingMode] = useState<CaptureMode | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const isMac = Boolean(api?.isMac ?? navigator.userAgent.includes('Mac'))

  const openCaptureEditor = useCallback(
    async (imageDataUrl: string) => {
      const result = await api?.openScreenCaptureEditorImage?.(imageDataUrl)
      if (!result?.success) {
        throw new Error(result?.error || t('toolbox.screenshot_start_failed'))
      }
    },
    [api, t],
  )

  const completeRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  useEffect(() => {
    let isCurrent = true
    api?.getSettings?.().then((settings: ScreenshotSettings) => {
      if (isCurrent && settings?.shortcuts?.screenshot) setShortcut(settings.shortcuts.screenshot)
    })
    const unsubscribe = api?.onScreenRecordingStopRequested?.(() => void completeRecording())
    return () => {
      isCurrent = false
      unsubscribe?.()
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [api, completeRecording])

  const beginStillCapture = async (
    selectionMode: 'full' | 'rectangle' | 'freeform',
    delayMs = 0,
  ) => {
    const result = (await api?.startScreenCapture?.({
      selectionMode,
      delayMs,
    })) as CaptureStartResponse
    if (!result?.success) throw new Error(result?.error || t('toolbox.screenshot_start_failed'))
  }

  const captureFrames = async (
    controls = false,
    selectArea = false,
    count = frameCount,
    interval = frameInterval,
  ) => {
    const result = (await api?.captureScreenBurst?.({
      count,
      interval,
      controls,
      selectionMode: selectArea ? 'rectangle' : undefined,
    })) as BurstResponse
    if (result?.success && result.cancelled) return null
    if (!result?.success || !result.frames?.length) {
      throw new Error(result?.error || t('toolbox.screenshot_burst_failed'))
    }
    return result.frames
  }

  const startVideoCapture = async () => {
    const source = (await api?.getScreenRecordingSource?.()) as RecordingSourceResponse
    if (!source?.success) {
      throw new Error(source?.error || t('toolbox.screenshot_video_failed'))
    }
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      throw new Error(t('toolbox.screenshot_video_unsupported'))
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { frameRate: { ideal: 30, max: 30 } },
    })
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(stream, { mimeType })
    recordingStreamRef.current = stream
    recorderRef.current = recorder
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      recorderRef.current = null
      setRecording(false)
      await api?.completeScreenRecording?.()
      const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())
      const saved = await api?.saveScreenCaptureMedia?.(bytes, 'webm')
      if (!saved?.success) setError(saved?.error || t('toolbox.screenshot_video_save_failed'))
      setActiveMode(null)
    }
    recorder.start(1_000)
    setRecording(true)
  }

  const startMode = async (mode: CaptureMode) => {
    if (activeMode || recording) return
    setError('')
    setActiveMode(mode)
    try {
      if (mode === 'screen') await beginStillCapture('full')
      else if (mode === 'rectangle') await beginStillCapture('rectangle')
      else if (mode === 'freeform') await beginStillCapture('freeform')
      else if (mode === 'delay') await beginStillCapture('rectangle', delaySeconds * 1_000)
      else if (mode === 'multi_frame') {
        const frames = await captureFrames(true, true)
        if (frames) await openCaptureEditor(await createContactSheet(frames))
      } else if (mode === 'long') {
        const frames = await captureFrames()
        if (frames) await openCaptureEditor(await createLongCapture(frames))
      } else if (mode === 'gif') {
        const gifPlan = getGifCapturePlan(gifDurationSeconds, frameInterval)
        const frames = await captureFrames(true, true, gifPlan.frameCount, gifPlan.interval)
        if (!frames) {
          setActiveMode(null)
          return
        }
        const bytes = await createGif(frames, gifPlan.interval)
        const result = await api?.saveScreenCaptureMedia?.(bytes, 'gif')
        if (!result?.success)
          throw new Error(result?.error || t('toolbox.screenshot_gif_save_failed'))
      } else if (mode === 'video') {
        await startVideoCapture()
        return
      }
      setActiveMode(null)
    } catch (captureError) {
      await api?.completeScreenRecording?.()
      setError(
        captureError instanceof Error ? captureError.message : t('toolbox.screenshot_start_failed'),
      )
      setActiveMode(null)
    }
  }

  const modes = [
    {
      id: 'screen' as const,
      icon: MonitorUp,
      title: t('toolbox.screenshot_mode_screen'),
      description: t('toolbox.screenshot_mode_screen_desc'),
    },
    {
      id: 'rectangle' as const,
      icon: Crop,
      title: t('toolbox.screenshot_mode_rectangle'),
      description: t('toolbox.screenshot_mode_rectangle_desc'),
    },
    {
      id: 'multi_frame' as const,
      icon: Layers3,
      title: t('toolbox.screenshot_mode_multi_frame'),
      description: t('toolbox.screenshot_mode_multi_frame_desc'),
    },
    {
      id: 'gif' as const,
      icon: Film,
      title: t('toolbox.screenshot_mode_gif'),
      description: t('toolbox.screenshot_mode_gif_desc'),
    },
    {
      id: 'video' as const,
      icon: Video,
      title: t('toolbox.screenshot_mode_video'),
      description: t('toolbox.screenshot_mode_video_desc'),
    },
    {
      id: 'delay' as const,
      icon: Timer,
      title: t('toolbox.screenshot_mode_delay'),
      description: t('toolbox.screenshot_mode_delay_desc'),
    },
    {
      id: 'freeform' as const,
      icon: LassoSelect,
      title: t('toolbox.screenshot_mode_freeform'),
      description: t('toolbox.screenshot_mode_freeform_desc'),
    },
    {
      id: 'long' as const,
      icon: ScrollText,
      title: t('toolbox.screenshot_mode_long'),
      description: t('toolbox.screenshot_mode_long_desc'),
    },
  ]
  const pendingModeConfig = pendingMode ? modes.find((mode) => mode.id === pendingMode) : null
  const PendingModeIcon = pendingModeConfig?.icon

  return (
    <section
      className="card"
      aria-labelledby="screenshot-tool-title"
      style={{ maxWidth: 1040, margin: '0 auto', padding: 28 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 id="screenshot-tool-title" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
            {t('toolbox.screenshot_title')}
          </h2>
          <p
            style={{
              margin: '6px 0 0',
              color: 'var(--text-muted)',
              fontSize: 13,
              lineHeight: 1.6,
              maxWidth: 680,
            }}
          >
            {t('toolbox.screenshot_desc')}
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-muted)',
            fontSize: 12,
          }}
        >
          <Keyboard size={15} aria-hidden="true" />
          <kbd className="kbd-shortcut">{displayShortcut(shortcut, isMac)}</kbd>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          alignItems: 'stretch',
          gap: 10,
          marginTop: 24,
        }}
      >
        {modes.map(({ id, icon: Icon, title, description }) => (
          <button
            key={id}
            type="button"
            className="btn"
            onClick={() => setPendingMode(id)}
            disabled={Boolean(activeMode) || recording}
            style={{
              minWidth: 0,
              minHeight: 116,
              height: 'auto',
              display: 'block',
              padding: 16,
              textAlign: 'left',
              whiteSpace: 'normal',
            }}
          >
            <Icon
              size={18}
              aria-hidden="true"
              style={{ color: 'var(--color-accent)', marginBottom: 9 }}
            />
            <strong style={{ display: 'block', fontSize: 13 }}>{title}</strong>
            <span
              style={{
                display: 'block',
                marginTop: 5,
                color: 'var(--text-muted)',
                fontSize: 11.5,
                lineHeight: 1.5,
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
              }}
            >
              {description}
            </span>
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'end',
          gap: 16,
          flexWrap: 'wrap',
          marginTop: 22,
          paddingTop: 18,
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          {t('toolbox.screenshot_frame_count')}
          <NumberInput
            className="form-field"
            min="2"
            max="20"
            value={frameCount}
            onValueChange={(nextValue) => setFrameCount(Math.max(2, Math.min(20, Number(nextValue) || 2)))}
            style={{ width: 100 }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          {t('toolbox.screenshot_frame_interval')}
          <NumberInput
            className="form-field"
            min="150"
            max="3000"
            step="50"
            value={frameInterval}
            onValueChange={(nextValue) => setFrameInterval(Math.max(150, Math.min(3000, Number(nextValue) || 150)))}
            style={{ width: 120 }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          {t('toolbox.screenshot_delay_seconds')}
          <NumberInput
            className="form-field"
            min="1"
            max="15"
            value={delaySeconds}
            onValueChange={(nextValue) => setDelaySeconds(Math.max(1, Math.min(15, Number(nextValue) || 1)))}
            style={{ width: 100 }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          {t('toolbox.screenshot_gif_duration')}
          <NumberInput
            className="form-field"
            min="2"
            max="15"
            value={gifDurationSeconds}
            onValueChange={(nextValue) => setGifDurationSeconds(Math.max(2, Math.min(15, Number(nextValue) || 2)))}
            style={{ width: 100 }}
          />
        </label>
        {recording && (
          <button type="button" className="btn danger" onClick={() => void completeRecording()}>
            <Video size={15} /> {t('toolbox.screenshot_stop_recording')}
          </button>
        )}
      </div>

      <p style={{ margin: '16px 0 0', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>
        {recording
          ? t('toolbox.screenshot_recording_hint', {
              shortcut: displayShortcut(DEFAULT_RECORDING_STOP_SHORTCUT, isMac),
            })
          : t('toolbox.screenshot_long_hint')}
      </p>
      {error && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger, #dc2626)', fontSize: 12, margin: '12px 0 0' }}
        >
          {error}
        </p>
      )}
      {pendingModeConfig && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="screenshot-mode-reminder-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            background: 'rgba(7, 12, 22, .56)',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            className="card"
            style={{
              width: 'min(390px, 100%)',
              padding: 24,
              boxShadow: '0 22px 56px rgba(0,0,0,.28)',
            }}
          >
            {PendingModeIcon && (
              <PendingModeIcon
                size={24}
                aria-hidden="true"
                style={{ color: 'var(--color-accent)' }}
              />
            )}
            <h3 id="screenshot-mode-reminder-title" style={{ margin: '14px 0 0', fontSize: 16 }}>
              {t('toolbox.screenshot_mode_reminder_title', { mode: pendingModeConfig.title })}
            </h3>
            <p
              style={{
                margin: '8px 0 0',
                color: 'var(--text-muted)',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {pendingModeConfig.description}
            </p>
            <p
              style={{
                margin: '12px 0 0',
                color: 'var(--text-muted)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {pendingMode === 'multi_frame' || pendingMode === 'gif'
                ? t('toolbox.screenshot_multi_frame_reminder')
                : pendingMode === 'video'
                  ? t('toolbox.screenshot_video_reminder', {
                      shortcut: displayShortcut(DEFAULT_RECORDING_STOP_SHORTCUT, isMac),
                    })
                  : t('toolbox.screenshot_mode_reminder_desc')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button type="button" className="btn" onClick={() => setPendingMode(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const mode = pendingMode
                  setPendingMode(null)
                  if (mode) void startMode(mode)
                }}
              >
                {t('toolbox.screenshot_mode_reminder_start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

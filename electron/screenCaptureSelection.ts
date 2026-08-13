import { BrowserWindow, ipcMain, nativeImage, type Display, type NativeImage } from 'electron'
import {
  normalizeScreenCaptureSelection,
  scaleScreenCaptureSelection,
  type ScreenCaptureRect,
} from '../src/utils/screenCaptureSelection'

export const SCREEN_CAPTURE_AREA_SELECTED_CHANNEL = 'screen-capture:area-selected'

type ScreenCaptureSelectionMode = 'rectangle' | 'freeform'

export type ScreenCaptureAreaResult = {
  image: NativeImage
  selection: ScreenCaptureRect
}

const createSelectionHtml = (selectionMode: ScreenCaptureSelectionMode) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #05070a; cursor: crosshair; user-select: none; }
      #screen { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
      #shade { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
      #selection { position: fixed; display: none; border: 1px solid rgba(255,255,255,.96); outline: 1px solid rgba(8,12,18,.76); pointer-events: none; }
      #selection::before, #selection::after { content: ''; position: absolute; background: rgba(255,255,255,.88); }
      #selection::before { left: 50%; top: -5px; width: 1px; height: 9px; }
      #selection::after { top: 50%; left: -5px; width: 9px; height: 1px; }
      #outline { display: none; fill: none; stroke: rgba(255,255,255,.96); stroke-width: 2; stroke-linejoin: round; }
      #size { position: fixed; display: none; min-width: 72px; padding: 5px 8px; border-radius: 4px; background: rgba(8,12,18,.88); color: #fff; font: 600 12px/1.2 Outfit, system-ui, sans-serif; text-align: center; pointer-events: none; }
      #surface { position: fixed; inset: 0; touch-action: none; }
      #processing { position: fixed; inset: 0; z-index: 10; display: none; place-items: center; background: rgba(4,8,14,.7); color: #fff; cursor: wait; font: 600 13px/1.4 Satoshi, Outfit, system-ui, sans-serif; }
      #processing.visible { display: grid; }
      #processing-content { display: grid; justify-items: center; gap: 12px; padding: 18px 22px; border: 1px solid rgba(255,255,255,.22); border-radius: 6px; background: rgba(8,12,18,.9); box-shadow: 0 16px 42px rgba(0,0,0,.32); }
      #processing-spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,.28); border-top-color: #fff; border-radius: 50%; animation: spin .72s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { #processing-spinner { animation-duration: 1.5s; } }
    </style>
  </head>
  <body>
    <img id="screen" alt="">
    <svg id="shade" aria-hidden="true">
      <defs>
        <mask id="cutout">
          <rect width="100%" height="100%" fill="white"></rect>
          <rect id="rectangleHole" width="0" height="0" fill="black"></rect>
          <path id="freeformHole" fill="black"></path>
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(4,8,14,.48)" mask="url(#cutout)"></rect>
      <path id="outline"></path>
    </svg>
    <div id="selection"></div>
    <div id="size"></div>
    <div id="surface"></div>
    <div id="processing" role="status" aria-live="assertive">
      <div id="processing-content">
        <span id="processing-spinner" aria-hidden="true"></span>
        <span>正在准备截图...</span>
      </div>
    </div>
    <script>
      const selectionMode = ${JSON.stringify(selectionMode)}
      const screenImage = document.getElementById('screen')
      const surface = document.getElementById('surface')
      const selection = document.getElementById('selection')
      const rectangleHole = document.getElementById('rectangleHole')
      const freeformHole = document.getElementById('freeformHole')
      const outline = document.getElementById('outline')
      const size = document.getElementById('size')
      const processing = document.getElementById('processing')
      let start = null
      let freeformPoints = []
      let confirming = false

      const confirmAfterPaint = (createPayload) => {
        if (confirming) return
        confirming = true
        start = null
        surface.style.pointerEvents = 'none'
        document.body.style.cursor = 'wait'
        processing.classList.add('visible')
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.setTimeout(() => {
              const payload = createPayload()
              if (payload) window.electronAPI.completeScreenAreaSelection(payload)
              else {
                confirming = false
                surface.style.pointerEvents = ''
                document.body.style.cursor = ''
                processing.classList.remove('visible')
                clear()
              }
            }, 32)
          })
        })
      }

      const rectFrom = (first, second) => ({
        x: Math.min(first.x, second.x),
        y: Math.min(first.y, second.y),
        width: Math.abs(second.x - first.x),
        height: Math.abs(second.y - first.y),
      })

      const boundsFromPoints = (points) => {
        const xs = points.map((point) => point.x)
        const ys = points.map((point) => point.y)
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
      }

      const pointFrom = (event) => ({
        x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
        y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
      })

      const pathFrom = (points) => points.length
        ? 'M ' + points.map((point) => point.x + ' ' + point.y).join(' L ') + ' Z'
        : ''

      const drawSize = (rect) => {
        size.style.display = 'block'
        size.textContent = Math.round(rect.width) + ' x ' + Math.round(rect.height)
        size.style.left = Math.max(8, Math.min(window.innerWidth - 88, rect.x)) + 'px'
        size.style.top = (rect.y > 38 ? rect.y - 32 : Math.min(window.innerHeight - 30, rect.y + rect.height + 8)) + 'px'
      }

      const drawRectangle = (rect) => {
        selection.style.display = 'block'
        selection.style.left = rect.x + 'px'
        selection.style.top = rect.y + 'px'
        selection.style.width = rect.width + 'px'
        selection.style.height = rect.height + 'px'
        rectangleHole.setAttribute('x', String(rect.x))
        rectangleHole.setAttribute('y', String(rect.y))
        rectangleHole.setAttribute('width', String(rect.width))
        rectangleHole.setAttribute('height', String(rect.height))
        drawSize(rect)
      }

      const drawFreeform = (points) => {
        const path = pathFrom(points)
        freeformHole.setAttribute('d', path)
        outline.setAttribute('d', path)
        outline.style.display = 'block'
        drawSize(boundsFromPoints(points))
      }

      const clear = () => {
        selection.style.display = 'none'
        outline.style.display = 'none'
        size.style.display = 'none'
        rectangleHole.setAttribute('width', '0')
        rectangleHole.setAttribute('height', '0')
        freeformHole.setAttribute('d', '')
        outline.setAttribute('d', '')
        freeformPoints = []
      }

      const createFreeformImage = (points, rect) => {
        const scaleX = screenImage.naturalWidth / window.innerWidth
        const scaleY = screenImage.naturalHeight / window.innerHeight
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(rect.width * scaleX))
        canvas.height = Math.max(1, Math.round(rect.height * scaleY))
        const context = canvas.getContext('2d')
        if (!context) return null
        context.beginPath()
        points.forEach((point, index) => {
          const x = (point.x - rect.x) * scaleX
          const y = (point.y - rect.y) * scaleY
          if (index === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        })
        context.closePath()
        context.clip()
        context.drawImage(
          screenImage,
          rect.x * scaleX,
          rect.y * scaleY,
          rect.width * scaleX,
          rect.height * scaleY,
          0,
          0,
          canvas.width,
          canvas.height,
        )
        return canvas.toDataURL('image/png')
      }

      surface.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || confirming) return
        event.preventDefault()
        start = pointFrom(event)
        freeformPoints = selectionMode === 'freeform' ? [start] : []
        surface.setPointerCapture(event.pointerId)
        if (selectionMode === 'rectangle') drawRectangle({ x: start.x, y: start.y, width: 0, height: 0 })
        else drawFreeform(freeformPoints)
      })

      surface.addEventListener('pointermove', (event) => {
        if (!start || (event.buttons & 1) !== 1) return
        const point = pointFrom(event)
        if (selectionMode === 'rectangle') {
          drawRectangle(rectFrom(start, point))
          return
        }
        const previous = freeformPoints.at(-1)
        if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 2) return
        freeformPoints.push(point)
        drawFreeform(freeformPoints)
      })

      surface.addEventListener('pointerup', (event) => {
        if (!start || confirming) return
        const dragStart = start
        const point = pointFrom(event)
        start = null
        if (selectionMode === 'rectangle') {
          const rect = rectFrom(dragStart, point)
          if (rect.width < 8 || rect.height < 8) { clear(); return }
          confirmAfterPaint(() => ({ mode: 'rectangle', rect }))
          return
        }
        freeformPoints.push(point)
        const rect = boundsFromPoints(freeformPoints)
        if (freeformPoints.length < 3 || rect.width < 8 || rect.height < 8) { clear(); return }
        const confirmedPoints = [...freeformPoints]
        confirmAfterPaint(() => {
          const imageDataUrl = createFreeformImage(confirmedPoints, rect)
          return imageDataUrl ? { mode: 'freeform', rect, imageDataUrl } : null
        })
      })

      surface.addEventListener('pointercancel', () => { if (!confirming) { start = null; clear() } })
      window.addEventListener('contextmenu', (event) => { event.preventDefault(); if (!confirming) window.electronAPI.completeScreenAreaSelection(null) })
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !confirming) window.electronAPI.completeScreenAreaSelection(null)
      })
    </script>
  </body>
</html>`

export async function selectScreenCaptureArea(input: {
  display: Display
  image: NativeImage
  preloadPath: string
  mode: ScreenCaptureSelectionMode
}): Promise<ScreenCaptureAreaResult | null> {
  const { display, image, preloadPath, mode } = input
  const displaySize = { width: display.bounds.width, height: display.bounds.height }
  const captureWindow = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#05070a',
    title: 'LifeOS Screen Capture',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  captureWindow.setMenuBarVisibility(false)
  captureWindow.setAlwaysOnTop(true, 'screen-saver')
  captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  return new Promise((resolve) => {
    let settled = false
    const finish = (payload: unknown) => {
      if (settled) return
      settled = true
      ipcMain.removeListener(SCREEN_CAPTURE_AREA_SELECTED_CHANNEL, handleSelection)

      const candidate =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
      const normalized = normalizeScreenCaptureSelection(candidate?.rect, displaySize)
      let selectedImage: NativeImage | null = null
      if (normalized && candidate?.mode === 'rectangle' && mode === 'rectangle') {
        selectedImage = image.crop(
          scaleScreenCaptureSelection(normalized, displaySize, image.getSize()),
        )
      } else if (
        normalized &&
        candidate?.mode === 'freeform' &&
        mode === 'freeform' &&
        typeof candidate.imageDataUrl === 'string' &&
        candidate.imageDataUrl.startsWith('data:image/png;base64,') &&
        candidate.imageDataUrl.length <= 64 * 1024 * 1024
      ) {
        try {
          const freeformImage = nativeImage.createFromDataURL(candidate.imageDataUrl)
          const expectedSize = scaleScreenCaptureSelection(normalized, displaySize, image.getSize())
          const actualSize = freeformImage.getSize()
          if (
            Math.abs(actualSize.width - expectedSize.width) <= 2 &&
            Math.abs(actualSize.height - expectedSize.height) <= 2
          ) {
            selectedImage = freeformImage
          }
        } catch {
          selectedImage = null
        }
      }

      if (!captureWindow.isDestroyed()) captureWindow.destroy()
      resolve(
        normalized && selectedImage && !selectedImage.isEmpty()
          ? { image: selectedImage, selection: normalized }
          : null,
      )
    }
    const handleSelection = (event: Electron.IpcMainEvent, selection: unknown) => {
      if (event.sender !== captureWindow.webContents) return
      finish(selection)
    }

    ipcMain.on(SCREEN_CAPTURE_AREA_SELECTED_CHANNEL, handleSelection)
    captureWindow.once('closed', () => finish(null))

    void captureWindow
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createSelectionHtml(mode))}`)
      .then(() =>
        captureWindow.webContents.executeJavaScript(
          `new Promise((resolve, reject) => { const image = document.getElementById('screen'); image.onload = () => resolve(true); image.onerror = () => reject(new Error('Unable to load screen capture.')); image.src = ${JSON.stringify(image.toDataURL())}; })`,
          true,
        ),
      )
      .then(() => {
        if (captureWindow.isDestroyed()) return
        captureWindow.show()
        captureWindow.focus()
      })
      .catch(() => finish(null))
  })
}

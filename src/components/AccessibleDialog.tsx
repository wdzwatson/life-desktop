import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { ViewportPortal } from './ViewportPortal'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let openDialogCount = 0
let previousBodyOverflow = ''
let previousBodyOverscrollBehavior = ''
const DIALOG_EXIT_MS = 220

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function playDetachedExitAnimation(overlay: HTMLDivElement) {
  if (prefersReducedMotion() || overlay.classList.contains('is-closing')) return
  const visualClone = overlay.cloneNode(true) as HTMLDivElement
  visualClone.classList.add('is-closing', 'dialog-overlay--detached')
  visualClone.setAttribute('aria-hidden', 'true')
  visualClone.setAttribute('inert', '')
  document.body.appendChild(visualClone)
  window.setTimeout(() => visualClone.remove(), DIALOG_EXIT_MS)
}

function lockDocumentScroll() {
  if (openDialogCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    previousBodyOverscrollBehavior = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'contain'
  }
  openDialogCount += 1

  return () => {
    openDialogCount = Math.max(0, openDialogCount - 1)
    if (openDialogCount > 0) return
    document.body.style.overflow = previousBodyOverflow
    document.body.style.overscrollBehavior = previousBodyOverscrollBehavior
  }
}

function getEnabledFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !('disabled' in element) || !(element as HTMLButtonElement).disabled,
  )
}

export function getTrappedFocusIndex(currentIndex: number, itemCount: number, shiftKey: boolean) {
  if (itemCount <= 0) return -1
  if (currentIndex < 0) return shiftKey ? itemCount - 1 : 0
  return shiftKey ? (currentIndex - 1 + itemCount) % itemCount : (currentIndex + 1) % itemCount
}

export function shouldRestoreDialogFocus(element: Pick<HTMLElement, 'isConnected'> | null) {
  return !element?.isConnected
}

type AccessibleDialogProps = {
  title: ReactNode
  children: ReactNode
  onClose: () => void
  returnFocus?: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
  overlayStyle?: CSSProperties
  contentStyle?: CSSProperties
  titleStyle?: CSSProperties
  role?: 'dialog' | 'alertdialog'
  overlayClassName?: string
  contentClassName?: string
  closeOnOverlay?: boolean
  animateExit?: boolean
  motionOverlayRef?: RefObject<HTMLDivElement | null>
  motionPanelRef?: RefObject<HTMLElement | null>
}

export function AccessibleDialog({
  title,
  children,
  onClose,
  returnFocus,
  initialFocusRef,
  overlayStyle,
  contentStyle,
  titleStyle,
  role = 'dialog',
  overlayClassName,
  contentClassName,
  closeOnOverlay = false,
  animateExit = true,
  motionOverlayRef,
  motionPanelRef,
}: AccessibleDialogProps) {
  const titleId = useId()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const latestOnCloseRef = useRef(onClose)
  const latestReturnFocusRef = useRef(returnFocus)
  const latestInitialFocusRef = useRef(initialFocusRef)
  latestOnCloseRef.current = onClose
  latestReturnFocusRef.current = returnFocus
  latestInitialFocusRef.current = initialFocusRef

  const setOverlayElement = useCallback(
    (element: HTMLDivElement | null) => {
      overlayRef.current = element
      if (motionOverlayRef) motionOverlayRef.current = element
    },
    [motionOverlayRef],
  )
  const setContentElement = useCallback(
    (element: HTMLDivElement | null) => {
      contentRef.current = element
      if (motionPanelRef) motionPanelRef.current = element
    },
    [motionPanelRef],
  )

  const requestClose = useCallback(() => {
    if (isClosing) return
    if (!animateExit || prefersReducedMotion()) {
      latestOnCloseRef.current()
      return
    }
    setIsClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      latestOnCloseRef.current()
    }, DIALOG_EXIT_MS)
  }, [animateExit, isClosing])

  useLayoutEffect(() => {
    const mountedOverlay = overlayRef.current
    return () => {
      if (animateExit && mountedOverlay) playDetachedExitAnimation(mountedOverlay)
    }
  }, [animateExit])

  useEffect(() => {
    const unlockDocumentScroll = lockDocumentScroll()
    const mountedContent = contentRef.current
    const initialTarget = latestInitialFocusRef.current?.current
    const enabledInitialTarget =
      initialTarget &&
      (!('disabled' in initialTarget) || !(initialTarget as HTMLButtonElement).disabled)
        ? initialTarget
        : null
    const firstFocusable = mountedContent ? getEnabledFocusableElements(mountedContent)[0] : null
    const focusTarget = enabledInitialTarget ?? firstFocusable ?? mountedContent
    focusTarget?.focus()

    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
      unlockDocumentScroll()
      queueMicrotask(() => {
        if (shouldRestoreDialogFocus(mountedContent)) latestReturnFocusRef.current?.()
      })
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
      return
    }
    if (event.key !== 'Tab') return

    const items = getEnabledFocusableElements(event.currentTarget)
    event.preventDefault()
    const currentIndex = items.findIndex((item) => item === document.activeElement)
    const nextIndex = getTrappedFocusIndex(currentIndex, items.length, event.shiftKey)
    if (nextIndex >= 0) items[nextIndex].focus()
  }

  return (
    <ViewportPortal>
      <div
        ref={setOverlayElement}
        data-manages-exit={animateExit ? 'true' : undefined}
        className={`dialog-overlay${isClosing ? ' is-closing' : ''}${overlayClassName ? ` ${overlayClassName}` : ''}`}
        style={overlayStyle}
        onMouseDown={(event) => {
          if (closeOnOverlay && event.target === event.currentTarget) requestClose()
        }}
      >
        <div
          ref={setContentElement}
          className={`dialog-surface${contentClassName ? ` ${contentClassName}` : ''}`}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          style={contentStyle}
          onKeyDown={handleKeyDown}
        >
          <h3 id={titleId} style={titleStyle}>
            {title}
          </h3>
          {children}
        </div>
      </div>
    </ViewportPortal>
  )
}

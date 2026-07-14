import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

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

type AccessibleDialogProps = {
  title: ReactNode
  children: ReactNode
  onClose: () => void
  returnFocus?: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
  overlayStyle?: CSSProperties
  contentStyle?: CSSProperties
  titleStyle?: CSSProperties
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
}: AccessibleDialogProps) {
  const titleId = useId()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const latestOnCloseRef = useRef(onClose)
  const latestReturnFocusRef = useRef(returnFocus)
  const latestInitialFocusRef = useRef(initialFocusRef)
  latestOnCloseRef.current = onClose
  latestReturnFocusRef.current = returnFocus
  latestInitialFocusRef.current = initialFocusRef

  useEffect(() => {
    const content = contentRef.current
    const initialTarget = latestInitialFocusRef.current?.current
    const enabledInitialTarget =
      initialTarget &&
      (!('disabled' in initialTarget) || !(initialTarget as HTMLButtonElement).disabled)
        ? initialTarget
        : null
    const firstFocusable = content ? getEnabledFocusableElements(content)[0] : null
    const focusTarget = enabledInitialTarget ?? firstFocusable ?? content
    focusTarget?.focus()

    return () => {
      latestReturnFocusRef.current?.()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      latestOnCloseRef.current()
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
    <div style={overlayStyle}>
      <div
        ref={contentRef}
        role="dialog"
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
  )
}

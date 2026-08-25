import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibleDialog } from './AccessibleDialog'
import { Checkbox } from './Checkbox'

type ConfirmationTone = 'danger' | 'primary'

type ConfirmationOptions = {
  title?: ReactNode
  description: ReactNode
  confirmLabel?: ReactNode
  tone?: ConfirmationTone
  checkboxLabel?: ReactNode
  checkboxDefaultChecked?: boolean
  onConfirm?: (options: { checkboxChecked: boolean }) => void
}

type PendingConfirmation = ConfirmationOptions & {
  resolve: (confirmed: boolean) => void
  returnFocus: HTMLElement | null
}

type ConfirmationContextValue = {
  confirm: (options: ConfirmationOptions) => Promise<boolean>
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null)

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const pendingRef = useRef<PendingConfirmation | null>(null)
  const checkboxCheckedRef = useRef(false)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  const close = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    setPending(null)
    if (confirmed) current.onConfirm?.({ checkboxChecked: checkboxCheckedRef.current })
    current.resolve(confirmed)
  }, [])

  const confirm = useCallback((options: ConfirmationOptions) => {
    return new Promise<boolean>((resolve) => {
      if (pendingRef.current) pendingRef.current.resolve(false)
      const request = {
        ...options,
        resolve,
        returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      }
      checkboxCheckedRef.current = options.checkboxDefaultChecked === true
      pendingRef.current = request
      setPending(request)
    })
  }, [])

  useEffect(
    () => () => {
      pendingRef.current?.resolve(false)
    },
    [],
  )

  return (
    <ConfirmationContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <AccessibleDialog
          title={pending.title ?? t('common.confirm')}
          role="alertdialog"
          onClose={() => close(false)}
          returnFocus={() => pending.returnFocus?.focus()}
          initialFocusRef={cancelButtonRef}
          contentClassName="app-confirm-dialog"
        >
          <p className="app-confirm-dialog__copy">{pending.description}</p>
          {pending.checkboxLabel && (
            <Checkbox
              label={pending.checkboxLabel}
              labelClassName="app-confirm-dialog__checkbox"
              defaultChecked={pending.checkboxDefaultChecked === true}
              onChange={(event) => {
                checkboxCheckedRef.current = event.target.checked
              }}
            />
          )}
          <div className="app-confirm-dialog__actions">
            <button ref={cancelButtonRef} type="button" className="btn" onClick={() => close(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={`btn ${pending.tone === 'danger' ? 'danger' : 'primary'}`}
              onClick={() => close(true)}
            >
              {pending.confirmLabel ?? t('common.confirm')}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </ConfirmationContext.Provider>
  )
}

export function useConfirmation() {
  const context = useContext(ConfirmationContext)
  if (!context) throw new Error('useConfirmation must be used within ConfirmationProvider')
  return context
}

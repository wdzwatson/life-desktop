import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react'

export type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'style' | 'type'> & {
  boxClassName?: string
  className?: string
  indeterminate?: boolean
  label?: ReactNode
  labelClassName?: string
  style?: CSSProperties
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    boxClassName,
    className,
    disabled,
    indeterminate = false,
    label,
    labelClassName,
    style,
    ...inputProps
  },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  const control = (
    <span
      className={['checkbox', className, disabled ? 'is-disabled' : '']
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      <input
        {...inputProps}
        ref={inputRef}
        className="checkbox__input"
        type="checkbox"
        disabled={disabled}
      />
      <span
        className={['checkbox__box', boxClassName].filter(Boolean).join(' ')}
        aria-hidden="true"
      />
    </span>
  )

  if (!label) return control

  return (
    <label
      className={['checkbox-field', labelClassName, disabled ? 'is-disabled' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {control}
      <span className="checkbox-field__label">{label}</span>
    </label>
  )
})

Checkbox.displayName = 'Checkbox'

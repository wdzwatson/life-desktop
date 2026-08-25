import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react'

export type SwitchProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'className' | 'style' | 'type'
> & {
  className?: string
  label?: ReactNode
  labelClassName?: string
  style?: CSSProperties
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { className, disabled, label, labelClassName, style, ...inputProps },
  forwardedRef,
) {
  const control = (
    <span
      className={['switch', className, disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}
      style={style}
    >
      <input
        {...inputProps}
        ref={forwardedRef}
        className="switch__input"
        type="checkbox"
        role="switch"
        disabled={disabled}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </span>
  )

  if (!label) return control

  return (
    <label className={['switch-field', labelClassName, disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
      {control}
      <span className="switch-field__label">{label}</span>
    </label>
  )
})

Switch.displayName = 'Switch'
